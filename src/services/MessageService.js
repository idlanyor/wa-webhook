import mongoose from 'mongoose';
import Message from '../models/Message.js';

class MessageService {
    /**
     * Record a message in the database
     */
    static async recordMessage(params) {
        const {
            userId, chatJid, sender, text, direction, timestamp,
            stanzaId, rawMessage, replyToId, quotedText, quotedSender, senderJid
        } = params;
        
        try {
            const message = new Message({
                userId,
                chatJid,
                sender,
                senderJid,
                message: text,
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
                timestamp: c.timestamp,
                sender: c.sender
            }));
        } catch (error) {
            console.error('Fetch chats error:', error);
            throw error;
        }
    }

    /**
     * Get messages for a specific chat
     */
    static async getChatMessages(userId, chatJid) {
        try {
            const messages = await Message.find({ userId, chatJid })
                .sort({ timestamp: 1 });
            
            return messages;
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