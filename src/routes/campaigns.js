const express = require('express');
const { isAuthenticated, getEffectiveUserId } = require('../middleware/auth');
const CampaignService = require('../services/CampaignService');

const router = express.Router();

router.get('/', isAuthenticated, async (req, res) => {
    try {
        const campaigns = await CampaignService.list(req.user.id);
        res.render('campaigns', { page: 'campaigns', campaigns, success: req.query.success, error: req.query.error });
    } catch (e) {
        res.render('campaigns', { page: 'campaigns', campaigns: [], error: 'Gagal memuat kampanye', success: null });
    }
});

router.post('/create', isAuthenticated, async (req, res) => {
    const { name, message, templateId, numbers, startAt, throttleMin, throttleMax } = req.body;
    try {
        await CampaignService.create(req.user.id, { name, message, templateId, numbers, startAt, throttleMin, throttleMax });
        res.redirect('/campaigns?success=' + encodeURIComponent('Kampanye dijadwalkan.'));
    } catch (e) {
        res.redirect('/campaigns?error=' + encodeURIComponent(e.message));
    }
});

module.exports = router;

