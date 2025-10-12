import { getDatabase } from '../config/database.js';

class MessageService {
    /**
     * Record a message in the database
     */
    static async recordMessage(params) {
        const {
            userId, chatJid, sender, text, direction, timestamp,
            stanzaId, rawMessage, replyToId, quotedText, quotedSender, senderJid,
            accessToken
        } = params;
        
        try {
            const supabase = getDatabase();
            let data = null; let error = null;
            ({ data, error } = await supabase
                .rpc('insert_message_secure', {
                    p_user: userId,
                    p_chat_jid: chatJid,
                    p_sender: sender,
                    p_text: text,
                    p_direction: direction,
                    p_timestamp: new Date(timestamp).toISOString(),
                    p_stanza_id: stanzaId,
                    p_raw: rawMessage,
                    p_reply_to: replyToId,
                    p_quoted_text: quotedText,
                    p_quoted_sender: quotedSender,
                    p_sender_jid: senderJid
                }));
            // Fallback if RPC function not found
            if (error && error.code === 'PGRST202') {
                // Try scoped client insert to satisfy RLS
                try {
                    const { createScopedClient } = require('../config/database');
                    const scoped = accessToken ? createScopedClient(accessToken) : supabase;
                    ({ data, error } = await scoped
                        .from('messages')
                        .insert({
                            user_id: userId,
                            chat_jid: chatJid,
                            sender: sender,
                            message: text,
                            direction: direction,
                            timestamp: new Date(timestamp).toISOString(),
                            stanza_id: stanzaId,
                            raw_message: rawMessage,
                            reply_to_id: replyToId,
                            quoted_text: quotedText,
                            quoted_sender: quotedSender,
                            sender_jid: senderJid
                        })
                        .select()
                        .single());
                } catch (e) {
                    error = e;
                }
            }
                
            if (error) throw error;
            return data;
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
            const supabase = getDatabase();
            const { data, error } = await supabase
                .from('messages')
                .select('id, chat_jid, message, timestamp, sender')
                .eq('user_id', userId)
                .order('timestamp', { ascending: false });
                
            if (error) throw error;
            
            // Aggregate last message per chat_jid
            const chatMap = new Map();
            for (const row of data) {
                if (!chatMap.has(row.chat_jid)) {
                    chatMap.set(row.chat_jid, row);
                }
            }
            
            return Array.from(chatMap.values());
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
            const supabase = getDatabase();
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('user_id', userId)
                .eq('chat_jid', chatJid)
                .order('timestamp', { ascending: true });
                
            if (error) throw error;
            return data;
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
