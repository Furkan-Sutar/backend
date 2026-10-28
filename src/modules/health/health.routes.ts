import { Router } from 'express';
import { env } from '../../config/env.js';
import { getDatabaseStatus } from '../../config/database.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const database = getDatabaseStatus();
  const ready = database === 'connected';
  res.status(ready ? 200 : 503).json({
    success: ready,
    data: {
      status: ready ? 'ok' : 'degraded',
      environment: env.NODE_ENV,
      database,
      timestamp: new Date().toISOString()
    },
    message: ready ? 'Service health retrieved' : 'Service is not ready',
    meta: {}
  });
});
