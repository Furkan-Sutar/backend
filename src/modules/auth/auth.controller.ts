import type { Request, Response } from 'express';
import { authService } from '../../services/auth.service.js';
import { ApiError } from '../../utils/api-error.js';
import { loginSchema, refreshSchema } from './auth.validators.js';
import { auditRequestMetadata } from '../../utils/audit-request.js';

function parseInput<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed');
  return result.data;
}

export const authController = {
  async login(req: Request, res: Response): Promise<void> {
    const input = parseInput(loginSchema, req.body);
    const data = await authService.login(input, auditRequestMetadata(req));
    res.status(200).json({ success: true, data, message: 'Login successful', meta: { correlationId: req.correlationId } });
  },
  async refresh(req: Request, res: Response): Promise<void> {
    const { refreshToken } = parseInput(refreshSchema, req.body);
    const data = await authService.refresh(refreshToken);
    res.status(200).json({ success: true, data, message: 'Token refreshed', meta: { correlationId: req.correlationId } });
  },
  async logout(req: Request, res: Response): Promise<void> {
    const { refreshToken } = parseInput(refreshSchema, req.body);
    if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
    await authService.logout(refreshToken, req.auth.objectId, req.auth.instituteId, auditRequestMetadata(req));
    res.status(200).json({ success: true, data: {}, message: 'Logout successful', meta: { correlationId: req.correlationId } });
  },
  me(req: Request, res: Response): void {
    if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
    const { objectId: _objectId, authVersion: _authVersion, ...user } = req.auth;
    res.status(200).json({ success: true, data: { user }, message: 'Authenticated user retrieved', meta: { correlationId: req.correlationId } });
  }
};

