import type { RequestHandler } from 'express';
import { ApiError } from '../utils/api-error.js';

export function instituteOwnership(): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'));

    const bodyInstituteId = req.body && typeof req.body === 'object' ? req.body.instituteId : undefined;
    const queryInstituteId = req.query.instituteId;
    const requestedValues: unknown[] = [req.params.instituteId, bodyInstituteId, queryInstituteId]
      .filter((value) => value !== undefined);

    const allowedValues = new Set([req.auth.instituteId, req.auth.instituteBusinessId]);
    if (requestedValues.some((value) => typeof value !== 'string' || !allowedValues.has(value))) {
      return next(new ApiError(403, 'INSTITUTE_ACCESS_DENIED', 'You cannot access another institute'));
    }
    return next();
  };
}

export const requireInstituteOwnership = instituteOwnership();
