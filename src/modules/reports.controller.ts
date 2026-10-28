import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { reportsService, type ReportFilters } from '../services/reports.service.js';
import { ApiError } from '../utils/api-error.js';

const filterSchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), courseId: z.string().trim().min(1).max(100).optional(), batchId: z.string().trim().min(1).max(100).optional(), staffId: z.string().trim().min(1).max(100).optional(), sourceId: z.string().trim().min(1).max(100).optional(), accountId: z.string().trim().min(1).max(100).optional(), includeDetails: z.enum(['true', 'false']).optional() }).strict();
const costAllocationSchema = z.object({ courseId: z.string().refine(Types.ObjectId.isValid), batchId: z.string().refine(Types.ObjectId.isValid).optional(), staffId: z.string().refine(Types.ObjectId.isValid).optional(), costType: z.enum(['TEACHER_ALLOCATION', 'MARKETING_ALLOCATION', 'COURSE_EXPENSE']), costBehavior: z.enum(['FIXED', 'VARIABLE']), amount: z.number().finite().positive(), sourceType: z.enum(['EXPENSE', 'SALARY_PAYMENT']), sourceObjectId: z.string().refine(Types.ObjectId.isValid), allocationPeriod: z.coerce.date(), note: z.string().trim().max(500).optional() }).strict();
const profitabilityPolicySchema = z.object({ revenueBasis: z.enum(['BILLED_FEES', 'NET_POSTED_PAYMENTS']) }).strict();
function auth(req: Request) { if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'); return req.auth; }
function filters(req: Request): ReportFilters {
  const result = filterSchema.safeParse(req.query);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Report filters are invalid', result.error.issues);
  const data = result.data;
  if (data.from && data.to && data.from > data.to) throw new ApiError(400, 'INVALID_DATE_RANGE', 'from must be on or before to');
  for (const key of ['courseId', 'batchId', 'staffId', 'sourceId', 'accountId'] as const) {
    const value = data[key];
    if (value && !Types.ObjectId.isValid(value)) throw new ApiError(400, 'INVALID_REPORT_FILTER', `${key} must be a MongoDB object ID`);
  }
  return { ...(data.from ? { from: data.from } : {}), ...(data.to ? { to: data.to } : {}), ...(data.courseId ? { courseId: data.courseId } : {}), ...(data.batchId ? { batchId: data.batchId } : {}), ...(data.staffId ? { staffId: data.staffId } : {}), ...(data.sourceId ? { sourceId: data.sourceId } : {}), ...(data.accountId ? { accountId: data.accountId } : {}), includeDetails: data.includeDetails === 'true' };
}
export const reportsController = {
  async dashboard(req: Request, res: Response) { res.json({ success: true, data: await reportsService.dashboard(auth(req), filters(req)) }); },
  async revenue(req: Request, res: Response) { res.json({ success: true, data: await reportsService.revenue(auth(req), filters(req)) }); },
  async expenses(req: Request, res: Response) { res.json({ success: true, data: await reportsService.expenses(auth(req), filters(req)) }); },
  async pnl(req: Request, res: Response) { res.json({ success: true, data: await reportsService.pnl(auth(req), filters(req)) }); },
  async cashFlow(req: Request, res: Response) { res.json({ success: true, data: await reportsService.cashFlow(auth(req), filters(req)) }); },
  async courseProfitability(req: Request, res: Response) { res.json({ success: true, data: await reportsService.courseProfitability(auth(req), filters(req)) }); },
  async courseCostAllocations(req: Request, res: Response) { res.json({ success: true, data: await reportsService.listCourseCostAllocations(auth(req), filters(req)) }); },
  async allocateCourseCost(req: Request, res: Response) { const parsed = costAllocationSchema.safeParse(req.body); if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Course cost allocation is invalid', parsed.error.issues); res.status(201).json({ success: true, data: await reportsService.allocateCourseCost(req, auth(req), parsed.data) }); },
  async profitabilityPolicy(req: Request, res: Response) { res.json({ success: true, data: await reportsService.getCourseProfitabilityPolicy(auth(req)) }); },
  async updateProfitabilityPolicy(req: Request, res: Response) { const parsed = profitabilityPolicySchema.safeParse(req.body); if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Course profitability policy is invalid', parsed.error.issues); res.json({ success: true, data: await reportsService.setCourseProfitabilityPolicy(req, auth(req), parsed.data.revenueBasis) }); },
  async crm(req: Request, res: Response) { res.json({ success: true, data: await reportsService.crm(auth(req), filters(req)) }); },
  async admissions(req: Request, res: Response) { res.json({ success: true, data: await reportsService.admissions(auth(req), filters(req)) }); },
  async students(req: Request, res: Response) { res.json({ success: true, data: await reportsService.students(auth(req), filters(req)) }); },
  async attendance(req: Request, res: Response) { res.json({ success: true, data: await reportsService.attendance(auth(req), filters(req)) }); },
  async staff(req: Request, res: Response) { res.json({ success: true, data: await reportsService.staff(auth(req), filters(req)) }); }
};
