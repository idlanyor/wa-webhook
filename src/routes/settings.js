import { Router } from 'express';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';
import { getMany, set } from '../services/SettingsService.js';

const router = Router();

router.get('/', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const keys = [
            'webhook_url', 'webhook_secret', 
            'webhook_toggle_connection', 'webhook_toggle_message_in', 'webhook_toggle_message_out',
            'gemini_api_key', 'gemini_system_instruction', 'gemini_enabled', 'owner_number'
        ];
        const map = await getMany(keys);
        
        const webhookUrl = map.get('webhook_url') || '';
        const webhookSecret = map.get('webhook_secret') || '';
        const webhookToggleConnection = (map.get('webhook_toggle_connection') || 'true') === 'true';
        const webhookToggleMessageIn = (map.get('webhook_toggle_message_in') || 'true') === 'true';
        const webhookToggleMessageOut = (map.get('webhook_toggle_message_out') || 'true') === 'true';
        
        const geminiApiKey = map.get('gemini_api_key') || '';
        const geminiSystemInstruction = map.get('gemini_system_instruction') || '';
        const geminiEnabled = map.get('gemini_enabled') || 'false';
        const ownerNumber = map.get('owner_number') || '';

        res.render('settings', {
            page: 'settings',
            webhookUrl,
            webhookSecret,
            webhookToggleConnection,
            webhookToggleMessageIn,
            webhookToggleMessageOut,
            geminiApiKey,
            geminiSystemInstruction,
            geminiEnabled,
            ownerNumber,
            success: req.query.success,
            error: req.query.error,
            user: req.user
        });
    } catch (e) {
        res.render('settings', { page: 'settings', error: 'Gagal memuat pengaturan: ' + e.message, success: null, user: req.user });
    }
});

router.post('/webhook', isAuthenticated, isAdmin, async (req, res) => {
    const { webhook_url, webhook_secret, webhook_toggle_connection, webhook_toggle_message_in, webhook_toggle_message_out } = req.body;
    try {
        await set('webhook_url', webhook_url || '', 'Webhook endpoint URL');
        await set('webhook_secret', webhook_secret || '', 'Webhook HMAC secret');
        await set('webhook_toggle_connection', webhook_toggle_connection ? 'true' : 'false', 'Toggle connection status webhook');
        await set('webhook_toggle_message_in', webhook_toggle_message_in ? 'true' : 'false', 'Toggle incoming message webhook');
        await set('webhook_toggle_message_out', webhook_toggle_message_out ? 'true' : 'false', 'Toggle outgoing message webhook');
        
        // Reload settings in WhatsApp service
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.loadSettings();

        res.redirect('/settings?success=' + encodeURIComponent('Pengaturan webhook disimpan.'));
    } catch (e) {
        res.redirect('/settings?error=' + encodeURIComponent(e.message));
    }
});

router.post('/gemini', isAuthenticated, isAdmin, async (req, res) => {
    const { gemini_api_key, gemini_system_instruction, gemini_enabled, owner_number } = req.body;
    try {
        await set('gemini_api_key', gemini_api_key || '', 'Gemini API Key');
        await set('gemini_system_instruction', gemini_system_instruction || '', 'Gemini System Instruction');
        await set('gemini_enabled', gemini_enabled ? 'true' : 'false', 'Enable Gemini AI');
        await set('owner_number', owner_number || '', 'Owner WhatsApp Number for Notifications');
        
        // Reload settings in WhatsApp service
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.loadSettings();

        res.redirect('/settings?success=' + encodeURIComponent('Pengaturan Gemini AI disimpan.'));
    } catch (e) {
        res.redirect('/settings?error=' + encodeURIComponent(e.message));
    }
});

router.post('/webhook/test', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const webhookService = req.app.get('webhookService');
        await webhookService.send('test', { message: 'Webhook uji', userId: req.user.id });
        res.redirect('/settings?success=' + encodeURIComponent('Webhook uji dikirim. Periksa endpoint Anda.'));
    } catch (e) {
        res.redirect('/settings?error=' + encodeURIComponent('Gagal mengirim webhook uji.'));
    }
});

export default router;
