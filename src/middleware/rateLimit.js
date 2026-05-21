/**
 * Simple in-memory sliding window rate limiter.
 * No external dependencies required.
 */

// store: ip => [timestamps]
const requestLog = new Map();

// Cleanup stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of requestLog.entries()) {
        // Keep only recent entries (within last 10 minutes)
        const recent = timestamps.filter(t => now - t < 10 * 60 * 1000);
        if (recent.length === 0) {
            requestLog.delete(ip);
        } else {
            requestLog.set(ip, recent);
        }
    }
}, 5 * 60 * 1000);

/**
 * Create a rate limiter middleware.
 * @param {number} maxRequests - Max requests allowed in the window
 * @param {number} windowMs - Time window in milliseconds
 * @param {string} [message] - Custom error message
 */
function createRateLimiter(maxRequests, windowMs, message = 'Too many requests, please try again later.') {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const key = `${ip}`;
        const now = Date.now();

        const timestamps = requestLog.get(key) || [];

        // Filter requests within window
        const windowStart = now - windowMs;
        const windowTimestamps = timestamps.filter(t => t > windowStart);

        if (windowTimestamps.length >= maxRequests) {
            // Calculate how long until the oldest request in the window expires
            const oldestInWindow = windowTimestamps[0];
            const retryAfterMs = oldestInWindow + windowMs - now;
            return res.status(429).json({
                error: 'rate_limit_exceeded',
                message,
                retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000))
            });
        }

        windowTimestamps.push(now);
        requestLog.set(key, windowTimestamps);
        next();
    };
}

// Preset limiters
export const generalLimiter = createRateLimiter(300, 60 * 1000, 'Too many requests. Limit: 300 per minute.');
export const sendMessageLimiter = createRateLimiter(60, 60 * 1000, 'Too many send requests. Limit: 60 per minute.');
export const authLimiter = createRateLimiter(30, 60 * 1000, 'Too many login attempts. Limit: 30 per minute.');

export default createRateLimiter;
