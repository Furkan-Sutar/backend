import type { Request } from 'express';
import type { ClientSession } from 'mongoose';
import type { AuthenticatedUser } from '../types/auth.js';
import { ROLE_PERMISSIONS, type Permission } from '../types/rbac.js';
import { ApiError } from '../utils/api-error.js';
import { auditRequestMetadata } from '../utils/audit-request.js';
import { inTransaction } from '../utils/transaction.js';
import { AuditService } from './audit.service.js';
import { attendanceProgressRepository as repository } from '../repositories/attendance-progress.repository.js';

type Auth = AuthenticatedUser;
const bad = (status: number, code: string, message: string, errors: unknown[] = []) => new ApiError(status, code, message, errors);
function permission(auth: Auth, key: Permission) { if (!ROLE_PERMISSIONS[auth.role].includes(key)) throw bad(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to perform this action'); }
function audit(req: Request, auth: Auth, input: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason?: string; session: ClientSession }) { return AuditService.record({ ...input, instituteId: auth.instituteId, actorUserId: auth.objectId, request: auditRequestMetadata(req) }); }
async function managedBatch(auth: Auth, batchId: string, session?: ClientSession) {
  const batch = await repository.findBatch(auth.instituteId, batchId, session);
  if (!batch) throw bad(404, 'BATCH_NOT_FOUND', 'Batch was not found');
  if (auth.role === 'TEACHER' && String(batch.teacherId) !== auth.objectId) throw bad(403, 'BATCH_ASSIGNMENT_REQUIRED', 'Teachers can only manage batches assigned to them');
  if (auth.role === 'STUDENT') throw bad(403, 'PERMISSION_FORBIDDEN', 'Students cannot manage attendance or progress');
  return batch;
}
async function visibleStudent(auth: Auth, studentId: string) {
  if (auth.role === 'STUDENT' && !(await repository.isStudentLinked(auth.instituteId, auth.objectId, studentId))) throw bad(403, 'STUDENT_ACCESS_DENIED', 'Students can only view their own records');
  if (!(await repository.studentExists(auth.instituteId, studentId))) throw bad(404, 'STUDENT_NOT_FOUND', 'Student was not found');
}
function percentage(sessionIds: string[], records: Array<{ sessionObjectId: unknown; status: string }>) {
  const recordsBySession = new Map(records.map((record) => [String(record.sessionObjectId), record.status]));
  let attended = 0;
  let denominator = 0;
  for (const sessionId of sessionIds) {
    const status = recordsBySession.get(sessionId);
    if (status === 'EXCUSED') continue;
    denominator += 1;
    if (status === 'PRESENT' || status === 'LATE') attended += 1;
  }
  return { percentage: denominator ? Math.round((attended / denominator) * 10000) / 100 : 0, attendedSessions: attended, totalSessions: denominator };
}
async function studentBatchScope(auth: Auth, studentId: string) {
  await visibleStudent(auth, studentId);
  const enrollments = await repository.studentEnrollmentBatches(auth.instituteId, studentId);
  const ids = enrollments.map((item) => String(item.batchId));
  if (auth.role !== 'TEACHER') return ids;
  const assigned = await repository.assignedBatchIds(auth.instituteId, auth.objectId, ids);
  if (!assigned.length) throw bad(403, 'BATCH_ASSIGNMENT_REQUIRED', 'You can only view attendance for students in your assigned batches');
  return assigned.map(String);
}

export const attendanceProgressService = {
  async createSession(auth: Auth, req: Request, input: Record<string, any>) {
    permission(auth, 'attendance.create');
    try { return await inTransaction(async (session) => {
      const batch = await managedBatch(auth, input.batchId, session);
      if (!['PLANNED', 'ACTIVE'].includes(batch.status)) throw bad(409, 'BATCH_CLOSED', 'Attendance cannot be created for a closed batch');
      const date = new Date(input.date); date.setUTCHours(0, 0, 0, 0);
      const start = new Date(batch.startDate); start.setUTCHours(0, 0, 0, 0);
      const end = new Date(batch.endDate); end.setUTCHours(23, 59, 59, 999);
      if (date < start || date > end) throw bad(422, 'SESSION_OUTSIDE_BATCH', 'Session date must fall within the batch dates');
      const enrolled = await repository.countEnrolled(auth.instituteId, String(batch._id), session);
      if (!enrolled) throw bad(409, 'NO_ENROLLED_STUDENTS', 'Attendance requires at least one active batch enrollment');
      const created = await repository.createSession({ instituteId: auth.instituteId, batchId: batch._id, date, subject: input.subject, createdBy: auth.objectId, updatedBy: auth.objectId }, session);
      await audit(req, auth, { action: 'attendance.create', entityType: 'AttendanceSession', entityId: String(created.sessionId), after: created, session });
      return created;
    }); } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) throw bad(409, 'DUPLICATE_ATTENDANCE_SESSION', 'An attendance session already exists for this batch, date, and subject'); throw error; }
  },
  async listSessions(auth: Auth, batchId: string, from?: Date, to?: Date) {
    permission(auth, 'attendance.view');
    const batch = await repository.findBatch(auth.instituteId, batchId);
    if (!batch) throw bad(404, 'BATCH_NOT_FOUND', 'Batch was not found');
    if (auth.role === 'TEACHER' && String(batch.teacherId) !== auth.objectId) throw bad(403, 'BATCH_ASSIGNMENT_REQUIRED', 'Teachers can only view assigned batch sessions');
    if (auth.role === 'STUDENT') { const student = await repository.studentByUserId(auth.instituteId, auth.objectId); if (!student || !(await repository.isEnrolled(auth.instituteId, String(batch._id), String(student._id)))) throw bad(403, 'STUDENT_ACCESS_DENIED', 'You are not enrolled in this batch'); }
    return repository.listSessions(auth.instituteId, String(batch._id), from, to);
  },
  async getSession(auth: Auth, id: string) {
    permission(auth, 'attendance.view');
    const session = await repository.findSession(auth.instituteId, id);
    if (!session) throw bad(404, 'ATTENDANCE_SESSION_NOT_FOUND', 'Attendance session was not found');
    if (auth.role === 'TEACHER') await managedBatch(auth, String(session.batchId));
    if (auth.role === 'STUDENT') {
      const student = await repository.studentByUserId(auth.instituteId, auth.objectId);
      if (!student || !(await repository.isEnrolled(auth.instituteId, String(session.batchId), String(student._id)))) throw bad(403, 'STUDENT_ACCESS_DENIED', 'You are not enrolled in this batch');
      const records = await repository.sessionRecords(auth.instituteId, String(session._id));
      return { session, records: records.filter((item) => String(item.studentId?._id ?? item.studentId) === String(student._id)) };
    }
    return { session, records: await repository.sessionRecords(auth.instituteId, String(session._id)) };
  },
  async markRecords(auth: Auth, req: Request, sessionId: string, inputs: Array<{ studentId: string; status: string }>) {
    permission(auth, 'attendance.create');
    try { return await inTransaction(async (session) => {
      const attendanceSession = await repository.findSession(auth.instituteId, sessionId, session);
      if (!attendanceSession) throw bad(404, 'ATTENDANCE_SESSION_NOT_FOUND', 'Attendance session was not found');
      if (attendanceSession.status !== 'OPEN') throw bad(409, 'ATTENDANCE_SESSION_CLOSED', 'Attendance session is already closed');
      const batch = await managedBatch(auth, String(attendanceSession.batchId), session);
      const enrollmentRows = await repository.enrolledStudents(auth.instituteId, String(batch._id), session);
      const enrolledIds = new Set(enrollmentRows.map((row) => String(row.studentId)));
      const invalid = inputs.filter((row) => !enrolledIds.has(row.studentId));
      if (invalid.length) throw bad(422, 'STUDENT_NOT_ENROLLED', 'Every attendance student must have an active enrollment in this batch', invalid.map(({ studentId }) => ({ studentId })));
      const existing = await repository.existingRecords(auth.instituteId, String(attendanceSession._id), inputs.map(({ studentId }) => studentId), session);
      if (existing.length) throw bad(409, 'DUPLICATE_ATTENDANCE', 'Attendance already exists for one or more students in this session', existing.map((item) => ({ studentId: String(item.studentId) })));
      const records = await repository.createRecords(inputs.map((row) => ({ ...row, instituteId: auth.instituteId, sessionId: attendanceSession.sessionId, sessionObjectId: attendanceSession._id, batchId: batch._id, markedBy: auth.objectId, timestamp: new Date() })), session);
      const recordCount = await repository.countSessionRecords(auth.instituteId, String(attendanceSession._id), session);
      if (recordCount === enrollmentRows.length) await repository.updateSessionStatus(auth.instituteId, String(attendanceSession._id), 'COMPLETED', auth.objectId, session);
      await audit(req, auth, { action: 'attendance.create', entityType: 'AttendanceSession', entityId: String(attendanceSession.sessionId), after: records.map((record) => ({ recordId: record.recordId, studentId: record.studentId, status: record.status })), session });
      return records;
    }); } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 11000) throw bad(409, 'DUPLICATE_ATTENDANCE', 'Attendance already exists for a student in this session'); throw error; }
  },
  async updateRecord(auth: Auth, req: Request, id: string, input: { status: string; reason: string }) {
    permission(auth, 'attendance.update');
    return inTransaction(async (session) => {
      const before = await repository.findRecord(auth.instituteId, id, session);
      if (!before) throw bad(404, 'ATTENDANCE_RECORD_NOT_FOUND', 'Attendance record was not found');
      await managedBatch(auth, String(before.batchId), session);
      const history = [...before.history, { status: input.status, changedBy: auth.objectId, changedAt: new Date(), reason: input.reason }];
      const after = await repository.updateRecord(String(before._id), auth.instituteId, { status: input.status, markedBy: auth.objectId, timestamp: new Date(), history }, session);
      await audit(req, auth, { action: 'attendance.sensitive_update', entityType: 'AttendanceRecord', entityId: String(before.recordId), before, after, reason: input.reason, session });
      return after;
    });
  },
  async studentHistory(auth: Auth, studentId: string, page: number, limit: number) {
    permission(auth, 'attendance.view');
    const batchIds = await studentBatchScope(auth, studentId);
    return repository.listStudentRecords(auth.instituteId, studentId, page, limit, auth.role === 'TEACHER' ? batchIds : undefined);
  },
  async studentPercentage(auth: Auth, studentId: string) {
    permission(auth, 'attendance.view');
    const batchIds = await studentBatchScope(auth, studentId);
    const sessions = await repository.sessionsForBatches(auth.instituteId, batchIds);
    const sessionIds = sessions.map((item) => String(item._id));
    const records = await repository.recordsForSessions(auth.instituteId, studentId, sessionIds);
    return { studentId, ...percentage(sessionIds, records) };
  },
  async lowAttendance(auth: Auth, batchId: string | undefined, threshold: number) {
    permission(auth, 'attendance.view');
    if (auth.role === 'STUDENT') throw bad(403, 'PERMISSION_FORBIDDEN', 'Students cannot view institute low-attendance reports');
    let ids: string[];
    if (batchId) { const batch = await managedBatch(auth, batchId); ids = [String(batch._id)]; }
    else if (auth.role === 'TEACHER') ids = (await repository.teacherBatches(auth.instituteId, auth.objectId)).map((batch) => String(batch._id));
    else if (auth.role === 'OWNER_ADMIN') ids = (await repository.allBatches(auth.instituteId)).map((batch) => String(batch._id));
    else throw bad(403, 'PERMISSION_FORBIDDEN', 'This role must request low attendance for an assigned batch');
    const low: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const learners = await repository.enrolledBatchStudents(auth.instituteId, id);
      const sessions = await repository.completedSessionsForBatch(auth.instituteId, id);
      if (!sessions.length) continue;
      const sessionIds = sessions.map((item) => String(item._id));
      const records = await repository.attendanceRecordsForBatchSessions(auth.instituteId, id, sessionIds);
      for (const learner of learners) {
        const studentId = String(learner.studentId?._id ?? learner.studentId);
        const summary = percentage(sessionIds, records.filter((record) => String(record.studentId) === studentId));
        if (summary.totalSessions && summary.percentage < threshold) low.push({ student: learner.studentId, batchId: id, ...summary, threshold });
      }
    }
    return low;
  },
  async createProgress(auth: Auth, req: Request, input: Record<string, any>) {
    permission(auth, 'progress.update');
    return inTransaction(async (session) => {
      if (!(await repository.isStudentActive(auth.instituteId, input.studentId, session))) throw bad(404, 'STUDENT_NOT_FOUND', 'Active student was not found');
      if (!(await repository.activeCourseModule(auth.instituteId, input.courseId, input.moduleId, session))) throw bad(422, 'INVALID_COURSE_MODULE', 'Course and module must be active and the module must belong to the course');
      if (!(await repository.studentEnrolledInCourse(auth.instituteId, input.studentId, input.courseId, session))) throw bad(422, 'STUDENT_NOT_ENROLLED', 'Student must be enrolled in the course');
      if (auth.role === 'TEACHER' && !(await repository.teacherAssignedToStudentCourse(auth.instituteId, auth.objectId, input.studentId, input.courseId, session))) throw bad(403, 'BATCH_ASSIGNMENT_REQUIRED', 'Teachers can only manage progress for students in their assigned batches');
      const status = input.status ?? 'NOT_STARTED';
      const progress = await repository.createProgress({ ...input, instituteId: auth.instituteId, completionDate: status === 'COMPLETED' ? input.completionDate ?? new Date() : undefined, history: [{ status, changedAt: new Date(), changedBy: auth.objectId, ...(input.note ? { note: input.note } : {}) }], createdBy: auth.objectId, updatedBy: auth.objectId }, session);
      await audit(req, auth, { action: 'progress.create', entityType: 'CourseProgress', entityId: String(progress.progressId), after: progress, session });
      return progress;
    });
  },
  async updateProgress(auth: Auth, req: Request, id: string, input: Record<string, any>) {
    permission(auth, 'progress.update');
    return inTransaction(async (session) => {
      const before = await repository.findProgress(auth.instituteId, id, session);
      if (!before) throw bad(404, 'PROGRESS_NOT_FOUND', 'Course progress was not found');
      if (auth.role === 'TEACHER' && !(await repository.teacherAssignedToStudentCourse(auth.instituteId, auth.objectId, String(before.studentId), String(before.courseId), session))) throw bad(403, 'BATCH_ASSIGNMENT_REQUIRED', 'Teachers can only manage progress for students in their assigned batches');
      const status = input.status ?? before.status;
      const history = [...before.history, { status, changedAt: new Date(), changedBy: auth.objectId, ...(input.note ? { note: input.note } : {}) }];
      const update: Record<string, unknown> = { history, updatedBy: auth.objectId };
      if (input.status) update.status = status;
      if (status === 'COMPLETED') update.completionDate = input.completionDate ?? before.completionDate ?? new Date();
      else if (input.completionDate !== undefined) update.completionDate = input.completionDate;
      const after = await repository.updateProgress(String(before._id), auth.instituteId, update, session);
      await audit(req, auth, { action: 'progress.update', entityType: 'CourseProgress', entityId: String(before.progressId), before, after, session });
      return after;
    });
  },
  async listProgress(auth: Auth, studentId?: string, courseId?: string) {
    permission(auth, 'progress.view');
    let resolvedStudent = studentId;
    if (auth.role === 'STUDENT') { const student = await repository.studentByUserId(auth.instituteId, auth.objectId); if (!student) throw bad(404, 'STUDENT_NOT_LINKED', 'Student profile is not linked to this account'); if (studentId && studentId !== String(student._id)) throw bad(403, 'STUDENT_ACCESS_DENIED', 'Students can only view their own progress'); resolvedStudent = String(student._id); }
    if (resolvedStudent) await visibleStudent(auth, resolvedStudent);
    let courses: string | string[] | undefined = courseId;
    if (auth.role === 'TEACHER') { const assigned = await repository.teacherCourses(auth.instituteId, auth.objectId); courses = courseId ? assigned.map(String).includes(courseId) ? courseId : [] : assigned.map(String); }
    const rows = await repository.listProgress(auth.instituteId, resolvedStudent, courses);
    if (auth.role !== 'TEACHER') return rows;
    const visible = [];
    for (const row of rows) if (await repository.teacherAssignedToStudentCourse(auth.instituteId, auth.objectId, String(row.studentId?._id ?? row.studentId), String(row.courseId?._id ?? row.courseId))) visible.push(row);
    return visible;
  },
  async progressHistory(auth: Auth, studentId: string) {
    permission(auth, 'progress.view');
    let resolved = studentId;
    if (auth.role === 'STUDENT') { const student = await repository.studentByUserId(auth.instituteId, auth.objectId); if (!student || studentId !== String(student._id)) throw bad(403, 'STUDENT_ACCESS_DENIED', 'Students can only view their own progress history'); resolved = String(student._id); }
    await visibleStudent(auth, resolved);
    const rows = await repository.listProgressHistory(auth.instituteId, resolved, auth.role === 'TEACHER' ? (await repository.teacherCourses(auth.instituteId, auth.objectId)).map(String) : undefined);
    if (auth.role !== 'TEACHER') return rows;
    const visible = [];
    for (const row of rows) if (await repository.teacherAssignedToStudentCourse(auth.instituteId, auth.objectId, resolved, String(row.courseId))) visible.push(row);
    if (!visible.length) throw bad(403, 'BATCH_ASSIGNMENT_REQUIRED', 'Teachers can only view progress history for assigned students');
    return visible;
  },
  async stalledProgress(auth: Auth, days: number, courseId?: string) {
    permission(auth, 'progress.view');
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    if (auth.role === 'STUDENT') { const student = await repository.studentByUserId(auth.instituteId, auth.objectId); if (!student) throw bad(404, 'STUDENT_NOT_LINKED', 'Student profile is not linked to this account'); return repository.stalledProgress(auth.instituteId, cutoff, courseId ? [courseId] : undefined, String(student._id)); }
    if (auth.role === 'TEACHER') { const courses = (await repository.teacherCourses(auth.instituteId, auth.objectId)).map(String); const rows = await repository.stalledProgress(auth.instituteId, cutoff, courseId ? courses.includes(courseId) ? [courseId] : [] : courses); const visible = []; for (const row of rows) if (await repository.teacherAssignedToStudentCourse(auth.instituteId, auth.objectId, String(row.studentId?._id ?? row.studentId), String(row.courseId?._id ?? row.courseId))) visible.push(row); return visible; }
    if (auth.role !== 'OWNER_ADMIN') throw bad(403, 'PERMISSION_FORBIDDEN', 'This role cannot view stalled progress');
    return repository.stalledProgress(auth.instituteId, cutoff, courseId ? [courseId] : undefined);
  }
};
