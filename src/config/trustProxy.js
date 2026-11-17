/**
 * Which proxies Express trusts for X-Forwarded-For (→ req.ip).
 *
 * The app runs behind Cloudflare (and possibly a reverse proxy on the LAN).
 * With a plain hop count, req.ip ends up as a Cloudflare edge address, which
 * makes per-IP rate limiting useless. Instead trust only addresses that can
 * be proxies — loopback/private networks and Cloudflare's published ranges —
 * so Express walks X-Forwarded-For back to the first untrusted address: the
 * real client. A client cannot spoof its IP, because entries it adds itself
 * sit to the left of the address Cloudflare appends.
 *
 * Override with TRUST_PROXY (any value Express accepts: "false", a hop count,
 * or a comma-separated list of addresses/CIDRs/keywords).
 */

// https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6 (checked 2026-11-17)
export const CLOUDFLARE_RANGES = [
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
    '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
    '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
    '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
    '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
];

export const DEFAULT_TRUST_PROXY = ['loopback', 'linklocal', 'uniquelocal', ...CLOUDFLARE_RANGES];

export function resolveTrustProxy(value = process.env.TRUST_PROXY) {
    if (value === undefined || value.trim() === '') return DEFAULT_TRUST_PROXY;
    const v = value.trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^\d+$/.test(v)) return Number(v);
    return v.split(',').map(s => s.trim()).filter(Boolean);
}
