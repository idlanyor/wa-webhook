require('dotenv').config();
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const supabase = require('./supabaseClient');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Setup view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Authentication Middleware
async function isAuthenticated(req, res, next) {
    const token = req.cookies['supabase-auth-token'];
    if (!token) {
        return res.redirect('/login');
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(JSON.parse(token).access_token);

    if (error || !user) {
        // Clear the invalid cookie
        res.clearCookie('supabase-auth-token');
        return res.redirect('/login');
    }
    
    req.user = user;
    next();
}

// --- API KEY SYSTEM ---
async function verifyApiKey(key) {
    try {
        const keyHash = crypto.createHash('sha256').update(key).digest('hex');
        const { data, error } = await supabase
            .from('api_keys')
            .select('user_id')
            .eq('key_hash', keyHash)
            .single();
        if (error || !data) return null;
        return data.user_id;
    } catch (err) {
        console.error('API key verification failed:', err);
        return null;
    }
}

async function isAuthenticatedOrApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (apiKey) {
        const userId = await verifyApiKey(apiKey);
        if (userId) {
            req.apiUserId = userId;
            return next();
        }
    }
    return isAuthenticated(req, res, next);
}

// WhatsApp Service Globals
let sock;
let qrCode = null;
let isConnected = false;
let connectionState = 'disconnected';
let appSettings = {};
let autoReplies = [];
let isWhatsAppServiceStarted = false; // Flag to ensure single startup
let keepAliveTimer = null; // interval ID for presence keep-alive

// Load settings and auto-replies from Supabase
async function loadSettings() {
    try {
        const { data: settingsData, error: settingsError } = await supabase.from('settings').select('*');
        if (settingsError) throw settingsError;
        appSettings = settingsData.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});

        const { data: repliesData, error: repliesError } = await supabase.from('auto_replies').select('*');
        if (repliesError) throw repliesError;
        autoReplies = repliesData;

        console.log('App settings and auto-replies loaded from Supabase.');
    } catch (error) {
        console.error('Failed to load settings from Supabase:', error);
    }
}

// Fungsi untuk memulai koneksi WhatsApp
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['WhatsApp API', 'Chrome', '1.0.0'],
        // shorter keep-alive at transport level to reduce idle disconnects
        keepAliveIntervalMs: 20_000,
        // stay offline in WA presence to not trigger push suppression, we'll manage presence manually
        markOnlineOnConnect: false
    });

    // Periodic presence ping to keep the session warm & prevent idle disconnects
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(async () => {
        try {
            if (sock && isConnected) {
                await sock.sendPresenceUpdate('available');
            }
        } catch (err) {
            // silent catch, presence errors are non-fatal
        }
    }, 25_000);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCode = qr;
            connectionState = 'qr_ready';
            console.log('QR Code generated');
            // Emit QR code ke frontend
            io.emit('qr', qr);
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;

            console.log('Connection closed. Code:', statusCode, isLoggedOut ? '(logged out)' : '');

            // Reset state & notify UI
            isConnected = false;
            connectionState = 'disconnected';
            io.emit('connection_status', { status: 'disconnected' });

            if (isLoggedOut) {
                // Remove stored auth credentials so a new QR is mandatory on next connect
                try {
                    const authPath = path.join(__dirname, 'auth_info_baileys');
                    if (fs.existsSync(authPath)) {
                        fs.rmSync(authPath, { recursive: true, force: true });
                        console.log('auth_info_baileys directory deleted due to logout.');
                    }
                } catch (err) {
                    console.error('Failed to delete auth_info_baileys directory:', err);
                }
            }

            // Attempt to reconnect (new QR will be generated if logged out)
            setTimeout(() => startWhatsApp(), 1_000);
        } else if (connection === 'open') {
            console.log('WhatsApp connection opened');
            isConnected = true;
            connectionState = 'connected';
            qrCode = null;
            io.emit('connection_status', { status: 'connected' });
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        if (!message.key.fromMe && m.type === 'notify') {
            const messageText = message.message?.conversation || message.message?.extendedTextMessage?.text;

            // Auto-reply bot logic (enabled by default unless explicitly disabled)
            const autoReplyEnabled = appSettings.auto_reply_enabled !== 'false';
            if (autoReplyEnabled && !message.key.remoteJid.endsWith('@g.us') && messageText) {
                const msgLower = messageText.trim().toLowerCase();
                const matchedReply = autoReplies.find(rule => {
                    if (!rule.enabled) return false;
                    const kw = String(rule.keyword || '').toLowerCase().trim();
                    return kw && msgLower.includes(kw);
                });

                if (matchedReply) {
                    try {
                        await sock.sendMessage(message.key.remoteJid, { text: matchedReply.reply });
                        console.log(`Auto-reply sent (rule '${matchedReply.keyword}') to ${message.key.remoteJid}`);
                    } catch (error) {
                        console.error(`Failed to send auto-reply to ${message.key.remoteJid}:`, error);
                    }
                } else {
                    console.log('No auto-reply match for incoming message:', msgLower);
                }
            }
            console.log('Received message:', message);

            let groupName = null;
            let sender = null;

            // Cek apakah dari grup
            if (message.key.remoteJid.endsWith('@g.us')) {
                const groupMetadata = await sock.groupMetadata(message.key.remoteJid);
                groupName = groupMetadata.subject; // Nama grup
                sender = message.pushName; // Nomor pengirim di grup
            } else {
                sender = message.pushName; // Kalau private chat, sender = pengirim langsung
            }
            console.log(sender)

            const messageData = {
                id: message.key.id,
                from: message.key.remoteJid,
                sender: sender,
                groupName: groupName,
                message: message.message?.conversation ||
                    message.message?.extendedTextMessage?.text ||
                    'Media message',
                timestamp: message.messageTimestamp
            };

            io.emit('new_message', messageData);
            console.log('New message received:', messageData);
        }
    });

}

// --- ROUTES ---

// Auth Routes
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        return res.render('login', { error: error.message });
    }

    res.cookie('supabase-auth-token', JSON.stringify(data.session), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: data.session.expires_in * 1000,
    });

    res.redirect('/dashboard');
});

app.post('/logout-user', async (req, res) => {
    await supabase.auth.signOut();
    res.clearCookie('supabase-auth-token');
    res.redirect('/login');
});


// Main App Routes
app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    if (!isWhatsAppServiceStarted) {
        console.log('First dashboard visit, starting WhatsApp service...');
        startWhatsApp();
        isWhatsAppServiceStarted = true;
    }
    res.render('dashboard', { page: 'dashboard' });
});

app.get('/blaster', isAuthenticated, (req, res) => {
    res.render('blaster', { page: 'blaster' });
});

// Documentation Route
app.get('/documentation', isAuthenticated, (req, res) => {
    res.render('documentation', { page: 'documentation' });
});

// WhatsApp Service Routes
app.get('/status', isAuthenticatedOrApiKey, (req, res) => {
    res.json({ status: connectionState, connected: isConnected, qr: qrCode });
});

app.post('/send-message', isAuthenticatedOrApiKey, async (req, res) => {
    try {
        const { to, message } = req.body;

        if (!isConnected) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        if (!to || !message) {
            return res.status(400).json({ error: 'Missing required fields: to, message' });
        }

        // Format nomor telepon
        const phoneNumber = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;

        const result = await sock.sendMessage(phoneNumber, { text: message });

        res.json({
            success: true,
            messageId: result.key.id,
            to: phoneNumber,
            message: message
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message', details: error.message });
    }
});

app.post('/logout', isAuthenticated, async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
        }

        // Hapus auth info
        const authPath = path.join(__dirname, 'auth_info_baileys');
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }

        isConnected = false;
        connectionState = 'disconnected';
        qrCode = null;

        res.json({ success: true, message: 'Logged out successfully' });

        // Restart connection untuk generate QR baru
        setTimeout(() => {
            startWhatsApp();
        }, 1000);

    } catch (error) {
        console.error('Error logging out:', error);
        res.status(500).json({ error: 'Failed to logout', details: error.message });
    }
});

// Blaster Route
app.post('/send-bulk', isAuthenticatedOrApiKey, async (req, res) => {
    const { numbers, message } = req.body;
    if (!numbers || !message) {
        return res.status(400).json({ success: false, error: 'Numbers and message are required.' });
    }

    if (!isConnected) {
        return res.status(400).json({ success: false, error: 'WhatsApp is not connected.' });
    }

    const numberList = numbers.split('\n').map(n => n.trim()).filter(n => n);

    res.json({ success: true, message: `Bulk sending process started for ${numberList.length} numbers.` });

    // Run the sending process in the background
    (async () => {
        for (const number of numberList) {
            try {
                const phoneNumber = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
                await sock.sendMessage(phoneNumber, { text: message });
                io.emit('bulk-log', { status: 'success', message: `Successfully sent to ${number}` });
            } catch (error) {
                console.error(`Failed to send to ${number}:`, error);
                io.emit('bulk-log', { status: 'error', message: `Failed to send to ${number}. Reason: ${error.message}` });
            }
            // Add a random delay between 2 to 7 seconds
            const delay = Math.floor(Math.random() * 5000) + 2000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        io.emit('bulk-log', { status: 'done', message: 'Bulk sending process finished.' });
    })();
});

// Contacts Management Routes
app.get('/contacts', isAuthenticated, async (req, res) => {
    const { data, error } = await supabase.from('contacts').select('*').order('name', { ascending: true });
    res.render('contacts', { contacts: data || [], error: error?.message, success: null, page: 'contacts' });
});

app.post('/contacts/add', isAuthenticated, async (req, res) => {
    const { name, phone } = req.body;
    const { error } = await supabase.from('contacts').insert({ name, phone });

    const { data } = await supabase.from('contacts').select('*').order('name', { ascending: true });
    res.render('contacts', { contacts: data || [], error: error?.message, success: error ? null : 'Contact added!', page: 'contacts' });
});

app.post('/contacts/delete/:id', isAuthenticated, async (req, res) => {
    await supabase.from('contacts').delete().match({ id: req.params.id });
    res.redirect('/contacts');
});

app.get('/api/contacts', isAuthenticatedOrApiKey, async (req, res) => {
    const { data, error } = await supabase.from('contacts').select('*').order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Auto Reply Routes
app.get('/auto-reply', isAuthenticated, async (req, res) => {
    const { data, error } = await supabase.from('auto_replies').select('*').order('keyword', { ascending: true });
    res.render('auto-reply', { settings: appSettings, replies: data || [], error: error?.message, success: null, page: 'auto-reply' });
});

app.post('/auto-reply/settings', isAuthenticated, async (req, res) => {
    const { auto_reply_enabled } = req.body;
    const enabled = auto_reply_enabled ? 'true' : 'false';
    await supabase.from('settings').update({ value: enabled }).match({ key: 'auto_reply_enabled' });
    await loadSettings();
    res.redirect('/auto-reply');
});

app.post('/auto-reply/add', isAuthenticated, async (req, res) => {
    const { keyword, reply } = req.body;
    await supabase.from('auto_replies').insert({ keyword, reply });
    await loadSettings();
    res.redirect('/auto-reply');
});

app.post('/auto-reply/delete/:id', isAuthenticated, async (req, res) => {
    await supabase.from('auto_replies').delete().match({ id: req.params.id });
    await loadSettings();
    res.redirect('/auto-reply');
});

app.get('/auto-reply/toggle/:id', isAuthenticated, async (req, res) => {
    const { data: rule } = await supabase.from('auto_replies').select('enabled').match({ id: req.params.id }).single();
    if (rule) {
        await supabase.from('auto_replies').update({ enabled: !rule.enabled }).match({ id: req.params.id });
        await loadSettings();
    }
    res.redirect('/auto-reply');
});

// UI & REST routes to manage API keys (requires login)
app.get('/api-keys', isAuthenticated, async (req, res) => {
    const { data, error } = await supabase
        .from('api_keys')
        .select('id, created_at')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });
    res.render('api-keys', { keys: data || [], error: error?.message, success: null, page: 'api-keys' });
});

app.post('/api-keys/generate', isAuthenticated, async (req, res) => {
    try {
        const rawKey = crypto.randomBytes(32).toString('hex');
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        await supabase.from('api_keys').insert({ user_id: req.user.id, key_hash: keyHash });
        res.render('api-keys', { keys: [{ raw: rawKey, created_at: new Date() }], success: 'API key generated. Copy it now, it will not be shown again!', page: 'api-keys', error: null });
    } catch (error) {
        console.error('Failed to generate API key:', error);
        res.render('api-keys', { keys: [], error: 'Failed to generate API key', page: 'api-keys' });
    }
});

app.post('/api-keys/delete/:id', isAuthenticated, async (req, res) => {
    await supabase.from('api_keys').delete().match({ id: req.params.id, user_id: req.user.id });
    res.redirect('/api-keys');
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected to socket');

    // Send current status to the newly connected client
    socket.emit('connection_status', { status: connectionState });

    if (qrCode) {
        socket.emit('qr', qrCode);
    }

    socket.on('disconnect', () => {
        console.log('Client disconnected from socket');
    });
});

// Server Initialization
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`WhatsApp service running on port ${PORT}`);
});

// Initial Load and Start
loadSettings();
// Mulai koneksi WhatsApp segera setelah server online
startWhatsApp();
isWhatsAppServiceStarted = true;

