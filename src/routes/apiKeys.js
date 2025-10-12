import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import { getUserApiKeys, generateApiKey, deleteApiKey } from '../services/ApiKeyService.js';

const router = Router();

// API keys management page
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const keys = await getUserApiKeys(req.user.id);
        
        res.render('api-keys', { 
            keys, 
            error: null, 
            success: req.query.success, 
            page: 'api-keys' 
        });
    } catch (error) {
        console.error('Error loading API keys page:', error);
        res.render('api-keys', { 
            keys: [], 
            error: 'Failed to load API keys.', 
            success: null, 
            page: 'api-keys' 
        });
    }
});

// Generate new API key
router.post('/generate', isAuthenticated, async (req, res) => {
    try {
        const apiKey = await generateApiKey(req.user.id);
        
        res.render('api-keys', { 
            keys: [{ 
                ...apiKey, 
                raw: apiKey.raw_key, 
                created_at: new Date() 
            }], 
            success: 'API key generated. Copy it now, it will not be shown again!', 
            page: 'api-keys', 
            error: null 
        });
    } catch (error) {
        console.error('Failed to generate API key:', error);
        res.render('api-keys', { 
            keys: [], 
            error: 'Failed to generate API key', 
            page: 'api-keys',
            success: null
        });
    }
});

// Delete API key
router.post('/delete/:id', isAuthenticated, async (req, res) => {
    try {
        await deleteApiKey(req.user.id, req.params.id);
        res.redirect('/api-keys?success=' + encodeURIComponent('API key deleted successfully.'));
    } catch (error) {
        console.error('Error deleting API key:', error);
        res.redirect('/api-keys');
    }
});

export default router;