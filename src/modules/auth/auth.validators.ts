import { z } from 'zod';

export const loginSchema = z.object({
  instituteId: z.string().trim().min(1).max(40),
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128)
}).strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(32).max(256) }).strict();
