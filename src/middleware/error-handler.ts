import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/api-error.js';
import { captureException } from '../config/error-monitor.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} was not found`));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const apiError = error instanceof ApiError ? error : null;
  const parserError = typeof error === 'object' && error !== null
    ? error as { status?: unknown; type?: unknown }
    : null;
  const parserStatus = parserError?.status === 413 ? 413 : parserError?.status === 400 ? 400 : null;
  const statusCode = apiError?.statusCode ?? parserStatus ?? 500;
  const code = apiError?.code ?? (parserStatus === 413 ? 'PAYLOAD_TOO_LARGE' : parserStatus === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR');
  const message = apiError?.message ?? (parserStatus === 413 ? 'Request body is too large' : parserStatus === 400 ? 'Request body is invalid' : 'An unexpected error occurred');

  if (statusCode >= 500) {
    logger.error({ err: error, correlationId: req.correlationId }, 'Request failed');
    captureException(error, { requestId: req.correlationId, method: req.method, route: req.route?.path });
  } else {
    logger.warn({ code, correlationId: req.correlationId }, message);
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    errors: apiError?.errors ?? [],
    meta: { correlationId: req.correlationId }
  });
};
