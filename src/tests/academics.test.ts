import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCourse: vi.fn(), findCourse: vi.fn(), listCourses: vi.fn(), updateCourse: vi.fn(), createModule: vi.fn(), listModules: vi.fn(), updateModule: vi.fn(),
  createBatch: vi.fn(), findBatch: vi.fn(), listBatches: vi.fn(), updateBatch: vi.fn(), teacherExists: vi.fn(), activeCourseExists: vi.fn(), activeStudentExists: vi.fn(), admissionMatches: vi.fn(),
  reserveSeat: vi.fn(), incrementSeat: vi.fn(), decrementSeat: vi.fn(), countEnrollments: vi.fn(), createEnrollment: vi.fn(), listEnrollments: vi.fn(), findEnrollment: vi.fn(), updateEnrollment: vi.fn(),
  findConflicts: vi.fn(), createTimetable: vi.fn(), listTimetable: vi.fn(), updateTimetable: vi.fn(), findTimetable: vi.fn(), cancelBatchTimetables: vi.fn(), audit: vi.fn(), transaction: vi.fn(), batchDistinct: vi.fn()
}));
vi.mock('../repositories/academics.repository.js', () => ({ academicsRepository: mocks }));
vi.mock('../models/batch.model.js', () => ({ BatchModel: { find: () => ({ distinct: mocks.batchDistinct }) } }));
vi.mock('../services/audit.service.js', () => ({ AuditService: { record: mocks.audit } }));
vi.mock('../utils/transaction.js', () => ({ inTransaction: mocks.transaction }));
import { academicsService } from '../services/academics.service.js';
import type { AuthenticatedUser } from '../types/auth.js';

const owner: AuthenticatedUser = { objectId: '64b000000000000000000001', userId: 'SN-USR-2026-00001', instituteId: '64b000000000000000000002', instituteBusinessId: 'SN-INS-2026-00001', name: 'Admin', role: 'OWNER_ADMIN', authVersion: 0 };
const teacher = { ...owner, role: 'TEACHER' as const };
const req = { correlationId: 'academics-test', ip: '127.0.0.1', header: () => undefined } as never;
const batch = { _id: '64b000000000000000000010', batchCode: 'SN-BAT-2026-00001', instituteId: owner.instituteId, courseId: '64b000000000000000000011', teacherId: '64b000000000000000000012', capacity: 1, enrolledCount: 1, status: 'ACTIVE', startDate: new Date('2026-11-01'), endDate: new Date('2027-01-01'), schedule: [], mode: 'IN_PERSON', room: 'R1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((work) => work({}));
  mocks.audit.mockResolvedValue({});
  mocks.findConflicts.mockResolvedValue([]);
  mocks.cancelBatchTimetables.mockResolvedValue({});
  mocks.teacherExists.mockResolvedValue(true);
  mocks.activeCourseExists.mockResolvedValue(true);
  mocks.activeStudentExists.mockResolvedValue(true);
});

describe('academics domain', () => {
  it('keeps deactivated courses readable and versions edits with an audit record', async () => {
    const course = { _id: '64b000000000000000000020', courseCode: 'SN-CRS-2026-00001', code: 'BIO1', name: 'Biology', version: 1, history: [], status: 'ACTIVE', duration: { value: 4, unit: 'MONTHS' }, fee: 2000, toObject() { return { ...this }; } };
    mocks.findCourse.mockResolvedValue(course);
    mocks.updateCourse.mockResolvedValue({ ...course, version: 2, status: 'INACTIVE' });
    const result = await academicsService.updateCourse(owner, req, course.courseCode, { status: 'INACTIVE' });
    expect(mocks.updateCourse).toHaveBeenCalledWith(course._id, owner.instituteId, expect.objectContaining({ version: 2, history: [expect.objectContaining({ version: 1 })] }), expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'course.deactivate', entityId: course.courseCode }));
    expect(result?.status).toBe('INACTIVE');
  });

  it('blocks timetable saves on teacher, room, or batch conflicts and returns conflict details', async () => {
    mocks.findBatch.mockResolvedValue(batch);
    mocks.findConflicts.mockResolvedValue([{ timetableId: 'SN-TIM-2026-001', teacherId: batch.teacherId, batchId: batch._id, room: 'R1', weekday: 1, startTime: '09:00', endTime: '10:30' }]);
    await expect(academicsService.createTimetable(owner, req, { batchId: batch._id, weekday: 1, startTime: '09:30', endTime: '10:30', effectiveFrom: batch.startDate, effectiveTo: batch.endDate })).rejects.toMatchObject({ statusCode: 409, code: 'TIMETABLE_CONFLICT', errors: [expect.objectContaining({ conflictTypes: expect.arrayContaining(['TEACHER', 'ROOM', 'BATCH']) })] });
    expect(mocks.createTimetable).not.toHaveBeenCalled();
  });

  it('reports a full batch without persisting an enrollment', async () => {
    mocks.findBatch.mockResolvedValue(batch);
    mocks.reserveSeat.mockResolvedValue(null);
    await expect(academicsService.enroll(owner, req, batch._id, { studentId: '64b000000000000000000030' })).rejects.toMatchObject({ statusCode: 409, code: 'BATCH_CAPACITY_REACHED', errors: [{ capacity: 1, enrolledCount: 1 }] });
    expect(mocks.createEnrollment).not.toHaveBeenCalled();
  });

  it('requires owner override permission and records an authorized capacity override', async () => {
    await expect(academicsService.enroll(teacher, req, batch._id, { studentId: '64b000000000000000000030', capacityOverrideReason: 'Approved additional seat' })).rejects.toMatchObject({ statusCode: 403, code: 'PERMISSION_FORBIDDEN' });
    mocks.findBatch.mockResolvedValue(batch);
    mocks.incrementSeat.mockResolvedValue({ ...batch, enrolledCount: 2 });
    mocks.createEnrollment.mockResolvedValue({ enrollmentId: 'SN-ENR-2026-00001', capacityOverride: { authorizedBy: owner.objectId, reason: 'Approved additional seat' } });
    await academicsService.enroll(owner, req, batch._id, { studentId: '64b000000000000000000030', capacityOverrideReason: 'Approved additional seat' });
    expect(mocks.incrementSeat).toHaveBeenCalledWith(owner.instituteId, batch._id, expect.anything());
    expect(mocks.createEnrollment).toHaveBeenCalledWith(expect.objectContaining({ capacityOverride: expect.objectContaining({ authorizedBy: owner.objectId, reason: 'Approved additional seat' }) }), expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'batch.capacity.override', reason: 'Approved additional seat' }));
  });

  it('validates course, batch, student, and teacher in the authenticated institute', async () => {
    mocks.listCourses.mockResolvedValue({ items: [], total: 0 });
    await academicsService.listCourses(owner, { page: 1, limit: 25 });
    expect(mocks.listCourses).toHaveBeenCalledWith(owner.instituteId, 1, 25, undefined, undefined, undefined);
    mocks.findBatch.mockResolvedValue(batch);
    mocks.activeStudentExists.mockResolvedValue(false);
    await expect(academicsService.enroll(owner, req, batch._id, { studentId: '64b000000000000000000030' })).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_STUDENT' });
  });

  it('limits teacher batch listings to batches assigned to the authenticated teacher', async () => {
    const assigned = { ...batch, teacherId: teacher.objectId };
    mocks.batchDistinct.mockResolvedValueOnce([assigned._id]).mockResolvedValueOnce([assigned.courseId]);
    mocks.listBatches.mockResolvedValue({ items: [assigned], total: 1 });
    await academicsService.listBatches(teacher, { page: 1, limit: 25 });
    expect(mocks.listBatches).toHaveBeenCalledWith(teacher.instituteId, 1, 25, undefined, undefined, [assigned._id]);
  });
});
