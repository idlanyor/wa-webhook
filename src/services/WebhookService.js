import { createHmac } from 'crypto';

class WebhookService {
    constructor(getSettings) {
        this.getSettings = getSettings; // async () => ({ url, secret })
    }

    async send(eventType, payload) {
        const { url, secret } = await this.getSettings();
        if (!url) return;

        const body = JSON.stringify({ event: eventType, data: payload, timestamp: Date.now() });
        const signature = secret ? createHmac('sha256', secret).update(body).digest('hex') : null;

        const attempt = async (n, delayMs) => {
            try {
                await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(signature ? { 'X-Signature': signature } : {})
                    },
                    body
                });
            } catch (e) {
                if (n > 0) {
                    await new Promise(r => setTimeout(r, delayMs));
                    return attempt(n - 1, delayMs * 2);
                } else {
                    // Best-effort logging
                    try { console.error('Webhook send failed:', e?.message || e); } catch {}
                }
            }
        };

        // 3 attempts: 1s, 2s, 4s
        await attempt(3, 1000);
    }
}

export default WebhookService;
