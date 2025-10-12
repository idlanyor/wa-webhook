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
const multer = require('multer');
const vCard = require('vcf');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        const fileExt = path.extname(file.originalname).toLowerCase();
        if (fileExt === '.vcf' || file.mimetype === 'text/vcard' || file.mimetype === 'text/x-vcard' || fileExt === '.csv' || file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Only .vcf and .csv files are allowed!'), false);
        }
    }
});


async function isAuthenticated(req, res, next) {
    const token = req.cookies['supabase-auth-token'];
    if (!token) {
        return res.redirect('/login');
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(JSON.parse(token).access_token);

    if (error || !user) {
        
        res.clearCookie('supabase-auth-token');
        return res.redirect('/login');
    }
    
    req.user = user;
    next();
}


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


const sessions = new Map(); 

let appSettings = {};
let autoReplies = [];


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

// ------------------ Multi-Tenant Session Helpers ------------------

function getEffectiveUserId(req) {
    return req.user?.id || req.apiUserId;
}

/**
 * Ensure WhatsApp session exists for given user ID. Returns session object.
 */
async function ensureSession(userId, phoneNumber = null) {
    if (sessions.has(userId)) return sessions.get(userId);

    const authDir = path.join(__dirname, 'auth_info_baileys', userId);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const session = {
        sock: null,
        isConnected: false,
        state: 'disconnected',
        qr: null,
        pairingCode: null,
        phoneNumber: phoneNumber,
        keepAliveTimer: null
    };

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['WhatsApp API', 'Chrome', '1.0.0'],
        keepAliveIntervalMs: 20_000,
        markOnlineOnConnect: false
    });

    session.sock = sock;

    // keep-alive presence
    session.keepAliveTimer = setInterval(async () => {
        if (session.isConnected) {
            try { await sock.sendPresenceUpdate('available'); } catch {}
        }
    }, 25_000);

    sock.ev.on('creds.update', saveCreds);

    // -------- connection handling --------
    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            session.qr = qr;
            session.state = 'qr_ready';
            io.to(userId).emit('qr', qr);
        }

        // Handle pairing code logic
        if (connection === 'connecting' && phoneNumber && !sock.authState.creds.registered) {
            try {
                console.log(`🔐 Requesting pairing code for ${phoneNumber}...`);
                const code = await sock.requestPairingCode(phoneNumber);
                session.pairingCode = code;
                session.state = 'pairing_code_ready';
                console.log(`📱 Pairing code: ${code}`);
                io.to(userId).emit('pairing_code', { code, phoneNumber });
            } catch (error) {
                console.error('Failed to request pairing code:', error);
                session.state = 'pairing_failed';
                io.to(userId).emit('pairing_error', { error: error.message });
            }
        }

        if (connection === 'open') {
            session.isConnected = true;
            session.state = 'connected';
            session.qr = null;
            session.pairingCode = null;
            console.log(`✅ WhatsApp connected for user ${userId}`);
            io.to(userId).emit('connection_status', { status: 'connected' });
        }

        if (connection === 'close') {
            session.isConnected = false;
            session.state = 'disconnected';
            io.to(userId).emit('connection_status', { status: 'disconnected' });

            if (session.keepAliveTimer) clearInterval(session.keepAliveTimer);
            sessions.delete(userId);

            const code = (lastDisconnect?.error)?.output?.statusCode;
            const loggedOut = code === DisconnectReason.loggedOut;
            if (loggedOut) {
                console.log(`🗑️ Session logged out, cleaning auth for user ${userId}`);
                try { if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive:true, force:true }); } catch {}
            }

            setTimeout(() => ensureSession(userId, phoneNumber), 1_000);
        }
    });

    // -------- auto-reply --------
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        if (!message.key.fromMe && m.type === 'notify') {
            const messageText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
            
            const contextInfo = message.message?.extendedTextMessage?.contextInfo;
            let quoted_text = null;
            let quoted_sender = null;
            let reply_to_id = null;
            
            if (contextInfo?.quotedMessage) {
                quoted_text = contextInfo.quotedMessage.conversation || contextInfo.quotedMessage.extendedTextMessage?.text || '...';
                quoted_sender = contextInfo.participant;
                const { data: repliedToMsg } = await supabase.from('messages').select('id').eq('stanza_id', contextInfo.stanzaId).eq('user_id', userId).maybeSingle() || {};
                if(repliedToMsg) reply_to_id = repliedToMsg.id;
            }

            const recordedMessage = await recordMessage({
                userId,
                chatJid: message.key.remoteJid,
                sender: message.pushName || message.key.participant || message.key.remoteJid,
                senderJid: message.key.participant || message.key.remoteJid,
                text: messageText,
                direction: 'in',
                timestamp: (message.messageTimestamp || Date.now()) * 1000,
                stanzaId: message.key.id,
                rawMessage: message.message,
                replyToId: reply_to_id,
                quoted_text: quoted_text,
                quoted_sender: quoted_sender
            });

            if(recordedMessage) io.to(userId).emit('new_message', recordedMessage);

            const autoReplyEnabled = appSettings.auto_reply_enabled !== 'false';
            if (autoReplyEnabled && !message.key.remoteJid.endsWith('@g.us') && messageText) {
                const lower = messageText.trim().toLowerCase();
                const rule = autoReplies.find(r => r.enabled && lower.includes(String(r.keyword || '').toLowerCase().trim()));
                if (rule) {
                    try {
                        await sock.sendMessage(message.key.remoteJid, { text: rule.reply });
                        const recordedReply = await recordMessage({
                            userId,
                            chatJid: message.key.remoteJid,
                            sender: 'auto-reply',
                            text: rule.reply,
                            direction: 'out',
                            timestamp: Date.now(),
                            stanzaId: result.key.id,
                            rawMessage: result.message,
                            replyToId: reply_to_id,
                            quotedText: quoted_text,
                            quotedSender: quoted_sender,
                            senderJid: s.sock.user.id.replace(/:.*$/,'@s.whatsapp.net')
                        });
                        if(recordedReply) io.to(userId).emit('new_message', recordedReply);
                    } catch {}
                }
            }
        }
    });

    sessions.set(userId, session);
    return session;
}

// Note: legacy single-tenant startWhatsApp removed after multi-tenant refactor

// --- ROUTES ---

// Auth Routes
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.get('/register', (req, res) => {
    res.render('register', { error: null, success: null });
});

app.post('/register', async (req, res) => {
    const { name, email, password, confirmPassword } = req.body;
    
    // Validation
    if (!name || !email || !password || !confirmPassword) {
        return res.render('register', { 
            error: 'All fields are required', 
            success: null 
        });
    }
    
    if (password !== confirmPassword) {
        return res.render('register', { 
            error: 'Passwords do not match', 
            success: null 
        });
    }
    
    if (password.length < 6) {
        return res.render('register', { 
            error: 'Password must be at least 6 characters long', 
            success: null 
        });
    }
    
    try {
        // 1) Attempt to sign up the user
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name }
            }
        });
        if (signUpError) {
            return res.render('register', { error: signUpError.message, success: null });
        }

        // 2) If Supabase did NOT return a session (common when using service key),
        //    attempt to sign the user in to retrieve a session token.
        let session = signUpData.session;
        if (!session) {
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
            if (!signInError) {
                session = signInData.session;
            }
        }

        // 3) If we managed to obtain a session, log the user in immediately.
        if (session) {
            res.cookie('supabase-auth-token', JSON.stringify(session), {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: session.expires_in * 1000,
            });
            return res.redirect('/dashboard');
        }

        // 4) Fallback: ask the user to confirm their email first.
        return res.render('register', {
            error: null,
            success: 'Registration successful! Please check your email to confirm your account before logging in.'
        });

    } catch (err) {
        console.error('Registration error:', err);
        return res.render('register', {
            error: 'An unexpected error occurred. Please try again.',
            success: null
        });
    }
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

app.get('/dashboard', isAuthenticated, async (req, res) => {
    await ensureSession(req.user.id);
    res.render('dashboard', { page: 'dashboard', userId: req.user.id });
});

app.get('/chat', isAuthenticated, (req, res) => {
    res.render('chat', { page: 'chat', userId: req.user.id });
});

app.get('/blaster', isAuthenticated, (req, res) => {
    res.render('blaster', { page: 'blaster', userId: req.user.id });
});

// Documentation Route
app.get('/documentation', isAuthenticated, (req, res) => {
    res.render('documentation', { page: 'documentation' });
});

// WhatsApp Service Routes
app.get('/status', isAuthenticatedOrApiKey, async (req, res) => {
    try {
        const uid = getEffectiveUserId(req);
        const s = await ensureSession(uid);
        return res.json({ 
            status: s.state, 
            connected: s.isConnected, 
            qr: s.qr,
            pairingCode: s.pairingCode || null,
            phoneNumber: s.phoneNumber || null
        });
    } catch (error) {
        console.error('Status route error:', error);
        return res.status(500).json({ error: 'internal_error', message: error.message });
    }
});

app.post('/send-message', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, message, reply_to_id } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Missing "to" or "message"' });

    const uid = getEffectiveUserId(req);
    const s = await ensureSession(uid);
    if (!s.isConnected) return res.status(400).json({ error: 'WhatsApp not connected' });

    const phone = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    try {
        let quotedInfo = undefined;
        let quotedDbRecord = null;
        if (reply_to_id) {
            const { data } = await supabase.from('messages').select('*').eq('id', reply_to_id).eq('user_id', uid).single();
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

        const result = await s.sock.sendMessage(phone, { text: message }, { quoted: quotedInfo });
        
        const recordedOutgoing = await recordMessage({
            userId: uid,
            chatJid: phone,
            sender: 'me',
            text: message,
            direction: 'out',
            timestamp: Date.now(),
            stanzaId: result.key.id,
            rawMessage: result.message,
            replyToId: reply_to_id,
            quotedText: quotedDbRecord?.message,
            quotedSender: quotedDbRecord?.sender,
            senderJid: s.sock.user.id.replace(/:.*$/,'@s.whatsapp.net')
        });

        if(recordedOutgoing) io.to(uid).emit('new_message', recordedOutgoing);

        res.json({ success: true, messageId: result.key.id, to: phone, message });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Failed', details: err.message });
    }
});

// Add new endpoint for pairing code authentication
app.post('/connect-pairing', isAuthenticated, async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Clean phone number (remove spaces, dashes, etc.)
        const cleanedNumber = phoneNumber.replace(/[^\d+]/g, '');
        
        // Validate phone number format
        if (!cleanedNumber.match(/^\+?[1-9]\d{1,14}$/)) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }

        const userId = getEffectiveUserId(req);
        
        // Clean existing session if any
        if (sessions.has(userId)) {
            const existingSession = sessions.get(userId);
            if (existingSession.keepAliveTimer) {
                clearInterval(existingSession.keepAliveTimer);
            }
            if (existingSession.sock) {
                existingSession.sock.ev.removeAllListeners();
                if (existingSession.sock.ws) {
                    existingSession.sock.ws.close();
                }
            }
            sessions.delete(userId);
        }

        // Start new session with pairing code
        const session = await ensureSession(userId, cleanedNumber);
        
        res.json({ 
            success: true, 
            message: 'Pairing code request initiated',
            phoneNumber: cleanedNumber
        });
    } catch (error) {
        console.error('Pairing connection error:', error);
        res.status(500).json({ error: 'Failed to initiate pairing connection' });
    }
});

app.post('/logout', isAuthenticated, async (req, res) => {
    const uid = req.user.id;
    const s = sessions.get(uid);
    if (!s) return res.json({ success: true });

    try {
        await s.sock.logout();
    } catch {}

    if (s.keepAliveTimer) clearInterval(s.keepAliveTimer);
    sessions.delete(uid);

    const dir = path.join(__dirname, 'auth_info_baileys', uid);
    try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive:true, force:true }); } catch {}

    res.json({ success: true, message: 'Logged out' });
});

// Blaster Route
app.post('/send-bulk', isAuthenticatedOrApiKey, async (req, res) => {
    const { numbers, message } = req.body;
    if (!numbers || !message) return res.status(400).json({ success:false, error:'Numbers and message are required.' });

    const uid = getEffectiveUserId(req);
    const s = await ensureSession(uid);
    if (!s.isConnected) return res.status(400).json({ success:false, error:'WhatsApp is not connected.' });

    const numberList = numbers.split('\n').map(n=>n.trim()).filter(Boolean);
    res.json({ success:true, message:`Bulk sending started for ${numberList.length} numbers.` });

    (async ()=>{
        for(const n of numberList){
            const jid = n.includes('@')? n : `${n}@s.whatsapp.net`;
            try{
                await s.sock.sendMessage(jid,{ text: message });
                io.to(uid).emit('bulk-log',{ status:'success', message:`Sent to ${n}`});
                recordMessage({ userId: uid, chatJid: jid, sender: 'me', text: message, direction: 'out', timestamp: Date.now() });
            }catch(err){
                io.to(uid).emit('bulk-log',{ status:'error', message:`Failed to send to ${n}: ${err.message}`});
            }
            await new Promise(r=>setTimeout(r, Math.floor(Math.random()*5000)+2000));
        }
        io.to(uid).emit('bulk-log',{ status:'done', message:'Bulk sending finished.'});
    })();
});

// Contacts Management Routes
app.get('/contacts', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const pageSize = 15;
        const offset = (page - 1) * pageSize;
        const userId = req.user.id;

        // Get total number of contacts for pagination
        const { count, error: countError } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (countError) throw countError;

        // Get contacts for the current page
        const { data, error } = await supabase
            .from('contacts')
            .select('*')
            .eq('user_id', userId)
            .order('name', { ascending: true })
            .range(offset, offset + pageSize - 1);

        if (error) throw error;
        
        res.render('contacts', { 
            contacts: data || [], 
            error: req.query.error, 
            success: req.query.success, 
            page: 'contacts',
            totalPages: Math.ceil(count / pageSize),
            currentPage: page
        });
    } catch (error) {
        res.render('contacts', { 
            contacts: [], 
            error: 'Failed to load contacts.', 
            success: null, 
            page: 'contacts',
            totalPages: 0,
            currentPage: 1
        });
    }
});

app.post('/contacts/add', isAuthenticated, async (req, res) => {
    const { name, phone } = req.body;
    const { error } = await supabase.from('contacts').insert({ name, phone });

    if (error) {
        return res.redirect('/contacts?error=' + encodeURIComponent(error.message));
    }
    res.redirect('/contacts?success=Contact added successfully.');
});

app.post('/contacts/import', isAuthenticated, upload.single('vcfFile'), async (req, res) => {
    if (!req.file) {
        return res.redirect('/contacts?error=' + encodeURIComponent('No file uploaded.'));
    }

    try {
        const vcfContent = req.file.buffer.toString('utf8');
        const cards = vCard.parse(vcfContent);

        if (!cards || cards.length === 0) {
            return res.redirect('/contacts?error=' + encodeURIComponent('VCF file is empty or invalid.'));
        }

        const parsedContacts = cards.map(card => {
            const name = card.data.fn;
            const phoneProp = card.data.tel?.[0];
            const phone = phoneProp ? phoneProp.valueOf().replace(/\D/g, '') : null;
            if (!name || !phone) return null;
            return { user_id: req.user.id, name: name.valueOf(), phone: phone };
        }).filter(Boolean);

        const { data: existingContacts, error: fetchError } = await supabase
            .from('contacts')
            .select('phone')
            .eq('user_id', req.user.id);

        if (fetchError) throw fetchError;

        const existingPhones = new Set(existingContacts.map(c => c.phone));
        const uniqueNewContacts = [];
        const phonesInThisBatch = new Set();
        
        for (const contact of parsedContacts) {
            if (!existingPhones.has(contact.phone) && !phonesInThisBatch.has(contact.phone)) {
                uniqueNewContacts.push(contact);
                phonesInThisBatch.add(contact.phone);
            }
        }
        
        const duplicateCount = parsedContacts.length - uniqueNewContacts.length;

        if (uniqueNewContacts.length > 0) {
            const { error } = await supabase.from('contacts').insert(uniqueNewContacts);
            if (error) throw error;
        }
        
        let successMessage = `${uniqueNewContacts.length} contacts imported successfully.`;
        if (duplicateCount > 0) {
            successMessage += ` ${duplicateCount} duplicates were ignored.`;
        }
        
        res.redirect('/contacts?success=' + encodeURIComponent(successMessage));

    } catch (error) {
        console.error('Error importing VCF file:', error);
        res.redirect('/contacts?error=' + encodeURIComponent('Failed to import contacts from VCF file. ' + error.message));
    }
});

app.post('/contacts/import/csv', isAuthenticated, upload.single('csvFile'), async (req, res) => {
    if (!req.file) {
        return res.redirect('/contacts?error=' + encodeURIComponent('No file uploaded.'));
    }

    const parsedContacts = [];
    const buffer = req.file.buffer;
    const stream = Readable.from(buffer.toString());

    stream.pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
        .on('data', (row) => {
            const firstName = row['First Name'] || '';
            const middleName = row['Middle Name'] || '';
            const lastName = row['Last Name'] || '';
            let name = `${firstName} ${middleName} ${lastName}`.replace(/\s+/g, ' ').trim();
            if (!name) {
                name = row['File As'] || row['Nickname'];
            }
            const phone = row['Phone 1 - Value'];
            if (name && phone) {
                parsedContacts.push({
                    user_id: req.user.id,
                    name: name,
                    phone: phone.replace(/\D/g, '')
                });
            }
        })
        .on('end', async () => {
            if (parsedContacts.length === 0) {
                return res.redirect('/contacts?error=' + encodeURIComponent('No valid contacts found in the CSV file.'));
            }

            try {
                const { data: existingContacts, error: fetchError } = await supabase
                    .from('contacts')
                    .select('phone')
                    .eq('user_id', req.user.id);

                if (fetchError) throw fetchError;

                const existingPhones = new Set(existingContacts.map(c => c.phone));
                const uniqueNewContacts = [];
                const phonesInThisBatch = new Set();

                for (const contact of parsedContacts) {
                    if (!existingPhones.has(contact.phone) && !phonesInThisBatch.has(contact.phone)) {
                        uniqueNewContacts.push(contact);
                        phonesInThisBatch.add(contact.phone);
                    }
                }

                const duplicateCount = parsedContacts.length - uniqueNewContacts.length;

                if (uniqueNewContacts.length > 0) {
                    const { error } = await supabase.from('contacts').insert(uniqueNewContacts);
                    if (error) throw error;
                }

                let successMessage = `${uniqueNewContacts.length} contacts imported successfully.`;
                if (duplicateCount > 0) {
                    successMessage += ` ${duplicateCount} duplicates were ignored.`;
                }
                res.redirect('/contacts?success=' + encodeURIComponent(successMessage));
            } catch (error) {
                console.error('Error importing CSV file:', error);
                res.redirect('/contacts?error=' + encodeURIComponent('Failed to import contacts from CSV file. ' + error.message));
            }
        })
        .on('error', (error) => {
            console.error('Error processing CSV file:', error);
            res.redirect('/contacts?error=' + encodeURIComponent('Failed to process CSV file. ' + error.message));
        });
});

app.post('/contacts/delete/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    await supabase.from('contacts').delete().match({ id: id });
    res.redirect('/contacts');
});

app.get('/api/contacts', isAuthenticatedOrApiKey, async (req, res) => {
    const uid = getEffectiveUserId(req);
    const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', uid)
        .order('name', { ascending: true });
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

// -------- Chat API --------
app.get('/api/chats', isAuthenticated, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('id, chat_jid, message, timestamp, sender')
            .eq('user_id', req.user.id)
            .order('timestamp', { ascending: false });
        if (error) throw error;
        // aggregate last message per chat_jid
        const map = new Map();
        for (const row of data) {
            if (!map.has(row.chat_jid)) map.set(row.chat_jid, row);
        }
        res.json(Array.from(map.values()));
    } catch (err) {
        console.error('Fetch chats error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chats/:jid', isAuthenticated, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('user_id', req.user.id)
            .eq('chat_jid', req.params.jid)
            .order('timestamp', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Fetch chat messages error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    const uid = socket.handshake.query.userId;
    if (uid) socket.join(uid);
    console.log('Socket connected for user:', uid);
});

// Server Initialization
const PORT = process.env.PORT || 8181;
if (!process.env.JEST_WORKER_ID) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`WhatsApp service running on port ${PORT}`);
    });
}

// Initial Load and Start
loadSettings();

// Preload WhatsApp sessions for all users that have auth files so they stay online even without an active WebSocket client
(async function preloadWhatsAppSessions(){
    try {
        console.log('Preloading WhatsApp sessions for existing users...');
        const { data: users, error } = await supabase.auth.admin.listUsers();
        
        if (error) {
            console.error('Failed to fetch users for session preload:', error);
            return;
        }

        if (users && users.users) {
            for (const user of users.users) {
                try {
                    // Check if user has stored phone number preference
                    const { data: settings } = await supabase
                        .from('settings')
                        .select('phone_number')
                        .eq('user_id', user.id)
                        .single();
                    
                    const phoneNumber = settings?.phone_number || null;
                    await ensureSession(user.id, phoneNumber);
                    console.log(`Session initialized for user: ${user.id}${phoneNumber ? ` (${phoneNumber})` : ''}`);
                } catch (err) {
                    console.error(`Failed to initialize session for user ${user.id}:`, err);
                }
            }
        }
    } catch (error) {
        console.error('Error during session preload:', error);
    }
})();

// ---------- Message Persistence Helper ----------
async function recordMessage(params) {
    const {
        userId, chatJid, sender, text, direction, timestamp,
        stanzaId, rawMessage, replyToId, quotedText, quotedSender, senderJid
    } = params;
    try {
        const { data, error } = await supabase.from('messages').insert({
            user_id: userId,
            chat_jid: chatJid,
            sender: sender,
            message: text,
            direction: direction,
            timestamp: new Date(timestamp).toISOString(),
            stanza_id: stanzaId,
            raw_message: rawMessage,
            reply_to_id: replyToId,
            quoted_text: quotedText,
            quoted_sender: quotedSender,
            sender_jid: senderJid
        }).select().single();
        if(error) throw error;
        return data;
    } catch (err) {
        console.error('Failed to record message:', err);
        return null;
    }
}

// For test environment, stub ensureSession to always return a connected dummy session
if (process.env.JEST_WORKER_ID) {
    ensureSession = async () => ({
        isConnected: true,
        state: 'connected',
        qr: null,
        sock: {
            sendMessage: async () => ({ key: { id: 'test-id' }, message: {} }),
            user: { id: 'bot@s.whatsapp.net' }
        }
    });
}

module.exports = { app, server, ensureSession };

