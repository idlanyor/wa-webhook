import mongoose from 'mongoose';
import Message from '../models/Message.js';

class MessageService {
    /**
     * Record a message in the database
     */
    static async recordMessage(params) {
        const {
            userId, chatJid, sender, text, direction, timestamp,
            stanzaId, rawMessage, replyToId, quotedText, quotedSender, senderJid,
            messageType = 'text', attachment = null
        } = params;
        
        try {
            const message = new Message({
                userId,
                chatJid,
                sender,
                senderJid,
                message: text,
                messageType,
                attachment,
                direction,
                timestamp: new Date(timestamp),
                stanzaId,
                rawMessage,
                replyToId,
                quotedText,
                quotedSender
            });

            await message.save();
            return message;
        } catch (err) {
            console.error('Failed to record message:', err);
            return null;
        }
    }

    /**
     * Get chat list for a user
     */
    static async getChats(userId) {
        try {
            // MongoDB aggregation to get last message per chatJid
            const chats = await Message.aggregate([
                { $match: { userId: typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId } },
                { $sort: { timestamp: -1 } },
                {
                    $group: {
                        _id: '$chatJid',
                        lastMessage: { $first: '$$ROOT' }
                    }
                },
                { $replaceRoot: { newRoot: '$lastMessage' } },
                { $sort: { timestamp: -1 } }
            ]);
            
            // Map to match expected format (chat_jid instead of chatJid if views expect that)
            // Actually, let's keep the model field names and check views later if needed.
            // SQL used chat_jid, message, timestamp, sender
            return chats.map(c => ({
                id: c._id,
                chat_jid: c.chatJid,
                message: c.message,
                messageType: c.messageType,
                attachment: c.attachment,
                timestamp: c.timestamp,
                sender: c.sender
            }));
        } catch (error) {
            console.error('Fetch chats error:', error);
            throw error;
        }
    }

    /**
     * Get messages for a specific chat with pagination.
     * @param {string} userId
     * @param {string} chatJid
     * @param {object} [opts]
     * @param {number} [opts.limit=100] - Max messages to return
     * @param {Date|string} [opts.before] - Cursor: only return messages before this timestamp
     */
    static async getChatMessages(userId, chatJid, { limit = 100, before } = {}) {
        try {
            const query = { userId, chatJid };
            if (before) {
                query.timestamp = { $lt: new Date(before) };
            }

            const messages = await Message.find(query)
                .sort({ timestamp: -1 })
                .limit(limit)
                .lean();

            // Return in ascending order (oldest first) for chat display
            return messages.reverse();
        } catch (error) {
            console.error('Fetch chat messages error:', error);
            throw error;
        }
    }
}

export default MessageService;

// Named exports for convenience
export const recordMessage = MessageService.recordMessage;
export const getChats = MessageService.getChats;
export const getChatMessages = MessageService.getChatMessages;
