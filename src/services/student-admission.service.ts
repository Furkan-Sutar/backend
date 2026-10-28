import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { ClientSession } from 'mongoose';
import type { AuthenticatedUser } from '../types/auth.js';
import { ROLE_PERMISSIONS, type Permission } from '../types/rbac.js';
import { ApiError } from '../utils/api-error.js';
import { auditRequestMetadata } from '../utils/audit-request.js';
import { inTransaction } from '../utils/transaction.js';
import { AuditService } from './audit.service.js';
import { admissionRepository } from '../repositories/admission.repository.js';
import { studentRepository } from '../repositories/student.repository.js';
import { StaffModel } from '../models/staff.model.js';

type Auth = AuthenticatedUser;
const bad = (status: number, code: string, message: string, errors: unknown[] = []) => new ApiError(status, code, message, errors);
function permission(auth: Auth, key: Permission) { if (!ROLE_PERMISSIONS[auth.role].includes(key)) throw bad(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to perform this action'); }
function mobile(value?: string | null) {
  if (!value) return undefined;
  const clean = value.trim().replace(/[\s().-]/g, '');
  const digits = clean.replace(/^\+/, '');
  if (!/^\d{7,15}$/.test(digits)) throw bad(422, 'INVALID_MOBILE', 'Mobile number must contain 7 to 15 digits');
  return `${clean.startsWith('+') ? '+' : ''}${digits}`;
}
function identityFingerprint(type?: string, number?: string) {
  if (!number) return undefined;
  return createHash('sha256').update(`${(type ?? 'OTHER').trim().toUpperCase()}:${number.trim().replace(/\s/g, '').toUpperCase()}`).digest('hex');
}
function audit(req: Request, auth: Auth, input: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason?: string; session: ClientSession }) {
  return AuditService.record({ ...input, instituteId: auth.instituteId, actorUserId: auth.objectId, request: auditRequestMetadata(req), session: input.session });
}
function safeDuplicate(match: Record<string, unknown>) { return Object.fromEntries(Object.entries(match).filter(([key]) => ['studentId', 'name', 'mobile', 'email', 'status'].includes(key))); }
async function assertNoDuplicate(auth: Auth, data: { identityType?: string; identityNumber?: string; mobile?: string | null | undefined; email?: string | null | undefined; excludeId?: string }, session?: ClientSession) {
  const matches = await studentRepository.findDuplicates(auth.instituteId, { identityFingerprint: identityFingerprint(data.identityType, data.identityNumber), mobile: mobile(data.mobile), email: data.email?.toLowerCase(), excludeId: data.excludeId }, session);
  if (matches.length) throw bad(409, 'DUPLICATE_STUDENT', 'A student with matching identity or contact details already exists', matches.map((item) => safeDuplicate(item as unknown as Record<string, unknown>)));
}
async function translateDuplicateKey(error: unknown, auth: Auth, data: { identityType?: string | undefined; identityNumber?: string | undefined; mobile?: string | null | undefined; email?: string | null | undefined }) : Promise<never> {
  if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
    const matches = await studentRepository.findDuplicates(auth.instituteId, { identityFingerprint: identityFingerprint(data.identityType, data.identityNumber), mobile: mobile(data.mobile), email: data.email?.toLowerCase() });
    if (matches.length) throw bad(409, 'DUPLICATE_STUDENT', 'A student with matching identity or contact details already exists', matches.map((item) => safeDuplicate(item as unknown as Record<string, unknown>)));
  }
  throw error;
}
async function validateReferences(auth: Auth, input: Record<string, any>, session: ClientSession) {
  const refs = await admissionRepository.validateReferences(auth.instituteId, String(input.courseId), String(input.batchId), String(input.feePlanId), session);
  if (!refs.course || !refs.batch || !refs.feePlan) throw bad(422, 'INVALID_ADMISSION_REFERENCE', 'Course, batch, and fee plan must be active records in this institute and match each other');
}
function sanitizeStudent(input: Record<string, any>) {
  const { identityNumber, ...safe } = input;
  return { ...safe, ...(identityNumber ? { identityNumber, identityFingerprint: identityFingerprint(input.identityType, identityNumber) } : {}), ...(input.mobile !== undefined ? { mobile: mobile(input.mobile) } : {}), ...(input.email ? { email: input.email.toLowerCase() } : {}) };
}

export const studentAdmissionService = {
  async listAdmissions(auth: Auth, page: number, limit: number, status?: string) {
    permission(auth, 'admission.view');
    return admissionRepository.list(auth.instituteId, page, limit, status);
  },
  async getAdmission(auth: Auth, id: string) {
    permission(auth, 'admission.view');
    const admission = await admissionRepository.findById(auth.instituteId, id);
    if (!admission) throw bad(404, 'ADMISSION_NOT_FOUND', 'Admission was not found');
    return admission;
  },
  async createAdmission(auth: Auth, req: Request, input: Record<string, any>) {
    permission(auth, 'admission.create');
    return inTransaction(async (session) => {
      const lead = await admissionRepository.findLead(auth.instituteId, input.leadId, session);
      if (!lead) throw bad(404, 'LEAD_NOT_FOUND', 'Lead was not found in this institute');
      if (lead.status === 'LOST') throw bad(409, 'LEAD_NOT_ELIGIBLE', 'A lost lead cannot start a new admission');
      await validateReferences(auth, input, session);
      const studentInput = input.student ?? {};
      const student = sanitizeStudent({ name: studentInput.name ?? lead.name, mobile: studentInput.mobile ?? lead.mobile, email: studentInput.email ?? lead.email, ...studentInput });
      await assertNoDuplicate(auth, student, session);
      const contributingStaff = await StaffModel.findOne({ instituteId: auth.instituteId, userId: auth.objectId, status: 'ACTIVE' }).select('_id').session(session);
      const admission = await admissionRepository.create({ instituteId: auth.instituteId, leadObjectId: lead._id, leadId: lead.leadId, sourceId: lead.sourceId, ...(contributingStaff ? { contributedByStaffId: contributingStaff._id } : {}), courseId: input.courseId, batchId: input.batchId, feePlanId: input.feePlanId, studentDetails: student, notes: input.notes, createdBy: auth.objectId, updatedBy: auth.objectId }, session);
      await audit(req, auth, { action: 'admission.create', entityType: 'Admission', entityId: String(admission.admissionId), after: admission, session });
      return admission;
    });
  },
  async updateAdmission(auth: Auth, req: Request, id: string, input: Record<string, any>) {
    permission(auth, 'admission.update');
    return inTransaction(async (session) => {
      const before = await admissionRepository.findById(auth.instituteId, id, session);
      if (!before) throw bad(404, 'ADMISSION_NOT_FOUND', 'Admission was not found');
      if (before.status !== 'PENDING') throw bad(409, 'ADMISSION_LOCKED', 'Only pending admissions can be updated');
      const update: Record<string, unknown> = { updatedBy: auth.objectId };
      if (input.student) {
        const merged = { ...(before.studentDetails as object), ...input.student } as Record<string, any>;
        const clean = sanitizeStudent(merged);
        await assertNoDuplicate(auth, clean, session);
        update.studentDetails = clean;
      }
      if (input.courseId || input.batchId || input.feePlanId) {
        const refs = { courseId: input.courseId ?? String(before.courseId), batchId: input.batchId ?? String(before.batchId), feePlanId: input.feePlanId ?? String(before.feePlanId) };
        await validateReferences(auth, refs, session);
        Object.assign(update, refs);
      }
      if (input.notes !== undefined) update.notes = input.notes;
      if (input.status) update.status = input.status;
      const after = await admissionRepository.update(String(before._id), auth.instituteId, update, session);
      await audit(req, auth, { action: 'admission.update', entityType: 'Admission', entityId: String(before.admissionId), before, after, session });
      return after;
    });
  },
  async convertAdmission(auth: Auth, req: Request, id: string) {
    permission(auth, 'admission.update');
    permission(auth, 'student.create');
    permission(auth, 'lead.convert');
    let duplicateProbe: { identityType?: string | undefined; identityNumber?: string | undefined; mobile?: string | null | undefined; email?: string | null | undefined } = {};
    try { return await inTransaction(async (session) => {
      const admission = await admissionRepository.findById(auth.instituteId, id, session);
      if (!admission) throw bad(404, 'ADMISSION_NOT_FOUND', 'Admission was not found');
      if (admission.status === 'CONVERTED' || admission.studentObjectId) throw bad(409, 'ADMISSION_ALREADY_CONVERTED', 'Admission has already been converted');
      if (admission.status !== 'PENDING') throw bad(409, 'ADMISSION_NOT_CONVERTIBLE', 'Only pending admissions can be converted');
      const details = admission.studentDetails as unknown as Record<string, any>;
      const studentInput = sanitizeStudent(details);
      duplicateProbe = details;
      await assertNoDuplicate(auth, studentInput, session);
      const student = await studentRepository.create({ ...studentInput, instituteId: auth.instituteId, status: 'ACTIVE', createdBy: auth.objectId, updatedBy: auth.objectId }, session);
      const guardians = await studentRepository.createGuardians((details.guardians ?? []).map((guardian: Record<string, unknown> & { toObject?: () => Record<string, unknown> }) => {
        const guardianData = typeof guardian.toObject === 'function' ? guardian.toObject() : guardian;
        return { ...guardianData, instituteId: auth.instituteId, studentId: student._id, mobile: mobile(String(guardianData.mobile)), createdBy: auth.objectId };
      }), session);
      const studentAfterGuardians = guardians.length ? await studentRepository.update(String(student._id), auth.instituteId, { guardianIds: guardians.map((guardian) => guardian._id) }, session) : student;
      const converted = await admissionRepository.update(String(admission._id), auth.instituteId, { status: 'CONVERTED', studentObjectId: student._id, convertedAt: new Date(), updatedBy: auth.objectId }, session);
      const lead = await admissionRepository.findLead(auth.instituteId, String(admission.leadId), session);
      if (!lead) throw bad(409, 'ADMISSION_LEAD_MISSING', 'Original lead could not be found');
      const leadBefore = lead.toObject();
      lead.status = 'ADMISSION';
      lead.updatedBy = auth.objectId as never;
      await lead.save({ session });
      await audit(req, auth, { action: 'student.create', entityType: 'Student', entityId: String(student.studentId), after: studentAfterGuardians, session });
      await audit(req, auth, { action: 'admission.update', entityType: 'Admission', entityId: String(admission.admissionId), before: admission, after: converted, session });
      await audit(req, auth, { action: 'lead.convert', entityType: 'Lead', entityId: String(admission.leadId), before: leadBefore, after: lead.toObject(), session });
      return { admission: converted, student: studentAfterGuardians };
    }); } catch (error) { return translateDuplicateKey(error, auth, duplicateProbe); }
  },
  async listStudents(auth: Auth, page: number, limit: number, status?: string, search?: string) {
    permission(auth, 'student.view');
    return studentRepository.list(auth.instituteId, page, limit, status, search, auth.role === 'STUDENT' ? auth.objectId : undefined);
  },
  async getStudent(auth: Auth, id: string) {
    permission(auth, 'student.view');
    const student = await studentRepository.findById(auth.instituteId, id, undefined, auth.role === 'STUDENT' ? auth.objectId : undefined);
    if (!student) throw bad(404, 'STUDENT_NOT_FOUND', 'Student was not found');
    return student;
  },
  async createStudent(auth: Auth, req: Request, input: Record<string, any>) {
    permission(auth, 'student.create');
    if (input.userId) { permission(auth, 'user.update'); if (!(await studentRepository.userExists(auth.instituteId, input.userId))) throw bad(422, 'INVALID_STUDENT_USER', 'Linked account must be an active student user in this institute'); }
    if (input.status === 'ARCHIVED') permission(auth, 'student.archive');
    try { return await inTransaction(async (session) => {
      const clean = sanitizeStudent(input);
      await assertNoDuplicate(auth, clean, session);
      const student = await studentRepository.create({ ...clean, instituteId: auth.instituteId, createdBy: auth.objectId, updatedBy: auth.objectId }, session);
      const guardians = await studentRepository.createGuardians((input.guardians ?? []).map((guardian: Record<string, unknown>) => ({ ...guardian, instituteId: auth.instituteId, studentId: student._id, mobile: mobile(String(guardian.mobile)), createdBy: auth.objectId })), session);
      const result = guardians.length ? await studentRepository.update(String(student._id), auth.instituteId, { guardianIds: guardians.map((guardian) => guardian._id) }, session) : student;
      await audit(req, auth, { action: 'student.create', entityType: 'Student', entityId: String(student.studentId), after: result, session });
      return result;
    }); } catch (error) { return translateDuplicateKey(error, auth, input); }
  },
  async updateStudent(auth: Auth, req: Request, id: string, input: Record<string, any>) {
    permission(auth, 'student.update');
    if (input.status === 'ARCHIVED') permission(auth, 'student.archive');
    return inTransaction(async (session) => {
      const before = await studentRepository.findById(auth.instituteId, id, session);
      if (!before) throw bad(404, 'STUDENT_NOT_FOUND', 'Student was not found');
      const update: Record<string, unknown> = { updatedBy: auth.objectId };
      const contactInput = { mobile: input.mobile === undefined ? before.mobile : input.mobile, email: input.email === undefined ? before.email : input.email };
      if (input.userId !== undefined) { permission(auth, 'user.update'); if (input.userId && !(await studentRepository.userExists(auth.instituteId, input.userId, session))) throw bad(422, 'INVALID_STUDENT_USER', 'Linked account must be an active student user in this institute'); }
      if (input.mobile !== undefined || input.email !== undefined) await assertNoDuplicate(auth, { ...contactInput, excludeId: String(before._id) }, session);
      for (const field of ['name', 'mobile', 'email', 'userId', 'dateOfBirth', 'emergencyContact', 'status'] as const) if (input[field] !== undefined) update[field] = field === 'mobile' && input[field] ? mobile(String(input[field])) : input[field];
      if (input.status === 'ARCHIVED') update.archivedAt = new Date();
      if (input.guardians) {
        const guardians = await studentRepository.createGuardians(input.guardians.map((guardian: Record<string, unknown>) => ({ ...guardian, instituteId: auth.instituteId, studentId: before._id, mobile: mobile(String(guardian.mobile)), createdBy: auth.objectId })), session);
        update.guardianIds = guardians.map((guardian) => guardian._id);
      }
      const after = await studentRepository.update(String(before._id), auth.instituteId, update, session);
      await audit(req, auth, { action: input.status === 'ARCHIVED' ? 'student.archive' : 'student.update', entityType: 'Student', entityId: String(before.studentId), before, after, session });
      return after;
    });
  },
  async studentFinance(auth: Auth, id: string) {
    permission(auth, 'student.view'); permission(auth, 'fee.view');
    const student = await studentRepository.findById(auth.instituteId, id);
    if (!student) throw bad(404, 'STUDENT_NOT_FOUND', 'Student was not found');
    return studentRepository.finance(auth.instituteId, String(student._id));
  }
};
