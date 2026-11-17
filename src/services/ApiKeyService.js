import { randomBytes, createHash } from 'crypto';
import { and, eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { apiKeys } = schema;

class ApiKeyService {
    /**
     * Get API keys for a user
     */
    static async getUserApiKeys(userId) {
        return db.select({ id: apiKeys.id, created_at: apiKeys.createdAt })
            .from(apiKeys)
            .where(eq(apiKeys.userId, String(userId)))
            .orderBy(desc(apiKeys.createdAt))
            .all();
    }

    /**
     * Generate a new API key for a user
     */
    static async generateApiKey(userId) {
        const rawKey = randomBytes(32).toString('hex');
        const keyHash = createHash('sha256').update(rawKey).digest('hex');

        const [apiKey] = db.insert(apiKeys)
            .values({ userId: String(userId), keyHash })
            .returning()
            .all();

        return {
            id: apiKey.id,
            created_at: apiKey.createdAt,
            raw_key: rawKey // Only returned once during creation
        };
    }

    /**
     * Delete an API key
     */
    static async deleteApiKey(userId, keyId) {
        db.delete(apiKeys)
            .where(and(eq(apiKeys.id, String(keyId)), eq(apiKeys.userId, String(userId))))
            .run();
        return true;
    }

    /**
     * Resolve the owner of an API key by its SHA-256 hash.
     * @returns {string|null} userId
     */
    static findUserIdByKeyHash(keyHash) {
        const row = db.select({ userId: apiKeys.userId })
            .from(apiKeys)
            .where(eq(apiKeys.keyHash, keyHash))
            .get();
        return row?.userId ?? null;
    }
}

export default ApiKeyService;

// Named exports for convenience
export const getUserApiKeys = ApiKeyService.getUserApiKeys;
export const generateApiKey = ApiKeyService.generateApiKey;
export const deleteApiKey = ApiKeyService.deleteApiKey;
