import { z } from 'zod';
import { LEAD_ACTIVITY_TYPES, LEAD_PRIORITIES, LEAD_STATUSES } from './lead.constants.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid record ID');
const nullableObjectId = objectId.nullable();

export const createLeadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  mobile: z.string().trim().min(7).max(24),
  email: z.string().trim().email().max(254).optional(),
  education: z.string().trim().max(160).optional(),
  interestedCourseId: objectId.optional(),
  sourceId: objectId.optional(),
  assignedTo: objectId.optional(),
  priority: z.enum(LEAD_PRIORITIES).default('NORMAL'),
  enquiryDate: z.coerce.date().optional(),
  notes: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([])
}).strict();

export const updateLeadSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  mobile: z.string().trim().min(7).max(24).optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  education: z.string().trim().max(160).nullable().optional(),
  interestedCourseId: nullableObjectId.optional(),
  assignedTo: nullableObjectId.optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).optional(),
  reason: z.string().trim().max(500).optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'reason'), 'At least one lead field must be changed');

export const createActivitySchema = z.object({
  type: z.enum(LEAD_ACTIVITY_TYPES),
  summary: z.string().trim().min(1).max(1000),
  outcome: z.string().trim().max(1000).optional(),
  occurredAt: z.coerce.date().optional()
}).strict();

export const createFollowUpSchema = z.object({
  assignedTo: objectId.optional(),
  scheduledAt: z.coerce.date(),
  notes: z.string().trim().max(1000).optional()
}).strict();

export const leadListSchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  sourceId: objectId.optional(),
  assignedTo: objectId.optional(),
  interestedCourseId: objectId.optional(),
  missedFollowUp: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'enquiryDate', 'nextFollowUpAt', 'name', 'priority']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
}).strict();

export const leadIdSchema = z.string().trim().min(1).max(100);
export const funnelSchema = z.object({ by: z.enum(['source', 'counsellor', 'course']) }).strict();
