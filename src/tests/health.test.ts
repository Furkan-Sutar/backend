import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config/database.js', () => ({ getDatabaseStatus: () => 'disconnected' }));

process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/skill_nova_test';
process.env.JWT_ACCESS_SECRET ??= 'health-test-secret-with-more-than-32-characters';
process.env.LOG_LEVEL ??= 'silent';
const { app } = await import('../app.js');

describe('GET /api/v1/health', () => {
  it('returns application, environment, database, timestamp, and correlation ID', async () => {
    const response = await request(app).get('/api/v1/health').set('x-correlation-id', 'health-test-1');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      data: { status: 'degraded', environment: 'test', database: 'disconnected' }
    });
    expect(Number.isNaN(Date.parse(response.body.data.timestamp))).toBe(false);
    expect(response.headers['x-correlation-id']).toBe('health-test-1');
  });

  it('rejects Mongo query operator keys', async () => {
    const response = await request(app).get('/api/v1/health?%24where=1');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
  });
});

