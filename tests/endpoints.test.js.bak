import request from 'supertest';
import { app } from '../whatsapp-service';

jest.mock('../supabaseClient', () => {
  const builder = (data = null, error = null) => {
    const chain = {};
    const r = Promise.resolve({ data, error });
    ['select', 'single', 'eq', 'order', 'range', 'insert', 'update', 'delete', 'match'].forEach(fn => {
      chain[fn] = () => chain;
    });
    chain.select = () => chain; 
    chain.order = () => chain;
    chain.eq = () => chain;
    chain.range = () => chain;
    chain.single = () => r;
    chain.insert = () => r;
    chain.update = () => r;
    chain.delete = () => r;
    chain.match = () => r;
    return chain;
  };

  const authUser = { id: 'user-id', email: 'test@example.com' };
  return {
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      getUser: jest.fn(() => Promise.resolve({ data: { user: authUser }, error: null })),
    },
    from: jest.fn(() => builder()),
  };
});

import { from as _from } from '../supabaseClient';

function authCookie() {
  const token = { access_token: 'token' };
  return [`supabase-auth-token=${encodeURIComponent(JSON.stringify(token))}`];
}

describe('All Endpoint Tests', () => {
  afterEach(() => jest.clearAllMocks());

  it('GET /login', async () => {
    const res = await request(app).get('/login');
    expect(res.statusCode).toBe(200);
  });

  it('GET /register', async () => {
    const res = await request(app).get('/register');
    expect(res.statusCode).toBe(200);
  });

  it('GET / (root) redirects', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(302);
  });

  it('GET /status (authenticated)', async () => {
    const res = await request(app).get('/status').set('Cookie', authCookie());
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('connected');
  });

  it('POST /send-message', async () => {
    const res = await request(app)
      .post('/send-message')
      .set('Cookie', authCookie())
      .send({ to: '62895395590009', message: 'Hello from test' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /send-bulk', async () => {
    const res = await request(app)
      .post('/send-bulk')
      .set('Cookie', authCookie())
      .send({ numbers: '62895395590009\n628157695152', message: 'Hi from test' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/contacts returns array', async () => {
    _from.mockImplementationOnce(() => ({
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    }));

    const res = await request(app).get('/api/contacts').set('Cookie', authCookie());
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
}); 