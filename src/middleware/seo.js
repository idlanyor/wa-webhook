import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

// Only these pages may be indexed by search engines; everything else
// (dashboard, API, auth flows) is private and marked noindex.
export const INDEXABLE_PATHS = new Set(['/', '/login']);

/**
 * Short content hash of the built assets, used as ?v= for cache busting.
 */
export function computeAssetVersion(publicDir) {
    const hash = createHash('sha1');
    for (const file of ['css/app.css', 'js/ui.js']) {
        try { hash.update(readFileSync(join(publicDir, file))); } catch { /* not built yet */ }
    }
    return hash.digest('hex').slice(0, 10);
}

/**
 * Public origin for canonical URLs. PUBLIC_URL wins; otherwise derived from
 * the request (trust proxy is configured, so this is the Cloudflare host).
 */
export function publicBaseUrl(req) {
    const fromEnv = process.env.PUBLIC_URL;
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    return `${req.protocol}://${req.get('host')}`;
}

export function seoMiddleware(publicDir) {
    const assetVersion = computeAssetVersion(publicDir);
    return (req, res, next) => {
        res.locals.baseUrl = publicBaseUrl(req);
        res.locals.assetVersion = assetVersion;
        res.locals.currentPath = req.path;
        res.locals.indexable = INDEXABLE_PATHS.has(req.path);
        if (!res.locals.indexable) res.set('X-Robots-Tag', 'noindex, nofollow');
        next();
    };
}

/**
 * Cache headers for express.static: versioned CSS/JS (?v=) are immutable,
 * images/fonts get a week, everything else revalidates.
 */
export function staticCacheHeaders(res, filePath) {
    const versioned = res.req && res.req.query && res.req.query.v;
    if (/\.(css|js)$/.test(filePath)) {
        res.setHeader('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
    } else if (/\.(svg|png|jpe?g|webp|ico|woff2?)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
    } else if (/\.webmanifest$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    }
}
