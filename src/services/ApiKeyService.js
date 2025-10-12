import { randomBytes, createHash } from 'crypto';
import { getDatabase } from '../config/database.js';

class ApiKeyService {
    /**
     * Get API keys for a user
     */
    static async getUserApiKeys(userId) {
        try {
            const supabase = getDatabase();
            const { data, error } = await supabase
                .from('api_keys')
                .select('id, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
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
            
            const supabase = getDatabase();
            const { data, error } = await supabase
                .from('api_keys')
                .insert({ user_id: userId, key_hash: keyHash })
                .select()
                .single();

            if (error) throw error;

            return {
                ...data,
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
            const supabase = getDatabase();
            const { error } = await supabase
                .from('api_keys')
                .delete()
                .match({ id: keyId, user_id: userId });

            if (error) throw error;
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