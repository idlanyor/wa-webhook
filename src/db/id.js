import { randomBytes, randomInt } from 'crypto';

const PROCESS_RANDOM = randomBytes(5);
let counter = randomInt(0xffffff);

/**
 * 24-char hex id in MongoDB ObjectId layout (timestamp + random + counter).
 * Keeps ids sortable by creation time and compatible with ids migrated from MongoDB.
 */
export function newId() {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
    PROCESS_RANDOM.copy(buf, 4);
    counter = (counter + 1) % 0xffffff;
    buf.writeUIntBE(counter, 9, 3);
    return buf.toString('hex');
}
