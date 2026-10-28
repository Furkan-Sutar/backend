import type { Request, Response } from 'express';
import { ApiError } from '../../utils/api-error.js';
import { studentAdmissionService } from '../../services/student-admission.service.js';
import { admissionIdSchema, admissionListSchema, createAdmissionSchema, updateAdmissionSchema } from './admission.validators.js';

function auth(req: Request) { if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'); return req.auth; }
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, input: unknown): T { const result = schema.safeParse(input); if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', result.error.issues); return result.data; }
export const admissionController = {
  async list(req: Request, res: Response) { const query = parse(admissionListSchema, req.query); const result = await studentAdmissionService.listAdmissions(auth(req), query.page, query.limit, query.status); res.json({ success: true, message: 'Admissions retrieved', data: result.items, meta: { page: query.page, limit: query.limit, total: result.total, pages: Math.ceil(result.total / query.limit) } }); },
  async create(req: Request, res: Response) { const data = await studentAdmissionService.createAdmission(auth(req), req, parse(createAdmissionSchema, req.body)); res.status(201).json({ success: true, message: 'Admission created', data }); },
  async get(req: Request, res: Response) { const id = parse(admissionIdSchema, req.params.id); const data = await studentAdmissionService.getAdmission(auth(req), id); res.json({ success: true, message: 'Admission retrieved', data }); },
  async update(req: Request, res: Response) { const id = parse(admissionIdSchema, req.params.id); const data = await studentAdmissionService.updateAdmission(auth(req), req, id, parse(updateAdmissionSchema, req.body)); res.json({ success: true, message: 'Admission updated', data }); },
  async convert(req: Request, res: Response) { const id = parse(admissionIdSchema, req.params.id); const data = await studentAdmissionService.convertAdmission(auth(req), req, id); res.status(201).json({ success: true, message: 'Admission converted to student', data }); }
};
