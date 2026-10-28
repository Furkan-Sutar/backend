import type { RequestHandler } from 'express';
import { ApiError } from '../utils/api-error.js';

const unsafeKey = /[.$]/;

function containsUnsafeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsafeKey);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => unsafeKey.test(key) || containsUnsafeKey(child));
}

export const inputSanitizer: RequestHandler = (req, _res, next) => {
  if (containsUnsafeKey(req.query) || containsUnsafeKey(req.body) || containsUnsafeKey(req.params)) {
    return next(new ApiError(400, 'INVALID_INPUT', 'Request contains unsupported field names'));
  }
  return next();
};
