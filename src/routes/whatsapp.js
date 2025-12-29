import { Router } from 'express';
import { isAuthenticatedOrApiKey, getEffectiveUserId, isAuthenticated } from '../middleware/auth.js';
import TemplateService from '../services/TemplateService.js';
import ContactService from '../services/ContactService.js';
import MessageService from '../services/MessageService.js';

const router = Router();

// Get WhatsApp connection status
router.get('/status', isAuthenticatedOrApiKey, async (req, res) => {
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.ensureSession(userId);
        const status = whatsappService.getSessionStatus(userId);
        
        res.json(status);
    } catch (error) {
        console.error('Status route error:', error);
        res.status(500).json({
            error: 'internal_error',
            message: error.message
        });
    }
});

// Send a single message
router.post('/send-message', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, message, reply_to_id } = req.body;
    
    if (!to || !message) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: 'Both "to" and "message" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        
        const result = await whatsappService.sendMessage(userId, to, message, reply_to_id);
        
        res.json({
            success: true,
            messageId: result.key.id,
            to: to,
            message: message
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            error: 'Failed to send message',
            details: error.message
        });
    }
});

// Send bulk messages
router.post('/send-bulk', isAuthenticatedOrApiKey, async (req, res) => {
    const { numbers, message, templateId } = req.body;
    
    if (!numbers || !message) {
        return res.status(400).json({
            success: false,
            error: 'Numbers and message are required.'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const session = await whatsappService.ensureSession(userId);
        
        if (!session.isConnected) {
            return res.status(400).json({
                success: false,
                error: 'WhatsApp is not connected.'
            });
        }

        const numberList = numbers.split('\n')
            .map(n => n.trim())
            .filter(Boolean);

        res.json({
            success: true,
            message: `Bulk sending started for ${numberList.length} numbers.`
        });

        // Start bulk sending in background
        const io = req.app.get('io');
        (async () => {
            let template = null;
            if (templateId) {
                try { template = await TemplateService.getTemplateById(userId, templateId); } catch {}
            }
            // Load contacts once for name lookup
            let contacts = [];
            try { contacts = await ContactService.getAllContacts(userId); } catch {}
            for (const number of numberList) {
                const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
                try {
                    // Try find contact name
                    let name = '';
                    try {
                        const cleanedNum = String(number).replace(/\D/g, '').replace(/^\+/, '');
                        const found = contacts.find(c => String(c.phone || '').replace(/\D/g, '').endsWith(cleanedNum));
                        if (found) name = found.name || '';
                    } catch {}

                    // Choose base text: template content if provided, else message body
                    let baseText = template ? (template.content || '') : (message || '');
                    // Always apply placeholder substitution
                    const finalMessage = baseText
                        .replace(/\{phone\}/g, number)
                        .replace(/\{name\}/g, name);
                    await session.sock.sendMessage(jid, { text: finalMessage });
                    io.to(userId).emit('bulk-log', {
                        status: 'success',
                        message: `Dikirim ke ${number}`
                    });
                    
                    // Record message
                    await MessageService.recordMessage({
                        userId,
                        chatJid: jid,
                        sender: 'me',
                        text: finalMessage,
                        direction: 'out',
                        timestamp: Date.now()
                    });
                } catch (err) {
                    io.to(userId).emit('bulk-log', {
                        status: 'error',
                        message: `Gagal kirim ke ${number}: ${err.message}`
                    });
                }
                
                // Random delay between messages
                await new Promise(resolve => 
                    setTimeout(resolve, Math.floor(Math.random() * 5000) + 2000)
                );
            }
            
            io.to(userId).emit('bulk-log', {
                status: 'done',
                message: 'Pengiriman massal selesai.'
            });
        })();

    } catch (error) {
        console.error('Error in bulk send:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start bulk sending',
            details: error.message
        });
    }
});

// Logout from WhatsApp
router.post('/logout', isAuthenticatedOrApiKey, async (req, res) => {
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        
        await whatsappService.logout(userId);
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to logout',
            details: error.message
        });
    }
});

// Reset session: logout then create a fresh session (QR-only)
router.post('/reset-session', isAuthenticated, async (req, res) => {
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.logout(userId);
        await whatsappService.ensureSession(userId);
        res.json({ success: true, message: 'Sesi telah direset' });
    } catch (error) {
        console.error('Reset session error:', error);
        res.status(500).json({ success: false, error: 'Gagal mereset sesi', details: error.message });
    }
});

export default router;