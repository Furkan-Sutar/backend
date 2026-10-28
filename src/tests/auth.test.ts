import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  institute: { findByBusinessId: vi.fn(), findById: vi.fn() },
  user: { findByCredentials: vi.fn(), findById: vi.fn(), recordFailedLogin: vi.fn(), clearFailedLogins: vi.fn(), setLastLogin: vi.fn() },
  session: { create: vi.fn(), findActiveByHash: vi.fn(), consume: vi.fn(), revokeOwned: vi.fn() },
  audit: { create: vi.fn(), list: vi.fn() }
}));

vi.mock('../repositories/institute.repository.js', () => ({ instituteRepository: mocks.institute }));
vi.mock('../repositories/user.repository.js', () => ({ userRepository: mocks.user }));
vi.mock('../repositories/auth-session.repository.js', () => ({ authSessionRepository: mocks.session }));
vi.mock('../repositories/audit-log.repository.js', () => ({ auditLogRepository: mocks.audit }));

process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/skill_nova_test';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-longer-than-32-characters';

const { app } = await import('../app.js');
const { hashPassword } = await import('../utils/password.js');
const { hashRefreshToken } = await import('../utils/tokens.js');
const passwordHash = await hashPassword('Correct-Horse-Battery-9');

const institute = {
  _id: '507f1f77bcf86cd799439011', instituteId: 'SN-INS-2026-00001', name: 'North Campus', status: 'active'
};
const user = {
  _id: '507f1f77bcf86cd799439012', userId: 'SN-USR-2026-00001', instituteId: institute._id,
  name: 'Asha Rao', email: 'asha@example.test', passwordHash, role: 'OWNER_ADMIN', status: 'active',
  authVersion: 0, failedLoginAttempts: 0
};
const session = {
  _id: '507f1f77bcf86cd799439013', userId: user._id, instituteId: institute._id,
  expiresAt: new Date(Date.now() + 60_000), revokedAt: null
};
const loginBody = { instituteId: institute.instituteId, identifier: user.email, password: 'Correct-Horse-Battery-9' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.institute.findByBusinessId.mockResolvedValue(institute);
  mocks.institute.findById.mockResolvedValue(institute);
  mocks.user.findByCredentials.mockResolvedValue(user);
  mocks.user.findById.mockResolvedValue(user);
  mocks.user.recordFailedLogin.mockResolvedValue(undefined);
  mocks.user.clearFailedLogins.mockResolvedValue(undefined);
  mocks.user.setLastLogin.mockResolvedValue(undefined);
  mocks.session.create.mockResolvedValue({});
  mocks.session.findActiveByHash.mockResolvedValue(null);
  mocks.session.consume.mockResolvedValue(true);
  mocks.session.revokeOwned.mockResolvedValue(undefined);
  mocks.audit.create.mockResolvedValue({});
});

describe('authentication API', () => {
  it('logs in with valid credentials and never returns passwordHash', async () => {
    const response = await request(app).post('/api/v1/auth/login').send(loginBody);
    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBeTypeOf('string');
    expect(response.body.data.refreshToken).toBeTypeOf('string');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(mocks.session.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: user._id, instituteId: institute._id, tokenHash: expect.any(String)
    }));
    expect(mocks.user.setLastLogin).toHaveBeenCalledWith(user._id, expect.any(Date));
    expect(mocks.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login', actorUserId: user._id, instituteId: institute._id }));
  });

  it('rejects an invalid password and records a failed attempt', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ ...loginBody, password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_CREDENTIALS');
    expect(mocks.user.recordFailedLogin).toHaveBeenCalledWith(user._id, 5, 900_000);
  });

  it('blocks a user whose failed-login threshold has been reached', async () => {
    mocks.user.findByCredentials.mockResolvedValue({ ...user, lockedUntil: new Date(Date.now() + 60_000) });
    const response = await request(app).post('/api/v1/auth/login').send(loginBody);
    expect(response.status).toBe(429);
    expect(response.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('rejects expired access tokens', async () => {
    const jwt = await import('jsonwebtoken');
    const expiredToken = jwt.default.sign({
      sub: user._id, iid: institute._id, ins: institute.instituteId, role: user.role, ver: 0
    }, process.env.JWT_ACCESS_SECRET!, { expiresIn: -1 });
    const response = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expiredToken}`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('TOKEN_EXPIRED');
    expect(mocks.user.findById).not.toHaveBeenCalled();
  });

  it('rotates a valid refresh token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(loginBody);
    const oldRefreshToken = login.body.data.refreshToken as string;
    mocks.session.findActiveByHash.mockResolvedValue(session);

    const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: oldRefreshToken });
    expect(response.status).toBe(200);
    expect(response.body.data.refreshToken).not.toBe(oldRefreshToken);
    expect(mocks.session.findActiveByHash).toHaveBeenCalledWith(hashRefreshToken(oldRefreshToken));
    expect(mocks.session.consume).toHaveBeenCalledWith(session._id, expect.any(Date));
    expect(mocks.session.create).toHaveBeenCalledTimes(2);
  });

  it('rejects an expired or unknown refresh token', async () => {
    const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'x'.repeat(48) });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('revokes a refresh token on logout', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(loginBody);
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ refreshToken: login.body.data.refreshToken });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Logout successful');
    expect(mocks.session.revokeOwned).toHaveBeenCalledWith(
      hashRefreshToken(login.body.data.refreshToken), user._id, expect.any(Date)
    );
  });

  it('requires authentication for protected endpoints', async () => {
    const response = await request(app).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects inactive users', async () => {
    mocks.user.findByCredentials.mockResolvedValue({ ...user, status: 'inactive' });
    const response = await request(app).post('/api/v1/auth/login').send(loginBody);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('USER_INACTIVE');
  });

  it('rejects users from an inactive institute', async () => {
    mocks.institute.findByBusinessId.mockResolvedValue({ ...institute, status: 'inactive' });
    const response = await request(app).post('/api/v1/auth/login').send(loginBody);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSTITUTE_INACTIVE');
    expect(mocks.user.findByCredentials).not.toHaveBeenCalled();
  });

  it('returns the authenticated user without internal fields', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(loginBody);
    const response = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.user.userId).toBe(user.userId);
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(response.body.data.user).not.toHaveProperty('objectId');
  });

  it('rejects an inactive user on protected requests', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(loginBody);
    mocks.user.findById.mockResolvedValue({ ...user, status: 'inactive' });
    const response = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('USER_INACTIVE');
  });

  it('rejects an inactive institute on protected requests', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(loginBody);
    mocks.institute.findById.mockResolvedValue({ ...institute, status: 'inactive' });
    const response = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSTITUTE_INACTIVE');
  });

  it('rejects a requested institute outside the authenticated tenant', async () => {
    const { requireInstituteOwnership } = await import('../middleware/institute-ownership.js');
    const next = vi.fn();
    const req = {
      auth: { instituteId: 'institute-a-object-id', instituteBusinessId: 'SN-INS-2026-00001' },
      params: { instituteId: 'institute-b-object-id' },
      body: {},
      query: {}
    };
    requireInstituteOwnership(req as never, {} as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403, code: 'INSTITUTE_ACCESS_DENIED' });
  });
});


