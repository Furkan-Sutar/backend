import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findBatch: vi.fn(), isTeacherAssigned: vi.fn(), isStudentLinked: vi.fn(), studentByUserId: vi.fn(), isStudentActive: vi.fn(), studentExists: vi.fn(), isEnrolled: vi.fn(), enrolledStudents: vi.fn(), countEnrolled: vi.fn(),
  createSession: vi.fn(), findSession: vi.fn(), listSessions: vi.fn(), createRecords: vi.fn(), findRecord: vi.fn(), updateRecord: vi.fn(), listStudentRecords: vi.fn(), studentEnrollmentBatches: vi.fn(), assignedBatchIds: vi.fn(), sessionsForBatches: vi.fn(), recordsForSessions: vi.fn(), enrolledBatchStudents: vi.fn(), completedSessionsForBatch: vi.fn(), attendanceRecordsForBatchSessions: vi.fn(), existingRecords: vi.fn(), sessionRecords: vi.fn(), countSessionRecords: vi.fn(), updateSessionStatus: vi.fn(),
  createProgress: vi.fn(), findProgress: vi.fn(), updateProgress: vi.fn(), listProgress: vi.fn(), listProgressHistory: vi.fn(), activeCourseModule: vi.fn(), studentEnrolledInCourse: vi.fn(), teacherAssignedToStudentCourse: vi.fn(), stalledProgress: vi.fn(), teacherCourses: vi.fn(),
  audit: vi.fn(), transaction: vi.fn()
}));
vi.mock('../repositories/attendance-progress.repository.js', () => ({ attendanceProgressRepository: mocks }));
vi.mock('../services/audit.service.js', () => ({ AuditService: { record: mocks.audit } }));
vi.mock('../utils/transaction.js', () => ({ inTransaction: mocks.transaction }));
import { attendanceProgressService } from '../services/attendance-progress.service.js';
import type { AuthenticatedUser } from '../types/auth.js';

const teacher: AuthenticatedUser = { objectId: '64b000000000000000000001', userId: 'SN-USR-2026-00001', instituteId: '64b000000000000000000002', instituteBusinessId: 'SN-INS-2026-00001', name: 'Teacher', role: 'TEACHER', authVersion: 0 };
const owner: AuthenticatedUser = { ...teacher, role: 'OWNER_ADMIN' };
const req = { correlationId: 'attendance-test', ip: '127.0.0.1', header: () => undefined } as never;
const batch = { _id: '64b000000000000000000010', batchCode: 'SN-BAT-2026-00001', teacherId: teacher.objectId, status: 'ACTIVE', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') };
const session = { _id: '64b000000000000000000011', sessionId: 'SN-ASN-2026-00001', batchId: batch._id, instituteId: teacher.instituteId, status: 'OPEN' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((work) => work({}));
  mocks.audit.mockResolvedValue({});
  mocks.findBatch.mockResolvedValue(batch);
  mocks.findSession.mockResolvedValue(session);
  mocks.enrolledStudents.mockResolvedValue([{ studentId: '64b000000000000000000020' }]);
  mocks.existingRecords.mockResolvedValue([]);
  mocks.createRecords.mockResolvedValue([{ recordId: 'SN-ATR-2026-00001', status: 'PRESENT' }]);
  mocks.countSessionRecords.mockResolvedValue(1);
  mocks.updateSessionStatus.mockResolvedValue({ ...session, status: 'COMPLETED' });
  mocks.studentExists.mockResolvedValue(true);
  mocks.studentEnrollmentBatches.mockResolvedValue([{ batchId: batch._id }]);
  mocks.assignedBatchIds.mockResolvedValue([batch._id]);
});

describe('attendance and course progress', () => {
  it('prevents duplicate student attendance within one session', async () => {
    mocks.existingRecords.mockResolvedValue([{ studentId: '64b000000000000000000020' }]);
    await expect(attendanceProgressService.markRecords(teacher, req, session.sessionId, [{ studentId: '64b000000000000000000020', status: 'PRESENT' }])).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_ATTENDANCE' });
    expect(mocks.createRecords).not.toHaveBeenCalled();
  });

  it('blocks teachers from creating sessions for unassigned batches', async () => {
    mocks.findBatch.mockResolvedValue({ ...batch, teacherId: '64b000000000000000000099' });
    await expect(attendanceProgressService.createSession(teacher, req, { batchId: batch._id, date: new Date('2026-05-05'), subject: 'Math' })).rejects.toMatchObject({ statusCode: 403, code: 'BATCH_ASSIGNMENT_REQUIRED' });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('audits sensitive attendance edits with the reason and actor', async () => {
    mocks.findRecord.mockResolvedValue({ _id: '64b000000000000000000030', recordId: 'SN-ATR-1', batchId: batch._id, status: 'ABSENT', history: [] });
    mocks.updateRecord.mockResolvedValue({ status: 'PRESENT' });
    await attendanceProgressService.updateRecord(teacher, req, 'SN-ATR-1', { status: 'PRESENT', reason: 'Verified signed register' });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'attendance.sensitive_update', reason: 'Verified signed register', actorUserId: teacher.objectId }));
  });

  it('calculates attendance from completed sessions and stored records', async () => {
    mocks.sessionsForBatches.mockResolvedValue([{ _id: 'session-a' }, { _id: 'session-b' }]);
    mocks.recordsForSessions.mockResolvedValue([{ sessionObjectId: 'session-a', status: 'PRESENT' }, { sessionObjectId: 'session-b', status: 'ABSENT' }]);
    await expect(attendanceProgressService.studentPercentage(owner, '64b000000000000000000020')).resolves.toMatchObject({ percentage: 50, attendedSessions: 1, totalSessions: 2 });
  });

  it('limits progress writes by teacher assignment and audits progress changes', async () => {
    mocks.isStudentActive.mockResolvedValue(true);
    mocks.activeCourseModule.mockResolvedValue(true);
    mocks.studentEnrolledInCourse.mockResolvedValue(true);
    mocks.teacherAssignedToStudentCourse.mockResolvedValue(false);
    await expect(attendanceProgressService.createProgress(teacher, req, { studentId: '64b000000000000000000020', courseId: '64b000000000000000000021', moduleId: '64b000000000000000000022', topic: 'Fractions', status: 'IN_PROGRESS' })).rejects.toMatchObject({ statusCode: 403, code: 'BATCH_ASSIGNMENT_REQUIRED' });
    mocks.teacherAssignedToStudentCourse.mockResolvedValue(true);
    mocks.createProgress.mockResolvedValue({ progressId: 'SN-PRG-2026-00001', status: 'IN_PROGRESS' });
    await attendanceProgressService.createProgress(teacher, req, { studentId: '64b000000000000000000020', courseId: '64b000000000000000000021', moduleId: '64b000000000000000000022', topic: 'Fractions', status: 'IN_PROGRESS' });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'progress.create' }));
  });
});
