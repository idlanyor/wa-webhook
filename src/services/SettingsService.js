import { eq, desc, inArray, not } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { settings, autoReplies } = schema;

class SettingsService {
    static async get(key) {
        const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
        return row ? row.value : null;
    }

    static async getMany(keys) {
        const map = new Map();
        if (!keys.length) return map;
        const rows = db.select().from(settings).where(inArray(settings.key, keys)).all();
        rows.forEach(r => map.set(r.key, r.value));
        return map;
    }

    static async set(key, value, description = null) {
        db.insert(settings)
            .values({ key, value, description })
            .onConflictDoUpdate({
                target: settings.key,
                set: { value, description, updatedAt: new Date() }
            })
            .run();
    }

    // Fetch all settings as an object
    static async getSettings() {
        const obj = {};
        db.select().from(settings).all().forEach(r => { obj[r.key] = r.value; });
        return obj;
    }

    static async updateSetting(key, value, description = null) {
        return SettingsService.set(key, value, description);
    }

    // Auto-replies (global table)
    static async getAutoReplies() {
        return db.select().from(autoReplies).orderBy(desc(autoReplies.createdAt)).all().map(r => ({
            id: r.id,
            keyword: r.keyword,
            reply: r.reply,
            enabled: r.enabled,
            created_at: r.createdAt,
            updated_at: r.updatedAt
        }));
    }

    static async getEnabledAutoReplies() {
        return db.select().from(autoReplies).where(eq(autoReplies.enabled, true)).all();
    }

    static async addAutoReply(keyword, reply) {
        db.insert(autoReplies).values({ keyword, reply, enabled: true }).run();
    }

    static async deleteAutoReply(id) {
        db.delete(autoReplies).where(eq(autoReplies.id, String(id))).run();
    }

    static async toggleAutoReply(id) {
        db.update(autoReplies)
            .set({ enabled: not(autoReplies.enabled) })
            .where(eq(autoReplies.id, String(id)))
            .run();
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
