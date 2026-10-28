import mongoose, { type ClientSession } from 'mongoose';
import { AttendanceSessionModel } from '../models/attendance-session.model.js';
import { AttendanceRecordModel } from '../models/attendance-record.model.js';
import { CourseProgressModel } from '../models/course-progress.model.js';
import { BatchModel } from '../models/batch.model.js';
import { BatchEnrollmentModel } from '../models/batch-enrollment.model.js';
import { StudentModel } from '../models/student.model.js';
import { CourseModel } from '../models/course.model.js';
import { CourseModuleModel } from '../models/course-module.model.js';

export const attendanceProgressRepository = {
  findBatch(instituteId: string, id: string, session?: ClientSession) { const ident = mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { batchCode: id }] } : { batchCode: id }; return BatchModel.findOne({ instituteId, ...ident }).session(session ?? null); },
  async isTeacherAssigned(instituteId: string, teacherId: string, batchId: string, session?: ClientSession) { return Boolean(await BatchModel.exists({ instituteId, _id: batchId, teacherId }).session(session ?? null)); },
  async isStudentLinked(instituteId: string, userId: string, studentId: string, session?: ClientSession) { return Boolean(await StudentModel.exists({ instituteId, userId, _id: studentId }).session(session ?? null)); },
  studentByUserId(instituteId: string, userId: string) { return StudentModel.findOne({ instituteId, userId, status: { $ne: 'ARCHIVED' } }).select('_id studentId name').lean(); },
  async isStudentActive(instituteId: string, studentId: string, session?: ClientSession) { return Boolean(await StudentModel.exists({ instituteId, _id: studentId, status: 'ACTIVE' }).session(session ?? null)); },
  async studentExists(instituteId: string, studentId: string) { return Boolean(await StudentModel.exists({ instituteId, _id: studentId })); },
  async isEnrolled(instituteId: string, batchId: string, studentId: string, session?: ClientSession) { return Boolean(await BatchEnrollmentModel.exists({ instituteId, batchId, studentId, status: 'ACTIVE' }).session(session ?? null)); },
  enrolledStudents(instituteId: string, batchId: string, session?: ClientSession) { return BatchEnrollmentModel.find({ instituteId, batchId, status: 'ACTIVE' }).select('studentId').session(session ?? null).lean(); },
  countEnrolled(instituteId: string, batchId: string, session?: ClientSession) { return BatchEnrollmentModel.countDocuments({ instituteId, batchId, status: 'ACTIVE' }).session(session ?? null); },
  teacherBatches(instituteId: string, teacherId: string) { return BatchModel.find({ instituteId, teacherId, status: { $in: ['PLANNED', 'ACTIVE', 'COMPLETED'] } }).select('_id').lean(); },
  allBatches(instituteId: string) { return BatchModel.find({ instituteId, status: { $in: ['PLANNED', 'ACTIVE', 'COMPLETED'] } }).select('_id').lean(); },
  createSession(input: Record<string, unknown>, session: ClientSession) { return AttendanceSessionModel.create([input], { session }).then(([doc]) => doc!); },
  findSession(instituteId: string, id: string, session?: ClientSession) { const ident = mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { sessionId: id }] } : { sessionId: id }; return AttendanceSessionModel.findOne({ instituteId, ...ident }).session(session ?? null); },
  listSessions(instituteId: string, batchId: string, from?: Date, to?: Date) { const filter: Record<string, unknown> = { instituteId, batchId }; if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }; return AttendanceSessionModel.find(filter).sort({ date: -1, _id: -1 }).lean(); },
  createRecords(inputs: Record<string, unknown>[], session: ClientSession) { return AttendanceRecordModel.create(inputs, { session, ordered: true }); },
  findRecord(instituteId: string, id: string, session?: ClientSession) { const ident = mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { recordId: id }] } : { recordId: id }; return AttendanceRecordModel.findOne({ instituteId, ...ident }).session(session ?? null); },
  updateRecord(id: string, instituteId: string, update: Record<string, unknown>, session: ClientSession) { return AttendanceRecordModel.findOneAndUpdate({ _id: id, instituteId }, { $set: update }, { new: true, runValidators: true, session }); },
  listStudentRecords(instituteId: string, studentId: string, page: number, limit: number, batchIds?: string[]) { const filter: Record<string, unknown> = { instituteId, studentId }; if (batchIds) filter.batchId = { $in: batchIds }; return Promise.all([AttendanceRecordModel.find(filter).populate('sessionObjectId').sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(), AttendanceRecordModel.countDocuments(filter)]).then(([items, total]) => ({ items, total })); },
  studentEnrollmentBatches(instituteId: string, studentId: string) { return BatchEnrollmentModel.find({ instituteId, studentId, status: { $in: ['ACTIVE', 'COMPLETED', 'WITHDRAWN'] } }).select('batchId').lean(); },
  assignedBatchIds(instituteId: string, teacherId: string, batchIds: string[]) { return BatchModel.find({ instituteId, teacherId, _id: { $in: batchIds } }).distinct('_id'); },
  sessionsForBatches(instituteId: string, batchIds: string[]) { if (!batchIds.length) return Promise.resolve([]); return AttendanceSessionModel.find({ instituteId, batchId: { $in: batchIds }, status: 'COMPLETED' }).select('_id batchId date').lean(); },
  recordsForSessions(instituteId: string, studentId: string, sessionIds: string[]) { if (!sessionIds.length) return Promise.resolve([]); return AttendanceRecordModel.find({ instituteId, studentId, sessionObjectId: { $in: sessionIds } }).select('sessionObjectId status timestamp').lean(); },
  enrolledBatchStudents(instituteId: string, batchId: string) { return BatchEnrollmentModel.find({ instituteId, batchId, status: 'ACTIVE' }).select('studentId').populate('studentId', 'studentId name').lean(); },
  completedSessionsForBatch(instituteId: string, batchId: string) { return AttendanceSessionModel.find({ instituteId, batchId, status: 'COMPLETED' }).select('_id').lean(); },
  attendanceRecordsForBatchSessions(instituteId: string, batchId: string, sessionIds: string[]) { if (!sessionIds.length) return Promise.resolve([]); return AttendanceRecordModel.find({ instituteId, batchId, sessionObjectId: { $in: sessionIds } }).select('studentId sessionObjectId status').lean(); },
  existingRecords(instituteId: string, sessionObjectId: string, studentIds: string[], session?: ClientSession) { return AttendanceRecordModel.find({ instituteId, sessionObjectId, studentId: { $in: studentIds } }).select('studentId').session(session ?? null).lean(); },
  sessionRecords(instituteId: string, sessionObjectId: string) { return AttendanceRecordModel.find({ instituteId, sessionObjectId }).populate('studentId', 'studentId name').sort({ timestamp: 1 }).lean(); },
  countSessionRecords(instituteId: string, sessionObjectId: string, session?: ClientSession) { return AttendanceRecordModel.countDocuments({ instituteId, sessionObjectId }).session(session ?? null); },
  async updateSessionStatus(instituteId: string, sessionId: string, status: string, actorId: string, session: ClientSession) { return AttendanceSessionModel.findOneAndUpdate({ _id: sessionId, instituteId }, { $set: { status, updatedBy: actorId } }, { new: true, runValidators: true, session }); },
  createProgress(input: Record<string, unknown>, session: ClientSession) { return CourseProgressModel.create([input], { session }).then(([doc]) => doc!); },
  findProgress(instituteId: string, id: string, session?: ClientSession) { const ident = mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { progressId: id }] } : { progressId: id }; return CourseProgressModel.findOne({ instituteId, ...ident }).session(session ?? null); },
  updateProgress(id: string, instituteId: string, update: Record<string, unknown>, session: ClientSession) { return CourseProgressModel.findOneAndUpdate({ _id: id, instituteId }, { $set: update }, { new: true, runValidators: true, session }); },
  listProgress(instituteId: string, studentId?: string, courseId?: string | string[]) { const filter: Record<string, unknown> = { instituteId }; if (studentId) filter.studentId = studentId; if (Array.isArray(courseId)) filter.courseId = { $in: courseId }; else if (courseId) filter.courseId = courseId; return CourseProgressModel.find(filter).populate('studentId courseId moduleId').sort({ updatedAt: -1 }).lean(); },
  async studentEnrolledInCourse(instituteId: string, studentId: string, courseId: string, session?: ClientSession) { const enrollments = await BatchEnrollmentModel.find({ instituteId, studentId, status: 'ACTIVE' }).select('batchId').session(session ?? null).lean(); return Boolean(enrollments.length && await BatchModel.exists({ instituteId, _id: { $in: enrollments.map((item) => item.batchId) }, courseId, status: { $in: ['PLANNED', 'ACTIVE'] } }).session(session ?? null)); },
  listProgressHistory(instituteId: string, studentId: string, courseIds?: string[]) { return CourseProgressModel.find({ instituteId, studentId, ...(courseIds ? { courseId: { $in: courseIds } } : {}) }).sort({ updatedAt: -1 }).lean(); },
  async activeCourseModule(instituteId: string, courseId: string, moduleId: string, session?: ClientSession) { const [course, module] = await Promise.all([CourseModel.exists({ _id: courseId, instituteId, status: 'ACTIVE' }).session(session ?? null), CourseModuleModel.exists({ _id: moduleId, instituteId, courseId, isActive: true }).session(session ?? null)]); return Boolean(course && module); },
  async teacherAssignedToStudentCourse(instituteId: string, teacherId: string, studentId: string, courseId: string, session?: ClientSession) {
    const enrollments = await BatchEnrollmentModel.find({ instituteId, studentId, status: 'ACTIVE' }).select('batchId').session(session ?? null).lean();
    return Boolean(enrollments.length && await BatchModel.exists({ instituteId, _id: { $in: enrollments.map((item) => item.batchId) }, teacherId, courseId, status: { $in: ['PLANNED', 'ACTIVE'] } }).session(session ?? null));
  },
  stalledProgress(instituteId: string, cutoff: Date, courseIds?: string[], studentId?: string) { const filter: Record<string, unknown> = { instituteId, status: { $in: ['IN_PROGRESS', 'BLOCKED'] }, updatedAt: { $lte: cutoff } }; if (courseIds) filter.courseId = { $in: courseIds }; if (studentId) filter.studentId = studentId; return CourseProgressModel.find(filter).populate('studentId courseId moduleId').sort({ updatedAt: 1 }).lean(); },
  teacherCourses(instituteId: string, teacherId: string) { return BatchModel.distinct('courseId', { instituteId, teacherId, status: { $in: ['PLANNED', 'ACTIVE'] } }); }
};
