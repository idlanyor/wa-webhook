import { getDatabase } from '../config/database.js';
import { getTemplateById } from './TemplateService.js';
import { getAllContacts } from './ContactService.js';

class CampaignService {
    static async create(userId, data) {
        const supabase = getDatabase();
        const { error } = await supabase.from('campaigns').insert({
            user_id: userId,
            name: data.name,
            message: data.message,
            template_id: data.templateId || null,
            numbers: data.numbers,
            start_at: data.startAt,
            throttle_min_ms: data.throttleMin || 2000,
            throttle_max_ms: data.throttleMax || 7000
        });
        if (error) throw error;
    }

    static async list(userId) {
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('campaigns')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    static async updateStatus(id, status) {
        const supabase = getDatabase();
        const { error } = await supabase
            .from('campaigns')
            .update({ status })
            .eq('id', id);
        if (error) throw error;
    }

    static async dueCampaigns(now) {
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('campaigns')
            .select('*')
            .eq('status', 'scheduled')
            .lte('start_at', now.toISOString());
        if (error) throw error;
        return data || [];
    }

    static async processCampaign(app, campaign) {
        const { user_id: userId } = campaign;
        const whatsappService = app.get('whatsappService');
        const io = app.get('io');
        const session = await whatsappService.ensureSession(userId);
        if (!session.isConnected) {
            await this.updateStatus(campaign.id, 'failed');
            return;
        }

        await this.updateStatus(campaign.id, 'running');

        let contactsMap = new Map();
        try {
            const contacts = await getAllContacts(userId);
            contacts.forEach(c => contactsMap.set(String(c.phone || '').replace(/^\+/, ''), c.name || ''));
        } catch {}

        let template = null;
        if (campaign.template_id) {
            try { template = await getTemplateById(userId, campaign.template_id); } catch {}
        }

        const applyVars = (text, phoneRaw) => {
            const phone = String((phoneRaw || '').trim()).replace(/^\+/, '');
            const name = contactsMap.get(phone) || '';
            return text.replace(/\{phone\}/g, phone).replace(/\{name\}/g, name);
        };

        const numbers = campaign.numbers.split('\n').map(s=>s.trim()).filter(Boolean);
        for (const n of numbers) {
            const jid = n.includes('@') ? n : `${n}@s.whatsapp.net`;
            try {
                const text = template ? applyVars(template.content, n) : campaign.message;
                await session.sock.sendMessage(jid, { text });
                io.to(userId).emit('bulk-log', { status: 'success', message: `Dikirim ke ${n}` });
            } catch (err) {
                io.to(userId).emit('bulk-log', { status: 'error', message: `Gagal kirim ke ${n}: ${err.message}` });
            }
            const delay = Math.floor(Math.random() * (campaign.throttle_max_ms - campaign.throttle_min_ms + 1)) + campaign.throttle_min_ms;
            await new Promise(r => setTimeout(r, delay));
        }

        await this.updateStatus(campaign.id, 'done');
        io.to(userId).emit('bulk-log', { status: 'done', message: 'Kampanye selesai.' });
    }
}

export default CampaignService;

