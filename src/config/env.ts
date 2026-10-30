import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  APP_URL: z.string().url().optional(),
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().positive().default(20),
  MONGO_MIN_POOL_SIZE: z.coerce.number().int().nonnegative().default(0),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  JSON_BODY_LIMIT: z.string().default('1mb'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_DURATION_MS: z.coerce.number().int().positive().default(900_000),
  PRIVATE_DOCUMENT_STORAGE_PATH: z.string().min(1).default('./private-documents')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

if (parsed.data.NODE_ENV === 'production') {
  const issues: string[] = [];
  if (!parsed.data.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean).length) {
    issues.push('CORS_ORIGINS must contain at least one approved client origin in production');
  }
  if (!parsed.data.APP_URL || !parsed.data.APP_URL.startsWith('https://')) {
    issues.push('APP_URL must use HTTPS in production');
  }
  if (parsed.data.JWT_ACCESS_SECRET.toLowerCase().includes('replace-with')) {
    issues.push('JWT_ACCESS_SECRET must be replaced with a generated production secret');
  }
  if (!parsed.data.GOOGLE_CLIENT_ID || parsed.data.GOOGLE_CLIENT_ID.toLowerCase().includes('replace-with')) {
    issues.push('GOOGLE_CLIENT_ID must be set to the production Web OAuth Client ID');
  }
  if (!parsed.data.PRIVATE_DOCUMENT_STORAGE_PATH.startsWith('/')) {
    issues.push('PRIVATE_DOCUMENT_STORAGE_PATH must be an absolute private path in production');
  }
  if (parsed.data.MONGO_URI.startsWith('mongodb://127.0.0.1') || parsed.data.MONGO_URI.startsWith('mongodb://localhost')) {
    issues.push('MONGO_URI must point to a production MongoDB service in production');
  }
  if (issues.length) throw new Error(`Invalid production configuration: ${issues.join('; ')}`);
}

export const env = Object.freeze(parsed.data);
export const corsOrigins = Object.freeze(env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean));


