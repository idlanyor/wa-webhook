import { default as makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const buttonsWarpper = require('buttons-warpper');
const initFunction = buttonsWarpper.default || buttonsWarpper;
import { existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import Setting from '../models/Setting.js';
import AutoReply from '../models/AutoReply.js';
import Message from '../models/Message.js';
import MessageService from './MessageService.js';
import { info, error as logError, warn } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WhatsAppService {
    constructor(io) {
        this.io = io;
        this.sessions = new Map(); // userId => session object
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
        if (this.sessions.has(userIdStr)) {
            return this.sessions.get(userIdStr);
        }

        return await this.createSession(userIdStr, phoneNumber);
    }

    /**
     * Create a new WhatsApp session for a user
     */
    async createSession(userId, phoneNumber = null) {
        const userIdStr = String(userId);
        const authDir = join(__dirname, '../../auth_info_baileys', userIdStr);
        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        const { version, isLatest } = await fetchLatestBaileysVersion();
        info(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        const session = {
            sock: null,
            isConnected: false,
            state: 'disconnected',
            qr: null,
            keepAliveTimer: null
        };

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            keepAliveIntervalMs: config.whatsapp.keepAliveIntervalMs,
            markOnlineOnConnect: config.whatsapp.markOnlineOnConnect,
            // Add some timeout settings
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0
        });

        /* Initialize buttons-warpper for enhanced interactive buttons */
        await initFunction(sock);

        session.sock = sock;
        this.setupSessionHandlers(session, userIdStr, saveCreds, authDir);
        this.sessions.set(userIdStr, session);

        return session;
    }

    /**
     * Setup event handlers for a WhatsApp session
     */
    setupSessionHandlers(session, userId, saveCreds, authDir) {
        const { sock } = session;

        // Keep-alive timer
        session.keepAliveTimer = setInterval(async () => {
            if (session.isConnected) {
                try {
                    await sock.sendPresenceUpdate('available');
                } catch (error) {
                    logError('Keep-alive error:', error);
                }
            }
        }, config.whatsapp.keepAliveIntervalMs);

        // Credentials update handler
        sock.ev.on('creds.update', saveCreds);

        // Connection status handler
        sock.ev.on('connection.update', (update) => {
            this.handleConnectionUpdate(update, session, userId, authDir);
        });

        // Message handler
        sock.ev.on('messages.upsert', async (m) => {
            await this.handleIncomingMessage(m, userId, sock);
        });
    }

    /**
     * Handle connection status updates
     */
    handleConnectionUpdate(update, session, userId, authDir) {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            session.qr = qr;
            session.state = 'qr_ready';
            this.io.to(userId).emit('qr', qr);
            if (this.webhookService && this.appSettings.webhook_toggle_connection !== 'false') {
                this.webhookService.send('connection_status', { userId, status: 'qr_ready' });
            }
        }

        if (connection === 'open') {
            session.isConnected = true;
            session.state = 'connected';
            session.qr = null;
            this.io.to(userId).emit('connection_status', { 
                status: 'connected',
                user: session.sock?.user ? {
                    id: session.sock.user.id,
                    name: session.sock.user.name
                } : null
            });
            info(`WhatsApp connected for user: ${userId}`);
            if (this.webhookService && this.appSettings.webhook_toggle_connection !== 'false') {
                this.webhookService.send('connection_status', { userId, status: 'connected' });
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.message;
            warn(`WhatsApp connection closed for user ${userId}. Status: ${statusCode}, Reason: ${reason}`);

            session.isConnected = false;
            session.state = 'disconnected';
            this.io.to(userId).emit('connection_status', { status: 'disconnected' });
            if (this.webhookService && this.appSettings.webhook_toggle_connection !== 'false') {
                this.webhookService.send('connection_status', { userId, status: 'disconnected' });
            }

            if (session.keepAliveTimer) {
                clearInterval(session.keepAliveTimer);
            }
            this.sessions.delete(userId);

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 405;

            if (statusCode === DisconnectReason.loggedOut || statusCode === 405) {
                const reasonText = statusCode === 405 ? 'Connection Failure (405)' : 'Intentional logout';
                info(`${reasonText} detected for user ${userId}; clearing session.`);
                try {
                    if (existsSync(authDir)) {
                        rmSync(authDir, { recursive: true, force: true });
                    }
                } catch (error) {
                    logError('Error removing auth directory:', error);
                }
            }

            // Reconnect if not a logout or 405
            if (shouldReconnect) {
                const delay = statusCode === DisconnectReason.restartRequired ? 0 : 3000;
                info(`Reconnecting for user ${userId} in ${delay}ms...`);
                setTimeout(() => this.createSession(userId), delay);
            } else if (statusCode === 405) {
                // If it was a 405, we cleared the session, so we SHOULD reconnect to let them scan QR again
                info(`Session cleared for user ${userId} due to 405 error. Re-initializing for fresh QR...`);
                setTimeout(() => this.createSession(userId), 5000);
            } else {
                info(`Skipping reconnect for user ${userId} due to intentional logout.`);
            }
        }
    }

    /**
     * Handle incoming messages and auto-replies
     */
    async handleIncomingMessage(messageUpdate, userId, sock) {
        const message = messageUpdate.messages[0];

        if (!message.key.fromMe && messageUpdate.type === 'notify') {
            const incomingContent = this.unwrapMessageContent(message.message);
            const messageText = incomingContent?.conversation ||
                incomingContent?.extendedTextMessage?.text ||
                incomingContent?.documentMessage?.caption ||
                incomingContent?.imageMessage?.caption ||
                incomingContent?.videoMessage?.caption || '';
            const attachment = this.extractAttachment(incomingContent);
            const messageType = attachment?.type || 'text';

            // Handle quoted messages
            const contextInfo = message.message?.extendedTextMessage?.contextInfo;
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
                chatJid: message.key.remoteJid,
                sender: message.pushName || message.key.participant || message.key.remoteJid,
                senderJid: message.key.participant || message.key.remoteJid,
                text: messageText,
                messageType,
                attachment,
                direction: 'in',
                timestamp: (message.messageTimestamp || Date.now()) * 1000,
                stanzaId: message.key.id,
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
            await this.handleAutoReply(messageText, message, userId, sock, replyToId, quotedText, quotedSender);
        }
    }

    /**
     * Handle auto-reply logic
     */
    async handleAutoReply(messageText, message, userId, sock, replyToId, quotedText, quotedSender) {
        const autoReplyEnabled = this.appSettings.auto_reply_enabled !== 'false';

        if (autoReplyEnabled && !message.key.remoteJid.endsWith('@g.us') && messageText) {
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
                    const result = await sock.sendMessage(message.key.remoteJid, { text: rule.reply });

                    // Record auto-reply message
                    const recordedReply = await MessageService.recordMessage({
                        userId,
                        chatJid: message.key.remoteJid,
                        sender: 'auto-reply',
                        text: rule.reply,
                        messageType: 'text',
                        direction: 'out',
                        timestamp: Date.now(),
                        stanzaId: result.key.id,
                        rawMessage: null,
                        replyToId: replyToId,
                        quotedText: quotedText,
                        quotedSender: quotedSender,
                        senderJid: sock.user.id.replace(/:.*$/, '@s.whatsapp.net')
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
     * Resolve reply-to quoted info from database (shared by sendMessage & sendDocumentMessage)
     * @private
     */
    async _getQuotedInfo(userId, replyToId) {
        if (!replyToId) return { quotedInfo: undefined, quotedDbRecord: null };

        const data = await Message.findOne({ _id: replyToId, userId });
        if (!data) return { quotedInfo: undefined, quotedDbRecord: null };

        return {
            quotedDbRecord: data,
            quotedInfo: {
                key: {
                    remoteJid: data.chatJid,
                    id: data.stanzaId,
                    fromMe: data.direction === 'out',
                    participant: data.senderJid,
                },
                // rawMessage is no longer stored; pass undefined (WhatsApp will still thread correctly via stanzaId)
                message: data.rawMessage || undefined
            }
        };
    }

    /**
     * Send a message via WhatsApp
     */
    async sendMessage(userId, to, message, replyToId = null) {
        const session = await this.ensureSession(userId);

        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const cleanedTo = to.includes('@') ? to : to.replace(/[^\d]/g, '');
        const phone = cleanedTo.includes('@') ? cleanedTo : `${cleanedTo}@s.whatsapp.net`;

        const { quotedInfo, quotedDbRecord } = await this._getQuotedInfo(userId, replyToId);

        const result = await session.sock.sendMessage(phone, { text: message }, { quoted: quotedInfo });

        // Record outgoing message
        const recordedOutgoing = await MessageService.recordMessage({
            userId,
            chatJid: phone,
            sender: 'me',
            text: message,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.key.id,
            rawMessage: null,
            replyToId: replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: session.sock.user.id.replace(/:.*$/, '@s.whatsapp.net')
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

    buildDocumentPayload(document) {
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
        const documentContent = url ? { url } : buffer || Buffer.from(normalizedBase64, 'base64');

        return {
            document: documentContent,
            mimetype,
            fileName: fileName || filename || 'document',
            ...(caption ? { caption } : {})
        };
    }

    /**
     * Send a document attachment via WhatsApp
     */
    async sendDocumentMessage(userId, to, document, replyToId = null) {
        const session = await this.ensureSession(userId);

        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const cleanedTo = to.includes('@') ? to : to.replace(/[^\d]/g, '');
        const phone = cleanedTo.includes('@') ? cleanedTo : `${cleanedTo}@s.whatsapp.net`;
        const payload = this.buildDocumentPayload(document);

        const { quotedInfo, quotedDbRecord } = await this._getQuotedInfo(userId, replyToId);

        const result = await session.sock.sendMessage(phone, payload, { quoted: quotedInfo });
        const attachment = {
            type: 'document',
            fileName: payload.fileName,
            mimetype: payload.mimetype,
            caption: payload.caption || null,
            url: document.url || null
        };

        const recordedOutgoing = await MessageService.recordMessage({
            userId,
            chatJid: phone,
            sender: 'me',
            text: payload.caption || payload.fileName,
            messageType: 'document',
            attachment,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.key.id,
            rawMessage: null,
            replyToId: replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: session.sock.user.id.replace(/:.*$/, '@s.whatsapp.net')
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
        if (!session) return;

        try {
            await session.sock.logout();
        } catch (error) {
            logError('Logout error:', error);
        }

        if (session.keepAliveTimer) {
            clearInterval(session.keepAliveTimer);
        }
        this.sessions.delete(userIdStr);

        const authDir = join(__dirname, '../../auth_info_baileys', userIdStr);
        try {
            if (existsSync(authDir)) {
                rmSync(authDir, { recursive: true, force: true });
            }
        } catch (error) {
            logError('Error removing auth directory:', error);
        }
    }

    /**
     * Get session status for a user
     */
    getSessionStatus(userId) {
        const session = this.sessions.get(String(userId));
        if (!session) {
            return { status: 'disconnected', connected: false, qr: null };
        }

        return {
            status: session.state,
            connected: session.isConnected,
            qr: session.qr,
            user: session.isConnected && session.sock?.user ? {
                id: session.sock.user.id,
                name: session.sock.user.name
            } : null
        };
    }

    /**
     * Preload sessions for users with existing auth files.
     * Uses Promise.allSettled with a concurrency limit (max 3 parallel) to avoid
     * flooding the WhatsApp server on startup.
     */
    async preloadSessions() {
        try {
            const authRoot = join(__dirname, '../../auth_info_baileys');
            if (!existsSync(authRoot)) return;

            const userDirs = readdirSync(authRoot, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

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
        if (session.isConnected) {
            throw new Error('WhatsApp already connected');
        }

        if (!session.sock) {
            throw new Error('Session not initialized');
        }

        // Wait for connection to be ready
        let attempts = 0;
        while (attempts < 20) {
            if (session.sock.ws && session.sock.ws.isOpen) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }

        if (!session.sock.ws || !session.sock.ws.isOpen) {
            throw new Error('Connection to WhatsApp server failed, please try again');
        }

        const code = await session.sock.requestPairingCode(phoneNumber);
        return code;
    }

    async sendInteractiveMessage(userId, to, content) {
        info(`[WhatsAppService] sendInteractiveMessage start for user: ${userId}`);
        const session = await this.ensureSession(userId);
        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const cleanedTo = to.includes('@') ? to : to.replace(/[^\d]/g, '');
        const phone = cleanedTo.includes('@') ? cleanedTo : `${cleanedTo}@s.whatsapp.net`;
        info(`[WhatsAppService] Target JID: ${phone}`);

        /* Use buttons-warpper enhanced method for better compatibility */
        try {
            const msg = await session.sock.sendInteractiveMessage(phone, {
                text: content.text || '',
                footer: content.footer || '',
                title: content.title || '',
                subtitle: content.subtitle || '',
                interactiveButtons: content.interactiveButtons || []
            });
            info(`[WhatsAppService] Message sent successfully via buttons-warpper`);
            return msg;
        } catch (err) {
            logError(`[WhatsAppService] Failed to send via buttons-warpper:`, err);
            throw err;
        }
    }
}

export default WhatsAppService;
