import { pinoHttp } from 'pino-http';
import type { IncomingMessage } from 'node:http';
import { logger } from '../config/logger.js';

export const requestLogger = pinoHttp({
  logger,
  customProps: (req) => ({ correlationId: (req as IncomingMessage & { correlationId: string }).correlationId }),
  customLogLevel: (_req, res, error) => error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
});


