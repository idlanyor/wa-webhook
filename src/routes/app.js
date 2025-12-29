import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import WhatsAppService from '../services/WhatsAppService.js';

const router = Router();

// Main redirect
router.get('/', (req, res) => {
    res.redirect('/dashboard');
});

// Dashboard
router.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        // Ensure user has a WhatsApp session
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.ensureSession(req.user.id);
        
        res.render('dashboard', { 
            page: 'dashboard', 
            userId: req.user.id,
            user: req.user
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.render('dashboard', { 
            page: 'dashboard', 
            userId: req.user.id,
            user: req.user,
            error: 'Failed to initialize WhatsApp session'
        });
    }
});

// Documentation
router.get('/documentation', isAuthenticated, (req, res) => {
    res.render('documentation', { 
        page: 'documentation',
        user: req.user
    });
});

export default router;
