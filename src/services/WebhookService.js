import { createHmac } from 'crypto';
import { error as logError } from '../utils/logger.js';

class WebhookService {
    constructor(getSettings) {
        this.getSettings = getSettings; // async () => ({ url, secret })
        this._queue = [];
        this._processing = false;
    }

    /**
     * Enqueue a webhook event (non-blocking, fire-and-forget).
     */
    send(eventType, payload) {
        this._queue.push({ eventType, payload });
        // Kick off processor if not already running
        if (!this._processing) {
            this._processQueue();
        }
    }

    /**
     * Process the internal queue sequentially in the background.
     * @private
     */
    async _processQueue() {
        this._processing = true;
        while (this._queue.length > 0) {
            const item = this._queue.shift();
            try {
                await this._send(item.eventType, item.payload);
            } catch {
                // Errors are logged inside _send; never let queue crash
            }
        }
        this._processing = false;
    }

    /**
     * Actually perform the HTTP send with retry logic.
     * @private
     */
    async _send(eventType, payload) {
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
                    try { logError('Webhook send failed:', e?.message || e); } catch {}
                }
            }
        };

        // 3 attempts: 1s, 2s, 4s
        await attempt(3, 1000);
    }
}

export default WebhookService;
