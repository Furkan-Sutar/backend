import type { RequestHandler } from 'express';
import { authService } from '../services/auth.service.js';
import { ApiError } from '../utils/api-error.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  const authorization = req.header('authorization');
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return next(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'A valid bearer access token is required'));
  try {
    req.auth = await authService.authenticateAccessToken(match[1]!);
    return next();
  } catch (error) {
    return next(error);
  }
};
