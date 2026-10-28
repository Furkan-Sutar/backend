import { Router } from 'express';
import { env } from '../../config/env.js';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/authentication.js';
import { instituteOwnership } from '../../middleware/institute-ownership.js';
import { requirePermission, requireRole } from '../../middleware/authorization.js';
import { ROLES } from '../../types/rbac.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { authController } from './auth.controller.js';

export const authRouter = Router();
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1_000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts', code: 'AUTH_RATE_LIMITED', errors: [], meta: {} }
});
const authenticatedAccount = [authenticate, instituteOwnership(), requireRole(...ROLES)];

authRouter.post('/login', loginRateLimit, asyncHandler(authController.login));
authRouter.post('/refresh', loginRateLimit, asyncHandler(authController.refresh));
authRouter.post(
  '/logout',
  ...authenticatedAccount,
  requirePermission('auth.logout'),
  asyncHandler(authController.logout)
);
authRouter.get(
  '/me',
  ...authenticatedAccount,
  requirePermission('auth.me'),
  asyncHandler(async (req, res) => authController.me(req, res))
);
