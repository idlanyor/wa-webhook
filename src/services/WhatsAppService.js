import { WaClient, createStore, parsePhoneJid } from 'zapo-js';
import { createMongoStore } from '@zapo-js/store-mongo';
import { createMediaProcessor } from '@zapo-js/media-utils';
import { Readable } from 'stream';
import { config } from '../config/index.js';
import Setting from '../models/Setting.js';
import AutoReply from '../models/AutoReply.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import MessageService from './MessageService.js';
import { info, error as logError, warn } from '../utils/logger.js';

/**
 * Shared zapo store. Backed by MongoDB — one `store` instance is reused by
 * every session; each account is keyed by `sessionId` = userId.
 *
 * `sessionId` is the durable key: same id across restarts resumes the same
 * paired device. The app persists its own message archive in Mongo (the
 * Message model), so the zapo mailbox domains (`messages`/`threads`/`contacts`)
 * are disabled to save bandwidth.
 */
let _store = null;
function getStore() {
    if (!_store) {
        _store = createStore({
            backends: {
                mongo: createMongoStore({
                    db: {
                        uri: config.zapoStore.uri,
                        database: config.zapoStore.database
                    },
                    collectionPrefix: 'wa_'
                })
            },
            providers: {
                auth: 'mongo',
                signal: 'mongo',
                preKey: 'mongo',
                session: 'mongo',
                identity: 'mongo',
                senderKey: 'mongo',
                appState: 'mongo',
                privacyToken: 'mongo',
                messages: 'none',
                threads: 'none',
                contacts: 'none'
            }
        });
    }
    return _store;
}

class WhatsAppService {
    constructor(io) {
        this.io = io;
        this.sessions = new Map(); // userId => session object
        this.sessionPromises = new Map(); // userId => Promise<session>
        this.appSettings = {};
        this.autoReplies = new Map(); // keyword => AutoReply rule (O(1) lookup)
        this.webhookService = null;
    }

    setWebhookService(service) {
        this.webhookService = service;
    }

    /**
     * Load settings and auto-replies from database
     */
    async loadSettings() {
        try {
            // Load app settings
            const settingsData = await Setting.find({});

            this.appSettings = settingsData.reduce((acc, row) => {
                acc[row.key] = row.value;
                return acc;
            }, {});

            // Load auto-replies into a Map keyed by lowercase keyword for O(1) lookup
            const repliesData = await AutoReply.find({ enabled: true });
            this.autoReplies = new Map(
                repliesData.map(r => [String(r.keyword || '').toLowerCase().trim(), r])
            );

            info(`App settings and ${this.autoReplies.size} auto-reply rules loaded from database.`);
        } catch (error) {
            logError('Failed to load settings from database:', error);
        }
    }

    /**
     * Get session for user, create if doesn't exist
     */
    async ensureSession(userId, phoneNumber = null) {
        const userIdStr = String(userId);

        // If there is an active session creation promise, wait for it
        if (this.sessionPromises.has(userIdStr)) {
            return await this.sessionPromises.get(userIdStr);
        }

        const session = this.sessions.get(userIdStr);
        // Reuse any live client — recreating one mid-pairing invalidates the
        // pairing code and aborts QR scan in progress. Dead clients are removed
        // from the map by the connection-close handler, so a map hit implies usable.
        if (session && session.client) {
            return session;
        }

        return await this.createSession(userIdStr, phoneNumber);
    }

    /**
     * Create a new WhatsApp session for a user
     */
    async createSession(userId, phoneNumber = null) {
        const userIdStr = String(userId);

        if (this.sessionPromises.has(userIdStr)) {
            return await this.sessionPromises.get(userIdStr);
        }

        const promise = (async () => {
            let session = this.sessions.get(userIdStr);
            if (!session) {
                session = {
                    client: null,
                    isConnected: false,
                    state: 'disconnected',
                    qr: null,
                    keepAliveTimer: null,
                    user: null,
                    pairingReady: false,
                    pairingResolvers: [],
                    reconnectAttempts: 0
                };
                this.sessions.set(userIdStr, session);
            }

            // Clean up any existing client if we are re-creating
            if (session.client) {
                try {
                    await session.client.disconnect();
                } catch (e) {
                    // ignore error
                }
                session.client = null;
                session.isConnected = false;
                session.state = 'disconnected';
                session.qr = null;
            }
            // Reset pairing state for the fresh client
            session.pairingReady = false;
            session.pairingResolvers = [];

            const client = new WaClient(
                {
                    store: getStore(),
                    sessionId: userIdStr,
                    recoverFromClientTooOld: true,
                    markOnlineOnConnect: config.whatsapp.markOnlineOnConnect,
                    keepAliveIntervalMs: config.whatsapp.keepAliveIntervalMs,
                    connectTimeoutMs: 60000,
                    // Drop history-sync chunks — this app stores its own message archive
                    history: { enabled: false },
                    media: createMediaProcessor()
                }
            );

            session.client = client;
            this.setupSessionHandlers(session, userIdStr);

            // Keep-alive timer
            if (session.keepAliveTimer) {
                clearInterval(session.keepAliveTimer);
            }
            session.keepAliveTimer = setInterval(async () => {
                if (session.isConnected && session.client) {
                    try {
                        await session.client.presence.send('available');
                    } catch (error) {
                        logError('Keep-alive error:', error);
                    }
                }
            }, config.whatsapp.keepAliveIntervalMs);

            // Connect (drives pairing on first run, resumes stored credentials otherwise).
            // A failure here is non-fatal: the connection event below drives reconnection.
            try {
                await client.connect();
            } catch (error) {
                logError(`zapo connect() failed for user: ${userIdStr}`, error);
            }

            return session;
        })();

        this.sessionPromises.set(userIdStr, promise);
        try {
            return await promise;
        } finally {
            this.sessionPromises.delete(userIdStr);
        }
    }

    /**
     * Setup event handlers for a WhatsApp session
     */
    setupSessionHandlers(session, userId) {
        const { client } = session;

        // Pairing QR — rendered by the frontend
        client.on('auth_qr', ({ qr }) => {
            if (session.client !== client) return;
            info(`[auth_qr] User ${userId}: QR ready`);
            session.qr = qr;
            session.state = 'qr_ready';
            this.io.to(userId).emit('qr', qr);
            if (this.webhookService && this.appSettings.webhook_toggle_connection !== 'false') {
                this.webhookService.send('connection_status', { userId, status: 'qr_ready' });
            }
        });

        // 8-character pairing code was issued
        client.on('auth_pairing_code', ({ code }) => {
            if (session.client !== client) return;
            this.io.to(userId).emit('pairing_code', code);
        });

        // Server is ready to accept pairing input — resolve pending pairing-code requests
        client.on('auth_pairing_required', () => {
            if (session.client !== client) return;
            info(`[auth_pairing_required] User ${userId}: server ready for pairing`);
            session.pairingReady = true;
            const resolvers = session.pairingResolvers;
            session.pairingResolvers = [];
            for (const resolve of resolvers) resolve();
        });

        // Pairing succeeded — persist on User so the session is preloaded on next boot
        client.on('auth_paired', ({ credentials }) => {
            if (session.client !== client) return;
            info(`WhatsApp paired for user: ${userId} (${credentials.meJid})`);
            session.lastPairing = null;
            User.updateOne({ _id: userId }, { $set: { waSessionId: userId } })
                .catch(err => logError('Failed to mark user as WhatsApp-linked:', err));
        });

        // Passkey-gated account (informational)
        client.on('auth_passkey_required', ({ hasSigner }) => {
            if (session.client !== client) return;
            if (!hasSigner) {
                warn(`Account ${userId} requires a passkey (Shortcake) to link; no signer configured.`);
            }
        });

        // Connection status
        client.on('connection', (event) => {
            if (session.client !== client) return;

            if (event.status === 'open') {
                session.reconnectAttempts = 0;
                const creds = client.getCredentials();
                session.isConnected = true;
                session.state = 'connected';
                session.qr = null;
                session.user = creds ? { id: creds.meJid, name: creds.pushName } : null;
                this.io.to(userId).emit('connection_status', {
                    status: 'connected',
                    user: session.user
                });
                info(`WhatsApp connected for user: ${userId}`);
                if (this.webhookService && this.appSettings.webhook_toggle_connection !== 'false') {
                    this.webhookService.send('connection_status', { userId, status: 'connected' });
                }
                return;
            }

            if (event.status === 'close') {
                warn(`WhatsApp connection closed for user ${userId}. Reason: ${event.reason}, Code: ${event.code}, isLogout: ${event.isLogout}`);

                session.isConnected = false;
                session.state = 'disconnected';
                session.qr = null;
                this.io.to(userId).emit('connection_status', { status: 'disconnected' });
                if (this.webhookService && this.appSettings.webhook_toggle_connection !== 'false') {
                    this.webhookService.send('connection_status', { userId, status: 'disconnected' });
                }

                if (session.keepAliveTimer) {
                    clearInterval(session.keepAliveTimer);
                    session.keepAliveTimer = null;
                }

                if (event.isLogout) {
                    info(`Logout detected for user ${userId}; clearing session.`);
                    this.sessions.delete(userId);
                    User.updateOne({ _id: userId }, { $set: { waSessionId: null } })
                        .catch(err => logError('Failed to clear WhatsApp-link marker:', err));
                } else if (!session.user && !client.getCredentials()?.meJid) {
                    // Never paired — don't auto-reconnect; user must initiate from dashboard
                    info(`Unpaired session closed for user ${userId}; not reconnecting.`);
                    this.sessions.delete(userId);
                } else if (session.reconnectAttempts < 10) {
                    // Transient drop — reconnect with stored credentials, exponential backoff
                    const delayMs = Math.min(30000, 1000 * 2 ** session.reconnectAttempts);
                    session.reconnectAttempts += 1;
                    info(`Reconnecting for user ${userId} in ${delayMs}ms (attempt ${session.reconnectAttempts})...`);
                    setTimeout(() => this.ensureSession(userId), delayMs);
                } else {
                    warn(`Giving up reconnecting for user ${userId} after ${session.reconnectAttempts} attempts.`);
                }
            }
        });

        // Incoming messages
        client.on('message', async (event) => {
            if (session.client !== client) return;
            await this.handleIncomingMessage(event, userId, client);
        });
    }

    /**
     * Handle incoming messages and auto-replies
     */
    async handleIncomingMessage(event, userId, client) {
        const { key, message } = event;

        // Multi-device sync echoes our own outgoing messages — inbound only
        if (key.fromMe) return;

        const incomingContent = this.unwrapMessageContent(message);
        const messageText = incomingContent?.conversation ||
            incomingContent?.extendedTextMessage?.text ||
            incomingContent?.documentMessage?.caption ||
            incomingContent?.imageMessage?.caption ||
            incomingContent?.videoMessage?.caption || '';
        const attachment = this.extractAttachment(incomingContent);
        const messageType = attachment?.type || 'text';

        // Handle quoted messages
        const contextInfo = message?.extendedTextMessage?.contextInfo;
        let quotedText = null;
        let quotedSender = null;
        let replyToId = null;

        if (contextInfo?.quotedMessage) {
            quotedText = contextInfo.quotedMessage.conversation ||
                contextInfo.quotedMessage.extendedTextMessage?.text || '...';
            quotedSender = contextInfo.participant;

            // Find the original message ID in database
            const repliedToMsg = await Message.findOne({
                stanzaId: contextInfo.stanzaId,
                userId: userId
            });

            if (repliedToMsg) replyToId = repliedToMsg._id;
        }

        // Record incoming message
        const recordedMessage = await MessageService.recordMessage({
            userId,
            chatJid: key.remoteJid,
            sender: event.pushName || key.participant || key.remoteJid,
            senderJid: key.participant || key.remoteJid,
            text: messageText,
            messageType,
            attachment,
            direction: 'in',
            timestamp: (event.timestampSeconds || Date.now() / 1000) * 1000,
            stanzaId: key.id,
            rawMessage: null, // not stored to save space; stanzaId is sufficient for reply
            replyToId: replyToId,
            quotedText: quotedText,
            quotedSender: quotedSender
        });

        if (recordedMessage) {
            this.io.to(userId).emit('new_message', {
                ...recordedMessage.toObject(),
                id: recordedMessage._id,
                chat_jid: recordedMessage.chatJid
            });
            if (this.webhookService && this.appSettings.webhook_toggle_message_in !== 'false') {
                this.webhookService.send('message.in', {
                    userId,
                    id: recordedMessage._id,
                    chatJid: recordedMessage.chatJid,
                    sender: recordedMessage.sender,
                    text: recordedMessage.message,
                    messageType: recordedMessage.messageType,
                    attachment: recordedMessage.attachment,
                    timestamp: recordedMessage.timestamp
                });
            }
        }

        // Handle auto-reply
        await this.handleAutoReply(messageText, event, userId, client, replyToId, quotedText, quotedSender);
    }

    /**
     * Handle auto-reply logic
     */
    async handleAutoReply(messageText, event, userId, client, replyToId, quotedText, quotedSender) {
        const autoReplyEnabled = this.appSettings.auto_reply_enabled !== 'false';

        if (autoReplyEnabled && !event.key.remoteJid.endsWith('@g.us') && messageText) {
            const lowerText = messageText.trim().toLowerCase();

            // O(1) Map lookup: find a keyword that the message contains
            let rule = null;
            for (const [keyword, r] of this.autoReplies) {
                if (keyword && lowerText.includes(keyword)) {
                    rule = r;
                    break;
                }
            }

            if (rule) {
                try {
                    const result = await client.message.send(event.key.remoteJid, rule.reply);

                    // Record auto-reply message
                    const recordedReply = await MessageService.recordMessage({
                        userId,
                        chatJid: event.key.remoteJid,
                        sender: 'auto-reply',
                        text: rule.reply,
                        messageType: 'text',
                        direction: 'out',
                        timestamp: Date.now(),
                        stanzaId: result.id,
                        rawMessage: null,
                        replyToId: replyToId,
                        quotedText: quotedText,
                        quotedSender: quotedSender,
                        senderJid: this._ownJid(client)
                    });

                    if (recordedReply) {
                        this.io.to(userId).emit('new_message', {
                            ...recordedReply.toObject(),
                            id: recordedReply._id,
                            chat_jid: recordedReply.chatJid
                        });
                    }
                } catch (error) {
                    logError('Auto-reply error:', error);
                }
            }
        }
    }

    /**
     * Resolve the account's own base JID (device suffix stripped).
     * @private
     */
    _ownJid(client) {
        const meJid = client?.getCredentials?.()?.meJid;
        return meJid ? meJid.replace(/:.*$/, '@s.whatsapp.net') : undefined;
    }

    /**
     * Resolve reply-to quoted info from database (shared by sendMessage & sendDocumentMessage).
     * Returns a `WaMessageKey`-shaped `quote` for zapo's `options.quote`.
     * @private
     */
    async _getQuotedInfo(userId, replyToId) {
        if (!replyToId) return { quote: undefined, quotedDbRecord: null };

        const data = await Message.findOne({ _id: replyToId, userId });
        if (!data) return { quote: undefined, quotedDbRecord: null };

        return {
            quotedDbRecord: data,
            quote: {
                remoteJid: data.chatJid,
                id: data.stanzaId,
                fromMe: data.direction === 'out',
                participant: data.senderJid
            }
        };
    }

    /**
     * Resolve a raw "to" value (phone number or JID) to the canonical WhatsApp JID.
     * Numbers that have never been chatted with may resolve to a different JID than
     * the naive `{number}@s.whatsapp.net` guess (e.g. after WhatsApp's LID migration),
     * so we verify via getLidsByPhoneNumbers before sending instead of guessing blindly.
     */
    async _resolveTargetJid(client, to) {
        if (to.includes('@')) {
            return to;
        }

        const digits = to.replace(/[^\d]/g, '');
        const guessJid = parsePhoneJid(digits);

        try {
            const [result] = await client.profile.getLidsByPhoneNumbers([digits]);
            if (result?.exists) return result.lidJid || result.phoneJid || guessJid;
            throw new Error(`Number ${digits} is not registered on WhatsApp`);
        } catch (error) {
            if (error.message?.includes('not registered')) throw error;
            logError('getLidsByPhoneNumbers check failed, falling back to guessed JID:', error);
            return guessJid;
        }
    }

    /**
     * Send a message via WhatsApp
     */
    async sendMessage(userId, to, message, replyToId = null) {
        const session = await this.ensureSession(userId);

        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const phone = await this._resolveTargetJid(session.client, to);

        const { quote, quotedDbRecord } = await this._getQuotedInfo(userId, replyToId);

        const result = await session.client.message.send(phone, message, quote ? { quote } : undefined);

        // Record outgoing message
        const recordedOutgoing = await MessageService.recordMessage({
            userId,
            chatJid: phone,
            sender: 'me',
            text: message,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.id,
            rawMessage: null,
            replyToId: replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: this._ownJid(session.client)
        });

        if (recordedOutgoing) {
            this.io.to(userId).emit('new_message', {
                ...recordedOutgoing.toObject(),
                id: recordedOutgoing._id,
                chat_jid: recordedOutgoing.chatJid
            });
            if (this.webhookService && this.appSettings.webhook_toggle_message_out !== 'false') {
                this.webhookService.send('message.out', {
                    userId,
                    id: recordedOutgoing._id,
                    chatJid: recordedOutgoing.chatJid,
                    sender: recordedOutgoing.sender,
                    text: recordedOutgoing.message,
                    messageType: recordedOutgoing.messageType,
                    attachment: recordedOutgoing.attachment,
                    timestamp: recordedOutgoing.timestamp
                });
            }
        }

        return result;
    }

    extractAttachment(rawMessage = {}) {
        const mediaTypes = [
            ['documentMessage', 'document'],
            ['imageMessage', 'image'],
            ['videoMessage', 'video'],
            ['audioMessage', 'audio'],
            ['stickerMessage', 'sticker']
        ];

        for (const [key, type] of mediaTypes) {
            const media = rawMessage?.[key];
            if (!media) continue;

            return {
                type,
                fileName: media.fileName || null,
                mimetype: media.mimetype || null,
                caption: media.caption || null,
                fileLength: media.fileLength ? String(media.fileLength) : null,
                mediaKeyTimestamp: media.mediaKeyTimestamp ? String(media.mediaKeyTimestamp) : null
            };
        }

        return null;
    }

    unwrapMessageContent(rawMessage = {}) {
        let content = rawMessage;

        for (let i = 0; i < 5; i++) {
            if (content?.ephemeralMessage?.message) {
                content = content.ephemeralMessage.message;
                continue;
            }

            if (content?.viewOnceMessage?.message) {
                content = content.viewOnceMessage.message;
                continue;
            }

            if (content?.viewOnceMessageV2?.message) {
                content = content.viewOnceMessageV2.message;
                continue;
            }

            if (content?.documentWithCaptionMessage?.message) {
                content = content.documentWithCaptionMessage.message;
                continue;
            }

            break;
        }

        return content;
    }

    /**
     * Download a URL into a Readable stream for zapo's media input.
     * @private
     */
    async _fetchUrlToStream(url) {
        const res = await fetch(url);
        if (!res.ok || !res.body) {
            throw new Error(`Failed to download document: HTTP ${res.status}`);
        }
        return Readable.fromWeb(res.body);
    }

    /**
     * Send a document attachment via WhatsApp
     */
    async sendDocumentMessage(userId, to, document, replyToId = null) {
        const session = await this.ensureSession(userId);

        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const {
            url,
            base64,
            buffer,
            caption,
            fileName,
            filename,
            mimetype = 'application/octet-stream'
        } = document;

        if (!url && !base64 && !buffer) {
            throw new Error('Either "url", "base64", or "buffer" is required for document');
        }

        const normalizedBase64 = base64?.includes(',')
            ? base64.slice(base64.indexOf(',') + 1)
            : base64;

        const media = url
            ? await this._fetchUrlToStream(url)
            : (buffer || Buffer.from(normalizedBase64, 'base64'));

        const phone = await this._resolveTargetJid(session.client, to);

        const { quote, quotedDbRecord } = await this._getQuotedInfo(userId, replyToId);

        const result = await session.client.message.send(phone, {
            type: 'document',
            media,
            mimetype,
            fileName: fileName || filename || 'document',
            ...(caption ? { caption } : {})
        }, quote ? { quote } : undefined);

        const attachment = {
            type: 'document',
            fileName: fileName || filename || 'document',
            mimetype: mimetype,
            caption: caption || null,
            url: url || null
        };

        const recordedOutgoing = await MessageService.recordMessage({
            userId,
            chatJid: phone,
            sender: 'me',
            text: caption || fileName || filename || 'document',
            messageType: 'document',
            attachment,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.id,
            rawMessage: null,
            replyToId: replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: this._ownJid(session.client)
        });

        if (recordedOutgoing) {
            this.io.to(userId).emit('new_message', {
                ...recordedOutgoing.toObject(),
                id: recordedOutgoing._id,
                chat_jid: recordedOutgoing.chatJid
            });
            if (this.webhookService && this.appSettings.webhook_toggle_message_out !== 'false') {
                this.webhookService.send('message.out', {
                    userId,
                    id: recordedOutgoing._id,
                    chatJid: recordedOutgoing.chatJid,
                    sender: recordedOutgoing.sender,
                    text: recordedOutgoing.message,
                    messageType: recordedOutgoing.messageType,
                    attachment: recordedOutgoing.attachment,
                    timestamp: recordedOutgoing.timestamp
                });
            }
        }

        return result;
    }

    /**
     * Send an image via WhatsApp
     */
    async sendImageMessage(userId, to, mediaData, replyToId = null) {
        const session = await this.ensureSession(userId);

        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const {
            url,
            base64,
            buffer,
            caption,
            mimetype = 'image/jpeg'
        } = mediaData;

        if (!url && !base64 && !buffer) {
            throw new Error('Either "url", "base64", or "buffer" is required for image');
        }

        const normalizedBase64 = base64?.includes(',')
            ? base64.slice(base64.indexOf(',') + 1)
            : base64;

        const media = url
            ? await this._fetchUrlToStream(url)
            : (buffer || Buffer.from(normalizedBase64, 'base64'));

        const phone = await this._resolveTargetJid(session.client, to);
        const { quote, quotedDbRecord } = await this._getQuotedInfo(userId, replyToId);

        const result = await session.client.message.send(phone, {
            type: 'image',
            media,
            mimetype,
            ...(caption ? { caption } : {})
        }, quote ? { quote } : undefined);

        const attachment = {
            type: 'image',
            mimetype,
            caption: caption || null,
            url: url || null
        };

        const recordedOutgoing = await MessageService.recordMessage({
            userId,
            chatJid: phone,
            sender: 'me',
            text: caption || 'image',
            messageType: 'image',
            attachment,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.id,
            rawMessage: null,
            replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: this._ownJid(session.client)
        });

        if (recordedOutgoing) {
            this.io.to(userId).emit('new_message', {
                ...recordedOutgoing.toObject(),
                id: recordedOutgoing._id,
                chat_jid: recordedOutgoing.chatJid
            });
            if (this.webhookService && this.appSettings.webhook_toggle_message_out !== 'false') {
                this.webhookService.send('message.out', {
                    userId,
                    id: recordedOutgoing._id,
                    chatJid: recordedOutgoing.chatJid,
                    sender: recordedOutgoing.sender,
                    text: recordedOutgoing.message,
                    messageType: recordedOutgoing.messageType,
                    attachment: recordedOutgoing.attachment,
                    timestamp: recordedOutgoing.timestamp
                });
            }
        }

        return result;
    }

    /**
     * Send a video via WhatsApp
     */
    async sendVideoMessage(userId, to, mediaData, replyToId = null) {
        const session = await this.ensureSession(userId);

        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const {
            url,
            base64,
            buffer,
            caption,
            mimetype = 'video/mp4'
        } = mediaData;

        if (!url && !base64 && !buffer) {
            throw new Error('Either "url", "base64", or "buffer" is required for video');
        }

        const normalizedBase64 = base64?.includes(',')
            ? base64.slice(base64.indexOf(',') + 1)
            : base64;

        const media = url
            ? await this._fetchUrlToStream(url)
            : (buffer || Buffer.from(normalizedBase64, 'base64'));

        const phone = await this._resolveTargetJid(session.client, to);
        const { quote, quotedDbRecord } = await this._getQuotedInfo(userId, replyToId);

        const result = await session.client.message.send(phone, {
            type: 'video',
            media,
            mimetype,
            ...(caption ? { caption } : {})
        }, quote ? { quote } : undefined);

        const attachment = {
            type: 'video',
            mimetype,
            caption: caption || null,
            url: url || null
        };

        const recordedOutgoing = await MessageService.recordMessage({
            userId,
            chatJid: phone,
            sender: 'me',
            text: caption || 'video',
            messageType: 'video',
            attachment,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.id,
            rawMessage: null,
            replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: this._ownJid(session.client)
        });

        if (recordedOutgoing) {
            this.io.to(userId).emit('new_message', {
                ...recordedOutgoing.toObject(),
                id: recordedOutgoing._id,
                chat_jid: recordedOutgoing.chatJid
            });
            if (this.webhookService && this.appSettings.webhook_toggle_message_out !== 'false') {
                this.webhookService.send('message.out', {
                    userId,
                    id: recordedOutgoing._id,
                    chatJid: recordedOutgoing.chatJid,
                    sender: recordedOutgoing.sender,
                    text: recordedOutgoing.message,
                    messageType: recordedOutgoing.messageType,
                    attachment: recordedOutgoing.attachment,
                    timestamp: recordedOutgoing.timestamp
                });
            }
        }

        return result;
    }

    /**
     * Send audio / voice note via WhatsApp
     */
    async sendAudioMessage(userId, to, mediaData, replyToId = null) {
        const session = await this.ensureSession(userId);

        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const {
            url,
            base64,
            buffer,
            mimetype = 'audio/mpeg',
            isVoiceNote = false
        } = mediaData;

        if (!url && !base64 && !buffer) {
            throw new Error('Either "url", "base64", or "buffer" is required for audio');
        }

        const normalizedBase64 = base64?.includes(',')
            ? base64.slice(base64.indexOf(',') + 1)
            : base64;

        const media = url
            ? await this._fetchUrlToStream(url)
            : (buffer || Buffer.from(normalizedBase64, 'base64'));

        const phone = await this._resolveTargetJid(session.client, to);
        const { quote, quotedDbRecord } = await this._getQuotedInfo(userId, replyToId);

        const messageType = isVoiceNote ? 'ptv' : 'audio';
        const result = await session.client.message.send(phone, {
            type: messageType,
            media,
            mimetype
        }, quote ? { quote } : undefined);

        const attachment = {
            type: messageType,
            mimetype,
            url: url || null
        };

        const recordedOutgoing = await MessageService.recordMessage({
            userId,
            chatJid: phone,
            sender: 'me',
            text: isVoiceNote ? 'voice note' : 'audio',
            messageType,
            attachment,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.id,
            rawMessage: null,
            replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: this._ownJid(session.client)
        });

        if (recordedOutgoing) {
            this.io.to(userId).emit('new_message', {
                ...recordedOutgoing.toObject(),
                id: recordedOutgoing._id,
                chat_jid: recordedOutgoing.chatJid
            });
            if (this.webhookService && this.appSettings.webhook_toggle_message_out !== 'false') {
                this.webhookService.send('message.out', {
                    userId,
                    id: recordedOutgoing._id,
                    chatJid: recordedOutgoing.chatJid,
                    sender: recordedOutgoing.sender,
                    text: recordedOutgoing.message,
                    messageType: recordedOutgoing.messageType,
                    attachment: recordedOutgoing.attachment,
                    timestamp: recordedOutgoing.timestamp
                });
            }
        }

        return result;
    }

    /**
     * Send a sticker via WhatsApp
     */
    async sendStickerMessage(userId, to, mediaData, replyToId = null) {
        const session = await this.ensureSession(userId);

        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const {
            url,
            base64,
            buffer,
            mimetype = 'image/webp'
        } = mediaData;

        if (!url && !base64 && !buffer) {
            throw new Error('Either "url", "base64", or "buffer" is required for sticker');
        }

        const normalizedBase64 = base64?.includes(',')
            ? base64.slice(base64.indexOf(',') + 1)
            : base64;

        const media = url
            ? await this._fetchUrlToStream(url)
            : (buffer || Buffer.from(normalizedBase64, 'base64'));

        const phone = await this._resolveTargetJid(session.client, to);
        const { quote, quotedDbRecord } = await this._getQuotedInfo(userId, replyToId);

        const result = await session.client.message.send(phone, {
            type: 'sticker',
            media,
            mimetype
        }, quote ? { quote } : undefined);

        const attachment = {
            type: 'sticker',
            mimetype,
            url: url || null
        };

        const recordedOutgoing = await MessageService.recordMessage({
            userId,
            chatJid: phone,
            sender: 'me',
            text: 'sticker',
            messageType: 'sticker',
            attachment,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.id,
            rawMessage: null,
            replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: this._ownJid(session.client)
        });

        if (recordedOutgoing) {
            this.io.to(userId).emit('new_message', {
                ...recordedOutgoing.toObject(),
                id: recordedOutgoing._id,
                chat_jid: recordedOutgoing.chatJid
            });
            if (this.webhookService && this.appSettings.webhook_toggle_message_out !== 'false') {
                this.webhookService.send('message.out', {
                    userId,
                    id: recordedOutgoing._id,
                    chatJid: recordedOutgoing.chatJid,
                    sender: recordedOutgoing.sender,
                    text: recordedOutgoing.message,
                    messageType: recordedOutgoing.messageType,
                    attachment: recordedOutgoing.attachment,
                    timestamp: recordedOutgoing.timestamp
                });
            }
        }

        return result;
    }

    /**
     * Logout user from WhatsApp
     */
    async logout(userId) {
        const userIdStr = String(userId);
        const session = this.sessions.get(userIdStr);
        if (!session || !session.client) return;

        try {
            await session.client.logout();
        } catch (error) {
            logError('Logout error:', error);
        }

        if (session.keepAliveTimer) {
            clearInterval(session.keepAliveTimer);
            session.keepAliveTimer = null;
        }
        this.sessions.delete(userIdStr);

        // Clear the preload marker so the session is not resumed on next boot
        try {
            await User.updateOne({ _id: userId }, { $set: { waSessionId: null } });
        } catch (error) {
            logError('Error clearing waSessionId:', error);
        }
    }

    /**
     * Get session status for a user
     */
    getSessionStatus(userId) {
        const session = this.sessions.get(String(userId));
        if (!session || !session.client) {
            return { status: 'disconnected', connected: false, qr: null };
        }

        return {
            status: session.state,
            connected: session.isConnected,
            qr: session.qr,
            user: session.user
        };
    }

    /**
     * Preload sessions for users marked as WhatsApp-linked.
     * Uses Promise.allSettled with a concurrency limit (max 3 parallel) to avoid
     * flooding the WhatsApp server on startup.
     */
    async preloadSessions() {
        try {
            const linkedUsers = await User.find({ waSessionId: { $exists: true, $ne: null } })
                .select('waSessionId')
                .lean();

            const userDirs = linkedUsers.map(u => String(u.waSessionId)).filter(Boolean);
            if (userDirs.length === 0) return;

            info(`Preloading ${userDirs.length} WhatsApp session(s)...`);

            const CONCURRENCY = 3;
            for (let i = 0; i < userDirs.length; i += CONCURRENCY) {
                const batch = userDirs.slice(i, i + CONCURRENCY);
                await Promise.allSettled(
                    batch.map(userId => {
                        info(`Preloading WhatsApp session for user: ${userId}`);
                        return this.ensureSession(userId);
                    })
                );
                // Small delay between batches to avoid flooding WA servers
                if (i + CONCURRENCY < userDirs.length) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            info('Session preloading complete.');
        } catch (error) {
            logError('Error during WhatsApp session preload:', error);
        }
    }

    async requestPairingCode(userId, phoneNumber) {
        const session = await this.ensureSession(userId);
        info(`[requestPairingCode] Session ensured for user ${userId}, isConnected: ${session.isConnected}, pairingReady: ${session.pairingReady}`);

        if (session.isConnected) {
            throw new Error('WhatsApp already connected');
        }

        const client = session.client;
        if (!client) {
            throw new Error('Session not initialized');
        }

        const digits = phoneNumber.replace(/[^\d]/g, '');

        // WhatsApp invalidates the previous code each time a new one is issued
        // for the same handshake. A user re-clicking "Dapatkan Kode" therefore
        // bricks the code they already typed. Return the still-fresh code instead.
        if (session.lastPairing && session.lastPairing.phone === digits &&
            Date.now() - session.lastPairing.issuedAt < 60000) {
            info(`[requestPairingCode] Returning cached code for ${digits} (issued ${Date.now() - session.lastPairing.issuedAt}ms ago)`);
            return session.lastPairing.code;
        }

        // Try direct call first — some server configurations accept pairing code
        // without emitting auth_pairing_required (server sends QR by default).
        // Fall back to waiting for auth_pairing_required if direct call fails.
        try {
            info(`[requestPairingCode] Trying direct requestPairingCode for ${digits}`);
            const code = await client.auth.requestPairingCode(digits);
            info(`[requestPairingCode] Pairing code received (direct): ${code}`);
            session.lastPairing = { phone: digits, code, issuedAt: Date.now() };
            return code;
        } catch (directErr) {
            info(`[requestPairingCode] Direct call failed: ${directErr.message}. Falling back to auth_pairing_required wait.`);
        }

        // Fallback: wait for auth_pairing_required event
        if (!session.pairingReady) {
            info(`[requestPairingCode] Waiting for auth_pairing_required event for user ${userId}`);
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    warn(`[requestPairingCode] Timeout waiting for auth_pairing_required for user ${userId}`);
                    reject(new Error('Pairing code request timed out. Ensure the session is in pairing state.'));
                }, 60000);
                session.pairingResolvers.push(() => {
                    clearTimeout(timer);
                    info(`[requestPairingCode] auth_pairing_required received for user ${userId}`);
                    resolve();
                });
            });
        }

        info(`[requestPairingCode] Requesting pairing code for ${digits} (after auth_pairing_required)`);
        const code = await client.auth.requestPairingCode(digits);
        info(`[requestPairingCode] Pairing code received: ${code}`);
        session.lastPairing = { phone: digits, code, issuedAt: Date.now() };
        return code;
    }

    async sendInteractiveMessage(userId, to, content) {
        info(`[WhatsAppService] sendInteractiveMessage start for user: ${userId}`);
        const session = await this.ensureSession(userId);
        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const phone = await this._resolveTargetJid(session.client, to);
        info(`[WhatsAppService] Target JID: ${phone}`);

        // Native-flow interactive message (the same shape buttons-warpper produced)
        const interactiveMessage = {
            ...((content.title || content.subtitle)
                ? { header: { title: content.title || content.subtitle || '' } }
                : {}),
            ...(content.text ? { body: { text: content.text } } : {}),
            ...(content.footer ? { footer: { text: content.footer } } : {}),
            nativeFlowMessage: {
                buttons: (content.interactiveButtons || []).map(btn => ({
                    name: btn.name || 'quick_reply',
                    buttonParamsJson: btn.buttonParamsJson
                })),
                messageVersion: 1
            }
        };

        try {
            const result = await session.client.message.send(phone, { interactiveMessage });
            info(`[WhatsAppService] Message sent successfully via zapo native flow`);
            return result;
        } catch (err) {
            logError(`[WhatsAppService] Failed to send interactive message:`, err);
            throw err;
        }
    }

    /**
     * Send a poll
     */
    async sendPollMessage(userId, to, { question, options, selectableCount = 1 }) {
        const session = await this.ensureSession(userId);
        if (!session.isConnected) throw new Error('WhatsApp not connected');

        const phone = await this._resolveTargetJid(session.client, to);
        const result = await session.client.message.send(phone, {
            type: 'poll',
            name: question,
            options,
            selectableCount
        });

        await this._recordOutgoing(userId, phone, {
            text: `[Poll] ${question}`,
            messageType: 'poll',
            stanzaId: result.id
        });
        return result;
    }

    /**
     * React to a message. emoji '' removes the reaction.
     * targetMessage = { stanzaId, chatJid, fromMe, participant }
     */
    async sendReaction(userId, to, { emoji, target }) {
        const session = await this.ensureSession(userId);
        if (!session.isConnected) throw new Error('WhatsApp not connected');

        const phone = await this._resolveTargetJid(session.client, to);
        return await session.client.message.send(phone, {
            type: 'reaction',
            emoji,
            target: {
                remoteJid: target.chatJid || phone,
                id: target.stanzaId,
                fromMe: Boolean(target.fromMe),
                participant: target.participant
            }
        });
    }

    /**
     * Edit a previously sent (fromMe) message
     */
    async editMessage(userId, to, { stanzaId, newText }) {
        const session = await this.ensureSession(userId);
        if (!session.isConnected) throw new Error('WhatsApp not connected');

        const phone = await this._resolveTargetJid(session.client, to);
        return await session.client.message.send(phone, newText, {
            editKey: { id: stanzaId }
        });
    }

    /**
     * Revoke (delete for everyone). fromMe=false triggers admin-revoke in groups.
     */
    async revokeMessage(userId, to, { stanzaId, fromMe = true, participant }) {
        const session = await this.ensureSession(userId);
        if (!session.isConnected) throw new Error('WhatsApp not connected');

        const phone = await this._resolveTargetJid(session.client, to);
        return await session.client.message.send(phone, {
            type: 'revoke',
            target: { remoteJid: phone, id: stanzaId, fromMe, participant }
        });
    }

    /**
     * Pin / unpin a message. durationSecs default 24h (zapo stamps 86400).
     */
    async pinMessage(userId, to, { stanzaId, fromMe = true, participant, action = 'pin', durationSecs }) {
        const session = await this.ensureSession(userId);
        if (!session.isConnected) throw new Error('WhatsApp not connected');

        const phone = await this._resolveTargetJid(session.client, to);
        const target = { remoteJid: phone, id: stanzaId, fromMe, participant };
        const payload = { type: action === 'unpin' ? 'unpin' : 'pin', target };
        if (action === 'pin' && durationSecs) payload.durationSecs = durationSecs;
        return await session.client.message.send(phone, payload);
    }

    /**
     * Legacy buttons message (max 3 reply buttons)
     */
    async sendButtonMessage(userId, to, { title, content, footer, buttons }) {
        const session = await this.ensureSession(userId);
        if (!session.isConnected) throw new Error('WhatsApp not connected');

        const phone = await this._resolveTargetJid(session.client, to);
        const formattedButtons = buttons.slice(0, 3).map((btn, idx) => ({
            buttonId: btn.id || `btn_${idx + 1}`,
            buttonText: { displayText: typeof btn === 'string' ? btn : (btn.text || `Option ${idx + 1}`) },
            type: 1
        }));

        return await session.client.message.send(phone, {
            buttonsMessage: {
                contentText: content,
                footerText: footer || '',
                text: title || '',
                headerType: 1,
                buttons: formattedButtons
            }
        });
    }

    /**
     * List menu message (single-select sections/rows)
     */
    async sendListMessage(userId, to, { title, description, buttonText, footer, sections }) {
        const session = await this.ensureSession(userId);
        if (!session.isConnected) throw new Error('WhatsApp not connected');

        const phone = await this._resolveTargetJid(session.client, to);
        return await session.client.message.send(phone, {
            listMessage: {
                title,
                description,
                buttonText,
                footerText: footer || '',
                listType: 1,
                sections: sections.map(sec => ({
                    title: sec.title || 'Section',
                    rows: (sec.rows || []).map((r, idx) => ({
                        rowId: r.id || `row_${idx + 1}`,
                        title: r.title,
                        description: r.description || ''
                    }))
                }))
            }
        });
    }

    /**
     * CTA button (open URL or call number)
     */
    async sendCtaMessage(userId, to, { body, footer, displayText, url, phoneNumber }) {
        const session = await this.ensureSession(userId);
        if (!session.isConnected) throw new Error('WhatsApp not connected');

        const phone = await this._resolveTargetJid(session.client, to);
        const buttons = [];
        if (url) {
            buttons.push({ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: displayText, url }) });
        } else if (phoneNumber) {
            buttons.push({ name: 'cta_call', buttonParamsJson: JSON.stringify({ display_text: displayText, phone_number: phoneNumber }) });
        }
        if (buttons.length === 0) throw new Error('Either "url" or "phoneNumber" is required');

        return await session.client.message.send(phone, {
            interactiveMessage: {
                body: { text: body },
                footer: { text: footer || '' },
                nativeFlowMessage: { buttons, messageVersion: 1 }
            }
        });
    }

    /**
     * Shared outgoing-message recorder for the new message types.
     * @private
     */
    async _recordOutgoing(userId, chatJid, { text, messageType = 'text', attachment = null, stanzaId }) {
        const recorded = await MessageService.recordMessage({
            userId, chatJid, sender: 'me', text, messageType, attachment,
            direction: 'out', timestamp: Date.now(), stanzaId, rawMessage: null,
            senderJid: this._ownJid(this.sessions.get(String(userId))?.client)
        });
        if (recorded) {
            this.io.to(String(userId)).emit('new_message', {
                ...recorded.toObject(),
                id: recorded._id,
                chat_jid: recorded.chatJid
            });
        }
        return recorded;
    }

    // --- Group operations ---

    async _requireConnectedClient(userId) {
        const session = await this.ensureSession(userId);
        if (!session.isConnected) throw new Error('WhatsApp not connected');
        return session.client;
    }

    async listGroups(userId) {
        const client = await this._requireConnectedClient(userId);
        const groupsMap = await client.group.queryAllGroups() || {};
        return Object.values(groupsMap).map(g => ({
            group_id: g.jid || g.id,
            subject: g.subject || 'Unnamed Group',
            owner: g.owner,
            creation: g.creation,
            participants_count: g.participants?.length || 0
        }));
    }

    async getGroupMetadata(userId, groupJid) {
        const client = await this._requireConnectedClient(userId);
        return await client.group.queryGroupMetadata(this._asGroupJid(groupJid));
    }

    async createGroup(userId, subject, participants) {
        const client = await this._requireConnectedClient(userId);
        const jids = participants.map(p => p.includes('@') ? p : `${p.replace(/\D/g, '')}@s.whatsapp.net`);
        return await client.group.createGroup(subject, jids);
    }

    async manageGroupParticipants(userId, groupJid, action, participants) {
        const client = await this._requireConnectedClient(userId);
        const jid = this._asGroupJid(groupJid);
        const jids = participants.map(p => p.includes('@') ? p : `${p.replace(/\D/g, '')}@s.whatsapp.net`);
        const fn = {
            add: 'addParticipants', remove: 'removeParticipants',
            promote: 'promoteParticipants', demote: 'demoteParticipants'
        }[action];
        if (!fn) throw new Error('Invalid action. Use add, remove, promote, or demote');
        return await client.group[fn](jid, jids);
    }

    async updateGroupInfo(userId, groupJid, { subject, description }) {
        const client = await this._requireConnectedClient(userId);
        const jid = this._asGroupJid(groupJid);
        if (subject !== undefined) await client.group.setSubject(jid, subject);
        if (description !== undefined) await client.group.setDescription(jid, description);
        return true;
    }

    async getGroupInviteCode(userId, groupJid) {
        const client = await this._requireConnectedClient(userId);
        const code = await client.group.queryInviteCode(this._asGroupJid(groupJid));
        return { code, invite_url: `https://chat.whatsapp.com/${code}` };
    }

    async joinGroupViaInvite(userId, inviteCode) {
        const client = await this._requireConnectedClient(userId);
        return await client.group.joinGroupViaInvite(inviteCode);
    }

    async leaveGroup(userId, groupJid) {
        const client = await this._requireConnectedClient(userId);
        await client.group.leaveGroup([this._asGroupJid(groupJid)]);
        return true;
    }

    _asGroupJid(groupJid) {
        return groupJid.includes('@g.us') ? groupJid : `${groupJid}@g.us`;
    }
}

export default WhatsAppService;
