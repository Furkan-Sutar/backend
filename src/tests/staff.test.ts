import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffFindOne: vi.fn(), staffCreate: vi.fn(), userFindOne: vi.fn(), courseFindOne: vi.fn(), batchFindOne: vi.fn(),
  timetableFind: vi.fn(), timetableUpdateMany: vi.fn(), assignmentFindOne: vi.fn(), assignmentCreate: vi.fn(),
  audit: vi.fn(), transaction: vi.fn(),
  admissionCount: vi.fn(), paymentAggregate: vi.fn(), teacherAssignmentCount: vi.fn(), salaryFind: vi.fn(), collectionCount: vi.fn()
}));
vi.mock('../models/staff.model.js', () => ({ StaffModel: { find: vi.fn(), countDocuments: vi.fn(), findOne: mocks.staffFindOne, create: mocks.staffCreate } }));
vi.mock('../models/user.model.js', () => ({ UserModel: { findOne: mocks.userFindOne } }));
vi.mock('../models/teacher-assignment.model.js', () => ({ TeacherAssignmentModel: { find: vi.fn(), findOne: mocks.assignmentFindOne, create: mocks.assignmentCreate, countDocuments: mocks.teacherAssignmentCount } }));
vi.mock('../models/collection-responsibility.model.js', () => ({ CollectionResponsibilityModel: { find: vi.fn(), findOne: vi.fn(), create: vi.fn(), countDocuments: mocks.collectionCount } }));
vi.mock('../models/batch.model.js', () => ({ BatchModel: { findOne: mocks.batchFindOne } }));
vi.mock('../models/course.model.js', () => ({ CourseModel: { findOne: mocks.courseFindOne } }));
vi.mock('../models/timetable.model.js', () => ({ TimetableModel: { find: mocks.timetableFind, updateMany: mocks.timetableUpdateMany } }));
vi.mock('../models/student.model.js', () => ({ StudentModel: { findOne: vi.fn() } }));
vi.mock('../models/admission.model.js', () => ({ AdmissionModel: { findOne: vi.fn(), countDocuments: mocks.admissionCount } }));
vi.mock('../models/payment.model.js', () => ({ PaymentModel: { aggregate: mocks.paymentAggregate } }));
vi.mock('../models/staff-salary.model.js', () => ({ StaffSalaryModel: { find: mocks.salaryFind } }));
vi.mock('../models/evidence.model.js', () => ({ EvidenceModel: { find: vi.fn() } }));
vi.mock('../services/audit.service.js', () => ({ AuditService: { record: mocks.audit } }));
vi.mock('../utils/transaction.js', () => ({ inTransaction: mocks.transaction }));

import { staffService } from '../services/staff.service.js';
import type { AuthenticatedUser } from '../types/auth.js';

const owner: AuthenticatedUser = { objectId: '64b000000000000000000001', userId: 'SN-USR-2026-00001', instituteId: '64b000000000000000000002', instituteBusinessId: 'SN-INS-2026-00001', name: 'Owner', role: 'OWNER_ADMIN', authVersion: 0 };
const accountant: AuthenticatedUser = { ...owner, role: 'ACCOUNTANT' };
const req = { correlationId: 'staff-test', ip: '127.0.0.1', header: () => undefined } as never;
const session = {};
const query = (value: unknown) => ({ session: vi.fn().mockResolvedValue(value) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((work) => work(session));
  mocks.audit.mockResolvedValue({});
});

describe('staff management', () => {
  it('links a staff record to an existing institute user without creating another identity', async () => {
    mocks.userFindOne.mockReturnValue(query({ _id: '64b000000000000000000010', role: 'COUNSELLOR', name: 'Casey', email: 'casey@example.com', mobile: '+911234567890' }));
    const record = { staffId: 'SN-STF-2026-00001', name: 'Casey' };
    mocks.staffCreate.mockResolvedValue([record]);
    const result = await staffService.create(owner, req, { userId: '64b000000000000000000010', name: 'Duplicate name', contact: { mobile: '+911234567890' }, role: 'COUNSELLOR', joiningDate: new Date('2026-01-01'), documents: [] });
    expect(mocks.staffCreate).toHaveBeenCalledWith([expect.objectContaining({ userId: '64b000000000000000000010', name: 'Casey', instituteId: owner.instituteId })], { session });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.create', entityType: 'Staff' }));
    expect(result).toBe(record);
  });

  it('rejects linked users from another institute or with an inactive account', async () => {
    mocks.userFindOne.mockReturnValue(query(null));
    await expect(staffService.create(owner, req, { userId: '64b000000000000000000099', name: 'Sam', contact: { email: 'sam@example.com' }, role: 'TEACHER', joiningDate: new Date() })).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_STAFF_USER' });
    expect(mocks.staffCreate).not.toHaveBeenCalled();
  });

  it('does not resolve a staff ID from another institute', async () => {
    mocks.staffFindOne.mockResolvedValue(null);
    await expect(staffService.get(owner, '64b000000000000000000099')).rejects.toMatchObject({ statusCode: 404, code: 'STAFF_NOT_FOUND' });
    expect(mocks.staffFindOne).toHaveBeenCalledWith({ instituteId: owner.instituteId, $or: [{ staffId: '64b000000000000000000099' }, { _id: '64b000000000000000000099' }] });
  });

  it('limits teaching and collection assignment writes to authorized staff managers', async () => {
    await expect(staffService.assignTeaching(accountant, req, 'SN-STF-2026-00001', { courseId: '64b000000000000000000020', batchId: '64b000000000000000000021' })).rejects.toMatchObject({ statusCode: 403, code: 'PERMISSION_FORBIDDEN' });
  });

  it('blocks a teacher assignment when an existing timetable slot overlaps', async () => {
    mocks.staffFindOne.mockReturnValue(query({ _id: '64b000000000000000000011', staffId: 'SN-STF-2026-00001', instituteId: owner.instituteId, role: 'TEACHER', status: 'ACTIVE', userId: '64b000000000000000000012' }));
    mocks.courseFindOne.mockReturnValue(query({ _id: '64b000000000000000000020' }));
    mocks.batchFindOne.mockReturnValue(query({ _id: '64b000000000000000000021', courseId: '64b000000000000000000020', teacherId: '64b000000000000000000013' }));
    mocks.userFindOne.mockReturnValue(query({ _id: '64b000000000000000000012', role: 'TEACHER', status: 'active' }));
    const slot = { weekday: 1, startTime: '09:00', endTime: '10:00', effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2027-01-01') };
    const timetableQuery = vi.fn().mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([slot]) }).mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([{ ...slot, batchId: '64b000000000000000000099', timetableId: 'SN-TIM-2026-00001' }]) });
    mocks.timetableFind.mockReturnValue({ session: timetableQuery });
    await expect(staffService.assignTeaching(owner, req, 'SN-STF-2026-00001', { courseId: '64b000000000000000000020', batchId: '64b000000000000000000021' })).rejects.toMatchObject({ statusCode: 409, code: 'TEACHER_TIMETABLE_CONFLICT' });
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it('summarizes admission, collection, teaching, and salary links through the staff record', async () => {
    const staff = { _id: '64b000000000000000000011', staffId: 'SN-STF-2026-00001', instituteId: owner.instituteId, userId: '64b000000000000000000012' };
    mocks.staffFindOne.mockReturnValue(staff);
    mocks.admissionCount.mockResolvedValue(4);
    mocks.paymentAggregate.mockResolvedValue([{ paymentCount: 3, amount: 1500 }]);
    mocks.teacherAssignmentCount.mockResolvedValue(2);
    mocks.collectionCount.mockResolvedValue(1);
    const salaryRows = [{ salaryId: 'SN-SAL-2026-00001', payPeriod: '2026-06', netPayable: 50000, status: 'PAID' }];
    mocks.salaryFind.mockReturnValue({ select: () => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve(salaryRows) }) }) }) });
    await expect(staffService.contributions(owner, staff.staffId)).resolves.toEqual({ admissionsContributed: 4, collectionResponsibilityCount: 1, collectionsRecorded: { paymentCount: 3, amount: 1500 }, activeTeachingAssignments: 2, salaries: salaryRows });
    expect(mocks.paymentAggregate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ $match: expect.objectContaining({ authorizedBy: staff.userId }) })]));
    expect(mocks.admissionCount).toHaveBeenCalledWith(expect.objectContaining({ contributedByStaffId: staff._id }));
  });
});
