import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  instituteFindById: vi.fn(),
  userFindById: vi.fn(),
  userFindByIdForGoogleLink: vi.fn(),
  userFindByGoogleSubject: vi.fn(),
  userLinkGoogleSubject: vi.fn(),
  userSetLastLogin: vi.fn(),
  sessionCreate: vi.fn(),
  auditCreate: vi.fn(),
  authEventCreate: vi.fn(),
  clientAudience: undefined as string | undefined
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    constructor(audience: string) { mocks.clientAudience = audience; }
    verifyIdToken(options: unknown) { return mocks.verifyIdToken(options); }
  }
}));
vi.mock('../repositories/institute.repository.js', () => ({
  instituteRepository: { findById: mocks.instituteFindById }
}));
vi.mock('../repositories/user.repository.js', () => ({
  userRepository: {
    findById: mocks.userFindById,
    findByIdForGoogleLink: mocks.userFindByIdForGoogleLink,
    findByGoogleSubject: mocks.userFindByGoogleSubject,
    linkGoogleSubject: mocks.userLinkGoogleSubject,
    setLastLogin: mocks.userSetLastLogin
  }
}));
vi.mock('../repositories/auth-session.repository.js', () => ({ authSessionRepository: { create: mocks.sessionCreate } }));
vi.mock('../repositories/audit-log.repository.js', () => ({ auditLogRepository: { create: mocks.auditCreate } }));
vi.mock('../repositories/authentication-event.repository.js', () => ({
  authenticationEventRepository: { create: mocks.authEventCreate }
}));

process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/skill_nova_test';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = 'google-auth-test-secret-at-least-32-characters-long';
process.env.GOOGLE_CLIENT_ID = 'skill-nova-web.apps.googleusercontent.com';

const [{ app }, { verifyGoogleIdToken }] = await Promise.all([
  import('../app.js'),
  import('../services/google-id-token.service.js')
]);

const institute = { _id: '507f1f77bcf86cd799439011', instituteId: 'SN-INS-2026-00001', name: 'North Campus', status: 'active' };
const user = {
  _id: '507f1f77bcf86cd799439012', userId: 'SN-USR-2026-00001', instituteId: institute._id,
  name: 'Asha Rao', email: 'asha@example.test', role: 'COUNSELLOR', status: 'active', authVersion: 2,
  googleSubjectId: 'google-subject-123'
};
const validPayload = {
  sub: 'google-subject-123', email: 'asha@example.test', email_verified: true,
  aud: process.env.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 300
};
const validTicket = { getPayload: () => validPayload };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyIdToken.mockResolvedValue(validTicket);
  mocks.instituteFindById.mockResolvedValue(institute);
  mocks.userFindById.mockResolvedValue(user);
  mocks.userFindByIdForGoogleLink.mockResolvedValue({ ...user, googleSubjectId: undefined });
  mocks.userFindByGoogleSubject.mockResolvedValue(user);
  mocks.userLinkGoogleSubject.mockResolvedValue(user);
  mocks.userSetLastLogin.mockResolvedValue(undefined);
  mocks.sessionCreate.mockResolvedValue({});
  mocks.auditCreate.mockResolvedValue({});
  mocks.authEventCreate.mockResolvedValue({});
});

describe('Google ID token authentication', () => {
  it('rejects a missing ID token before verification', async () => {
    const response = await request(app).post('/api/v1/auth/google').send({});
    expect(response.status).toBe(400);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects the demo token without passing it to Google verification', async () => {
    await expect(verifyGoogleIdToken('demo_google_id_token')).rejects.toMatchObject({ code: 'INVALID_GOOGLE_ID_TOKEN' });
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects a fake token when Google signature verification fails', async () => {
    mocks.verifyIdToken.mockRejectedValueOnce(new Error('invalid signature'));
    const response = await request(app).post('/api/v1/auth/google').send({ idToken: 'not-a-real-google-id-token' });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_GOOGLE_ID_TOKEN');
    expect(response.text).not.toContain('not-a-real-google-id-token');
    expect(mocks.authEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'google.login', outcome: 'failure', reasonCode: 'INVALID_GOOGLE_ID_TOKEN'
    }));
  });

  it('rejects expired claims even if a verifier adapter returns them', async () => {
    mocks.verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ ...validPayload, exp: 1 }) });
    await expect(verifyGoogleIdToken('syntactically-valid-token'))
      .rejects.toMatchObject({ code: 'INVALID_GOOGLE_ID_TOKEN' });
  });

  it('rejects a token for a different OAuth audience', async () => {
    mocks.verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ ...validPayload, aud: 'another-client-id' }) });
    await expect(verifyGoogleIdToken('syntactically-valid-token'))
      .rejects.toMatchObject({ code: 'INVALID_GOOGLE_ID_TOKEN' });
  });

  it('requires verified email and Google subject claims', async () => {
    mocks.verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ ...validPayload, email_verified: false }) });
    await expect(verifyGoogleIdToken('syntactically-valid-token'))
      .rejects.toMatchObject({ code: 'INVALID_GOOGLE_ID_TOKEN' });
    mocks.verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ ...validPayload, sub: '' }) });
    await expect(verifyGoogleIdToken('syntactically-valid-token'))
      .rejects.toMatchObject({ code: 'INVALID_GOOGLE_ID_TOKEN' });
    mocks.verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ ...validPayload, iss: 'https://attacker.example' }) });
    await expect(verifyGoogleIdToken('syntactically-valid-token'))
      .rejects.toMatchObject({ code: 'INVALID_GOOGLE_ID_TOKEN' });
  });

  it('verifies against configured Web Client ID and issues normal Skill Nova tokens without bearer auth', async () => {
    const response = await request(app).post('/api/v1/auth/google').send({ idToken: 'signed-google-id-token' });
    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBeTypeOf('string');
    expect(response.body.data.refreshToken).toBeTypeOf('string');
    expect(response.body.data.user.role).toBe('COUNSELLOR');
    expect(mocks.clientAudience).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-google-id-token', audience: process.env.GOOGLE_CLIENT_ID
    });
    expect(mocks.userFindByGoogleSubject).toHaveBeenCalledWith(validPayload.sub);
    expect(mocks.sessionCreate).toHaveBeenCalledOnce();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login' }));
    expect(mocks.authEventCreate).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'google.login', outcome: 'success' }));
    expect(response.text).not.toContain('signed-google-id-token');
  });

  it('does not auto-link an unlinked account even when its email matches', async () => {
    mocks.userFindByGoogleSubject.mockResolvedValueOnce(null);
    const response = await request(app).post('/api/v1/auth/google').send({ idToken: 'signed-google-id-token' });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('GOOGLE_ACCOUNT_NOT_LINKED');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a disabled existing account', async () => {
    mocks.userFindByGoogleSubject.mockResolvedValueOnce({ ...user, status: 'inactive' });
    const response = await request(app).post('/api/v1/auth/google').send({ idToken: 'signed-google-id-token' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('USER_INACTIVE');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a linked user whose institute is inactive', async () => {
    mocks.instituteFindById.mockResolvedValueOnce({ ...institute, status: 'inactive' });
    const response = await request(app).post('/api/v1/auth/google').send({ idToken: 'signed-google-id-token' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSTITUTE_INACTIVE');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('requires an existing Skill Nova bearer token for the explicit linking workflow', async () => {
    const response = await request(app).post('/api/v1/auth/google/link').send({ idToken: 'signed-google-id-token' });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    expect(mocks.userLinkGoogleSubject).not.toHaveBeenCalled();
  });

  it('links only the authenticated account after a verified Google token and matching account email', async () => {
    const { createAccessToken } = await import('../utils/tokens.js');
    const accessToken = createAccessToken({
      sub: user._id, iid: institute._id, ins: institute.instituteId, role: user.role, ver: user.authVersion
    });
    mocks.userFindByIdForGoogleLink.mockResolvedValueOnce({ ...user, googleSubjectId: undefined });
    mocks.userFindByGoogleSubject.mockResolvedValueOnce(null);
    const response = await request(app).post('/api/v1/auth/google/link')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ idToken: 'signed-google-id-token' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ linked: true });
    expect(mocks.userLinkGoogleSubject).toHaveBeenCalledWith(user._id, validPayload.sub, validPayload.email);
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.google_link' }));
  });

  it('rejects linking a Google identity whose verified email differs from the authenticated account', async () => {
    const { createAccessToken } = await import('../utils/tokens.js');
    const accessToken = createAccessToken({
      sub: user._id, iid: institute._id, ins: institute.instituteId, role: user.role, ver: user.authVersion
    });
    mocks.userFindByIdForGoogleLink.mockResolvedValueOnce({ ...user, email: 'different@example.test', googleSubjectId: undefined });
    const response = await request(app).post('/api/v1/auth/google/link')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ idToken: 'signed-google-id-token' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('GOOGLE_LINK_EMAIL_MISMATCH');
    expect(mocks.userLinkGoogleSubject).not.toHaveBeenCalled();
  });

  it.each(['OWNER_ADMIN', 'TEACHER', 'STUDENT'] as const)('returns the stored %s role, never a client role', async (role) => {
    mocks.userFindByGoogleSubject.mockResolvedValueOnce({ ...user, role });
    const response = await request(app).post('/api/v1/auth/google')
      .send({ idToken: 'signed-google-id-token', role: 'OWNER_ADMIN', userId: 'forged-user' });
    expect(response.status).toBe(400);
    const valid = await request(app).post('/api/v1/auth/google').send({ idToken: 'signed-google-id-token' });
    expect(valid.status).toBe(200);
    expect(valid.body.data.user.role).toBe(role);
  });

  it('keeps private authentication routes protected', async () => {
    const profile = await request(app).get('/api/v1/auth/me');
    const logout = await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'r'.repeat(48) });
    expect(profile.status).toBe(401);
    expect(profile.body.code).toBe('AUTHENTICATION_REQUIRED');
    expect(logout.status).toBe(401);
    expect(logout.body.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
