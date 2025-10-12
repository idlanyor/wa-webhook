const crypto = require('crypto');
const { getDatabase } = require('../config/database');

/**
 * Middleware to check if user is authenticated via session cookie
 */
async function isAuthenticated(req, res, next) {
    const token = req.cookies['supabase-auth-token'];
    if (!token) {
        return res.redirect('/login');
    }
    
    try {
        const supabase = getDatabase();
        const { data: { user }, error } = await supabase.auth.getUser(JSON.parse(token).access_token);

        if (error || !user) {
            // Clear the invalid cookie
            res.clearCookie('supabase-auth-token');
            return res.redirect('/login');
        }
        
        req.user = user;
        req.userAccessToken = JSON.parse(token).access_token;
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.clearCookie('supabase-auth-token');
        return res.redirect('/login');
    }
}

/**
 * Verify API key against database
 */
async function verifyApiKey(key) {
    try {
        const keyHash = crypto.createHash('sha256').update(key).digest('hex');
        const supabase = getDatabase();
        const { data, error } = await supabase
            .from('api_keys')
            .select('user_id')
            .eq('key_hash', keyHash)
            .single();
        
        if (error || !data) return null;
        return data.user_id;
    } catch (err) {
        console.error('API key verification failed:', err);
        return null;
    }
}

/**
 * Middleware to check authentication via session cookie OR API key
 */
async function isAuthenticatedOrApiKey(req, res, next) {
    // Check for API key first
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (apiKey) {
        const userId = await verifyApiKey(apiKey);
        if (userId) {
            req.apiUserId = userId;
            return next();
        }
    }
    
    // Fall back to session authentication
    return isAuthenticated(req, res, next);
}

/**
 * Get effective user ID from either session or API authentication
 */
function getEffectiveUserId(req) {
    return req.user?.id || req.apiUserId;
}

module.exports = {
    isAuthenticated,
    isAuthenticatedOrApiKey,
    verifyApiKey,
    getEffectiveUserId
};
