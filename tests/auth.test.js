import request from 'supertest';
import { jest } from '@jest/globals';

// Real SQLite database, in memory
process.env.SQLITE_PATH = ':memory:';

// Mock WhatsApp service to avoid opening WhatsApp connections during tests
jest.unstable_mockModule('../src/services/WhatsAppService.js', () => ({
  default: class {
    constructor() { this.sessions = new Map(); }
    loadSettings() { return Promise.resolve(); }
    ensureSession() { return Promise.resolve({ isConnected: true }); }
    getStatus() { return { isConnected: false, state: 'disconnected' }; }
    preloadSessions() { return Promise.resolve(); }
    setWebhookService() {}
  }
}));

const { app, application } = await import('../app.js');
const { closeDb } = await import('../src/config/database.js');
const { default: UserService } = await import('../src/services/UserService.js');

describe('Authentication Routes', () => {
  beforeAll(async () => {
    await application.initialize();
  });

  afterAll(async () => {
    application.schedulerService?.stop();
    application.io?.close();
    if (application.server?.listening) {
      await new Promise(resolve => application.server.close(resolve));
    }
    closeDb();
  });

  describe('POST /register', () => {
    it('should validate missing fields', async () => {
      const res = await request(app).post('/register').send({});
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('All fields are required');
    });

    it('should validate password mismatch', async () => {
      const res = await request(app).post('/register').send({
        name: 'Test',
        email: 'test@example.com',
        password: 'pass123',
        confirmPassword: 'different',
      });
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Passwords do not match');
    });

    it('should create the first user as admin and set the auth cookie', async () => {
      const res = await request(app).post('/register').type('form').send({
        name: 'Admin',
        email: '  Admin@Example.com ',
        password: 'secret123',
        confirmPassword: 'secret123',
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/dashboard');
      expect(res.headers['set-cookie'].join(';')).toContain('auth-token=');

      const user = UserService.findByEmail('admin@example.com');
      expect(user.role).toBe('admin');
      expect(user.password).not.toBe('secret123');
    });

    it('should reject a duplicate email', async () => {
      const res = await request(app).post('/register').type('form').send({
        name: 'Other',
        email: 'admin@example.com',
        password: 'secret123',
        confirmPassword: 'secret123',
      });
      expect(res.text).toContain('Email already registered');
    });
  });

  describe('POST /login', () => {
    it('should return error on invalid credentials', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'fail@example.com', password: 'wrong' });

      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Invalid email or password');
    });

    it('should reject a wrong password', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'admin@example.com', password: 'wrong' });
      expect(res.text).toContain('Invalid email or password');
    });

    it('should log in and reach the dashboard', async () => {
      const agent = request.agent(app);
      const login = await agent.post('/login').type('form')
        .send({ email: 'admin@example.com', password: 'secret123' });
      expect(login.statusCode).toBe(302);
      expect(login.headers.location).toBe('/dashboard');

      const users = await agent.get('/users');
      expect(users.statusCode).toBe(200);
      expect(users.text).toContain('admin@example.com');
    });
  });
});
