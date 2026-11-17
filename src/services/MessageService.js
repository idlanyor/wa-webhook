import { and, eq, desc, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { messages } = schema;

class MessageService {
    /**
     * Record a message in the database
     * @returns {object|null} the stored row, or null on failure
     */
    static async recordMessage(params) {
        const {
            userId, chatJid, sender, text, direction, timestamp,
            stanzaId, rawMessage, replyToId, quotedText, quotedSender, senderJid,
            messageType = 'text', attachment = null
        } = params;

        try {
            const [row] = db.insert(messages).values({
                userId: String(userId),
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
                replyToId: replyToId != null ? String(replyToId) : null,
                quotedText,
                quotedSender
            }).returning().all();
            return row;
        } catch (err) {
            console.error('Failed to record message:', err);
            return null;
        }
    }

    /** Find a stored message by its id (scoped to the user). */
    static findById(userId, id) {
        if (!id) return null;
        return db.select().from(messages)
            .where(and(eq(messages.id, String(id)), eq(messages.userId, String(userId))))
            .get() ?? null;
    }

    /** Find a stored message by its WhatsApp stanza id (scoped to the user). */
    static findByStanzaId(userId, stanzaId) {
        if (!stanzaId) return null;
        return db.select().from(messages)
            .where(and(eq(messages.stanzaId, stanzaId), eq(messages.userId, String(userId))))
            .get() ?? null;
    }

    /**
     * Get chat list for a user: the latest message of every chat, newest first.
     */
    static async getChats(userId) {
        const latest = db.select({
            id: messages.id,
            rn: sql`row_number() over (partition by ${messages.chatJid} order by ${messages.timestamp} desc)`.as('rn')
        }).from(messages).where(eq(messages.userId, String(userId))).as('latest');

        const rows = db.select({ m: messages })
            .from(messages)
            .innerJoin(latest, eq(latest.id, messages.id))
            .where(eq(latest.rn, 1))
            .orderBy(desc(messages.timestamp))
            .all();

        return rows.map(({ m }) => ({
            id: m.id,
            chat_jid: m.chatJid,
            message: m.message,
            messageType: m.messageType,
            attachment: m.attachment,
            timestamp: m.timestamp,
            sender: m.sender
        }));
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
        const conditions = [eq(messages.userId, String(userId)), eq(messages.chatJid, chatJid)];
        if (before) conditions.push(lt(messages.timestamp, new Date(before)));

        const rows = db.select().from(messages)
            .where(and(...conditions))
            .orderBy(desc(messages.timestamp))
            .limit(limit)
            .all();

        // Return in ascending order (oldest first) for chat display
        return rows.reverse();
    }
}

export default MessageService;

// Named exports for convenience
export const recordMessage = MessageService.recordMessage;
export const getChats = MessageService.getChats;
export const getChatMessages = MessageService.getChatMessages;
