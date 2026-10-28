import type { Request, Response } from 'express';
import { ApiError } from '../../utils/api-error.js';
import { attendanceProgressService } from '../../services/attendance-progress.service.js';
import { createProgressSchema, progressIdSchema, progressListSchema, stalledProgressQuerySchema, updateProgressSchema } from './progress.validators.js';
function auth(req: Request) { if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'); return req.auth; }
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, input: unknown): T { const result = schema.safeParse(input); if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', result.error.issues); return result.data; }
export const progressController = {
  async create(req: Request, res: Response) { const data = await attendanceProgressService.createProgress(auth(req), req, parse(createProgressSchema, req.body)); res.status(201).json({ success: true, message: 'Course progress created', data }); },
  async list(req: Request, res: Response) { const q = parse(progressListSchema, req.query); const data = await attendanceProgressService.listProgress(auth(req), q.studentId, q.courseId); res.json({ success: true, message: 'Course progress retrieved', data }); },
  async update(req: Request, res: Response) { const data = await attendanceProgressService.updateProgress(auth(req), req, parse(progressIdSchema, req.params.id), parse(updateProgressSchema, req.body)); res.json({ success: true, message: 'Course progress updated', data }); },
  async history(req: Request, res: Response) { const data = await attendanceProgressService.progressHistory(auth(req), parse(progressIdSchema, req.params.studentId)); res.json({ success: true, message: 'Progress history retrieved', data }); },
  async stalled(req: Request, res: Response) { const q = parse(stalledProgressQuerySchema, req.query); const data = await attendanceProgressService.stalledProgress(auth(req), q.days, q.courseId); res.json({ success: true, message: 'Stalled progress retrieved', data }); }
};
