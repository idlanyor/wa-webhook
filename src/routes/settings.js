import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import { getMany, set } from '../services/SettingsService.js';

const router = Router();

router.get('/', isAuthenticated, async (req, res) => {
    try {
        const map = await getMany(['webhook_url', 'webhook_secret', 'webhook_toggle_connection', 'webhook_toggle_message_in', 'webhook_toggle_message_out']);
        const webhookUrl = map.get('webhook_url') || '';
        const webhookSecret = map.get('webhook_secret') || '';
        const webhookToggleConnection = (map.get('webhook_toggle_connection') || 'true') === 'true';
        const webhookToggleMessageIn = (map.get('webhook_toggle_message_in') || 'true') === 'true';
        const webhookToggleMessageOut = (map.get('webhook_toggle_message_out') || 'true') === 'true';
        res.render('settings', {
            page: 'settings',
            webhookUrl,
            webhookSecret,
            webhookToggleConnection,
            webhookToggleMessageIn,
            webhookToggleMessageOut,
            success: req.query.success,
            error: req.query.error
        });
    } catch (e) {
        res.render('settings', { page: 'settings', webhookUrl: '', webhookSecret: '', error: 'Gagal memuat pengaturan', success: null });
    }
});

router.post('/webhook', isAuthenticated, async (req, res) => {
    const { webhook_url, webhook_secret, webhook_toggle_connection, webhook_toggle_message_in, webhook_toggle_message_out } = req.body;
    try {
        await set('webhook_url', webhook_url || '', 'Webhook endpoint URL');
        await set('webhook_secret', webhook_secret || '', 'Webhook HMAC secret');
        await set('webhook_toggle_connection', webhook_toggle_connection ? 'true' : 'false', 'Toggle connection status webhook');
        await set('webhook_toggle_message_in', webhook_toggle_message_in ? 'true' : 'false', 'Toggle incoming message webhook');
        await set('webhook_toggle_message_out', webhook_toggle_message_out ? 'true' : 'false', 'Toggle outgoing message webhook');
        res.redirect('/settings?success=' + encodeURIComponent('Pengaturan webhook disimpan.'));
    } catch (e) {
        res.redirect('/settings?error=' + encodeURIComponent(e.message));
    }
});

router.post('/webhook/test', isAuthenticated, async (req, res) => {
    try {
        const webhookService = req.app.get('webhookService');
        await webhookService.send('test', { message: 'Webhook uji', userId: req.user.id });
        res.redirect('/settings?success=' + encodeURIComponent('Webhook uji dikirim. Periksa endpoint Anda.'));
    } catch (e) {
        res.redirect('/settings?error=' + encodeURIComponent('Gagal mengirim webhook uji.'));
    }
});

export default router;
