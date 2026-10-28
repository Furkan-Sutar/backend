import type { Request, Response } from 'express';
import { ApiError } from '../../utils/api-error.js';
import { studentAdmissionService } from '../../services/student-admission.service.js';
import { createStudentSchema, studentIdSchema, studentListSchema, updateStudentSchema } from './student.validators.js';
function auth(req: Request) { if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'); return req.auth; }
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, input: unknown): T { const result = schema.safeParse(input); if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', result.error.issues); return result.data; }
export const studentController = {
  async list(req: Request, res: Response) { const query = parse(studentListSchema, req.query); const result = await studentAdmissionService.listStudents(auth(req), query.page, query.limit, query.status, query.search); res.json({ success: true, message: 'Students retrieved', data: result.items, meta: { page: query.page, limit: query.limit, total: result.total, pages: Math.ceil(result.total / query.limit) } }); },
  async create(req: Request, res: Response) { const data = await studentAdmissionService.createStudent(auth(req), req, parse(createStudentSchema, req.body)); res.status(201).json({ success: true, message: 'Student created', data }); },
  async get(req: Request, res: Response) { const data = await studentAdmissionService.getStudent(auth(req), parse(studentIdSchema, req.params.id)); res.json({ success: true, message: 'Student retrieved', data }); },
  async update(req: Request, res: Response) { const data = await studentAdmissionService.updateStudent(auth(req), req, parse(studentIdSchema, req.params.id), parse(updateStudentSchema, req.body)); res.json({ success: true, message: 'Student updated', data }); },
  async finance(req: Request, res: Response) { const data = await studentAdmissionService.studentFinance(auth(req), parse(studentIdSchema, req.params.id)); res.json({ success: true, message: 'Student finance retrieved', data }); }
};
