import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { authSessionRepository } from '../repositories/auth-session.repository.js';
import { instituteRepository } from '../repositories/institute.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import type { AuthenticatedUser } from '../types/auth.js';
import type { Role } from '../types/rbac.js';
import type { AuditRequestMetadata } from '../types/audit.js';
import { AuditService } from './audit.service.js';
import { ApiError } from '../utils/api-error.js';
import { verifyPassword } from '../utils/password.js';
import { createAccessToken, createRefreshToken, hashRefreshToken, verifyAccessToken } from '../utils/tokens.js';
import { verifyGoogleIdToken } from './google-id-token.service.js';
import { createHash } from 'node:crypto';
import { authenticationEventRepository } from '../repositories/authentication-event.repository.js';
import { logger } from '../config/logger.js';

const INVALID_LOGIN = new ApiError(401, 'INVALID_CREDENTIALS', 'The institute ID, identifier, or password is incorrect');

interface UserRecord {
  _id: { toString(): string } | string;
  userId: string;
  instituteId: { toString(): string } | string;
  name: string;
  email?: string;
  mobile?: string;
  passwordHash?: string;
  role: string;
  status: string;
  lastLoginAt?: Date;
  failedLoginAttempts?: number;
  lockedUntil?: Date;
  authVersion?: number;
}

interface InstituteRecord {
  _id: { toString(): string } | string;
  instituteId: string;
  name: string;
  status: string;
}

function objectId(value: { toString(): string } | string): string {
  return value.toString();
}

async function recordGoogleEvent(input: {
  eventType: 'google.login' | 'google.link';
  outcome: 'success' | 'failure';
  request: AuditRequestMetadata;
  reasonCode?: string;
  subject?: string;
  userId?: string;
  instituteId?: string;
}): Promise<void> {
  try {
    await authenticationEventRepository.create({
      eventType: input.eventType,
      outcome: input.outcome,
      ...(input.reasonCode ? { reasonCode: input.reasonCode.slice(0, 80) } : {}),
      ...(input.subject ? { subjectHash: createHash('sha256').update(input.subject).digest('hex') } : {}),
      ...(input.userId ? { actorUserId: input.userId } : {}),
      ...(input.instituteId ? { instituteId: input.instituteId } : {}),
      requestId: input.request.requestId,
      ...(input.request.ip ? { ip: input.request.ip } : {}),
      ...(input.request.userAgent ? { userAgent: input.request.userAgent } : {})
    });
  } catch (error) {
    logger.error({ err: error, requestId: input.request.requestId, eventType: input.eventType }, 'Authentication event could not be persisted');
  }
}

function publicUser(user: UserRecord, institute: InstituteRecord): AuthenticatedUser {
  return {
    objectId: objectId(user._id),
    userId: user.userId,
    instituteId: objectId(user.instituteId),
    instituteBusinessId: institute.instituteId,
    name: user.name,
    ...(user.email ? { email: user.email } : {}),
    ...(user.mobile ? { mobile: user.mobile } : {}),
    role: user.role as Role,
    authVersion: user.authVersion ?? 0
  };
}

function tokenResponse(user: UserRecord, institute: InstituteRecord) {
  const safeUser = publicUser(user, institute);
  const now = new Date();
  const accessTokenExpiresAt = new Date(now.getTime() + env.JWT_ACCESS_TTL_SECONDS * 1000);
  const refreshTokenExpiresAt = new Date(now.getTime() + env.JWT_REFRESH_TTL_SECONDS * 1000);
  const accessToken = createAccessToken({
    sub: safeUser.objectId,
    iid: safeUser.instituteId,
    ins: safeUser.instituteBusinessId,
    role: safeUser.role,
    ver: safeUser.authVersion
  });
  const refreshToken = createRefreshToken();
  return { safeUser, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt };
}

async function createSession(user: UserRecord, institute: InstituteRecord) {
  const tokens = tokenResponse(user, institute);
  await authSessionRepository.create({
    userId: objectId(user._id),
    instituteId: objectId(institute._id),
    tokenHash: hashRefreshToken(tokens.refreshToken),
    expiresAt: tokens.refreshTokenExpiresAt
  });
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
    user: {
      userId: tokens.safeUser.userId,
      name: tokens.safeUser.name,
      ...(tokens.safeUser.email ? { email: tokens.safeUser.email } : {}),
      ...(tokens.safeUser.mobile ? { mobile: tokens.safeUser.mobile } : {}),
      role: tokens.safeUser.role
    },
    institute: { instituteId: institute.instituteId, name: institute.name }
  };
}

export const authService = {
  async login(input: { instituteId: string; identifier: string; password: string }, request: AuditRequestMetadata) {
    const institute = await instituteRepository.findByBusinessId(input.instituteId) as InstituteRecord | null;
    if (!institute) throw INVALID_LOGIN;
    if (institute.status !== 'active') throw new ApiError(403, 'INSTITUTE_INACTIVE', 'This institute account is not active');

    const user = await userRepository.findByCredentials(objectId(institute._id), input.identifier) as UserRecord | null;
    if (!user) throw INVALID_LOGIN;
    if (user.status !== 'active') throw new ApiError(403, 'USER_INACTIVE', 'This user account is not active');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ApiError(429, 'ACCOUNT_LOCKED', 'Too many failed login attempts; try again later');
    }
    if (!user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      await userRepository.recordFailedLogin(objectId(user._id), env.LOGIN_MAX_FAILED_ATTEMPTS, env.LOGIN_LOCK_DURATION_MS);
      throw INVALID_LOGIN;
    }

    await userRepository.clearFailedLogins(objectId(user._id));
    await userRepository.setLastLogin(objectId(user._id), new Date());
    const result = await createSession(user, institute);
    await AuditService.record({
      instituteId: objectId(institute._id),
      actorUserId: objectId(user._id),
      action: 'auth.login',
      entityType: 'User',
      entityId: user.userId,
      after: { status: 'authenticated' },
      request
    });
    return result;
  },

  async googleLogin(idToken: string, request: AuditRequestMetadata) {
    let subject: string | undefined;
    try {
      const google = await verifyGoogleIdToken(idToken);
      subject = google.sub;
      const found = await userRepository.findByGoogleSubject(google.sub);
      if (!found) throw new ApiError(401, 'GOOGLE_ACCOUNT_NOT_LINKED', 'Google authentication failed');
      const user = found as unknown as UserRecord;
      if (user.status !== 'active') throw new ApiError(403, 'USER_INACTIVE', 'This user account is not active');
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new ApiError(429, 'ACCOUNT_LOCKED', 'Too many failed login attempts; try again later');
      }
      const institute = await instituteRepository.findById(objectId(user.instituteId)) as InstituteRecord | null;
      if (!institute || institute.status !== 'active') {
        throw new ApiError(403, 'INSTITUTE_INACTIVE', 'This institute account is not active');
      }
      await userRepository.setLastLogin(objectId(user._id), new Date());
      const result = await createSession(user, institute);
      await AuditService.record({
        instituteId: objectId(institute._id), actorUserId: objectId(user._id), action: 'auth.login',
        entityType: 'User', entityId: user.userId,
        after: { status: 'authenticated', provider: 'google' }, request
      });
      await recordGoogleEvent({ eventType: 'google.login', outcome: 'success', subject, userId: objectId(user._id), instituteId: objectId(institute._id), request });
      return result;
    } catch (error) {
      await recordGoogleEvent({
        eventType: 'google.login', outcome: 'failure', ...(subject ? { subject } : {}),
        reasonCode: error instanceof ApiError ? error.code : 'GOOGLE_AUTH_FAILURE', request
      });
      throw error;
    }
  },

  async linkGoogleAccount(idToken: string, auth: AuthenticatedUser, request: AuditRequestMetadata) {
    let subject: string | undefined;
    try {
      const google = await verifyGoogleIdToken(idToken);
      subject = google.sub;
      const institute = await instituteRepository.findById(auth.instituteId) as InstituteRecord | null;
      if (!institute || institute.status !== 'active') {
        throw new ApiError(403, 'INSTITUTE_INACTIVE', 'This institute account is not active');
      }
      const currentUser = await userRepository.findByIdForGoogleLink(auth.objectId) as UserRecord & { googleSubjectId?: string } | null;
      if (!currentUser || currentUser.status !== 'active' || objectId(currentUser.instituteId) !== auth.instituteId) {
        throw new ApiError(401, 'USER_INACTIVE', 'User is unavailable');
      }
      if (!currentUser.email || currentUser.email.toLowerCase() !== google.email!.toLowerCase()) {
        throw new ApiError(403, 'GOOGLE_LINK_EMAIL_MISMATCH', 'The verified Google email must match this Skill Nova account');
      }
      if (currentUser.googleSubjectId && currentUser.googleSubjectId !== google.sub) {
        throw new ApiError(409, 'GOOGLE_ACCOUNT_ALREADY_LINKED', 'A different Google account is already linked');
      }
      const existingOwner = await userRepository.findByGoogleSubject(google.sub) as (UserRecord & { googleSubjectId?: string }) | null;
      if (existingOwner && objectId(existingOwner._id) !== auth.objectId) {
        throw new ApiError(409, 'GOOGLE_ACCOUNT_ALREADY_LINKED', 'This Google account is already linked');
      }
      if (!currentUser.googleSubjectId) {
        try {
          const linked = await userRepository.linkGoogleSubject(auth.objectId, google.sub, google.email!);
          if (!linked) throw new ApiError(409, 'GOOGLE_ACCOUNT_LINK_CONFLICT', 'Google account could not be linked');
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(409, 'GOOGLE_ACCOUNT_ALREADY_LINKED', 'This Google account is already linked');
        }
      }
      await AuditService.record({
        instituteId: auth.instituteId, actorUserId: auth.objectId, action: 'auth.google_link',
        entityType: 'User', entityId: auth.userId,
        after: { provider: 'google', linked: true }, request
      });
      await recordGoogleEvent({ eventType: 'google.link', outcome: 'success', subject, userId: auth.objectId, instituteId: auth.instituteId, request });
      return { linked: true };
    } catch (error) {
      await recordGoogleEvent({
        eventType: 'google.link', outcome: 'failure', ...(subject ? { subject } : {}),
        reasonCode: error instanceof ApiError ? error.code : 'GOOGLE_LINK_FAILURE',
        userId: auth.objectId, instituteId: auth.instituteId, request
      });
      throw error;
    }
  },

  async refresh(refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken);
    const session = await authSessionRepository.findActiveByHash(tokenHash);
    if (!session) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');

    const user = await userRepository.findById(objectId(session.userId)) as UserRecord | null;
    if (!user || user.status !== 'active') throw new ApiError(403, 'USER_INACTIVE', 'This user account is not active');
    const institute = await instituteRepository.findById(objectId(session.instituteId)) as InstituteRecord | null;
    if (!institute || institute.status !== 'active') throw new ApiError(403, 'INSTITUTE_INACTIVE', 'This institute account is not active');

    if (!(await authSessionRepository.consume(objectId(session._id), new Date()))) {
      throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    }
    return createSession(user, institute);
  },

  async logout(refreshToken: string, userId: string, instituteId: string, request: AuditRequestMetadata): Promise<void> {
    await authSessionRepository.revokeOwned(hashRefreshToken(refreshToken), userId, new Date());
    await AuditService.record({
      instituteId,
      actorUserId: userId,
      action: 'auth.logout',
      entityType: 'User',
      entityId: userId,
      after: { refreshSession: 'revoked' },
      request
    });
  },

  async authenticateAccessToken(token: string): Promise<AuthenticatedUser> {
    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) throw new ApiError(401, 'TOKEN_EXPIRED', 'Access token has expired');
      throw new ApiError(401, 'INVALID_TOKEN', 'Access token is invalid');
    }

    const user = await userRepository.findById(claims.sub) as UserRecord | null;
    if (!user || user.status !== 'active') throw new ApiError(401, 'USER_INACTIVE', 'User is unavailable');
    if (objectId(user.instituteId) !== claims.iid || (user.authVersion ?? 0) !== claims.ver) {
      throw new ApiError(401, 'INVALID_TOKEN', 'Access token is invalid');
    }
    const institute = await instituteRepository.findById(claims.iid) as InstituteRecord | null;
    if (!institute || institute.status !== 'active' || institute.instituteId !== claims.ins) {
      throw new ApiError(403, 'INSTITUTE_INACTIVE', 'This institute account is not active');
    }
    return publicUser(user, institute);
  }
};


