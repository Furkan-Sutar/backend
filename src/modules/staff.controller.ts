import type { Request, Response } from 'express';
import { z } from 'zod';
import { staffService } from '../services/staff.service.js';
import { ApiError } from '../utils/api-error.js';
const id = z.string().trim().min(1).max(100);
const contact = z.object({ email: z.string().email().max(254).optional(), mobile: z.string().trim().min(7).max(30).optional(), address: z.string().trim().max(500).optional() }).strict().refine((value) => Boolean(value.email || value.mobile), 'At least an email or mobile number is required');
const line = z.object({ label: z.string().trim().min(1).max(160), amount: z.number().min(0), direction: z.enum(['ADD', 'SUBTRACT']).optional() }).strict();
const compensation = z.object({ currency: z.string().trim().length(3).default('INR'), payFrequency: z.enum(['MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY', 'CONTRACT']).default('MONTHLY'), grossBase: z.number().min(0), adjustments: z.array(line).default([]), deductions: z.array(z.object({ label: z.string().trim().min(1).max(160), amount: z.number().min(0) }).strict()).default([]) }).strict();
const documentLink = z.object({ evidenceId: z.string().trim().min(1).max(40) }).strict();
const createSchema = z.object({ userId: id.optional(), name: z.string().trim().min(1).max(160), contact, role: z.string().trim().min(1).max(80), joiningDate: z.coerce.date(), status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED']).default('ACTIVE'), compensationConfiguration: compensation.optional() }).strict();
const updateSchema = createSchema.partial().omit({ joiningDate: true }).extend({ joiningDate: z.coerce.date().optional(), documents: z.array(documentLink).optional() }).strict();
const assignmentSchema = z.object({ courseId: id, batchId: id }).strict(); const collectionSchema = z.object({ studentId: id, admissionId: id.optional() }).strict();
const listSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED']).optional(), role: z.string().trim().max(80).optional(), search: z.string().trim().max(100).optional() }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', result.error.issues); return result.data; }
function auth(req: Request) { if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'); return req.auth; }
export const staffController = {
  async list(req: Request, res: Response) { const query = parse(listSchema, req.query); res.json({ success: true, data: await staffService.list(auth(req), { page: query.page ?? 1, limit: query.limit ?? 25, ...(query.status ? { status: query.status } : {}), ...(query.role ? { role: query.role } : {}), ...(query.search ? { search: query.search } : {}) }) }); },
  async create(req: Request, res: Response) { res.status(201).json({ success: true, data: await staffService.create(auth(req), req, parse(createSchema, req.body)) }); },
  async get(req: Request, res: Response) { res.json({ success: true, data: await staffService.get(auth(req), String(req.params.id)) }); },
  async update(req: Request, res: Response) { res.json({ success: true, data: await staffService.update(auth(req), req, String(req.params.id), parse(updateSchema, req.body)) }); },
  async contributions(req: Request, res: Response) { res.json({ success: true, data: await staffService.contributions(auth(req), String(req.params.id)) }); },
  async teachingAssignments(req: Request, res: Response) { res.json({ success: true, data: await staffService.teachingAssignments(auth(req), String(req.params.id)) }); },
  async assignTeaching(req: Request, res: Response) { res.status(201).json({ success: true, data: await staffService.assignTeaching(auth(req), req, String(req.params.id), parse(assignmentSchema, req.body)) }); },
  async collectionResponsibilities(req: Request, res: Response) { res.json({ success: true, data: await staffService.collectionResponsibilities(auth(req), String(req.params.id)) }); },
  async assignCollection(req: Request, res: Response) { const input = parse(collectionSchema, req.body); res.status(201).json({ success: true, data: await staffService.assignCollection(auth(req), req, String(req.params.id), { studentId: input.studentId, ...(input.admissionId ? { admissionId: input.admissionId } : {}) }) }); }
};
