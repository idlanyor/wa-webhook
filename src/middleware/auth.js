import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import User from '../models/User.js';
import ApiKey from '../models/ApiKey.js';

/**
 * Middleware to check if user is authenticated via session cookie
 */
async function isAuthenticated(req, res, next) {
    const token = req.cookies['auth-token'];
    if (!token) {
        return res.redirect('/login');
    }
    
    try {
        const decoded = jwt.verify(token, config.session.secret);
        const user = await User.findById(decoded.userId);

        if (!user) {
            res.clearCookie('auth-token');
            return res.redirect('/login');
        }
        
        req.user = {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role
        };
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.clearCookie('auth-token');
        return res.redirect('/login');
    }
}

/**
 * Verify API key against database
 */
async function verifyApiKey(key) {
    try {
        const keyHash = createHash('sha256').update(key).digest('hex');
        const apiKey = await ApiKey.findOne({ keyHash });
        
        if (!apiKey) return null;
        return apiKey.userId;
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

export {
    isAuthenticated,
    isAuthenticatedOrApiKey,
    verifyApiKey,
    getEffectiveUserId
};