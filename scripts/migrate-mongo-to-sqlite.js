#!/usr/bin/env node
/**
 * One-off migration: copy app data from MongoDB into the SQLite database.
 *
 *   MONGODB_URI=mongodb://host:27017/whatsapp-webhook npm run db:migrate-mongo
 *
 * - Target is SQLITE_PATH (default ./data/wa-webhook.db). It must not contain
 *   any users yet; pass --force to migrate into a non-empty database anyway.
 * - Ids are preserved (ObjectId hex), so existing JWT cookies stay valid.
 * - WhatsApp sessions (zapo Signal state) cannot be copied between stores:
 *   `waSessionId` is cleared and every user has to scan the QR code again.
 * - Rows pointing at a user that no longer exists are skipped.
 *
 * Requires the `mongodb` package (dev dependency): npm install
 */
import 'dotenv/config';
import { config } from '../src/config/index.js';
import { initDb, closeDb, schema } from '../src/db/index.js';
import { count } from 'drizzle-orm';

const BATCH = 500;
const force = process.argv.includes('--force');
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
}

let MongoClient;
try {
    ({ MongoClient } = await import('mongodb'));
} catch {
    console.error('The "mongodb" package is missing. Run `npm install` (it is a dev dependency).');
    process.exit(1);
}

const str = (v) => (v === undefined || v === null ? null : String(v));
const date = (v) => (v ? new Date(v) : null);

const db = await initDb(config.database.path);
const existingUsers = db.select({ n: count() }).from(schema.users).get().n;
if (existingUsers > 0 && !force) {
    console.error(`Target ${config.database.path} already has ${existingUsers} user(s). Use --force to migrate anyway.`);
    process.exit(1);
}

const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
await client.connect();
const mongo = client.db();
console.log(`Migrating ${mongo.databaseName} -> ${config.database.path}`);

const userIds = new Set();
const stats = {};

/**
 * Stream a Mongo collection into a SQLite table in batches.
 * @param {string} collection - Mongo collection name
 * @param {object} table - Drizzle table
 * @param {(doc) => object|null} map - Row mapper; return null to skip
 */
async function copy(collection, table, map) {
    const s = (stats[collection] = { read: 0, written: 0, skipped: 0 });
    let batch = [];
    const flush = () => {
        if (!batch.length) return;
        const rows = batch;
        batch = [];
        db.transaction((tx) => {
            tx.insert(table).values(rows).onConflictDoNothing().run();
        });
        s.written += rows.length;
    };

    for await (const doc of mongo.collection(collection).find({})) {
        s.read++;
        const row = map(doc);
        if (!row) { s.skipped++; continue; }
        batch.push(row);
        if (batch.length >= BATCH) flush();
    }
    flush();
}

const ownedBy = (doc) => userIds.has(str(doc.userId));

try {
    await copy('users', schema.users, (d) => {
        userIds.add(str(d._id));
        return {
            id: str(d._id),
            email: String(d.email).trim().toLowerCase(),
            password: d.password,
            name: d.name,
            role: d.role === 'admin' ? 'admin' : 'user',
            waSessionId: null, // sessions must be re-paired on the new store
            createdAt: date(d.createdAt) ?? new Date(),
            updatedAt: date(d.updatedAt) ?? new Date()
        };
    });

    await copy('apikeys', schema.apiKeys, (d) => ownedBy(d) ? {
        id: str(d._id),
        userId: str(d.userId),
        keyHash: d.keyHash,
        createdAt: date(d.createdAt) ?? new Date()
    } : null);

    await copy('autoreplies', schema.autoReplies, (d) => ({
        id: str(d._id),
        keyword: d.keyword,
        reply: d.reply,
        enabled: d.enabled !== false,
        createdAt: date(d.createdAt) ?? new Date(),
        updatedAt: date(d.updatedAt) ?? new Date()
    }));

    await copy('contacts', schema.contacts, (d) => ownedBy(d) ? {
        id: str(d._id),
        userId: str(d.userId),
        name: d.name,
        phone: d.phone,
        tags: d.tags || '',
        createdAt: date(d.createdAt) ?? new Date(),
        updatedAt: date(d.updatedAt) ?? new Date()
    } : null);

    await copy('messages', schema.messages, (d) => ownedBy(d) ? {
        id: str(d._id),
        userId: str(d.userId),
        chatJid: d.chatJid,
        sender: d.sender ?? '',
        senderJid: d.senderJid ?? null,
        message: d.message ?? null,
        messageType: d.messageType || 'text',
        attachment: d.attachment ?? null,
        direction: d.direction === 'out' ? 'out' : 'in',
        timestamp: date(d.timestamp) ?? date(d.createdAt) ?? new Date(),
        stanzaId: d.stanzaId ?? null,
        rawMessage: d.rawMessage ?? null,
        replyToId: str(d.replyToId),
        quotedText: d.quotedText ?? null,
        quotedSender: d.quotedSender ?? null,
        createdAt: date(d.createdAt) ?? new Date()
    } : null);

    await copy('scheduledmessages', schema.scheduledMessages, (d) => ownedBy(d) ? {
        id: str(d._id),
        userId: str(d.userId),
        to: d.to,
        message: d.message,
        messageType: d.messageType === 'interactive' ? 'interactive' : 'text',
        interactiveData: d.interactiveData ?? null,
        scheduledAt: date(d.scheduledAt),
        status: d.status || 'pending',
        sentAt: date(d.sentAt),
        error: d.error ?? null,
        messageId: d.messageId ?? null,
        createdAt: date(d.createdAt) ?? new Date(),
        updatedAt: date(d.updatedAt) ?? new Date()
    } : null);

    await copy('settings', schema.settings, (d) => ({
        key: d.key,
        value: d.value ?? null,
        description: d.description ?? null,
        createdAt: date(d.createdAt) ?? new Date(),
        updatedAt: date(d.updatedAt) ?? new Date()
    }));

    console.table(stats);
    console.log('Done. WhatsApp sessions were not migrated: each user must scan the QR code again.');
} finally {
    await client.close();
    closeDb();
}
