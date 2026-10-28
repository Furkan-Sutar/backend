import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const safeIdPattern = /^[a-zA-Z0-9._:-]{1,128}$/;

export const correlationIdMiddleware: RequestHandler = (req, res, next) => {
  const supplied = req.header('x-correlation-id');
  const correlationId = supplied && safeIdPattern.test(supplied) ? supplied : randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
};
