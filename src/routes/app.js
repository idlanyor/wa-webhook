import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';

const router = Router();

// Main redirect
router.get('/', (req, res) => {
    res.redirect('/dashboard');
});

// Dashboard
router.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        // Ensure user has a WhatsApp session
        const WhatsAppService = require('../services/WhatsAppService').default;
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.ensureSession(req.user.id);
        
        res.render('dashboard', { 
            page: 'dashboard', 
            userId: req.user.id 
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.render('dashboard', { 
            page: 'dashboard', 
            userId: req.user.id,
            error: 'Failed to initialize WhatsApp session'
        });
    }
});

// Chat interface
router.get('/chat', isAuthenticated, (req, res) => {
    res.render('chat', { 
        page: 'chat', 
        userId: req.user.id 
    });
});

// Blaster interface
router.get('/blaster', isAuthenticated, (req, res) => {
    res.render('blaster', { 
        page: 'blaster', 
        userId: req.user.id 
    });
});

// Documentation
router.get('/documentation', isAuthenticated, (req, res) => {
    res.render('documentation', { 
        page: 'documentation' 
    });
});

export default router;