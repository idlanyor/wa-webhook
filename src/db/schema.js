/**
 * Drizzle schema (SQLite).
 *
 * After changing this file run `npm run db:generate` to create a new SQL
 * migration in ./drizzle; migrations are applied automatically on startup.
 */
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { newId } from './id.js';

const id = () => text('id').primaryKey().$defaultFn(newId);
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());
const userRef = () => text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' });

export const users = sqliteTable('users', {
    id: id(),
    email: text('email').notNull().unique(),
    password: text('password').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
    // Set when this user's WhatsApp device is paired (zapo sessionId = id).
    // Used to preload active sessions on startup. Cleared on logout.
    waSessionId: text('wa_session_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
});

export const apiKeys = sqliteTable('api_keys', {
    id: id(),
    userId: userRef(),
    keyHash: text('key_hash').notNull().unique(),
    createdAt: createdAt()
}, (t) => [index('api_keys_user_idx').on(t.userId)]);

export const autoReplies = sqliteTable('auto_replies', {
    id: id(),
    keyword: text('keyword').notNull(),
    reply: text('reply').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
});

export const contacts = sqliteTable('contacts', {
    id: id(),
    userId: userRef(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    tags: text('tags').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt()
}, (t) => [uniqueIndex('contacts_user_phone_uniq').on(t.userId, t.phone)]);

export const messages = sqliteTable('messages', {
    id: id(),
    userId: userRef(),
    chatJid: text('chat_jid').notNull(),
    sender: text('sender').notNull(),
    senderJid: text('sender_jid'),
    message: text('message'),
    messageType: text('message_type').notNull().default('text'),
    attachment: text('attachment', { mode: 'json' }),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    stanzaId: text('stanza_id'),
    rawMessage: text('raw_message', { mode: 'json' }),
    replyToId: text('reply_to_id'),
    quotedText: text('quoted_text'),
    quotedSender: text('quoted_sender'),
    createdAt: createdAt()
}, (t) => [
    index('messages_user_chat_idx').on(t.userId, t.chatJid, t.timestamp),
    index('messages_user_ts_idx').on(t.userId, t.timestamp),
    index('messages_stanza_idx').on(t.stanzaId, t.userId)
]);

export const scheduledMessages = sqliteTable('scheduled_messages', {
    id: id(),
    userId: userRef(),
    to: text('to').notNull(),
    message: text('message').notNull(),
    messageType: text('message_type', { enum: ['text', 'interactive'] }).notNull().default('text'),
    interactiveData: text('interactive_data', { mode: 'json' }),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp_ms' }).notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'cancelled'] }).notNull().default('pending'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    error: text('error'),
    messageId: text('message_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
}, (t) => [
    index('scheduled_status_at_idx').on(t.status, t.scheduledAt),
    index('scheduled_user_status_idx').on(t.userId, t.status, t.scheduledAt)
]);

export const settings = sqliteTable('settings', {
    key: text('key').primaryKey(),
    value: text('value'),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
});
