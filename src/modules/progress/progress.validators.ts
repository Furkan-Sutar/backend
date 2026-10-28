import { z } from 'zod';
const objectId = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid record ID');
export const createProgressSchema = z.object({ studentId: objectId, courseId: objectId, moduleId: objectId, topic: z.string().trim().min(1).max(200), status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']).default('NOT_STARTED'), completionDate: z.coerce.date().optional(), note: z.string().trim().max(500).optional() }).strict();
export const updateProgressSchema = z.object({ status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']).optional(), completionDate: z.coerce.date().nullable().optional(), note: z.string().trim().max(500).optional() }).strict().refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const progressListSchema = z.object({ studentId: objectId.optional(), courseId: objectId.optional() }).strict();
export const stalledProgressQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(14), courseId: objectId.optional() }).strict();
export const progressIdSchema = z.string().trim().min(1).max(100);
