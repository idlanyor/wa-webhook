import { Router } from 'express';
import { isAuthenticatedOrApiKey, getEffectiveUserId, isAuthenticated } from '../middleware/auth.js';
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

// Request pairing code
router.post('/pairing-code', isAuthenticatedOrApiKey, async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({
            error: 'Missing phone number',
            message: 'Phone number is required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');

        const code = await whatsappService.requestPairingCode(userId, phoneNumber);

        res.json({
            success: true,
            pairingCode: code
        });
    } catch (error) {
        console.error('Pairing code error:', error);
        res.status(500).json({
            error: 'Failed to request pairing code',
            details: error.message
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



// Send interactive message
router.post('/send-interactive', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, text, footer, title, subtitle, interactiveButtons } = req.body;

    if (!to || !interactiveButtons) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to" and "interactiveButtons" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');

        const result = await whatsappService.sendInteractiveMessage(userId, to, {
            text, footer, title, subtitle, interactiveButtons
        });

        res.json({
            success: true,
            messageId: result.key.id,
            to: to
        });
    } catch (error) {
        console.error('Error sending interactive message:', error);
        res.status(500).json({
            error: 'Failed to send interactive message',
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