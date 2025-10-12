const { getDatabase } = require('../config/database');

class TemplateService {
    static async listTemplates(userId) {
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('message_templates')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    static async getTemplateById(userId, id) {
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('message_templates')
            .select('*')
            .eq('user_id', userId)
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    static async createTemplate(userId, name, content) {
        const supabase = getDatabase();
        const { error } = await supabase
            .from('message_templates')
            .insert({ user_id: userId, name, content });
        if (error) throw error;
    }

    static async updateTemplate(userId, id, name, content) {
        const supabase = getDatabase();
        const { error } = await supabase
            .from('message_templates')
            .update({ name, content })
            .eq('id', id)
            .eq('user_id', userId);
        if (error) throw error;
    }

    static async deleteTemplate(userId, id) {
        const supabase = getDatabase();
        const { error } = await supabase
            .from('message_templates')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);
        if (error) throw error;
    }
}

module.exports = TemplateService;
