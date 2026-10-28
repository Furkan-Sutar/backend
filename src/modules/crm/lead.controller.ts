import type { Request, Response } from 'express';
import { leadService } from '../../services/lead.service.js';
import { createActivitySchema, createFollowUpSchema, createLeadSchema, funnelSchema, leadIdSchema, leadListSchema, updateLeadSchema } from './lead.validators.js';
import { ApiError } from '../../utils/api-error.js';
import type { LeadListQuery } from '../../repositories/lead.repository.js';

function auth(req: Request) {
  if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
  return req.auth;
}
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', result.error.issues);
  return result.data;
}

export const leadController = {
  async list(req: Request, res: Response) {
    const query = parse(leadListSchema, req.query);
    const result = await leadService.list(auth(req), Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as Omit<LeadListQuery, 'instituteId'>);
    res.json({ success: true, message: 'Leads retrieved', data: result.items, meta: { page: query.page, limit: query.limit, total: result.total, pages: Math.ceil(result.total / query.limit) } });
  },
  async create(req: Request, res: Response) {
    const data = await leadService.create(auth(req), req, parse(createLeadSchema, req.body));
    res.status(201).json({ success: true, message: 'Lead created', data });
  },
  async get(req: Request, res: Response) {
    const id = parse(leadIdSchema, req.params.id);
    const data = await leadService.get(auth(req), id);
    res.json({ success: true, message: 'Lead retrieved', data });
  },
  async update(req: Request, res: Response) {
    const id = parse(leadIdSchema, req.params.id);
    const data = await leadService.update(auth(req), req, id, parse(updateLeadSchema, req.body));
    res.json({ success: true, message: 'Lead updated', data });
  },
  async activity(req: Request, res: Response) {
    const id = parse(leadIdSchema, req.params.id);
    const data = await leadService.addActivity(auth(req), req, id, parse(createActivitySchema, req.body));
    res.status(201).json({ success: true, message: 'Lead activity recorded', data });
  },
  async followUp(req: Request, res: Response) {
    const id = parse(leadIdSchema, req.params.id);
    const data = await leadService.addFollowUp(auth(req), req, id, parse(createFollowUpSchema, req.body));
    res.status(201).json({ success: true, message: 'Follow-up scheduled', data });
  },
  async funnel(req: Request, res: Response) {
    const { by } = parse(funnelSchema, req.query);
    const data = await leadService.funnel(auth(req), by);
    res.json({ success: true, message: 'Lead funnel retrieved', data });
  }
};
