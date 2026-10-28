import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  institute: { findById: vi.fn() },
  user: { findById: vi.fn() },
  audit: { create: vi.fn(), list: vi.fn() }
}));

vi.mock('../repositories/institute.repository.js', () => ({ instituteRepository: mocks.institute }));
vi.mock('../repositories/user.repository.js', () => ({ userRepository: mocks.user }));
vi.mock('../repositories/audit-log.repository.js', () => ({ auditLogRepository: mocks.audit }));

process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/skill_nova_test';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = 'audit-test-secret-that-is-longer-than-32-characters';

const { app } = await import('../app.js');
const { createAccessToken } = await import('../utils/tokens.js');
const { AuditService } = await import('../services/audit.service.js');

const institute = { _id: '507f1f77bcf86cd799439011', instituteId: 'SN-INS-2026-00001', name: 'Audit Institute', status: 'active' };
const user = {
  _id: '507f1f77bcf86cd799439012', userId: 'SN-USR-2026-00001', instituteId: institute._id,
  name: 'Owner', email: 'owner@example.test', role: 'OWNER_ADMIN', status: 'active', authVersion: 0
};
const tokenFor = (role: 'OWNER_ADMIN' | 'STUDENT') => createAccessToken({
  sub: user._id, iid: institute._id, ins: institute.instituteId, role, ver: 0
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.institute.findById.mockResolvedValue(institute);
  mocks.user.findById.mockResolvedValue(user);
  mocks.audit.create.mockImplementation(async (record) => record);
  mocks.audit.list.mockResolvedValue({ items: [{ auditId: 'SN-AUD-2026-00001', action: 'payment.create' }], total: 1 });
});

describe('audit log API', () => {
  it('lists audit records with validated filters and authenticated institute scope', async () => {
    const response = await request(app).get('/api/v1/audit-logs')
      .query({
        date: '2026-10-14', actor: user.userId, action: 'payment.create', entity: 'Payment',
        entityId: 'SN-REC-2026-00001', page: '2', limit: '10'
      })
      .set('Authorization', `Bearer ${tokenFor('OWNER_ADMIN')}`)
      .set('x-correlation-id', 'audit-list-test');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta).toMatchObject({ page: 2, limit: 10, total: 1, pages: 1 });
    expect(mocks.audit.list).toHaveBeenCalledWith({
      instituteId: institute._id,
      date: '2026-10-14',
      actor: user.userId,
      action: 'payment.create',
      entity: 'Payment',
      entityId: 'SN-REC-2026-00001',
      page: 2,
      limit: 10
    });
  });

  it('requires the audit.view permission', async () => {
    mocks.user.findById.mockResolvedValue({ ...user, role: 'STUDENT' });
    const response = await request(app).get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${tokenFor('STUDENT')}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PERMISSION_FORBIDDEN');
    expect(mocks.audit.list).not.toHaveBeenCalled();
  });

  it('rejects a request for another institute and never queries it', async () => {
    const response = await request(app).get('/api/v1/audit-logs?instituteId=SN-INS-2026-00002')
      .set('Authorization', `Bearer ${tokenFor('OWNER_ADMIN')}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSTITUTE_ACCESS_DENIED');
    expect(mocks.audit.list).not.toHaveBeenCalled();
  });

  it('rejects invalid calendar date filters', async () => {
    const response = await request(app).get('/api/v1/audit-logs?date=2026-02-31')
      .set('Authorization', `Bearer ${tokenFor('OWNER_ADMIN')}`);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('AuditService.record', () => {
  it('persists audit metadata and removes secrets from before/after snapshots', async () => {
    await AuditService.record({
      instituteId: institute._id,
      actorUserId: user._id,
      action: 'payment.create',
      entityType: 'Payment',
      entityId: 'SN-REC-2026-00001',
      before: { status: 'pending', passwordHash: 'hidden', nested: { refreshToken: 'hidden', amount: 2500 } },
      after: { status: 'posted', secret: 'hidden', amount: 2500 },
      reason: 'Payment received',
      request: {
        requestId: 'audit-record-test', ip: '127.0.0.1', userAgent: 'Unit Test',
        device: { id: 'device-1', platform: 'android' }
      }
    });

    expect(mocks.audit.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payment.create', instituteId: institute._id, actorUserId: user._id,
      requestId: 'audit-record-test', ip: '127.0.0.1', userAgent: 'Unit Test',
      before: { status: 'pending', nested: { amount: 2500 } },
      after: { status: 'posted', amount: 2500 }
    }));
  });
});

