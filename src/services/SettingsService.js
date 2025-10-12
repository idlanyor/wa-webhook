const { getDatabase } = require('../config/database');

class SettingsService {
    static async get(key) {
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('settings')
            .select('value')
            .eq('key', key)
            .maybeSingle();
        if (error) throw error;
        return data ? data.value : null;
    }

    static async getMany(keys) {
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('settings')
            .select('key,value')
            .in('key', keys);
        if (error) throw error;
        const map = new Map();
        (data || []).forEach(r => map.set(r.key, r.value));
        return map;
    }
    static async set(key, value, description = null) {
        const supabase = getDatabase();
        const { error } = await supabase
            .from('settings')
            .upsert({ key, value, description }, { onConflict: 'key' });
        if (error) throw error;
    }

    // Fetch all settings as an object
    static async getSettings() {
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('settings')
            .select('key,value');
        if (error) throw error;
        const obj = {};
        (data || []).forEach(r => { obj[r.key] = r.value; });
        return obj;
    }

    static async updateSetting(key, value, description = null) {
        return this.set(key, value, description);
    }

    // Auto-replies (global table)
    static async getAutoReplies() {
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('auto_replies')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    static async addAutoReply(keyword, reply) {
        const supabase = getDatabase();
        const { error } = await supabase
            .from('auto_replies')
            .insert({ keyword, reply, enabled: true });
        if (error) throw error;
    }

    static async deleteAutoReply(id) {
        const supabase = getDatabase();
        const { error } = await supabase
            .from('auto_replies')
            .delete()
            .eq('id', id);
        if (error) throw error;
    }

    static async toggleAutoReply(id) {
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('auto_replies')
            .select('enabled')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        const current = data?.enabled === true;
        const { error: upErr } = await supabase
            .from('auto_replies')
            .update({ enabled: !current })
            .eq('id', id);
        if (upErr) throw upErr;
    }
}

module.exports = SettingsService;
