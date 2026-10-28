import type { Request } from 'express';
import type { AuthenticatedUser } from '../types/auth.js';
import type { Permission } from '../types/rbac.js';
import { ROLE_PERMISSIONS } from '../types/rbac.js';
import { StaffModel } from '../models/staff.model.js';
import { UserModel } from '../models/user.model.js';
import { TeacherAssignmentModel } from '../models/teacher-assignment.model.js';
import { CollectionResponsibilityModel } from '../models/collection-responsibility.model.js';
import { BatchModel } from '../models/batch.model.js';
import { CourseModel } from '../models/course.model.js';
import { TimetableModel } from '../models/timetable.model.js';
import { StudentModel } from '../models/student.model.js';
import { AdmissionModel } from '../models/admission.model.js';
import { PaymentModel } from '../models/payment.model.js';
import { StaffSalaryModel } from '../models/staff-salary.model.js';
import { EvidenceModel } from '../models/evidence.model.js';
import { AuditService } from './audit.service.js';
import { auditRequestMetadata } from '../utils/audit-request.js';
import { inTransaction } from '../utils/transaction.js';
import { ApiError } from '../utils/api-error.js';

type Auth = AuthenticatedUser;
const fail = (statusCode: number, code: string, message: string, errors: unknown[] = []) => new ApiError(statusCode, code, message, errors);
function permit(auth: Auth, key: Permission) { if (!ROLE_PERMISSIONS[auth.role].includes(key)) throw fail(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to perform this action'); }
async function audit(auth: Auth, req: Request, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown, session?: any) {
  return AuditService.record({ instituteId: auth.instituteId, actorUserId: auth.objectId, action, entityType, entityId, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }), request: auditRequestMetadata(req), ...(session ? { session } : {}) });
}
function staffQuery(instituteId: string, id: string) { return { instituteId, $or: [{ staffId: id }, ...( /^[a-f\d]{24}$/i.test(id) ? [{ _id: id }] : [])] }; }
function identityFilter(id: string, businessField: string) { return /^[a-f\d]{24}$/i.test(id) ? { $or: [{ _id: id }, { [businessField]: id }] } : { [businessField]: id }; }
async function findStaff(auth: Auth, id: string, session?: any) {
  const q = StaffModel.findOne(staffQuery(auth.instituteId, id));
  return session ? q.session(session) : q;
}
function overlaps(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) { return a.startTime < b.endTime && b.startTime < a.endTime; }
function datesOverlap(a: { effectiveFrom: Date; effectiveTo: Date }, b: { effectiveFrom: Date; effectiveTo: Date }) { return a.effectiveFrom < b.effectiveTo && b.effectiveFrom < a.effectiveTo; }

export const staffService = {
  async list(auth: Auth, query: { page: number; limit: number; status?: string; role?: string; search?: string }) {
    permit(auth, 'staff.view');
    const filter: Record<string, unknown> = { instituteId: auth.instituteId };
    if (query.status) filter.status = query.status;
    if (query.role) filter.role = query.role.toUpperCase();
    if (query.search) filter.$or = [{ staffId: new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { name: new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    const [items, total] = await Promise.all([StaffModel.find(filter).sort({ name: 1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(), StaffModel.countDocuments(filter)]);
    return { items, total, page: query.page, limit: query.limit };
  },
  async get(auth: Auth, id: string) { permit(auth, 'staff.view'); const staff = await findStaff(auth, id); if (!staff) throw fail(404, 'STAFF_NOT_FOUND', 'Staff record was not found'); return staff; },
  async create(auth: Auth, req: Request, input: Record<string, any>) {
    permit(auth, 'staff.create');
    return inTransaction(async (session) => {
      let linkedUser: any;
      if (input.userId) {
        linkedUser = await UserModel.findOne({ _id: input.userId, instituteId: auth.instituteId, status: 'active' }).session(session);
        if (!linkedUser) throw fail(422, 'INVALID_STAFF_USER', 'Linked user must be active and belong to this institute');
        if (input.role.toUpperCase() === 'TEACHER' && linkedUser.role !== 'TEACHER') throw fail(422, 'STAFF_USER_ROLE_MISMATCH', 'Teacher staff records must link to a TEACHER user');
      }
      try {
        const { documents: _unlinkedDocuments, ...profile } = input;
        const staff = await StaffModel.create([{ ...profile, name: linkedUser?.name ?? input.name, contact: { ...(input.contact ?? {}), ...(linkedUser?.email ? { email: linkedUser.email } : {}), ...(linkedUser?.mobile ? { mobile: linkedUser.mobile } : {}) }, instituteId: auth.instituteId, createdBy: auth.objectId, updatedBy: auth.objectId }], { session }).then((xs) => xs[0]!);
        await audit(auth, req, 'staff.create', 'Staff', staff.staffId, undefined, staff, session);
        return staff;
      } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) throw fail(409, 'DUPLICATE_STAFF_LINK', 'This user is already linked to a staff record'); throw error; }
    });
  },
  async update(auth: Auth, req: Request, id: string, input: Record<string, any>) {
    permit(auth, 'staff.update');
    return inTransaction(async (session) => {
      const staff = await findStaff(auth, id, session);
      if (!staff) throw fail(404, 'STAFF_NOT_FOUND', 'Staff record was not found');
      const before = staff.toObject();
      if (input.status && input.status !== 'ACTIVE') {
        const activeTeaching = await TeacherAssignmentModel.exists({ instituteId: auth.instituteId, staffId: staff._id, status: 'ACTIVE' }).session(session);
        if (activeTeaching) throw fail(409, 'STAFF_HAS_ACTIVE_TEACHING_ASSIGNMENTS', 'Reassign teaching batches before changing this staff member from ACTIVE');
      }
      if (input.userId !== undefined && String(input.userId ?? '') !== String(staff.userId ?? '')) {
        if (input.userId) {
          const linked = await UserModel.findOne({ _id: input.userId, instituteId: auth.instituteId, status: 'active' }).session(session);
          if (!linked) throw fail(422, 'INVALID_STAFF_USER', 'Linked user must be active and belong to this institute');
          if (staff.role === 'TEACHER' && linked.role !== 'TEACHER') throw fail(422, 'STAFF_USER_ROLE_MISMATCH', 'Teacher staff records must link to a TEACHER user');
        }
        staff.userId = input.userId || undefined;
      }
      for (const key of ['name', 'contact', 'role', 'joiningDate', 'status', 'compensationConfiguration'] as const) if (input[key] !== undefined) (staff as any)[key] = input[key];
      if (staff.role === 'TEACHER') {
        const validTeacherUser = staff.userId && await UserModel.exists({ _id: staff.userId, instituteId: auth.instituteId, role: 'TEACHER', status: 'active' }).session(session);
        if (!validTeacherUser) throw fail(422, 'INVALID_TEACHER_STAFF', 'TEACHER staff records require an active linked TEACHER user');
      }
      if (input.documents !== undefined) {
        const docs = await EvidenceModel.find({ instituteId: auth.instituteId, archivedAt: null, evidenceId: { $in: input.documents.map((x: any) => x.evidenceId) }, 'relatedEntity.entityType': 'Staff', 'relatedEntity.entityId': staff.staffId }, { evidenceId: 1, type: 1, verificationStatus: 1, date: 1 }).session(session).lean();
        if (docs.length !== input.documents.length) throw fail(422, 'INVALID_STAFF_DOCUMENT', 'Staff documents must refer to private evidence uploaded for this staff record');
        staff.documents = docs.map((doc) => ({ evidenceId: doc.evidenceId, documentType: doc.type, verificationStatus: doc.verificationStatus, uploadedAt: doc.date })) as any;
      }
      staff.updatedBy = auth.objectId as any;
      await staff.save({ session });
      await audit(auth, req, 'staff.update', 'Staff', staff.staffId, before, staff, session);
      return staff;
    });
  },
  async teachingAssignments(auth: Auth, id: string) {
    permit(auth, 'staff.view'); const staff = await findStaff(auth, id); if (!staff) throw fail(404, 'STAFF_NOT_FOUND', 'Staff record was not found');
    return TeacherAssignmentModel.find({ instituteId: auth.instituteId, staffId: staff._id }).populate('courseId', 'courseCode name code').populate('batchId', 'batchCode name status').sort({ assignedAt: -1 });
  },
  async assignTeaching(auth: Auth, req: Request, id: string, input: { courseId: string; batchId: string }) {
    permit(auth, 'staff.assignment.manage');
    return inTransaction(async (session) => {
      const staff = await findStaff(auth, id, session);
      if (!staff || staff.status !== 'ACTIVE' || staff.role !== 'TEACHER' || !staff.userId) throw fail(422, 'INVALID_TEACHER_STAFF', 'An active TEACHER staff record linked to a user account is required');
      const [course, batch, user] = await Promise.all([
        CourseModel.findOne({ ...identityFilter(input.courseId, 'courseCode'), instituteId: auth.instituteId, status: 'ACTIVE' }).session(session),
        BatchModel.findOne({ ...identityFilter(input.batchId, 'batchCode'), instituteId: auth.instituteId, status: { $in: ['PLANNED', 'ACTIVE'] } }).session(session),
        UserModel.findOne({ _id: staff.userId, instituteId: auth.instituteId, role: 'TEACHER', status: 'active' }).session(session)
      ]);
      if (!course || !batch || String(batch.courseId) !== String(course._id) || !user) throw fail(422, 'INVALID_TEACHING_ASSIGNMENT', 'Active course, matching batch, and active linked teacher account are required');
      const conflicts: unknown[] = [];
      const ownSlots = await TimetableModel.find({ instituteId: auth.instituteId, batchId: batch._id, status: 'SCHEDULED' }).session(session).lean();
      const others = await TimetableModel.find({ instituteId: auth.instituteId, teacherId: user._id, status: 'SCHEDULED', batchId: { $ne: batch._id } }).session(session).lean();
      for (const slot of ownSlots) for (const other of others) if (slot.weekday === other.weekday && overlaps(slot, other) && datesOverlap(slot, other)) conflicts.push({ batchId: other.batchId, timetableId: other.timetableId, weekday: other.weekday, startTime: other.startTime, endTime: other.endTime });
      if (conflicts.length) throw fail(409, 'TEACHER_TIMETABLE_CONFLICT', 'Teacher has overlapping scheduled classes', conflicts);
      const prior = await TeacherAssignmentModel.findOne({ instituteId: auth.instituteId, batchId: batch._id, status: 'ACTIVE' }).session(session);
      if (prior && String(prior.staffId) === String(staff._id)) return prior;
      if (prior) { prior.status = 'ENDED'; prior.endedAt = new Date(); await prior.save({ session }); }
      const assignment = await TeacherAssignmentModel.create([{ instituteId: auth.instituteId, staffId: staff._id, userId: user._id, courseId: course._id, batchId: batch._id, assignedBy: auth.objectId }], { session }).then((xs) => xs[0]!);
      const before = { teacherId: batch.teacherId };
      batch.teacherId = user._id as any; batch.updatedBy = auth.objectId as any; await batch.save({ session });
      await TimetableModel.updateMany({ instituteId: auth.instituteId, batchId: batch._id, status: 'SCHEDULED' }, { $set: { teacherId: user._id, updatedBy: auth.objectId } }, { session });
      await audit(auth, req, 'staff.teacher_assignment', 'TeacherAssignment', assignment.assignmentId, before, assignment, session);
      return assignment;
    });
  },
  async collectionResponsibilities(auth: Auth, id: string) {
    permit(auth, 'staff.view'); const staff = await findStaff(auth, id); if (!staff) throw fail(404, 'STAFF_NOT_FOUND', 'Staff record was not found');
    return CollectionResponsibilityModel.find({ instituteId: auth.instituteId, staffId: staff._id, status: 'ACTIVE' }).populate('studentId', 'studentId name status').populate('admissionId', 'admissionId status').sort({ assignedAt: -1 });
  },
  async assignCollection(auth: Auth, req: Request, id: string, input: { studentId: string; admissionId?: string }) {
    permit(auth, 'staff.assignment.manage');
    return inTransaction(async (session) => {
      const staff = await findStaff(auth, id, session);
      if (!staff || staff.status !== 'ACTIVE') throw fail(404, 'STAFF_NOT_ACTIVE', 'Active staff record was not found');
      const student = await StudentModel.findOne({ ...identityFilter(input.studentId, 'studentId'), instituteId: auth.instituteId, status: { $ne: 'ARCHIVED' } }).session(session);
      if (!student) throw fail(404, 'STUDENT_NOT_FOUND', 'Active student was not found in this institute');
      let admission: any;
      if (input.admissionId) { admission = await AdmissionModel.findOne({ ...identityFilter(input.admissionId, 'admissionId'), instituteId: auth.instituteId, studentObjectId: student._id, status: 'CONVERTED' }).session(session); if (!admission) throw fail(422, 'ADMISSION_STUDENT_MISMATCH', 'Admission must be converted and belong to the selected student'); }
      const existing = await CollectionResponsibilityModel.findOne({ instituteId: auth.instituteId, studentId: student._id, status: 'ACTIVE' }).session(session);
      if (existing) { if (String(existing.staffId) === String(staff._id) && String(existing.admissionId ?? '') === String(admission?._id ?? '')) return existing; throw fail(409, 'COLLECTION_RESPONSIBILITY_EXISTS', 'Student already has an active collection responsibility'); }
      const responsibility = await CollectionResponsibilityModel.create([{ instituteId: auth.instituteId, staffId: staff._id, studentId: student._id, ...(admission ? { admissionId: admission._id } : {}), assignedBy: auth.objectId }], { session }).then((xs) => xs[0]!);
      await audit(auth, req, 'staff.collection_assignment', 'CollectionResponsibility', responsibility.responsibilityId, undefined, responsibility, session);
      return responsibility;
    });
  },
  async contributions(auth: Auth, id: string) {
    permit(auth, 'staff.view'); const staff = await findStaff(auth, id); if (!staff) throw fail(404, 'STAFF_NOT_FOUND', 'Staff record was not found');
    const [admissions, collections, teachingAssignments, salaries] = await Promise.all([
      AdmissionModel.countDocuments({ instituteId: auth.instituteId, contributedByStaffId: staff._id }),
      staff.userId ? PaymentModel.aggregate([{ $match: { instituteId: staff.instituteId, authorizedBy: staff.userId, transactionType: 'PAYMENT' } }, { $group: { _id: null, paymentCount: { $sum: 1 }, amount: { $sum: '$amount' } } }]) : Promise.resolve([]),
      TeacherAssignmentModel.countDocuments({ instituteId: auth.instituteId, staffId: staff._id, status: 'ACTIVE' }),
      staff.userId ? StaffSalaryModel.find({ instituteId: auth.instituteId, staffUserId: staff.userId }).select('salaryId payPeriod netPayable status paidAt').sort({ payPeriod: -1 }).limit(24).lean() : Promise.resolve([])
    ]);
    const responsibilities = await CollectionResponsibilityModel.countDocuments({ instituteId: auth.instituteId, staffId: staff._id, status: 'ACTIVE' });
    return { admissionsContributed: admissions, collectionResponsibilityCount: responsibilities, collectionsRecorded: collections[0] ?? { paymentCount: 0, amount: 0 }, activeTeachingAssignments: teachingAssignments, salaries };
  }
};
