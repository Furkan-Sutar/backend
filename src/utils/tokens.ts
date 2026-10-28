import { createHash, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessClaims extends JwtPayload {
  sub: string;
  iid: string;
  ins: string;
  role: string;
  ver: number;
}

export function createAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: env.JWT_ACCESS_TTL_SECONDS });
}

export function verifyAccessToken(token: string): AccessClaims {
  const claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (typeof claims === 'string' || !claims.sub || !claims.iid || !claims.ins || typeof claims.ver !== 'number') {
    throw new jwt.JsonWebTokenError('Invalid access token claims');
  }
  return claims as AccessClaims;
}

export function createRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

