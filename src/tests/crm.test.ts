import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findDuplicates: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn(), list: vi.fn(), sourceExists: vi.fn(), activeUserExists: vi.fn(),
  funnelBy: vi.fn(), createActivity: vi.fn(), createFollowUp: vi.fn(), createCounselling: vi.fn(), audit: vi.fn(), transaction: vi.fn()
}));
vi.mock('../repositories/lead.repository.js', () => ({ leadRepository: mocks }));
vi.mock('../services/audit.service.js', () => ({ AuditService: { record: mocks.audit } }));
vi.mock('../utils/transaction.js', () => ({ inTransaction: mocks.transaction }));

import { leadService } from '../services/lead.service.js';
import type { AuthenticatedUser } from '../types/auth.js';

const auth: AuthenticatedUser = { objectId: '64b000000000000000000001', userId: 'SN-USR-2026-00001', instituteId: '64b000000000000000000002', instituteBusinessId: 'SN-INS-2026-00001', name: 'Test', role: 'OWNER_ADMIN', authVersion: 0 };
const req = { correlationId: 'req-1', ip: '127.0.0.1', header: () => undefined } as never;
const baseLead = { _id: '64b000000000000000000003', leadId: 'SN-LEAD-2026-00001', instituteId: auth.instituteId, name: 'A', mobile: '+919876543210', email: undefined, sourceId: 'source-1', status: 'NEW', assignmentHistory: [], assignedTo: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((work) => work({}));
  mocks.findDuplicates.mockResolvedValue([]);
  mocks.sourceExists.mockResolvedValue(true);
  mocks.activeUserExists.mockResolvedValue(true);
  mocks.audit.mockResolvedValue({});
});

describe('CRM leads', () => {
  it('blocks duplicate mobile or email and returns possible matches', async () => {
    mocks.findDuplicates.mockResolvedValue([{ leadId: baseLead.leadId, name: 'Existing', mobile: '+919876543210', status: 'NEW' }]);
    await expect(leadService.create(auth, req, { name: 'New', mobile: '+91 98765 43210' })).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_LEAD', errors: [{ leadId: baseLead.leadId }] });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('normalizes contact values, persists tenant scope, and audits create', async () => {
    mocks.create.mockResolvedValue({ ...baseLead, mobile: '+919876543210' });
    await leadService.create(auth, req, { name: 'A', mobile: '+91 98765 43210', email: 'A@EXAMPLE.COM' });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ instituteId: auth.instituteId, mobile: '+919876543210', email: 'a@example.com' }), expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.create', entityId: baseLead.leadId, instituteId: auth.instituteId, actorUserId: auth.objectId }));
  });

  it('returns 404 for leads outside the authenticated institute', async () => {
    mocks.findById.mockResolvedValue(null);
    await expect(leadService.get(auth, 'other')).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.findById).toHaveBeenCalledWith(auth.instituteId, 'other');
  });

  it('preserves immutable lead and source ids during conversion', async () => {
    mocks.findById.mockResolvedValue(baseLead);
    mocks.update.mockResolvedValue({ ...baseLead, status: 'ADMISSION' });
    await leadService.update(auth, req, baseLead.leadId, { status: 'ADMISSION' });
    const update = mocks.update.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(update).not.toHaveProperty('leadId');
    expect(update).not.toHaveProperty('sourceId');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.convert', entityId: baseLead.leadId }));
  });

  it('tracks reassignment history and requires assignment permission', async () => {
    mocks.findById.mockResolvedValue({ ...baseLead, assignedTo: '64b000000000000000000004' });
    mocks.update.mockResolvedValue(baseLead);
    await leadService.update(auth, req, baseLead.leadId, { assignedTo: '64b000000000000000000005', reason: 'Balance workload' });
    expect(mocks.update.mock.calls[0]?.[2]).toHaveProperty('assignmentHistory');
    const counsellor = { ...auth, role: 'TEACHER' };
    await expect(leadService.update(counsellor, req, baseLead.leadId, { assignedTo: null })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('records counselling activity and creates the linked counselling record', async () => {
    mocks.findById.mockResolvedValue(baseLead);
    mocks.createActivity.mockResolvedValue({ activityId: 'SN-ACT-1' });
    await leadService.addActivity(auth, req, baseLead.leadId, { type: 'COUNSELLING', summary: 'Course guidance' });
    expect(mocks.createCounselling).toHaveBeenCalledWith(expect.objectContaining({ leadId: baseLead.leadId, status: 'COMPLETED' }), expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'counselling.create' }));
  });

  it('schedules follow-ups for active tenant users and audits them', async () => {
    mocks.findById.mockResolvedValue(baseLead);
    mocks.createFollowUp.mockResolvedValue({ followUpId: 'SN-FUP-1' });
    mocks.update.mockResolvedValue({ ...baseLead, status: 'FOLLOW_UP' });
    await leadService.addFollowUp(auth, req, baseLead.leadId, { scheduledAt: new Date(Date.now() + 3600000) });
    expect(mocks.createFollowUp).toHaveBeenCalledWith(expect.objectContaining({ instituteId: auth.instituteId, assignedTo: auth.objectId }), expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'followup.create' }));
  });

  it('scopes listings and funnel dimensions to the caller institute', async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0 });
    mocks.funnelBy.mockResolvedValue([]);
    await leadService.list(auth, { page: 2, limit: 10, sortBy: 'createdAt', sortOrder: 'desc', missedFollowUp: true });
    await leadService.funnel(auth, 'counsellor');
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ instituteId: auth.instituteId, missedFollowUp: true }));
    expect(mocks.funnelBy).toHaveBeenCalledWith(auth.instituteId, 'assignedTo');
  });
});
