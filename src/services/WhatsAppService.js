import { default as makeWASocket, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { getDatabase } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WhatsAppService {
    constructor(io) {
        this.io = io;
        this.sessions = new Map(); // userId => session object
        this.appSettings = {};
        this.autoReplies = [];
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
            const supabase = getDatabase();
            
            // Load app settings
            const { data: settingsData, error: settingsError } = await supabase
                .from('settings')
                .select('*');
            
            if (settingsError) throw settingsError;
            
            this.appSettings = settingsData.reduce((acc, row) => {
                acc[row.key] = row.value;
                return acc;
            }, {});

            // Load auto-replies
            const { data: repliesData, error: repliesError } = await supabase
                .from('auto_replies')
                .select('*');
            
            if (repliesError) throw repliesError;
            this.autoReplies = repliesData;

            console.log('App settings and auto-replies loaded from database.');
        } catch (error) {
            console.error('Failed to load settings from database:', error);
        }
    }

    /**
     * Get session for user, create if doesn't exist
     */
    async ensureSession(userId, phoneNumber = null) {
        if (this.sessions.has(userId)) {
            return this.sessions.get(userId);
        }

        return await this.createSession(userId, phoneNumber);
    }

    /**
     * Create a new WhatsApp session for a user
     */
    async createSession(userId, phoneNumber = null) {
        const authDir = join(__dirname, '../../auth_info_baileys', userId);
        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        const session = {
            sock: null,
            isConnected: false,
            state: 'disconnected',
            qr: null,
            keepAliveTimer: null
        };

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['WhatsApp API', 'Chrome', '1.0.0'],
            keepAliveIntervalMs: config.whatsapp.keepAliveIntervalMs,
            markOnlineOnConnect: config.whatsapp.markOnlineOnConnect
        });

        session.sock = sock;
        this.setupSessionHandlers(session, userId, saveCreds, authDir);
        this.sessions.set(userId, session);

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
                    console.error('Keep-alive error:', error);
                }
            }
        }, config.whatsapp.keepAliveInterval);

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
            if (this.webhookService) {
                this.webhookService.send('connection_status', { userId, status: 'qr_ready' });
            }
        }

        if (connection === 'open') {
            session.isConnected = true;
            session.state = 'connected';
            session.qr = null;
            this.io.to(userId).emit('connection_status', { status: 'connected' });
            console.log(`WhatsApp connected for user: ${userId}`);
            if (this.webhookService) {
                this.webhookService.send('connection_status', { userId, status: 'connected' });
            }
        }

        if (connection === 'close') {
            session.isConnected = false;
            session.state = 'disconnected';
            this.io.to(userId).emit('connection_status', { status: 'disconnected' });
            if (this.webhookService) {
                this.webhookService.send('connection_status', { userId, status: 'disconnected' });
            }

            if (session.keepAliveTimer) {
                clearInterval(session.keepAliveTimer);
            }
            this.sessions.delete(userId);

            const code = lastDisconnect?.error?.output?.statusCode;
            const loggedOut = code === DisconnectReason.loggedOut;
            
            if (loggedOut) {
                try {
                    if (existsSync(authDir)) {
                        rmSync(authDir, { recursive: true, force: true });
                    }
                } catch (error) {
                    console.error('Error removing auth directory:', error);
                }
            }

            // Reconnect after delay unless user intentionally logged out
            if (!loggedOut) {
                setTimeout(() => this.createSession(userId), 1000);
            } else {
                console.log('Intentional logout detected; skipping auto-reconnect.');
            }
        }
    }

    /**
     * Handle incoming messages and auto-replies
     */
    async handleIncomingMessage(messageUpdate, userId, sock) {
        const message = messageUpdate.messages[0];
        
        if (!message.key.fromMe && messageUpdate.type === 'notify') {
            const messageText = message.message?.conversation || 
                             message.message?.extendedTextMessage?.text || '';
            
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
                const supabase = getDatabase();
                const { data: repliedToMsg } = await supabase
                    .from('messages')
                    .select('id')
                    .eq('stanza_id', contextInfo.stanzaId)
                    .eq('user_id', userId)
                    .maybeSingle() || {};
                
                if (repliedToMsg) replyToId = repliedToMsg.id;
            }

            // Record incoming message
            const MessageService = require('./MessageService').default;
            const recordedMessage = await MessageService.recordMessage({
                userId,
                chatJid: message.key.remoteJid,
                sender: message.pushName || message.key.participant || message.key.remoteJid,
                senderJid: message.key.participant || message.key.remoteJid,
                text: messageText,
                direction: 'in',
                timestamp: (message.messageTimestamp || Date.now()) * 1000,
                stanzaId: message.key.id,
                rawMessage: message.message,
                replyToId: replyToId,
                quotedText: quotedText,
                quotedSender: quotedSender
            });

            if (recordedMessage) {
                this.io.to(userId).emit('new_message', recordedMessage);
                if (this.webhookService) {
                    this.webhookService.send('message.in', {
                        userId,
                        id: recordedMessage.id,
                        chatJid: recordedMessage.chat_jid,
                        sender: recordedMessage.sender,
                        text: recordedMessage.text,
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
            const rule = this.autoReplies.find(r => 
                r.enabled && 
                lowerText.includes(String(r.keyword || '').toLowerCase().trim())
            );
            
            if (rule) {
                try {
                    const result = await sock.sendMessage(message.key.remoteJid, { text: rule.reply });
                    
                    // Record auto-reply message
                    const MessageService = require('./MessageService').default;
                    const recordedReply = await MessageService.recordMessage({
                        userId,
                        chatJid: message.key.remoteJid,
                        sender: 'auto-reply',
                        text: rule.reply,
                        direction: 'out',
                        timestamp: Date.now(),
                        stanzaId: result.key.id,
                        rawMessage: result.message,
                        replyToId: replyToId,
                        quotedText: quotedText,
                        quotedSender: quotedSender,
                        senderJid: sock.user.id.replace(/:.*$/, '@s.whatsapp.net')
                    });
                    
                    if (recordedReply) {
                        this.io.to(userId).emit('new_message', recordedReply);
                    }
                } catch (error) {
                    console.error('Auto-reply error:', error);
                }
            }
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

        const phone = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        
        let quotedInfo = undefined;
        let quotedDbRecord = null;
        
        if (replyToId) {
            const supabase = getDatabase();
            const { data } = await supabase
                .from('messages')
                .select('*')
                .eq('id', replyToId)
                .eq('user_id', userId)
                .single();
                
            if (data) {
                quotedDbRecord = data;
                quotedInfo = {
                    key: {
                        remoteJid: data.chat_jid,
                        id: data.stanza_id,
                        fromMe: data.direction === 'out',
                        participant: data.sender_jid,
                    },
                    message: data.raw_message
                };
            }
        }

        const result = await session.sock.sendMessage(phone, { text: message }, { quoted: quotedInfo });
        
        // Record outgoing message
        const MessageService = require('./MessageService').default;
        const recordedOutgoing = await MessageService.recordMessage({
            userId,
            chatJid: phone,
            sender: 'me',
            text: message,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.key.id,
            rawMessage: result.message,
            replyToId: replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: session.sock.user.id.replace(/:.*$/, '@s.whatsapp.net')
        });

        if (recordedOutgoing) {
            this.io.to(userId).emit('new_message', recordedOutgoing);
            if (this.webhookService) {
                this.webhookService.send('message.out', {
                    userId,
                    id: recordedOutgoing.id,
                    chatJid: recordedOutgoing.chat_jid,
                    sender: recordedOutgoing.sender,
                    text: recordedOutgoing.text,
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
        const session = this.sessions.get(userId);
        if (!session) return;

        try {
            await session.sock.logout();
        } catch (error) {
            console.error('Logout error:', error);
        }

        if (session.keepAliveTimer) {
            clearInterval(session.keepAliveTimer);
        }
        this.sessions.delete(userId);

        const authDir = join(__dirname, '../../auth_info_baileys', userId);
        try {
            if (existsSync(authDir)) {
                rmSync(authDir, { recursive: true, force: true });
            }
        } catch (error) {
            console.error('Error removing auth directory:', error);
        }
    }

    /**
     * Get session status for a user
     */
    getSessionStatus(userId) {
        const session = this.sessions.get(userId);
        if (!session) {
            return { status: 'disconnected', connected: false, qr: null };
        }
        
        return {
            status: session.state,
            connected: session.isConnected,
            qr: session.qr
        };
    }

    /**
     * Preload sessions for users with existing auth files
     */
    async preloadSessions() {
        try {
            const authRoot = join(__dirname, '../../auth_info_baileys');
            if (!existsSync(authRoot)) return;

            const userDirs = readdirSync(authRoot, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const userId of userDirs) {
                console.log(`Preloading WhatsApp session for user: ${userId}`);
                await this.ensureSession(userId);
            }
        } catch (error) {
            console.error('Error during WhatsApp session preload:', error);
        }
    }
}

export default WhatsAppService;
