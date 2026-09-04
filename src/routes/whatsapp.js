import { Router } from 'express';
import multer, { memoryStorage } from 'multer';
import { isAuthenticatedOrApiKey, getEffectiveUserId, isAuthenticated } from '../middleware/auth.js';
import ContactService from '../services/ContactService.js';
import MessageService from '../services/MessageService.js';

const router = Router();
const documentUpload = multer({
    storage: memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024
    }
});

// Get WhatsApp connection status
router.get('/status', isAuthenticatedOrApiKey, async (req, res) => {
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
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
            messageId: result.id,
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

// Send a message to a group
router.post('/send-group-message', isAuthenticatedOrApiKey, async (req, res) => {
    const { groupId, message, reply_to_id } = req.body;

    if (!groupId || !message) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: 'Both "groupId" and "message" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const groupJid = groupId.includes('@') ? groupId : `${groupId}@g.us`;

        const result = await whatsappService.sendMessage(userId, groupJid, message, reply_to_id);

        res.json({
            success: true,
            messageId: result.id,
            groupId: groupJid,
            message: message
        });
    } catch (error) {
        console.error('Error sending group message:', error);
        res.status(500).json({
            error: 'Failed to send group message',
            details: error.message
        });
    }
});

// Send a document attachment
router.post('/send-document', isAuthenticatedOrApiKey, documentUpload.fields([
    { name: 'document', maxCount: 1 },
    { name: 'file', maxCount: 1 }
]), async (req, res) => {
    const {
        to,
        url,
        base64,
        caption,
        fileName,
        filename,
        mimetype,
        reply_to_id
    } = req.body;
    const uploadedFile = req.files?.document?.[0] || req.files?.file?.[0] || null;

    if (!to || (!url && !base64 && !uploadedFile)) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to" and one of "url", "base64", or multipart file field "document" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');

        const result = await whatsappService.sendDocumentMessage(userId, to, {
            url,
            base64,
            buffer: uploadedFile?.buffer,
            caption,
            fileName: fileName || uploadedFile?.originalname,
            filename,
            mimetype: mimetype || uploadedFile?.mimetype
        }, reply_to_id);

        res.json({
            success: true,
            messageId: result.id,
            to,
            type: 'document',
            fileName: fileName || filename || uploadedFile?.originalname || 'document'
        });
    } catch (error) {
        console.error('Error sending document:', error);
        res.status(500).json({
            error: 'Failed to send document',
            details: error.message
        });
    }
});

// Send an image attachment
router.post('/send-image', isAuthenticatedOrApiKey, documentUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 }
]), async (req, res) => {
    const {
        to,
        url,
        base64,
        caption,
        fileName,
        filename,
        mimetype,
        reply_to_id
    } = req.body;
    const uploadedFile = req.files?.image?.[0] || req.files?.file?.[0] || null;

    if (!to || (!url && !base64 && !uploadedFile)) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to" and one of "url", "base64", or multipart file field "image" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');

        const result = await whatsappService.sendImageMessage(userId, to, {
            url,
            base64,
            buffer: uploadedFile?.buffer,
            caption,
            fileName: fileName || uploadedFile?.originalname,
            filename,
            mimetype: mimetype || uploadedFile?.mimetype
        }, reply_to_id);

        res.json({
            success: true,
            messageId: result.id,
            to,
            type: 'image',
            fileName: fileName || filename || uploadedFile?.originalname || 'image'
        });
    } catch (error) {
        console.error('Error sending image:', error);
        res.status(500).json({
            error: 'Failed to send image',
            details: error.message
        });
    }
});

// Send a video attachment
router.post('/send-video', isAuthenticatedOrApiKey, documentUpload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'file', maxCount: 1 }
]), async (req, res) => {
    const {
        to,
        url,
        base64,
        caption,
        fileName,
        filename,
        mimetype,
        reply_to_id
    } = req.body;
    const uploadedFile = req.files?.video?.[0] || req.files?.file?.[0] || null;

    if (!to || (!url && !base64 && !uploadedFile)) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to" and one of "url", "base64", or multipart file field "video" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');

        const result = await whatsappService.sendVideoMessage(userId, to, {
            url,
            base64,
            buffer: uploadedFile?.buffer,
            caption,
            fileName: fileName || uploadedFile?.originalname,
            filename,
            mimetype: mimetype || uploadedFile?.mimetype
        }, reply_to_id);

        res.json({
            success: true,
            messageId: result.id,
            to,
            type: 'video',
            fileName: fileName || filename || uploadedFile?.originalname || 'video'
        });
    } catch (error) {
        console.error('Error sending video:', error);
        res.status(500).json({
            error: 'Failed to send video',
            details: error.message
        });
    }
});

// Send audio / voice note
router.post('/send-audio', isAuthenticatedOrApiKey, documentUpload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'file', maxCount: 1 }
]), async (req, res) => {
    const {
        to,
        url,
        base64,
        fileName,
        filename,
        mimetype,
        reply_to_id,
        is_voice_note = false
    } = req.body;
    const uploadedFile = req.files?.audio?.[0] || req.files?.file?.[0] || null;

    if (!to || (!url && !base64 && !uploadedFile)) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to" and one of "url", "base64", or multipart file field "audio" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');

        const result = await whatsappService.sendAudioMessage(userId, to, {
            url,
            base64,
            buffer: uploadedFile?.buffer,
            fileName: fileName || uploadedFile?.originalname,
            filename,
            mimetype: mimetype || uploadedFile?.mimetype,
            isVoiceNote: is_voice_note === 'true' || is_voice_note === true
        }, reply_to_id);

        res.json({
            success: true,
            messageId: result.id,
            to,
            type: is_voice_note ? 'voice_note' : 'audio',
            fileName: fileName || filename || uploadedFile?.originalname || 'audio'
        });
    } catch (error) {
        console.error('Error sending audio:', error);
        res.status(500).json({
            error: 'Failed to send audio',
            details: error.message
        });
    }
});

// Send a sticker
router.post('/send-sticker', isAuthenticatedOrApiKey, documentUpload.fields([
    { name: 'sticker', maxCount: 1 },
    { name: 'file', maxCount: 1 }
]), async (req, res) => {
    const {
        to,
        url,
        base64,
        fileName,
        filename,
        mimetype,
        reply_to_id
    } = req.body;
    const uploadedFile = req.files?.sticker?.[0] || req.files?.file?.[0] || null;

    if (!to || (!url && !base64 && !uploadedFile)) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to" and one of "url", "base64", or multipart file field "sticker" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');

        const result = await whatsappService.sendStickerMessage(userId, to, {
            url,
            base64,
            buffer: uploadedFile?.buffer,
            fileName: fileName || uploadedFile?.originalname,
            filename,
            mimetype: mimetype || uploadedFile?.mimetype
        }, reply_to_id);

        res.json({
            success: true,
            messageId: result.id,
            to,
            type: 'sticker',
            fileName: fileName || filename || uploadedFile?.originalname || 'sticker'
        });
    } catch (error) {
        console.error('Error sending sticker:', error);
        res.status(500).json({
            error: 'Failed to send sticker',
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
            messageId: result.id,
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

// Send a poll
router.post('/send-poll', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, question, options, selectable_count } = req.body;

    if (!to || !question || !Array.isArray(options) || options.length < 2) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to", "question", and "options" (array, min 2) are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const result = await whatsappService.sendPollMessage(userId, to, {
            question, options, selectableCount: selectable_count ?? 1
        });
        res.json({ success: true, messageId: result.id, to });
    } catch (error) {
        console.error('Error sending poll:', error);
        res.status(500).json({ error: 'Failed to send poll', details: error.message });
    }
});

// React to a message (emoji '' removes the reaction)
router.post('/send-reaction', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, emoji, stanza_id, from_me, participant } = req.body;

    if (!to || emoji === undefined || !stanza_id) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to", "emoji", and "stanza_id" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const result = await whatsappService.sendReaction(userId, to, {
            emoji,
            target: { stanzaId: stanza_id, chatJid: to, fromMe: from_me, participant }
        });
        res.json({ success: true, messageId: result.id, to });
    } catch (error) {
        console.error('Error sending reaction:', error);
        res.status(500).json({ error: 'Failed to send reaction', details: error.message });
    }
});

// Edit a previously sent message
router.post('/edit-message', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, stanza_id, new_text } = req.body;

    if (!to || !stanza_id || !new_text) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to", "stanza_id", and "new_text" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const result = await whatsappService.editMessage(userId, to, { stanzaId: stanza_id, newText: new_text });
        res.json({ success: true, messageId: result.id, to });
    } catch (error) {
        console.error('Error editing message:', error);
        res.status(500).json({ error: 'Failed to edit message', details: error.message });
    }
});

// Revoke (delete for everyone)
router.post('/revoke-message', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, stanza_id, from_me, participant } = req.body;

    if (!to || !stanza_id) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to" and "stanza_id" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.revokeMessage(userId, to, {
            stanzaId: stanza_id,
            fromMe: from_me !== false,
            participant
        });
        res.json({ success: true, to });
    } catch (error) {
        console.error('Error revoking message:', error);
        res.status(500).json({ error: 'Failed to revoke message', details: error.message });
    }
});

// Pin or unpin a message
router.post('/pin-message', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, stanza_id, action, from_me, participant, duration_secs } = req.body;

    if (!to || !stanza_id) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to" and "stanza_id" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.pinMessage(userId, to, {
            stanzaId: stanza_id,
            fromMe: from_me !== false,
            participant,
            action: action === 'unpin' ? 'unpin' : 'pin',
            durationSecs: duration_secs
        });
        res.json({ success: true, to, action: action === 'unpin' ? 'unpin' : 'pin' });
    } catch (error) {
        console.error('Error pinning message:', error);
        res.status(500).json({ error: 'Failed to pin message', details: error.message });
    }
});

// Send legacy buttons message (max 3)
router.post('/send-button', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, title, content, footer, buttons } = req.body;

    if (!to || !content || !Array.isArray(buttons) || buttons.length === 0) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to", "content", and "buttons" (non-empty array) are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const result = await whatsappService.sendButtonMessage(userId, to, { title, content, footer, buttons });
        res.json({ success: true, messageId: result.id, to });
    } catch (error) {
        console.error('Error sending button message:', error);
        res.status(500).json({ error: 'Failed to send button message', details: error.message });
    }
});

// Send list menu message
router.post('/send-list', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, title, description, button_text, footer, sections } = req.body;

    if (!to || !title || !description || !button_text || !Array.isArray(sections)) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to", "title", "description", "button_text", and "sections" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const result = await whatsappService.sendListMessage(userId, to, {
            title, description, buttonText: button_text, footer, sections
        });
        res.json({ success: true, messageId: result.id, to });
    } catch (error) {
        console.error('Error sending list message:', error);
        res.status(500).json({ error: 'Failed to send list message', details: error.message });
    }
});

// Send CTA button (open URL or call)
router.post('/send-cta', isAuthenticatedOrApiKey, async (req, res) => {
    const { to, body, footer, display_text, url, phone_number } = req.body;

    if (!to || !body || !display_text || (!url && !phone_number)) {
        return res.status(400).json({
            error: 'Missing required fields',
            message: '"to", "body", "display_text", and one of "url" or "phone_number" are required'
        });
    }

    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const result = await whatsappService.sendCtaMessage(userId, to, {
            body, footer, displayText: display_text, url, phoneNumber: phone_number
        });
        res.json({ success: true, messageId: result.id, to });
    } catch (error) {
        console.error('Error sending CTA message:', error);
        res.status(500).json({ error: 'Failed to send CTA message', details: error.message });
    }
});

// --- Group management ---

// List groups
router.get('/groups', isAuthenticatedOrApiKey, async (req, res) => {
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const groups = await whatsappService.listGroups(userId);
        res.json({ success: true, data: groups });
    } catch (error) {
        console.error('Error listing groups:', error);
        res.status(500).json({ error: 'Failed to list groups', details: error.message });
    }
});

// Group metadata
router.get('/groups/metadata', isAuthenticatedOrApiKey, async (req, res) => {
    const { group_id } = req.query;
    if (!group_id) {
        return res.status(400).json({ error: 'Missing required fields', message: '"group_id" query param is required' });
    }
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const metadata = await whatsappService.getGroupMetadata(userId, group_id);
        res.json({ success: true, data: metadata });
    } catch (error) {
        console.error('Error fetching group metadata:', error);
        res.status(500).json({ error: 'Failed to fetch group metadata', details: error.message });
    }
});

// Create group
router.post('/groups/create', isAuthenticatedOrApiKey, async (req, res) => {
    const { subject, participants } = req.body;
    if (!subject || !Array.isArray(participants)) {
        return res.status(400).json({ error: 'Missing required fields', message: '"subject" and "participants" array are required' });
    }
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const group = await whatsappService.createGroup(userId, subject, participants);
        res.json({ success: true, data: group });
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(500).json({ error: 'Failed to create group', details: error.message });
    }
});

// Manage participants (add/remove/promote/demote)
router.post('/groups/participants', isAuthenticatedOrApiKey, async (req, res) => {
    const { group_id, action, participants } = req.body;
    if (!group_id || !action || !Array.isArray(participants)) {
        return res.status(400).json({ error: 'Missing required fields', message: '"group_id", "action", and "participants" are required' });
    }
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const result = await whatsappService.manageGroupParticipants(userId, group_id, action, participants);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error managing participants:', error);
        res.status(500).json({ error: 'Failed to manage participants', details: error.message });
    }
});

// Update group subject/description
router.post('/groups/update-info', isAuthenticatedOrApiKey, async (req, res) => {
    const { group_id, subject, description } = req.body;
    if (!group_id) {
        return res.status(400).json({ error: 'Missing required fields', message: '"group_id" is required' });
    }
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.updateGroupInfo(userId, group_id, { subject, description });
        res.json({ success: true, message: 'Group info updated' });
    } catch (error) {
        console.error('Error updating group info:', error);
        res.status(500).json({ error: 'Failed to update group info', details: error.message });
    }
});

// Get invite code/link
router.get('/groups/invite-code', isAuthenticatedOrApiKey, async (req, res) => {
    const { group_id } = req.query;
    if (!group_id) {
        return res.status(400).json({ error: 'Missing required fields', message: '"group_id" query param is required' });
    }
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const data = await whatsappService.getGroupInviteCode(userId, group_id);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error fetching invite code:', error);
        res.status(500).json({ error: 'Failed to fetch invite code', details: error.message });
    }
});

// Join group via invite code
router.post('/groups/join', isAuthenticatedOrApiKey, async (req, res) => {
    const { invite_code } = req.body;
    if (!invite_code) {
        return res.status(400).json({ error: 'Missing required fields', message: '"invite_code" is required' });
    }
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        const group = await whatsappService.joinGroupViaInvite(userId, invite_code);
        res.json({ success: true, data: group });
    } catch (error) {
        console.error('Error joining group:', error);
        res.status(500).json({ error: 'Failed to join group', details: error.message });
    }
});

// Leave group
router.post('/groups/leave', isAuthenticatedOrApiKey, async (req, res) => {
    const { group_id } = req.body;
    if (!group_id) {
        return res.status(400).json({ error: 'Missing required fields', message: '"group_id" is required' });
    }
    try {
        const userId = getEffectiveUserId(req);
        const whatsappService = req.app.get('whatsappService');
        await whatsappService.leaveGroup(userId, group_id);
        res.json({ success: true, message: 'Left group' });
    } catch (error) {
        console.error('Error leaving group:', error);
        res.status(500).json({ error: 'Failed to leave group', details: error.message });
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
