import { randomBytes, createHash } from 'crypto';
import ApiKey from '../models/ApiKey.js';

class ApiKeyService {
    /**
     * Get API keys for a user
     */
    static async getUserApiKeys(userId) {
        try {
            const keys = await ApiKey.find({ userId })
                .sort({ createdAt: -1 });

            return keys.map(k => ({
                id: k._id,
                created_at: k.createdAt
            }));
        } catch (error) {
            console.error('Error fetching API keys:', error);
            throw error;
        }
    }

    /**
     * Generate a new API key for a user
     */
    static async generateApiKey(userId) {
        try {
            const rawKey = randomBytes(32).toString('hex');
            const keyHash = createHash('sha256').update(rawKey).digest('hex');
            
            const apiKey = new ApiKey({
                userId,
                keyHash
            });
            await apiKey.save();

            return {
                id: apiKey._id,
                created_at: apiKey.createdAt,
                raw_key: rawKey // Only returned once during creation
            };
        } catch (error) {
            console.error('Error generating API key:', error);
            throw error;
        }
    }

    /**
     * Delete an API key
     */
    static async deleteApiKey(userId, keyId) {
        try {
            await ApiKey.findOneAndDelete({ _id: keyId, userId });
            return true;
        } catch (error) {
            console.error('Error deleting API key:', error);
            throw error;
        }
    }
}

export default ApiKeyService;

// Named exports for convenience
export const getUserApiKeys = ApiKeyService.getUserApiKeys;
export const generateApiKey = ApiKeyService.generateApiKey;
export const deleteApiKey = ApiKeyService.deleteApiKey;
