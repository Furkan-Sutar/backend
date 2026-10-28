import type { RequestHandler } from 'express';
import { isRole, type Permission, type Role, ROLE_PERMISSIONS } from '../types/rbac.js';
import { ApiError } from '../utils/api-error.js';

export function requireRole(...allowedRoles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'));
    if (!isRole(req.auth.role) || !allowedRoles.includes(req.auth.role)) {
      return next(new ApiError(403, 'ROLE_FORBIDDEN', 'Your role cannot perform this action'));
    }
    return next();
  };
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'));
    if (!isRole(req.auth.role) || !ROLE_PERMISSIONS[req.auth.role].includes(permission)) {
      return next(new ApiError(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to perform this action'));
    }
    return next();
  };
}
