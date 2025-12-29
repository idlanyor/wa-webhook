import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import { getSettings, getAutoReplies, updateSetting, addAutoReply, deleteAutoReply, toggleAutoReply } from '../services/SettingsService.js';

const router = Router();

// Auto-reply settings page
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const [settings, replies] = await Promise.all([
            getSettings(),
            getAutoReplies()
        ]);
        
        res.render('auto-reply', { 
            settings, 
            replies, 
            error: null, 
            success: req.query.success, 
            page: 'auto-reply',
            user: req.user
        });
    } catch (error) {
        console.error('Error loading auto-reply page:', error);
        res.render('auto-reply', { 
            settings: {}, 
            replies: [], 
            error: 'Failed to load auto-reply settings.', 
            success: null, 
            page: 'auto-reply',
            user: req.user
        });
    }
});

// Update auto-reply global settings
router.post('/settings', isAuthenticated, async (req, res) => {
    const { auto_reply_enabled } = req.body;
    
    try {
        const enabled = auto_reply_enabled ? 'true' : 'false';
        await updateSetting('auto_reply_enabled', enabled);
        
        // Reload settings in WhatsApp service
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.loadSettings();
        
        res.redirect('/auto-reply?success=' + encodeURIComponent('Settings updated successfully.'));
    } catch (error) {
        console.error('Error updating auto-reply settings:', error);
        res.redirect('/auto-reply');
    }
});

// Add new auto-reply rule
router.post('/add', isAuthenticated, async (req, res) => {
    const { keyword, reply } = req.body;
    
    if (!keyword || !reply) {
        return res.redirect('/auto-reply');
    }
    
    try {
        await addAutoReply(keyword, reply);
        
        // Reload settings in WhatsApp service
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.loadSettings();
        
        res.redirect('/auto-reply?success=' + encodeURIComponent('Auto-reply rule added successfully.'));
    } catch (error) {
        console.error('Error adding auto-reply rule:', error);
        res.redirect('/auto-reply');
    }
});

// Delete auto-reply rule
router.post('/delete/:id', isAuthenticated, async (req, res) => {
    try {
        await deleteAutoReply(req.params.id);
        
        // Reload settings in WhatsApp service
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.loadSettings();
        
        res.redirect('/auto-reply?success=' + encodeURIComponent('Auto-reply rule deleted successfully.'));
    } catch (error) {
        console.error('Error deleting auto-reply rule:', error);
        res.redirect('/auto-reply');
    }
});

// Toggle auto-reply rule
router.get('/toggle/:id', isAuthenticated, async (req, res) => {
    try {
        await toggleAutoReply(req.params.id);
        
        // Reload settings in WhatsApp service
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.loadSettings();
        
        res.redirect('/auto-reply?success=' + encodeURIComponent('Auto-reply rule toggled successfully.'));
    } catch (error) {
        console.error('Error toggling auto-reply rule:', error);
        res.redirect('/auto-reply');
    }
});

export default router;