import { OAuth2Client, type LoginTicket, type TokenPayload } from 'google-auth-library';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

const INVALID_GOOGLE_TOKEN = new ApiError(401, 'INVALID_GOOGLE_ID_TOKEN', 'Google ID token is invalid');
let cachedClient: OAuth2Client | undefined;

function client(): { googleClient: OAuth2Client; audience: string } {
  const audience = env.GOOGLE_CLIENT_ID;
  if (!audience) {
    throw new ApiError(503, 'GOOGLE_AUTH_NOT_CONFIGURED', 'Google authentication is not configured');
  }
  cachedClient ??= new OAuth2Client(audience);
  return { googleClient: cachedClient, audience };
}

export async function verifyGoogleIdToken(idToken: string): Promise<Required<Pick<TokenPayload, 'sub' | 'email' | 'email_verified' | 'aud' | 'iss' | 'exp'>> & TokenPayload> {
  if (idToken === 'demo_google_id_token') throw INVALID_GOOGLE_TOKEN;
  const { googleClient, audience } = client();
  let payload: TokenPayload | undefined;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience }) as LoginTicket;
    payload = ticket.getPayload();
  } catch {
    // Never include the supplied token in errors or logs.
    throw INVALID_GOOGLE_TOKEN;
  }
  if (!payload || !payload.sub || !payload.email || payload.email_verified !== true ||
      payload.aud !== audience ||
      (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') ||
      !Number.isFinite(payload.exp) || payload.exp! <= Math.floor(Date.now() / 1000)) {
    throw INVALID_GOOGLE_TOKEN;
  }
  return payload as Required<Pick<TokenPayload, 'sub' | 'email' | 'email_verified' | 'aud' | 'iss' | 'exp'>> & TokenPayload;
}
