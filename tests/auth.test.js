import request from 'supertest';
import { jest } from '@jest/globals';

// Mock mongoose models
jest.unstable_mockModule('../src/models/User.js', () => ({
  default: {
    findOne: jest.fn(),
    findById: jest.fn(),
    prototype: {
      save: jest.fn(),
      comparePassword: jest.fn()
    }
  }
}));

// Mock database connection
jest.unstable_mockModule('../src/config/database.js', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(true),
  getDatabase: jest.fn()
}));

// Mock WhatsApp service to avoid initialization issues during tests
jest.unstable_mockModule('../src/services/WhatsAppService.js', () => ({
  default: class {
    constructor() {}
    loadSettings() { return Promise.resolve(); }
    ensureSession() { return Promise.resolve({ isConnected: true }); }
    preloadSessions() { return Promise.resolve(); }
  }
}));

const { app } = await import('../app.js');
const { default: User } = await import('../src/models/User.js');

describe('Authentication Routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
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
  });

  describe('POST /login', () => {
    it('should return error on invalid credentials', async () => {
      User.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/login')
        .send({ email: 'fail@example.com', password: 'wrong' });

      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Invalid email or password');
    });
  });
});