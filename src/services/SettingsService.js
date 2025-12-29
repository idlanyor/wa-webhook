import Setting from '../models/Setting.js';
import AutoReply from '../models/AutoReply.js';

class SettingsService {
    static async get(key) {
        try {
            const setting = await Setting.findOne({ key });
            return setting ? setting.value : null;
        } catch (error) {
            console.error('Error fetching setting:', error);
            throw error;
        }
    }

    static async getMany(keys) {
        try {
            const settings = await Setting.find({ key: { $in: keys } });
            const map = new Map();
            settings.forEach(r => map.set(r.key, r.value));
            return map;
        } catch (error) {
            console.error('Error fetching settings:', error);
            throw error;
        }
    }

    static async set(key, value, description = null) {
        try {
            await Setting.findOneAndUpdate(
                { key },
                { value, description },
                { upsert: true, new: true }
            );
        } catch (error) {
            console.error('Error setting setting:', error);
            throw error;
        }
    }

    // Fetch all settings as an object
    static async getSettings() {
        try {
            const settings = await Setting.find({});
            const obj = {};
            settings.forEach(r => { obj[r.key] = r.value; });
            return obj;
        } catch (error) {
            console.error('Error fetching all settings:', error);
            throw error;
        }
    }

    static async updateSetting(key, value, description = null) {
        return SettingsService.set(key, value, description);
    }

    // Auto-replies (global table)
    static async getAutoReplies() {
        try {
            const replies = await AutoReply.find({}).sort({ createdAt: -1 });
            return replies.map(r => ({
                id: r._id,
                keyword: r.keyword,
                reply: r.reply,
                enabled: r.enabled,
                created_at: r.createdAt,
                updated_at: r.updatedAt
            }));
        } catch (error) {
            console.error('Error fetching auto replies:', error);
            throw error;
        }
    }

    static async addAutoReply(keyword, reply) {
        try {
            const autoReply = new AutoReply({ keyword, reply, enabled: true });
            await autoReply.save();
        } catch (error) {
            console.error('Error adding auto reply:', error);
            throw error;
        }
    }

    static async deleteAutoReply(id) {
        try {
            await AutoReply.findByIdAndDelete(id);
        } catch (error) {
            console.error('Error deleting auto reply:', error);
            throw error;
        }
    }

    static async toggleAutoReply(id) {
        try {
            const autoReply = await AutoReply.findById(id);
            if (autoReply) {
                autoReply.enabled = !autoReply.enabled;
                await autoReply.save();
            }
        } catch (error) {
            console.error('Error toggling auto reply:', error);
            throw error;
        }
    }
}

export default SettingsService;

// Named exports for convenience
export const getSettings = SettingsService.getSettings;
export const getAutoReplies = SettingsService.getAutoReplies;
export const updateSetting = SettingsService.updateSetting;
export const addAutoReply = SettingsService.addAutoReply;
export const deleteAutoReply = SettingsService.deleteAutoReply;
export const toggleAutoReply = SettingsService.toggleAutoReply;
export const getMany = SettingsService.getMany;
export const set = SettingsService.set;