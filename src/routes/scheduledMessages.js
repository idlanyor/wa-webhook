import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';

const router = Router();

// Scheduled messages page
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const schedulerService = req.app.get('schedulerService');
        const messages = await schedulerService.getUserScheduledMessages(req.user.id, {
            limit: 100
        });
        const stats = await schedulerService.getStatistics(req.user.id);

        res.render('scheduled-messages', {
            page: 'scheduled-messages',
            user: req.user,
            messages,
            stats,
            error: null,
            success: req.query.success
        });
    } catch (error) {
        console.error('Error loading scheduled messages:', error);
        res.render('scheduled-messages', {
            page: 'scheduled-messages',
            user: req.user,
            messages: [],
            stats: { total: 0, pending: 0, sent: 0, failed: 0, cancelled: 0 },
            error: 'Failed to load scheduled messages',
            success: null
        });
    }
});

// Create new scheduled message
router.post('/create', isAuthenticated, async (req, res) => {
    try {
        const { to, message, scheduledAt, messageType, interactiveData } = req.body;

        if (!to || !message || !scheduledAt) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        // Validate scheduled time is in the future
        const scheduledDate = new Date(scheduledAt);
        if (scheduledDate <= new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Scheduled time must be in the future'
            });
        }

        let parsedInteractiveData = null;
        if (interactiveData) {
            try {
                parsedInteractiveData = JSON.parse(interactiveData);
            } catch (parseError) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid interactiveData JSON'
                });
            }
        }

        const schedulerService = req.app.get('schedulerService');
        const scheduled = await schedulerService.createScheduledMessage(req.user.id, {
            to,
            message,
            scheduledAt,
            messageType: messageType || 'text',
            interactiveData: parsedInteractiveData
        });

        res.json({
            success: true,
            message: 'Message scheduled successfully',
            scheduled
        });
    } catch (error) {
        console.error('Error creating scheduled message:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to schedule message',
            details: error.message
        });
    }
});

// Cancel scheduled message
router.post('/cancel/:id', isAuthenticated, async (req, res) => {
    try {
        const schedulerService = req.app.get('schedulerService');
        await schedulerService.cancelScheduledMessage(req.user.id, req.params.id);

        res.redirect('/scheduled-messages?success=' + encodeURIComponent('Message cancelled successfully'));
    } catch (error) {
        console.error('Error cancelling scheduled message:', error);
        res.redirect('/scheduled-messages');
    }
});

// Delete scheduled message
router.post('/delete/:id', isAuthenticated, async (req, res) => {
    try {
        const schedulerService = req.app.get('schedulerService');
        await schedulerService.deleteScheduledMessage(req.user.id, req.params.id);

        res.redirect('/scheduled-messages?success=' + encodeURIComponent('Message deleted successfully'));
    } catch (error) {
        console.error('Error deleting scheduled message:', error);
        res.redirect('/scheduled-messages');
    }
});

// Get scheduled messages (API endpoint)
router.get('/api/list', isAuthenticated, async (req, res) => {
    try {
        const schedulerService = req.app.get('schedulerService');
        const status = req.query.status;
        
        const messages = await schedulerService.getUserScheduledMessages(req.user.id, {
            status,
            limit: 100
        });

        res.json({
            success: true,
            messages
        });
    } catch (error) {
        console.error('Error fetching scheduled messages:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch scheduled messages'
        });
    }
});

export default router;
