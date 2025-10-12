const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const TemplateService = require('../services/TemplateService');

const router = express.Router();

// List templates page
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const templates = await TemplateService.listTemplates(req.user.id);
        res.render('templates', { page: 'templates', templates, success: req.query.success, error: req.query.error });
    } catch (error) {
        res.render('templates', { page: 'templates', templates: [], error: 'Gagal memuat template', success: null });
    }
});

// Create template
router.post('/create', isAuthenticated, async (req, res) => {
    const { name, content } = req.body;
    try {
        await TemplateService.createTemplate(req.user.id, name, content);
        res.redirect('/templates?success=' + encodeURIComponent('Template berhasil dibuat.'));
    } catch (error) {
        res.redirect('/templates?error=' + encodeURIComponent(error.message));
    }
});

// Update template
router.post('/update/:id', isAuthenticated, async (req, res) => {
    const { name, content } = req.body;
    try {
        await TemplateService.updateTemplate(req.user.id, req.params.id, name, content);
        res.redirect('/templates?success=' + encodeURIComponent('Template berhasil diperbarui.'));
    } catch (error) {
        res.redirect('/templates?error=' + encodeURIComponent(error.message));
    }
});

// Delete template
router.post('/delete/:id', isAuthenticated, async (req, res) => {
    try {
        await TemplateService.deleteTemplate(req.user.id, req.params.id);
        res.redirect('/templates?success=' + encodeURIComponent('Template berhasil dihapus.'));
    } catch (error) {
        res.redirect('/templates?error=' + encodeURIComponent('Gagal menghapus template.'));
    }
});

module.exports = router;
// API: list templates as JSON
router.get('/api', isAuthenticated, async (req, res) => {
    try {
        const templates = await TemplateService.listTemplates(req.user.id);
        res.json(templates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
