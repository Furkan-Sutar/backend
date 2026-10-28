import mongoose from 'mongoose';
import { AuditService } from './audit.service.js';
import { leadRepository, type LeadListQuery } from '../repositories/lead.repository.js';
import { ApiError } from '../utils/api-error.js';
import { inTransaction } from '../utils/transaction.js';
import { auditRequestMetadata } from '../utils/audit-request.js';
import { ROLE_PERMISSIONS, type Permission } from '../types/rbac.js';
import type { AuthenticatedUser } from '../types/auth.js';
import type { Request } from 'express';
import type { RecordAuditInput } from './audit.service.js';
import { ALLOWED_LEAD_TRANSITIONS } from '../modules/crm/lead.constants.js';

type Auth = AuthenticatedUser;
const fail = (status: number, code: string, message: string) => new ApiError(status, code, message);
function requirePerm(auth: Auth, permission: Permission) {
  if (!ROLE_PERMISSIONS[auth.role].includes(permission)) throw fail(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to perform this action');
}
function normalizeMobile(value: string) {
  const cleaned = value.trim().replace(/[\s().-]/g, '');
  const digits = cleaned.replace(/^\+/, '');
  if (!/^\d{7,15}$/.test(digits)) throw fail(422, 'INVALID_MOBILE', 'Mobile number must contain 7 to 15 digits');
  return `${cleaned.startsWith('+') ? '+' : ''}${digits}`;
}
function safeMatch(match: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(match).filter(([key]) => ['leadId', 'name', 'mobile', 'email', 'status', 'priority', 'sourceId', 'assignedTo', 'interestedCourseId', 'enquiryDate'].includes(key)));
}
async function assertNoDuplicate(instituteId: string, mobile: string, email?: string, excludeId?: string, session?: mongoose.ClientSession) {
  const matches = await leadRepository.findDuplicates(instituteId, mobile, email?.toLowerCase(), excludeId, session);
  if (matches.length) throw new ApiError(409, 'DUPLICATE_LEAD', 'A lead with this mobile number or email already exists', matches.map((item) => safeMatch(item as unknown as Record<string, unknown>)));
}
async function assertSource(instituteId: string, sourceId?: string, session?: mongoose.ClientSession) {
  if (sourceId && !(await leadRepository.sourceExists(instituteId, sourceId, session))) throw fail(422, 'INVALID_SOURCE', 'Lead source is unavailable in this institute');
}
async function assertAssignee(instituteId: string, userId: string | null | undefined, session?: mongoose.ClientSession) {
  if (userId && !(await leadRepository.activeUserExists(instituteId, userId, session))) throw fail(422, 'INVALID_ASSIGNEE', 'Assignee must be an active user in this institute');
}
function audit(request: Request, auth: Auth, input: Omit<RecordAuditInput, 'instituteId' | 'actorUserId' | 'request'>) {
  return AuditService.record({ ...input, instituteId: auth.instituteId, actorUserId: auth.objectId, request: auditRequestMetadata(request) });
}

export const leadService = {
  list(auth: Auth, query: Omit<LeadListQuery, 'instituteId'>) {
    requirePerm(auth, 'lead.view');
    return leadRepository.list({ ...query, instituteId: auth.instituteId });
  },
  async get(auth: Auth, id: string) {
    requirePerm(auth, 'lead.view');
    const lead = await leadRepository.findById(auth.instituteId, id);
    if (!lead) throw fail(404, 'LEAD_NOT_FOUND', 'Lead was not found');
    return lead;
  },
  async create(auth: Auth, request: Request, input: Record<string, any>) {
    requirePerm(auth, 'lead.create');
    if (input.assignedTo) requirePerm(auth, 'lead.assign');
    const mobile = normalizeMobile(input.mobile);
    try {
      return await inTransaction(async (session) => {
        await assertNoDuplicate(auth.instituteId, mobile, input.email, undefined, session);
        await assertSource(auth.instituteId, input.sourceId, session);
        await assertAssignee(auth.instituteId, input.assignedTo, session);
        const lead = await leadRepository.create({ ...input, mobile, email: input.email?.toLowerCase(), instituteId: auth.instituteId, createdBy: auth.objectId, updatedBy: auth.objectId,
          ...(input.assignedTo ? { assignmentHistory: [{ toUserId: input.assignedTo, assignedBy: auth.objectId, assignedAt: new Date() }] } : {}) }, session);
        await audit(request, auth, { action: 'lead.create', entityType: 'Lead', entityId: lead.leadId, after: lead, session });
        return lead;
      });
    } catch (error) { return rethrowDuplicate(error, auth.instituteId, mobile, input.email); }
  },
  async update(auth: Auth, request: Request, id: string, input: Record<string, any>) {
    requirePerm(auth, 'lead.update');
    if (Object.hasOwn(input, 'assignedTo')) requirePerm(auth, 'lead.assign');
    if (input.status === 'ADMISSION') requirePerm(auth, 'lead.convert');
    return inTransaction(async (session) => {
      const before = await leadRepository.findById(auth.instituteId, id, session);
      if (!before) throw fail(404, 'LEAD_NOT_FOUND', 'Lead was not found');
      if (input.status && input.status !== before.status && !ALLOWED_LEAD_TRANSITIONS[before.status as keyof typeof ALLOWED_LEAD_TRANSITIONS].includes(input.status)) throw fail(422, 'INVALID_STATUS_TRANSITION', `Cannot change lead status from ${before.status} to ${input.status}`);
      if (input.mobile || input.email) await assertNoDuplicate(auth.instituteId, normalizeMobile(input.mobile ?? before.mobile), input.email ?? before.email, String(before._id), session);
      if (Object.hasOwn(input, 'assignedTo')) await assertAssignee(auth.instituteId, input.assignedTo, session);
      const update: Record<string, unknown> = { ...input, updatedBy: auth.objectId };
      delete update.reason;
      if (input.mobile) update.mobile = normalizeMobile(input.mobile);
      if (input.email) update.email = input.email.toLowerCase();
      const assignmentChanged = Object.hasOwn(input, 'assignedTo') && String(input.assignedTo ?? '') !== String(before.assignedTo ?? '');
      if (assignmentChanged) update.assignmentHistory = [...(before.assignmentHistory ?? []), { ...(before.assignedTo ? { fromUserId: before.assignedTo } : {}), ...(input.assignedTo ? { toUserId: input.assignedTo } : {}), assignedBy: auth.objectId, assignedAt: new Date(), ...(input.reason ? { reason: input.reason } : {}) }];
      const after = await leadRepository.update(String(before._id), auth.instituteId, update, session);
      const action = input.status === 'ADMISSION' ? 'lead.convert' : assignmentChanged ? 'lead.assign' : 'lead.update';
      await audit(request, auth, { action, entityType: 'Lead', entityId: before.leadId, before, after, ...(input.reason ? { reason: input.reason } : {}), session });
      return after;
    });
  },
  async addActivity(auth: Auth, request: Request, id: string, input: Record<string, any>) {
    requirePerm(auth, 'lead.update');
    return inTransaction(async (session) => {
      const lead = await leadRepository.findById(auth.instituteId, id, session);
      if (!lead) throw fail(404, 'LEAD_NOT_FOUND', 'Lead was not found');
      const activity = await leadRepository.createActivity({ ...input, instituteId: auth.instituteId, leadObjectId: lead._id, leadId: lead.leadId, createdBy: auth.objectId }, session);
      if (['CALL', 'WHATSAPP', 'SMS', 'EMAIL', 'VISIT'].includes(input.type)) await leadRepository.update(String(lead._id), auth.instituteId, { lastContactedAt: input.occurredAt ?? new Date(), updatedBy: auth.objectId }, session);
      if (input.type === 'COUNSELLING') await leadRepository.createCounselling({ instituteId: auth.instituteId, leadObjectId: lead._id, leadId: lead.leadId, counsellorId: auth.objectId, scheduledAt: input.occurredAt ?? new Date(), status: 'COMPLETED', notes: input.summary, createdBy: auth.objectId }, session);
      await audit(request, auth, { action: input.type === 'COUNSELLING' ? 'counselling.create' : 'lead.update', entityType: 'LeadActivity', entityId: activity.activityId, after: activity, session });
      return activity;
    });
  },
  async addFollowUp(auth: Auth, request: Request, id: string, input: Record<string, any>) {
    requirePerm(auth, 'lead.update');
    const assignedTo = input.assignedTo;
    if (assignedTo) requirePerm(auth, 'lead.assign');
    if (input.scheduledAt <= new Date()) throw fail(422, 'INVALID_FOLLOW_UP_DATE', 'Follow-up must be scheduled in the future');
    return inTransaction(async (session) => {
      const lead = await leadRepository.findById(auth.instituteId, id, session);
      if (!lead) throw fail(404, 'LEAD_NOT_FOUND', 'Lead was not found');
      if (['ADMISSION', 'NOT_INTERESTED', 'LOST'].includes(lead.status)) throw fail(422, 'FOLLOW_UP_NOT_ALLOWED', 'Follow-up cannot be scheduled for a closed lead');
      const owner = assignedTo ?? lead.assignedTo ?? auth.objectId;
      if (String(owner) !== String(lead.assignedTo ?? '')) requirePerm(auth, 'lead.assign');
      await assertAssignee(auth.instituteId, String(owner), session);
      const followUp = await leadRepository.createFollowUp({ instituteId: auth.instituteId, leadObjectId: lead._id, leadId: lead.leadId, assignedTo: owner, scheduledAt: input.scheduledAt, notes: input.notes, createdBy: auth.objectId }, session);
      const after = await leadRepository.update(String(lead._id), auth.instituteId, { status: 'FOLLOW_UP', nextFollowUpAt: input.scheduledAt, updatedBy: auth.objectId }, session);
      await audit(request, auth, { action: 'followup.create', entityType: 'FollowUp', entityId: followUp.followUpId, before: lead, after: { followUp, lead: after }, session });
      return followUp;
    });
  },
  async funnel(auth: Auth, by: 'source' | 'counsellor' | 'course') {
    requirePerm(auth, 'report.view');
    const dimension = { source: 'sourceId', counsellor: 'assignedTo', course: 'interestedCourseId' }[by] as 'sourceId' | 'assignedTo' | 'interestedCourseId';
    return leadRepository.funnelBy(auth.instituteId, dimension);
  }
};

async function rethrowDuplicate(error: unknown, instituteId: string, mobile: string, email?: string): Promise<never> {
  if (error && typeof error === 'object' && 'code' in error && error.code === 11000) await assertNoDuplicate(instituteId, mobile, email);
  throw error;
}
