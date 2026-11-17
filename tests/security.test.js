import request from 'supertest';
import { jest } from '@jest/globals';
import { io as ioClient } from 'socket.io-client';

process.env.SQLITE_PATH = ':memory:';

jest.unstable_mockModule('../src/services/WhatsAppService.js', () => ({
  default: class {
    constructor() { this.sessions = new Map(); }
    loadSettings() { return Promise.resolve(); }
    ensureSession() { return Promise.resolve({ isConnected: true }); }
    getStatus() { return { isConnected: false, state: 'disconnected' }; }
    preloadSessions() { return Promise.resolve(); }
    setWebhookService() {}
    // Reached only after API-key auth succeeds
    sendMessage() { throw new Error('WhatsApp not connected'); }
  }
}));

const { app, application } = await import('../app.js');
const { closeDb } = await import('../src/config/database.js');
const { default: UserService } = await import('../src/services/UserService.js');
const { default: ApiKeyService } = await import('../src/services/ApiKeyService.js');
const { resolveTrustProxy, DEFAULT_TRUST_PROXY } = await import('../src/config/trustProxy.js');

let baseUrl;
let alice;
let bob;
let aliceCookie;

/** Log in and return the signed auth cookie ("auth-token=..."). */
async function login(email, password) {
  const res = await request(app).post('/login').type('form').send({ email, password });
  return res.headers['set-cookie'].find(c => c.startsWith('auth-token=')).split(';')[0];
}

function connect(extra = {}) {
  return new Promise((resolve) => {
    const socket = ioClient(baseUrl, { transports: ['polling'], reconnection: false, forceNew: true, ...extra });
    socket.on('connect', () => resolve({ socket, connected: true }));
    socket.on('connect_error', (err) => { socket.close(); resolve({ socket, connected: false, error: err.message }); });
  });
}

beforeAll(async () => {
  await application.initialize();
  await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  alice = await UserService.create({ name: 'Alice', email: 'alice@test.io', password: 'pw-alice' });
  bob = await UserService.create({ name: 'Bob', email: 'bob@test.io', password: 'pw-bob' });
  aliceCookie = await login('alice@test.io', 'pw-alice');
});

afterAll(async () => {
  application.schedulerService?.stop();
  await new Promise(resolve => application.io.close(() => resolve()));
  closeDb();
});

describe('Socket.IO authentication', () => {
  it('rejects a socket without the auth cookie', async () => {
    const { connected, error } = await connect();
    expect(connected).toBe(false);
    expect(error).toBe('unauthorized');
  });

  it('rejects a forged / unsigned cookie', async () => {
    const { connected } = await connect({ extraHeaders: { cookie: 'auth-token=s%3Aforged.sig' } });
    expect(connected).toBe(false);
  });

  it('joins only the room of the authenticated user, ignoring query.userId', async () => {
    const { socket, connected } = await connect({
      extraHeaders: { cookie: aliceCookie },
      query: { userId: bob.id } // attempt to subscribe to Bob's events
    });
    expect(connected).toBe(true);

    const received = [];
    socket.on('qr', (qr) => received.push(qr));
    await new Promise(r => setTimeout(r, 100));

    application.io.to(bob.id).emit('qr', 'bob-secret-qr');
    application.io.to(alice.id).emit('qr', 'alice-qr');
    await new Promise(r => setTimeout(r, 300));

    expect(received).toEqual(['alice-qr']);
    socket.close();
  });
});

describe('API keys', () => {
  it('stop working immediately after deletion', async () => {
    const key = await ApiKeyService.generateApiKey(alice.id);
    const send = () => request(app).post('/send-message')
      .set('X-API-KEY', key.raw_key)
      .send({ to: '6281234', message: 'x' });

    const before = await send();
    expect(before.statusCode).not.toBe(401); // authenticated (fails later: WhatsApp not connected)

    await ApiKeyService.deleteApiKey(alice.id, key.id);
    const after = await send();
    expect(after.statusCode).toBe(401);
  });
});

describe('trust proxy / client IP', () => {
  // Echo route registered on a fresh app with the same setting
  async function ipFor(headers, remote) {
    const express = (await import('express')).default;
    const probe = express();
    probe.set('trust proxy', resolveTrustProxy());
    probe.get('/ip', (req, res) => res.send(req.ip));
    const req = request(probe).get('/ip');
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return (await req).text;
  }

  it('resolves the real client behind Cloudflare and a LAN proxy', async () => {
    // supertest connects from 127.0.0.1 (trusted, like a LAN proxy)
    expect(await ipFor({ 'X-Forwarded-For': '203.0.113.7, 172.69.176.28' })).toBe('203.0.113.7');
  });

  it('ignores addresses a client forges on the left of the chain', async () => {
    expect(await ipFor({ 'X-Forwarded-For': '1.2.3.4, 203.0.113.7, 162.158.189.111' })).toBe('203.0.113.7');
  });

  it('does not trust a non-Cloudflare public hop', async () => {
    expect(await ipFor({ 'X-Forwarded-For': '1.2.3.4, 198.51.100.9' })).toBe('198.51.100.9');
  });

  it('honours TRUST_PROXY overrides', () => {
    expect(resolveTrustProxy('')).toBe(DEFAULT_TRUST_PROXY);
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy('2')).toBe(2);
    expect(resolveTrustProxy('10.0.0.1, loopback')).toEqual(['10.0.0.1', 'loopback']);
  });
});
