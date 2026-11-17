import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import UserService from '../services/UserService.js';
import ApiKeyService from '../services/ApiKeyService.js';

/**
 * Middleware to check if user is authenticated via session cookie
 */
async function isAuthenticated(req, res, next) {
    const token = req.signedCookies['auth-token'];
    
    // Check if it's an API request
    const isApiRequest = req.path.startsWith('/api/') || 
                         req.path.includes('/send-message') || 
                         req.path.includes('/send-bulk');

    if (!token) {
        if (isApiRequest) {
            return res.status(401).json({
                error: 'unauthorized',
                message: 'Authentication token is missing'
            });
        }
        return res.redirect('/login');
    }
    
    try {
        const decoded = jwt.verify(token, config.session.secret);
        const user = UserService.findPublicById(decoded.userId);

        if (!user) {
            res.clearCookie('auth-token');
            if (isApiRequest) {
                return res.status(401).json({
                    error: 'unauthorized',
                    message: 'User no longer exists'
                });
            }
            return res.redirect('/login');
        }
        
        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
        };
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.clearCookie('auth-token');
        
        if (isApiRequest) {
            const message = error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
            return res.status(401).json({
                error: 'unauthorized',
                message
            });
        }
        return res.redirect('/login');
    }
}

/**
 * Middleware to redirect to dashboard if already authenticated
 */
async function redirectIfAuthenticated(req, res, next) {
    const token = req.signedCookies['auth-token'];
    if (!token) {
        return next();
    }

    try {
        const decoded = jwt.verify(token, config.session.secret);
        const user = UserService.findPublicById(decoded.userId);
        if (user) {
            return res.redirect('/dashboard');
        }
        next();
    } catch (error) {
        next();
    }
}

/**
 * Verify API key against database
 */
async function verifyApiKey(key) {
    try {
        const keyHash = createHash('sha256').update(key).digest('hex');

        // Indexed lookup on every request (no cache), so a deleted key
        // stops working immediately.
        const userId = ApiKeyService.findUserIdByKeyHash(keyHash);

        return userId;
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

/**
 * Middleware to check if user has admin role
 */
function isAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    
    res.status(403).render('error', {
        error: 'Forbidden',
        message: 'You do not have permission to access this page.'
    });
}

/**
 * Socket.IO middleware: authenticate the handshake with the same signed
 * `auth-token` cookie as the web UI. The room is derived from the verified
 * token — never from client-supplied data — so a socket only receives its
 * own user's QR codes and messages.
 * Requires `io.engine.use(cookieParser(secret))` so signed cookies are parsed.
 */
function authenticateSocket(socket, next) {
    const token = socket.request.signedCookies?.['auth-token'];
    if (!token) return next(new Error('unauthorized'));
    try {
        const decoded = jwt.verify(token, config.session.secret);
        const user = UserService.findPublicById(decoded.userId);
        if (!user) return next(new Error('unauthorized'));
        socket.data.userId = String(user.id);
        next();
    } catch {
        next(new Error('unauthorized'));
    }
}

export {
    authenticateSocket,
    isAuthenticated,
    isAuthenticatedOrApiKey,
    redirectIfAuthenticated,
    verifyApiKey,
    getEffectiveUserId,
    isAdmin
};