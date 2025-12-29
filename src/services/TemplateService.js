import Template from '../models/Template.js';

class TemplateService {
    static async listTemplates(userId) {
        try {
            const templates = await Template.find({ userId })
                .sort({ createdAt: -1 });
            
            return templates.map(t => ({
                id: t._id,
                user_id: t.userId,
                name: t.name,
                content: t.content,
                created_at: t.createdAt,
                updated_at: t.updatedAt
            }));
        } catch (error) {
            console.error('Error listing templates:', error);
            throw error;
        }
    }

    static async getTemplateById(userId, id) {
        try {
            const template = await Template.findOne({ _id: id, userId });
            if (!template) return null;

            return {
                id: template._id,
                user_id: template.userId,
                name: template.name,
                content: template.content,
                created_at: template.createdAt,
                updated_at: template.updatedAt
            };
        } catch (error) {
            console.error('Error getting template:', error);
            throw error;
        }
    }

    static async createTemplate(userId, name, content) {
        try {
            const template = new Template({ userId, name, content });
            await template.save();
        } catch (error) {
            console.error('Error creating template:', error);
            throw error;
        }
    }

    static async updateTemplate(userId, id, name, content) {
        try {
            await Template.findOneAndUpdate(
                { _id: id, userId },
                { name, content }
            );
        } catch (error) {
            console.error('Error updating template:', error);
            throw error;
        }
    }

    static async deleteTemplate(userId, id) {
        try {
            await Template.findOneAndDelete({ _id: id, userId });
        } catch (error) {
            console.error('Error deleting template:', error);
            throw error;
        }
    }
}

export default TemplateService;

// Named exports for convenience
export const listTemplates = TemplateService.listTemplates;
export const getTemplateById = TemplateService.getTemplateById;
export const createTemplate = TemplateService.createTemplate;
export const updateTemplate = TemplateService.updateTemplate;
export const deleteTemplate = TemplateService.deleteTemplate;