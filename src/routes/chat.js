import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import { getChats, getChatMessages } from '../services/MessageService.js';

const router = Router();

// Get chat list
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const chats = await getChats(req.user.id);
        res.json(chats);
    } catch (error) {
        console.error('Fetch chats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get messages for specific chat
router.get('/:jid', isAuthenticated, async (req, res) => {
    try {
        const messages = await getChatMessages(req.user.id, req.params.jid);
        res.json(messages);
    } catch (error) {
        console.error('Fetch chat messages error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;