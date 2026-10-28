import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env, corsOrigins } from './config/env.js';
import { correlationIdMiddleware } from './middleware/correlation-id.js';
import { inputSanitizer } from './middleware/input-sanitizer.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { v1Router } from './routes/v1.routes.js';

export const app = express();

app.disable('x-powered-by');
if (env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(helmet());
app.use(correlationIdMiddleware);
app.use(requestLogger);
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true
}));
app.use(rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      success: false,
      message: 'Too many requests',
      code: 'RATE_LIMITED',
      errors: [],
      meta: { correlationId: req.correlationId }
    });
  }
}));
app.use(express.json({ limit: env.JSON_BODY_LIMIT, strict: true }));
app.use(express.urlencoded({ extended: false, limit: env.JSON_BODY_LIMIT, parameterLimit: 100 }));
app.use(inputSanitizer);
app.use('/api/v1', v1Router);
app.use(notFoundHandler);
app.use(errorHandler);

