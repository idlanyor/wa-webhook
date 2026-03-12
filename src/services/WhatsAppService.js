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
import GeminiService from './GeminiService.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import ProductField from '../models/ProductField.js';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WhatsAppService {
    constructor(io) {
        this.io = io;
        this.sessions = new Map(); // userId => session object
        this.appSettings = {};
        this.autoReplies = [];
        this.webhookService = null;
        this.logger = pino({ level: 'silent' });
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
            const settingsData = await Setting.find({}).lean();

            this.appSettings = settingsData.reduce((acc, row) => {
                acc[row.key] = row.value;
                return acc;
            }, {});

            // Load auto-replies
            const repliesData = await AutoReply.find({}).lean();
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
        console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);

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
            // Optimization: Silence the logger
            logger: this.logger,
            // Optimization: Don't sync full history
            syncFullHistory: false,
            // Optimization: Speed up connection
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 30000,
            // Optimization: Avoid keeping all message retries in memory
            msgRetryCounterCache: new Map(),
            // Optimization: Custom getMessage to help with retries without keeping whole history
            getMessage: async (key) => {
                // We don't necessarily need to return the message here unless we want to support retries
                // For a webhook service, we often care more about incoming messages
                return undefined;
            }
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
                    // Silently ignore presence errors to avoid log bloating
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
            if (this.webhookService && this.appSettings.webhook_toggle_connection !== 'false') {
                this.webhookService.send('connection_status', { userId, status: 'qr_ready' });
            }
        }

        if (connection === 'open') {
            session.isConnected = true;
            session.state = 'connected';
            session.qr = null;
            this.io.to(userId).emit('connection_status', { status: 'connected' });
            console.log(`WhatsApp connected for user: ${userId}`);
            if (this.webhookService && this.appSettings.webhook_toggle_connection !== 'false') {
                this.webhookService.send('connection_status', { userId, status: 'connected' });
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.message;
            console.log(`WhatsApp connection closed for user ${userId}. Status: ${statusCode}, Reason: ${reason}`);

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
                console.log(`${reasonText} detected for user ${userId}; clearing session.`);
                try {
                    if (existsSync(authDir)) {
                        rmSync(authDir, { recursive: true, force: true });
                    }
                } catch (error) {
                    console.error('Error removing auth directory:', error);
                }
            }

            // Reconnect if not a logout or 405
            if (shouldReconnect) {
                const delay = statusCode === DisconnectReason.restartRequired ? 0 : 3000;
                console.log(`Reconnecting for user ${userId} in ${delay}ms...`);
                setTimeout(() => this.createSession(userId), delay);
            } else if (statusCode === 405) {
                // If it was a 405, we cleared the session, so we SHOULD reconnect to let them scan QR again
                console.log(`Session cleared for user ${userId} due to 405 error. Re-initializing for fresh QR...`);
                setTimeout(() => this.createSession(userId), 5000);
            } else {
                console.log(`Skipping reconnect for user ${userId} due to intentional logout.`);
            }
        }
    }

    /**
     * Handle incoming messages and auto-replies
     */
    async handleIncomingMessage(messageUpdate, userId, sock) {
        const message = messageUpdate.messages[0];
        if (!message.message) return;

        const isNotify = messageUpdate.type === 'notify';
        const fromMe = message.key.fromMe;

        // Extract message text
        const messageText = message.message?.conversation ||
            message.message?.extendedTextMessage?.text || '';

        if (messageText) {
            // Normalize owner number (keep only digits)
            const rawOwnerNum = this.appSettings.owner_number || '';
            const ownerNum = rawOwnerNum.replace(/\D/g, '');
            
            // Normalize sender number (Check both remoteJid and remoteJidAlt for LID support)
            const senderJid = message.key.participant || message.key.remoteJid;
            const senderAltJid = message.key.remoteJidAlt || '';
            
            const senderNum = senderJid.replace(/\D/g, '');
            const senderAltNum = senderAltJid.replace(/\D/g, '');

            // Bot's own number
            const botNum = sock.user?.id ? sock.user.id.replace(/\D/g, '') : '';

            // Check if owner:
            // 1. message.key.fromMe is true (Self-chat or bot sending)
            // 2. Sender number matches ownerNum
            // 3. Sender ALT number matches ownerNum (LID Support)
            // 4. Sender number matches bot's own number
            const isOwner = fromMe || 
                            (ownerNum && (senderNum.includes(ownerNum) || senderAltNum.includes(ownerNum))) || 
                            (botNum && senderNum.includes(botNum));
            
            // 1. Check if sender is Owner for Admin Commands
            if (isOwner && messageText.trim().startsWith('#')) {
                return await this.handleOwnerCommand(messageText.trim(), message, userId, sock);
            }
        }

        if (!fromMe && isNotify) {
            // Handle quoted messages
            const contextInfo = message.message?.extendedTextMessage?.contextInfo;
            let quotedText = null;
            let quotedSender = null;
            let replyToId = null;

            if (contextInfo?.quotedMessage) {
                quotedText = contextInfo.quotedMessage.conversation ||
                    contextInfo.quotedMessage.extendedTextMessage?.text || '...';
                quotedSender = contextInfo.participant;

                // Find the original message ID in database - Use .lean() for optimization
                const repliedToMsg = await Message.findOne({
                    stanzaId: contextInfo.stanzaId,
                    userId: userId
                }).select('_id').lean();

                if (repliedToMsg) replyToId = repliedToMsg._id;
            }

            // Record incoming message
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
                // If recordedMessage is a Mongoose document, convert to object
                const msgData = recordedMessage.toObject ? recordedMessage.toObject() : recordedMessage;
                this.io.to(userId).emit('new_message', {
                    ...msgData,
                    id: msgData._id,
                    chat_jid: msgData.chatJid
                });
                if (this.webhookService && this.appSettings.webhook_toggle_message_in !== 'false') {
                    this.webhookService.send('message.in', {
                        userId,
                        id: msgData._id,
                        chatJid: msgData.chatJid,
                        sender: msgData.sender,
                        text: msgData.message,
                        timestamp: msgData.timestamp
                    });
                }
            }

            // Handle auto-reply or Gemini fallback
            await this.handleAutoReply(messageText, message, userId, sock, replyToId, quotedText, quotedSender);
        }
    }

    /**
     * Handle commands from the Owner/Admin
     */
    async handleOwnerCommand(messageText, message, userId, sock) {
        const command = messageText.split(' ')[0].toLowerCase();
        const args = messageText.split(' ').slice(1);
        const chatJid = message.key.remoteJid;

        try {
            switch (command) {
                case '#help':
                    const helpMsg = `*🛠️ ADMIN CONTROL PANEL*\n\n` +
                        `*--- SISTEM ---*\n` +
                        `• *#stats* : Statistik Sistem\n` +
                        `• *#ai <on/off>* : Kontrol Chatbot\n` +
                        `• *#restart* : Reload Pengaturan\n\n` +
                        `*--- PESANAN ---*\n` +
                        `• *#orders* : 5 Pesanan Terbaru\n` +
                        `• *#lunas <inv>* : Tandai Order Lunas\n\n` +
                        `*--- PRODUK ---*\n` +
                        `• *#listp* : Daftar Semua Produk\n` +
                        `• *#addp Nama . Val1 . Val2* : Tambah Produk\n` +
                        `• *#delp Nama* : Hapus Produk\n\n` +
                        `_Gunakan perintah dengan teliti._`;
                    await sock.sendMessage(chatJid, { text: helpMsg });
                    break;

                case '#listp':
                    const allProducts = await Product.find({}).lean();
                    let pListMsg = `*📦 DAFTAR PRODUK (${allProducts.length})*\n\n`;
                    allProducts.forEach((p, i) => {
                        pListMsg += `${i + 1}. *${p.name}*\n`;
                    });
                    if (allProducts.length === 0) pListMsg += "_Produk kosong._";
                    await sock.sendMessage(chatJid, { text: pListMsg });
                    break;

                case '#delp':
                    if (!args.length) return await sock.sendMessage(chatJid, { text: "❌ Masukkan nama produk. Contoh: #delp VPS 1" });
                    const pNameDel = args.join(' ');
                    const delRes = await Product.findOneAndDelete({ name: pNameDel });
                    if (delRes) {
                        await sock.sendMessage(chatJid, { text: `✅ Berhasil menghapus produk: *${pNameDel}*` });
                    } else {
                        await sock.sendMessage(chatJid, { text: `❌ Produk *${pNameDel}* tidak ditemukan.` });
                    }
                    break;

                case '#addp':
                    const rawPData = args.join(' ');
                    if (!rawPData.includes('.')) {
                        return await sock.sendMessage(chatJid, { text: "❌ Format salah! Gunakan: #addp Nama . Val1 . Val2\n\n_Cek urutan kolom di dashboard atau ketik #fields_" });
                    }
                    
                    const pParts = rawPData.split('.').map(p => p.trim());
                    const pName = pParts[0];
                    const pValues = pParts.slice(1);
                    
                    const pFields = await ProductField.find({}).sort({ order: 1 }).lean();
                    
                    const dynamicData = {};
                    pFields.forEach((field, index) => {
                        if (pValues[index]) {
                            dynamicData[field.key] = pValues[index];
                        }
                    });

                    const newP = new Product({
                        name: pName,
                        data: dynamicData
                    });
                    await newP.save();
                    
                    await sock.sendMessage(chatJid, { text: `✅ Produk *${pName}* berhasil ditambahkan!` });
                    break;

                case '#fields':
                    const curFields = await ProductField.find({}).sort({ order: 1 }).lean();
                    let fieldMsg = `*📋 URUTAN KOLOM PRODUK*\n\n`;
                    fieldMsg += `1. Nama Produk (Wajib)\n`;
                    curFields.forEach((f, i) => {
                        fieldMsg += `${i + 2}. ${f.label} (${f.type})\n`;
                    });
                    fieldMsg += `\n_Gunakan urutan ini saat mengetik #addp_`;
                    await sock.sendMessage(chatJid, { text: fieldMsg });
                    break;

                case '#stats':
                    const orderCount = await Order.countDocuments({ userId });
                    const msgCount = await Message.countDocuments({ userId });
                    const statsMsg = `*📊 STATISTIK SISTEM*\n\n` +
                        `• Total Pesanan : ${orderCount}\n` +
                        `• Total Pesan   : ${msgCount}\n` +
                        `• Status AI     : ${this.appSettings.gemini_enabled === 'true' ? '✅ AKTIF' : '❌ NONAKTIF'}\n` +
                        `• WhatsApp      : TERKONEKSI`;
                    await sock.sendMessage(chatJid, { text: statsMsg });
                    break;

                case '#orders':
                    const latestOrders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(5);
                    let orderMsg = `*📦 5 PESANAN TERBARU*\n\n`;
                    latestOrders.forEach(o => {
                        orderMsg += `• ${o.invoiceNumber} | ${o.productName} | *${o.status.toUpperCase()}*\n`;
                    });
                    if (latestOrders.length === 0) orderMsg += "_Belum ada pesanan._";
                    await sock.sendMessage(chatJid, { text: orderMsg });
                    break;

                case '#lunas':
                    if (!args[0]) return await sock.sendMessage(chatJid, { text: "❌ Sertakan Nomor Invoice. Contoh: #lunas INV-123" });
                    const updatedOrder = await Order.findOneAndUpdate(
                        { invoiceNumber: args[0], userId },
                        { status: 'paid' },
                        { new: true }
                    );
                    if (updatedOrder) {
                        await sock.sendMessage(chatJid, { text: `✅ Berhasil! Order *${args[0]}* telah ditandai LUNAS.` });
                        // Notify customer too
                        await sock.sendMessage(updatedOrder.customerJid, { text: `*✅ PEMBAYARAN DITERIMA*\n\nTerima kasih! Pembayaran untuk Invoice *${args[0]}* telah kami terima. Layanan Anda akan segera diproses.` });
                    } else {
                        await sock.sendMessage(chatJid, { text: `❌ Order dengan invoice *${args[0]}* tidak ditemukan.` });
                    }
                    break;

                case '#ai':
                    const mode = args[0]?.toLowerCase();
                    if (mode === 'on' || mode === 'off') {
                        const Setting = (await import('../models/Setting.js')).default;
                        await Setting.findOneAndUpdate({ key: 'gemini_enabled' }, { value: mode === 'on' ? 'true' : 'false' });
                        await this.loadSettings(); // Reload settings locally
                        await sock.sendMessage(chatJid, { text: `🤖 Chatbot AI berhasil diubah ke: *${mode.toUpperCase()}*` });
                    } else {
                        await sock.sendMessage(chatJid, { text: "❌ Gunakan: #ai on atau #ai off" });
                    }
                    break;

                case '#restart':
                    await this.loadSettings();
                    await sock.sendMessage(chatJid, { text: "🔄 Pengaturan sistem telah dimuat ulang." });
                    break;

                default:
                    await sock.sendMessage(chatJid, { text: "❓ Perintah tidak dikenal. Ketik *#help* untuk bantuan." });
            }
        } catch (error) {
            console.error('Admin Command Error:', error);
            await sock.sendMessage(chatJid, { text: "⚠️ Terjadi kesalahan saat memproses perintah." });
        }
    }

    /**
     * Handle auto-reply logic and Gemini fallback
     */
    async handleAutoReply(messageText, message, userId, sock, replyToId, quotedText, quotedSender) {
        const autoReplyEnabled = this.appSettings.auto_reply_enabled !== 'false';
        const geminiEnabled = this.appSettings.gemini_enabled === 'true';

        // Filter out group messages if needed, currently skipping groups for auto-reply as per original logic
        if (!message.key.remoteJid.endsWith('@g.us') && messageText) {
            const lowerText = messageText.trim().toLowerCase();
            
            // 1. Check Auto-Reply (Exact/Keyword match)
            let matchFound = false;
            if (autoReplyEnabled) {
                const rule = this.autoReplies.find(r =>
                    r.enabled &&
                    lowerText.includes(String(r.keyword || '').toLowerCase().trim())
                );

                if (rule) {
                    matchFound = true;
                    try {
                        const result = await sock.sendMessage(message.key.remoteJid, { text: rule.reply });
                        await this.recordBotResponse(userId, message.key.remoteJid, rule.reply, result, replyToId, quotedText, quotedSender, sock);
                    } catch (error) {
                        console.error('Auto-reply error:', error);
                    }
                }
            }

            // 2. Fallback to Gemini AI if no match found and enabled
            if (!matchFound && geminiEnabled) {
                try {
                    // Fetch last 6 messages for context (3 exchanges)
                    const chatHistory = await Message.find({ 
                        chatJid: message.key.remoteJid,
                        userId: userId 
                    })
                    .sort({ timestamp: -1 })
                    .limit(6)
                    .lean();

                    // Format history for Gemini SDK
                    // SDK expects: { role: 'user'|'model', parts: [{ text: '...' }] }
                    const formattedHistory = chatHistory.reverse().map(msg => ({
                        role: msg.direction === 'in' ? 'user' : 'model',
                        parts: [{ text: msg.message || '' }]
                    }));
                    
                    let responseText = await GeminiService.generateResponse(messageText, formattedHistory);
                    
                    if (responseText) {
                        // Check for Order Signal
                        if (responseText.includes('[ORDER_SIGNAL:')) {
                            const signalMatch = responseText.match(/\[ORDER_SIGNAL:\s*({.*?})\s*\]/);
                            if (signalMatch) {
                                try {
                                    const orderData = JSON.parse(signalMatch[1]);
                                    // Clean the response text from the signal
                                    responseText = responseText.replace(signalMatch[0], '').trim();
                                    
                                    // Process the Invoice (Background)
                                    this.processOrderProvisioning(userId, message.key.remoteJid, message.pushName || 'Pelanggan', orderData, sock);
                                } catch (e) {
                                    console.error('Failed to parse order signal:', e);
                                }
                            }
                        }

                        const result = await sock.sendMessage(message.key.remoteJid, { text: responseText });
                        await this.recordBotResponse(userId, message.key.remoteJid, responseText, result, replyToId, quotedText, quotedSender, sock);
                    }
                } catch (error) {
                    console.error('Gemini AI error:', error);
                }
            }
        }
    }

    /**
     * Helper to record bot responses (Auto-reply or AI)
     */
    async recordBotResponse(userId, chatJid, text, result, replyToId, quotedText, quotedSender, sock) {
        const recordedReply = await MessageService.recordMessage({
            userId,
            chatJid,
            sender: 'bot', // 'auto-reply' or 'ai'
            text: text,
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
            const msgData = recordedReply.toObject ? recordedReply.toObject() : recordedReply;
            this.io.to(userId).emit('new_message', {
                ...msgData,
                id: msgData._id,
                chat_jid: msgData.chatJid
            });
        }
    }

    /**
     * Helper to process order provisioning and invoicing
     */
    async processOrderProvisioning(userId, customerJid, customerName, orderData, sock) {
        try {
            const invNumber = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
            
            // 1. Save to Database
            const newOrder = new Order({
                invoiceNumber: invNumber,
                customerJid: customerJid,
                customerName: customerName,
                productName: orderData.product,
                price: orderData.price,
                userId: userId,
                status: 'pending'
            });
            await newOrder.save();

            // 2. Prepare Invoice Message for Customer
            const invoiceMsg = `*📝 INVOICE PEMESANAN*\n` +
                `--------------------------\n` +
                `No. Invoice : ${invNumber}\n` +
                `Produk      : *${orderData.product}*\n` +
                `Total Bayar : *${orderData.price}*\n` +
                `Status      : *PENDING*\n` +
                `--------------------------\n\n` +
                `Silakan lakukan pembayaran dan kirimkan bukti transfer di sini.\n` +
                `Pesanan Anda sedang kami catat di sistem. Terima kasih! 😊`;

            // Wait a bit before sending invoice for natural feel
            setTimeout(async () => {
                const result = await sock.sendMessage(customerJid, { text: invoiceMsg });
                await this.recordBotResponse(userId, customerJid, invoiceMsg, result, null, null, null, sock);
            }, 2000);

            // 3. Notify Owner
            const ownerNum = this.appSettings.owner_number;
            if (ownerNum) {
                const ownerJid = ownerNum.includes('@') ? ownerNum : `${ownerNum}@s.whatsapp.net`;
                const ownerMsg = `*🔔 NOTIFIKASI ORDER BARU*\n\n` +
                    `Ada pesanan baru masuk!\n\n` +
                    `• Customer: ${customerName} (${customerJid.split('@')[0]})\n` +
                    `• Produk: ${orderData.product}\n` +
                    `• Harga: ${orderData.price}\n` +
                    `• Invoice: ${invNumber}\n\n` +
                    `Cek detailnya di dashboard.`;
                
                await sock.sendMessage(ownerJid, { text: ownerMsg });
            }

        } catch (error) {
            console.error('Provisioning error:', error);
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
            const data = await Message.findOne({
                _id: replyToId,
                userId: userId
            }).lean();

            if (data) {
                quotedDbRecord = data;
                quotedInfo = {
                    key: {
                        remoteJid: data.chatJid,
                        id: data.stanzaId,
                        fromMe: data.direction === 'out',
                        participant: data.senderJid,
                    },
                    message: data.rawMessage
                };
            }
        }

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
            rawMessage: result.message,
            replyToId: replyToId,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: session.sock.user.id.replace(/:.*$/, '@s.whatsapp.net')
        });

        if (recordedOutgoing) {
            const msgData = recordedOutgoing.toObject ? recordedOutgoing.toObject() : recordedOutgoing;
            this.io.to(userId).emit('new_message', {
                ...msgData,
                id: msgData._id,
                chat_jid: msgData.chatJid
            });
            if (this.webhookService && this.appSettings.webhook_toggle_message_out !== 'false') {
                this.webhookService.send('message.out', {
                    userId,
                    id: msgData._id,
                    chatJid: msgData.chatJid,
                    sender: msgData.sender,
                    text: msgData.message,
                    timestamp: msgData.timestamp
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
            console.error('Logout error:', error);
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
            console.error('Error removing auth directory:', error);
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

            // Optimization: Stagger preloading to avoid massive memory spike
            let index = 0;
            const preloadBatch = async () => {
                if (index >= userDirs.length) return;
                
                const userId = userDirs[index];
                console.log(`Preloading WhatsApp session for user: ${userId} (${index + 1}/${userDirs.length})`);
                await this.ensureSession(userId);
                
                index++;
                // 2 second delay between session preloads
                setTimeout(preloadBatch, 2000);
            };

            preloadBatch();
        } catch (error) {
            console.error('Error during WhatsApp session preload:', error);
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
        console.log(`[WhatsAppService] sendInteractiveMessage start for user: ${userId}`);
        const session = await this.ensureSession(userId);
        if (!session.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const phone = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        console.log(`[WhatsAppService] Target JID: ${phone}`);

        /* Use buttons-warpper enhanced method for better compatibility */
        console.log(`[WhatsAppService] Using buttons-warpper sendInteractiveMessage...`);
        try {
            const msg = await session.sock.sendInteractiveMessage(phone, {
                text: content.text || '',
                footer: content.footer || '',
                title: content.title || '',
                subtitle: content.subtitle || '',
                interactiveButtons: content.interactiveButtons || []
            });
            console.log(`[WhatsAppService] Message sent successfully via buttons-warpper`);
            return msg;
        } catch (err) {
            console.error(`[WhatsAppService] Failed to send via buttons-warpper:`, err);
            throw err;
        }
    }
}

export default WhatsAppService;
