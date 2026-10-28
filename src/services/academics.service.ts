import type { Request } from 'express';
import type { ClientSession } from 'mongoose';
import type { AuthenticatedUser } from '../types/auth.js';
import { ROLE_PERMISSIONS, type Permission } from '../types/rbac.js';
import { ApiError } from '../utils/api-error.js';
import { auditRequestMetadata } from '../utils/audit-request.js';
import { inTransaction } from '../utils/transaction.js';
import { AuditService } from './audit.service.js';
import { academicsRepository } from '../repositories/academics.repository.js';
import { BatchModel } from '../models/batch.model.js';
import { BatchEnrollmentModel } from '../models/batch-enrollment.model.js';
import { StudentModel } from '../models/student.model.js';

type Auth = AuthenticatedUser;
const bad = (status: number, code: string, message: string, errors: unknown[] = []) => new ApiError(status, code, message, errors);
function permission(auth: Auth, key: Permission) { if (!ROLE_PERMISSIONS[auth.role].includes(key)) throw bad(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to perform this action'); }
function audit(req: Request, auth: Auth, input: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason?: string; session: ClientSession }) { return AuditService.record({ ...input, instituteId: auth.instituteId, actorUserId: auth.objectId, request: auditRequestMetadata(req) }); }
function checkDuplicate(error: unknown, label: string): never { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) throw bad(409, `DUPLICATE_${label}`, `This ${label.toLowerCase()} already exists`); throw error; }
type ScheduleSlot = { weekday: number; startTime: string; endTime: string };
async function assertNoConflict(auth: Auth, slot: ScheduleSlot, dates: { effectiveFrom: Date; effectiveTo: Date }, resource: { teacherId: string; room?: string; batchId?: string; excludeId?: string }, session: ClientSession) {
  const conflicts = await academicsRepository.findConflicts({ instituteId: auth.instituteId, ...slot, ...dates, ...resource }, session);
  if (conflicts.length) {
    const details = conflicts.map((item) => {
      const types = [String(item.teacherId?._id ?? item.teacherId) === resource.teacherId ? 'TEACHER' : '', resource.room && item.room?.toLowerCase() === resource.room.toLowerCase() ? 'ROOM' : '', resource.batchId && String(item.batchId?._id ?? item.batchId) === resource.batchId ? 'BATCH' : ''].filter(Boolean);
      return { timetableId: item.timetableId, batchId: item.batchId, teacherId: item.teacherId, room: item.room, weekday: item.weekday, startTime: item.startTime, endTime: item.endTime, conflictTypes: types };
    });
    throw bad(409, 'TIMETABLE_CONFLICT', 'The timetable conflicts with an existing session', details);
  }
}
async function writeSchedule(auth: Auth, req: Request, batch: any, slots: ScheduleSlot[], dates: { effectiveFrom: Date; effectiveTo: Date }, room: string | undefined, session: ClientSession) {
  const normalizedRoom = room?.trim().toUpperCase();
  await academicsRepository.cancelBatchTimetables(auth.instituteId, String(batch._id), auth.objectId, session);
  for (const slot of slots) await assertNoConflict(auth, slot, dates, { teacherId: String(batch.teacherId), ...(normalizedRoom && batch.mode !== 'ONLINE' ? { room: normalizedRoom } : {}), batchId: String(batch._id) }, session);
  const records = [];
  for (const slot of slots) records.push(await academicsRepository.createTimetable({ instituteId: auth.instituteId, batchId: batch._id, teacherId: batch.teacherId, ...(normalizedRoom && batch.mode !== 'ONLINE' ? { room: normalizedRoom } : {}), ...slot, ...dates, createdBy: auth.objectId, updatedBy: auth.objectId }, session));
  return records;
}

async function visibleAcademicScope(auth: Auth): Promise<{ batchIds?: string[]; courseIds?: string[]; studentId?: string }> {
  if (auth.role === 'TEACHER') {
    const batchIds = (await BatchModel.find({ instituteId: auth.instituteId, teacherId: auth.objectId }).distinct('_id')).map(String);
    const courseIds = (await BatchModel.find({ instituteId: auth.instituteId, _id: { $in: batchIds } }).distinct('courseId')).map(String);
    return { batchIds, courseIds };
  }
  if (auth.role === 'STUDENT') {
    const student = await StudentModel.findOne({ instituteId: auth.instituteId, userId: auth.objectId }).select('_id').lean();
    if (!student) return { batchIds: [], courseIds: [] };
    const batchIds = (await BatchEnrollmentModel.find({ instituteId: auth.instituteId, studentId: student._id, status: { $in: ['ACTIVE', 'COMPLETED'] } }).distinct('batchId')).map(String);
    const courseIds = (await BatchModel.find({ instituteId: auth.instituteId, _id: { $in: batchIds } }).distinct('courseId')).map(String);
    return { batchIds, courseIds, studentId: String(student._id) };
  }
  return {};
}

function assertVisibleId(scope: string[] | undefined, id: unknown, label: string) {
  if (scope && !scope.includes(String(id))) throw bad(404, `${label}_NOT_FOUND`, `${label.toLowerCase()} was not found`);
}

export const academicsService = {
  async listCourses(auth: Auth, query: { page: number; limit: number; status?: string | undefined; search?: string | undefined }) { permission(auth, 'course.view'); const scope = await visibleAcademicScope(auth); return academicsRepository.listCourses(auth.instituteId, query.page, query.limit, query.status, query.search, scope.courseIds); },
  async getCourse(auth: Auth, id: string) { permission(auth, 'course.view'); const course = await academicsRepository.findCourse(auth.instituteId, id); if (!course) throw bad(404, 'COURSE_NOT_FOUND', 'Course was not found'); const scope = await visibleAcademicScope(auth); assertVisibleId(scope.courseIds, course._id, 'COURSE'); return course; },
  async createCourse(auth: Auth, req: Request, input: Record<string, any>) {
    permission(auth, 'course.create');
    try { return await inTransaction(async (session) => { const course = await academicsRepository.createCourse({ ...input, code: input.code.toUpperCase(), instituteId: auth.instituteId, createdBy: auth.objectId, updatedBy: auth.objectId }, session); await audit(req, auth, { action: 'course.create', entityType: 'Course', entityId: String(course.courseCode), after: course, session }); return course; }); } catch (error) { return checkDuplicate(error, 'COURSE'); }
  },
  async updateCourse(auth: Auth, req: Request, id: string, input: Record<string, any>) {
    permission(auth, 'course.update');
    return inTransaction(async (session) => {
      const before = await academicsRepository.findCourse(auth.instituteId, id, session); if (!before) throw bad(404, 'COURSE_NOT_FOUND', 'Course was not found');
      const prior = before.toObject();
      const status = input.status;
      const currentVersion = before.version || 1;
      const update: Record<string, unknown> = { ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}), version: currentVersion + 1, updatedBy: auth.objectId, history: [...before.history, { version: currentVersion, changedAt: new Date(), changedBy: auth.objectId, snapshot: { name: before.name, code: before.code, duration: before.duration, fee: before.fee, description: before.description, eligibility: before.eligibility, status: before.status } }] };
      const after = await academicsRepository.updateCourse(String(before._id), auth.instituteId, update, session);
      await audit(req, auth, { action: status && status !== 'ACTIVE' ? 'course.deactivate' : 'course.update', entityType: 'Course', entityId: String(before.courseCode), before: prior, after, session }); return after;
    });
  },
  async addModule(auth: Auth, req: Request, courseId: string, input: Record<string, unknown>) {
    permission(auth, 'course.update');
    return inTransaction(async (session) => { const course = await academicsRepository.findCourse(auth.instituteId, courseId, session); if (!course) throw bad(404, 'COURSE_NOT_FOUND', 'Course was not found'); if (course.status !== 'ACTIVE') throw bad(409, 'COURSE_INACTIVE', 'Modules cannot be added to an inactive course'); const module = await academicsRepository.createModule({ ...input, instituteId: auth.instituteId, courseId: course._id, createdBy: auth.objectId, updatedBy: auth.objectId }, session); await audit(req, auth, { action: 'course.update', entityType: 'CourseModule', entityId: String(module.moduleId), after: module, session }); return module; });
  },
  async listModules(auth: Auth, courseId: string) { permission(auth, 'course.view'); const course = await academicsRepository.findCourse(auth.instituteId, courseId); if (!course) throw bad(404, 'COURSE_NOT_FOUND', 'Course was not found'); return academicsRepository.listModules(auth.instituteId, String(course._id)); },
  async updateModule(auth: Auth, req: Request, id: string, input: Record<string, unknown>) { permission(auth, 'course.update'); return inTransaction(async (session) => { const after = await academicsRepository.updateModule(auth.instituteId, id, { ...input, updatedBy: auth.objectId }, session); if (!after) throw bad(404, 'COURSE_MODULE_NOT_FOUND', 'Course module was not found'); await audit(req, auth, { action: 'course.update', entityType: 'CourseModule', entityId: String(after.moduleId), after, session }); return after; }); },
  async listBatches(auth: Auth, query: { page: number; limit: number; courseId?: string | undefined; status?: string | undefined }) { permission(auth, 'batch.view'); const scope = await visibleAcademicScope(auth); return academicsRepository.listBatches(auth.instituteId, query.page, query.limit, query.courseId, query.status, scope.batchIds); },
  async getBatch(auth: Auth, id: string) { permission(auth, 'batch.view'); const batch = await academicsRepository.findBatch(auth.instituteId, id); if (!batch) throw bad(404, 'BATCH_NOT_FOUND', 'Batch was not found'); const scope = await visibleAcademicScope(auth); assertVisibleId(scope.batchIds, batch._id, 'BATCH'); return batch; },
  async createBatch(auth: Auth, req: Request, input: Record<string, any>) {
    permission(auth, 'batch.create');
    try { return await inTransaction(async (session) => {
      if (!(await academicsRepository.activeCourseExists(auth.instituteId, input.courseId, session))) throw bad(422, 'INVALID_COURSE', 'Course must be active in this institute');
      if (!(await academicsRepository.teacherExists(auth.instituteId, input.teacherId, session))) throw bad(422, 'INVALID_TEACHER', 'Teacher must be an active teacher in this institute');
      const batch = await academicsRepository.createBatch({ ...input, instituteId: auth.instituteId, createdBy: auth.objectId, updatedBy: auth.objectId }, session);
      const timetable = await writeSchedule(auth, req, batch, input.schedule, { effectiveFrom: input.startDate, effectiveTo: input.endDate }, input.room, session);
      await audit(req, auth, { action: 'batch.create', entityType: 'Batch', entityId: String(batch.batchCode), after: { batch, timetable }, session }); return batch;
    }); } catch (error) { return checkDuplicate(error, 'BATCH'); }
  },
  async updateBatch(auth: Auth, req: Request, id: string, input: Record<string, any>) {
    permission(auth, 'batch.update');
    return inTransaction(async (session) => {
      const before = await academicsRepository.findBatch(auth.instituteId, id, session); if (!before) throw bad(404, 'BATCH_NOT_FOUND', 'Batch was not found');
      const startDate = input.startDate ?? before.startDate;
      const endDate = input.endDate ?? before.endDate;
      if (endDate < startDate) throw bad(422, 'INVALID_BATCH_DATES', 'Batch end date must not precede start date');
      if (input.courseId && !(await academicsRepository.activeCourseExists(auth.instituteId, input.courseId, session))) throw bad(422, 'INVALID_COURSE', 'Course must be active in this institute');
      if (input.teacherId && !(await academicsRepository.teacherExists(auth.instituteId, input.teacherId, session))) throw bad(422, 'INVALID_TEACHER', 'Teacher must be an active teacher in this institute');
      if (input.capacity !== undefined && input.capacity < before.enrolledCount) throw bad(409, 'CAPACITY_BELOW_ENROLLED', 'Capacity cannot be lower than current enrollment');
      const update = { ...input, updatedBy: auth.objectId };
      const after = await academicsRepository.updateBatch(String(before._id), auth.instituteId, update, session);
      if (input.schedule || input.startDate || input.endDate || input.teacherId || input.room !== undefined || input.mode) {
        const source = after!;
        await writeSchedule(auth, req, source, input.schedule ?? source.schedule, { effectiveFrom: input.startDate ?? source.startDate, effectiveTo: input.endDate ?? source.endDate }, input.room === undefined ? source.room : input.room ?? undefined, session);
      }
      if (['INACTIVE', 'CANCELLED', 'COMPLETED'].includes(input.status)) await academicsRepository.cancelBatchTimetables(auth.instituteId, String(before._id), auth.objectId, session);
      await audit(req, auth, { action: ['INACTIVE', 'CANCELLED', 'COMPLETED'].includes(input.status) ? 'batch.deactivate' : 'batch.update', entityType: 'Batch', entityId: String(before.batchCode), before, after, session }); return after;
    });
  },
  async enroll(auth: Auth, req: Request, batchId: string, input: Record<string, any>) {
    permission(auth, 'batch.enroll');
    if (input.capacityOverrideReason) permission(auth, 'batch.capacity.override');
    try { return await inTransaction(async (session) => {
      const batch = await academicsRepository.findBatch(auth.instituteId, batchId, session); if (!batch || !['PLANNED', 'ACTIVE'].includes(batch.status)) throw bad(404, 'BATCH_NOT_FOUND', 'An active batch was not found');
      if (auth.role === 'TEACHER') { const scope = await visibleAcademicScope(auth); assertVisibleId(scope.batchIds, batch._id, 'BATCH'); }
      if (!(await academicsRepository.activeStudentExists(auth.instituteId, input.studentId, session))) throw bad(422, 'INVALID_STUDENT', 'Student must exist in this institute and not be archived');
      if (input.admissionId && !(await academicsRepository.admissionMatches(auth.instituteId, input.admissionId, input.studentId, String(batch.courseId), session))) throw bad(422, 'INVALID_ADMISSION', 'Admission must belong to this student, course, and institute');
      let override = false;
      let reserved = await academicsRepository.reserveSeat(auth.instituteId, String(batch._id), session);
      if (!reserved && input.capacityOverrideReason) { reserved = await academicsRepository.incrementSeat(auth.instituteId, String(batch._id), session); override = Boolean(reserved); }
      if (!reserved) { const current = await academicsRepository.findBatch(auth.instituteId, String(batch._id), session); throw bad(409, 'BATCH_CAPACITY_REACHED', 'Batch capacity has been reached', [{ batchId: batch.batchCode, capacity: current?.capacity, enrolledCount: current?.enrolledCount, overrideAvailable: ROLE_PERMISSIONS[auth.role].includes('batch.capacity.override') }]); }
      const enrollment = await academicsRepository.createEnrollment({ instituteId: auth.instituteId, batchId: batch._id, studentId: input.studentId, ...(input.admissionId ? { admissionId: input.admissionId } : {}), createdBy: auth.objectId, ...(override ? { capacityOverride: { authorizedBy: auth.objectId, reason: input.capacityOverrideReason, authorizedAt: new Date() } } : {}) }, session);
      await audit(req, auth, { action: override ? 'batch.capacity.override' : 'batch.enrollment.create', entityType: 'BatchEnrollment', entityId: String(enrollment.enrollmentId), after: enrollment, ...(override ? { reason: input.capacityOverrideReason } : {}), session });
      return enrollment;
    }); } catch (error) { return checkDuplicate(error, 'ENROLLMENT'); }
  },
  async listEnrollments(auth: Auth, batchId: string, page: number, limit: number) { permission(auth, 'batch.view'); const batch = await academicsRepository.findBatch(auth.instituteId, batchId); if (!batch) throw bad(404, 'BATCH_NOT_FOUND', 'Batch was not found'); const scope = await visibleAcademicScope(auth); assertVisibleId(scope.batchIds, batch._id, 'BATCH'); return academicsRepository.listEnrollments(auth.instituteId, String(batch._id), page, limit, scope.studentId); },
  async updateEnrollment(auth: Auth, req: Request, id: string, status: 'COMPLETED' | 'WITHDRAWN') {
    permission(auth, 'batch.update');
    return inTransaction(async (session) => { const before = await academicsRepository.findEnrollment(auth.instituteId, id, session); if (!before) throw bad(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment was not found'); if (before.status !== 'ACTIVE') throw bad(409, 'ENROLLMENT_CLOSED', 'Only active enrollments can be changed'); const after = await academicsRepository.updateEnrollment(String(before._id), auth.instituteId, { status }, session); if (status === 'WITHDRAWN') await academicsRepository.decrementSeat(auth.instituteId, String(before.batchId), session); await audit(req, auth, { action: 'batch.update', entityType: 'BatchEnrollment', entityId: String(before.enrollmentId), before, after, session }); return after; });
  },
  async createTimetable(auth: Auth, req: Request, input: Record<string, any>) {
    permission(auth, 'batch.update');
    return inTransaction(async (session) => { const batch = await academicsRepository.findBatch(auth.instituteId, input.batchId, session); if (!batch || !['PLANNED', 'ACTIVE'].includes(batch.status)) throw bad(404, 'BATCH_NOT_FOUND', 'An active batch was not found'); const entry = { weekday: input.weekday, startTime: input.startTime, endTime: input.endTime }; await assertNoConflict(auth, entry, { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo }, { teacherId: String(batch.teacherId), ...(batch.room && batch.mode !== 'ONLINE' ? { room: batch.room } : {}), batchId: String(batch._id) }, session); const timetable = await academicsRepository.createTimetable({ ...entry, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, instituteId: auth.instituteId, batchId: batch._id, teacherId: batch.teacherId, ...(batch.room && batch.mode !== 'ONLINE' ? { room: batch.room } : {}), createdBy: auth.objectId, updatedBy: auth.objectId }, session); await audit(req, auth, { action: 'timetable.create', entityType: 'Timetable', entityId: String(timetable.timetableId), after: timetable, session }); return timetable; });
  },
  async listTimetable(auth: Auth, from: Date, to: Date) { permission(auth, 'batch.view'); const scope = await visibleAcademicScope(auth); return academicsRepository.listTimetable(auth.instituteId, from, to, auth.role === 'TEACHER' ? { teacherId: auth.objectId } : scope.batchIds ? { batchIds: scope.batchIds } : undefined); },
  async updateTimetable(auth: Auth, req: Request, id: string, input: Record<string, any>) {
    permission(auth, 'batch.update');
    return inTransaction(async (session) => { const current = await academicsRepository.findTimetable(auth.instituteId, id, session); if (!current) throw bad(404, 'TIMETABLE_NOT_FOUND', 'Timetable entry was not found'); if (current.status !== 'SCHEDULED') throw bad(409, 'TIMETABLE_CLOSED', 'Cancelled timetable entries are historical and cannot be edited'); const merged = { weekday: input.weekday ?? current.weekday, startTime: input.startTime ?? current.startTime, endTime: input.endTime ?? current.endTime, effectiveFrom: input.effectiveFrom ?? current.effectiveFrom, effectiveTo: input.effectiveTo ?? current.effectiveTo }; if (input.status === 'CANCELLED') { const after = await academicsRepository.updateTimetable(String(current._id), auth.instituteId, { status: 'CANCELLED', updatedBy: auth.objectId }, session); await audit(req, auth, { action: 'timetable.update', entityType: 'Timetable', entityId: String(current.timetableId), before: current, after, session }); return after; } if (merged.startTime >= merged.endTime || merged.effectiveTo < merged.effectiveFrom) throw bad(422, 'INVALID_TIMETABLE_RANGE', 'Timetable time/date range is invalid'); await assertNoConflict(auth, merged, { effectiveFrom: merged.effectiveFrom, effectiveTo: merged.effectiveTo }, { teacherId: String(current.teacherId), ...(current.room ? { room: current.room } : {}), batchId: String(current.batchId), excludeId: String(current._id) }, session); const after = await academicsRepository.updateTimetable(String(current._id), auth.instituteId, { ...merged, updatedBy: auth.objectId }, session); await audit(req, auth, { action: 'timetable.update', entityType: 'Timetable', entityId: String(current.timetableId), before: current, after, session }); return after; });
  }
};
