import { Router } from 'express';
import { publicBaseUrl } from '../middleware/seo.js';

const router = Router();

router.get('/robots.txt', (req, res) => {
    const base = publicBaseUrl(req);
    res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(
        [
            'User-agent: *',
            'Allow: /$',
            'Allow: /login$',
            'Allow: /img/',
            'Allow: /css/',
            'Allow: /js/',
            'Disallow: /',
            '',
            `Sitemap: ${base}/sitemap.xml`,
            ''
        ].join('\n')
    );
});

router.get('/sitemap.xml', (req, res) => {
    const base = publicBaseUrl(req);
    const urls = [
        { loc: `${base}/`, priority: '1.0', changefreq: 'weekly' },
        { loc: `${base}/login`, priority: '0.3', changefreq: 'yearly' }
    ];
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
    res.type('application/xml').set('Cache-Control', 'public, max-age=86400').send(body);
});

export default router;
