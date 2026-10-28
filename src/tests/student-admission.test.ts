import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admissionFindLead: vi.fn(), admissionFindById: vi.fn(), admissionCreate: vi.fn(), admissionUpdate: vi.fn(), admissionList: vi.fn(), validateReferences: vi.fn(),
  studentFindById: vi.fn(), studentCreate: vi.fn(), createGuardians: vi.fn(), studentUpdate: vi.fn(), studentList: vi.fn(), findDuplicates: vi.fn(), finance: vi.fn(),
  audit: vi.fn(), transaction: vi.fn(), staffFindOne: vi.fn()
}));
vi.mock('../repositories/admission.repository.js', () => ({ admissionRepository: { findLead: mocks.admissionFindLead, findById: mocks.admissionFindById, create: mocks.admissionCreate, update: mocks.admissionUpdate, list: mocks.admissionList, validateReferences: mocks.validateReferences } }));
vi.mock('../repositories/student.repository.js', () => ({ studentRepository: { findById: mocks.studentFindById, create: mocks.studentCreate, createGuardians: mocks.createGuardians, update: mocks.studentUpdate, list: mocks.studentList, findDuplicates: mocks.findDuplicates, finance: mocks.finance } }));
vi.mock('../services/audit.service.js', () => ({ AuditService: { record: mocks.audit } }));
vi.mock('../utils/transaction.js', () => ({ inTransaction: mocks.transaction }));
vi.mock('../models/staff.model.js', () => ({ StaffModel: { findOne: mocks.staffFindOne } }));

import { studentAdmissionService } from '../services/student-admission.service.js';
import type { AuthenticatedUser } from '../types/auth.js';

const auth: AuthenticatedUser = { objectId: '64b000000000000000000001', userId: 'SN-USR-2026-00001', instituteId: '64b000000000000000000002', instituteBusinessId: 'SN-INS-2026-00001', name: 'Registrar', role: 'OWNER_ADMIN', authVersion: 0 };
const req = { correlationId: 'admission-test', ip: '127.0.0.1', header: () => undefined } as never;
const lead = { _id: '64b000000000000000000003', leadId: 'SN-LEAD-2026-00001', instituteId: auth.instituteId, name: 'Student One', mobile: '+919876543210', email: 'one@example.com', sourceId: '64b000000000000000000004', status: 'INTERESTED', updatedBy: auth.objectId, toObject() { return { ...this }; }, async save() { return this; } };
const admission = { _id: '64b000000000000000000005', admissionId: 'SN-ADM-2026-00001', leadObjectId: lead._id, leadId: lead.leadId, sourceId: lead.sourceId, courseId: '64b000000000000000000006', batchId: '64b000000000000000000007', feePlanId: '64b000000000000000000008', studentDetails: { name: lead.name, mobile: lead.mobile, email: lead.email, guardians: [] }, status: 'PENDING' };
const student = { _id: '64b000000000000000000009', studentId: 'SN-STU-2026-00001', instituteId: auth.instituteId, name: lead.name, mobile: lead.mobile, email: lead.email, status: 'ACTIVE' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((work) => work({}));
  mocks.validateReferences.mockResolvedValue({ course: true, batch: true, feePlan: true });
  mocks.findDuplicates.mockResolvedValue([]);
  mocks.createGuardians.mockResolvedValue([]);
  mocks.audit.mockResolvedValue({});
  mocks.staffFindOne.mockReturnValue({ select: () => ({ session: () => Promise.resolve(null) }) });
});

describe('admission and student flow', () => {
  it('converts lead to admission and then creates the student transactionally', async () => {
    mocks.admissionFindLead.mockResolvedValue(lead);
    mocks.admissionCreate.mockResolvedValue(admission);
    mocks.staffFindOne.mockReturnValue({ select: () => ({ session: () => Promise.resolve({ _id: '64b000000000000000000012' }) }) });
    await studentAdmissionService.createAdmission(auth, req, { leadId: lead.leadId, courseId: admission.courseId, batchId: admission.batchId, feePlanId: admission.feePlanId });
    expect(mocks.admissionCreate).toHaveBeenCalledWith(expect.objectContaining({ leadId: lead.leadId, sourceId: lead.sourceId, contributedByStaffId: '64b000000000000000000012', instituteId: auth.instituteId }), expect.anything());
    mocks.admissionFindById.mockResolvedValue(admission);
    mocks.studentCreate.mockResolvedValue(student);
    mocks.admissionUpdate.mockResolvedValue({ ...admission, status: 'CONVERTED', studentObjectId: student._id });
    const converted = await studentAdmissionService.convertAdmission(auth, req, admission.admissionId);
    expect(converted.student).toMatchObject({ studentId: student.studentId });
    expect(converted.admission).toMatchObject({ status: 'CONVERTED', studentObjectId: student._id });
    expect(lead.status).toBe('ADMISSION');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.convert', entityId: lead.leadId }));
  });

  it('rejects duplicate identity before creating a student', async () => {
    mocks.findDuplicates.mockResolvedValue([{ studentId: student.studentId, name: student.name, mobile: student.mobile }]);
    await expect(studentAdmissionService.createStudent(auth, req, { name: student.name, mobile: student.mobile, identityType: 'NATIONAL_ID', identityNumber: 'ID-1234', guardians: [] })).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_STUDENT', errors: [{ studentId: student.studentId }] });
    expect(mocks.studentCreate).not.toHaveBeenCalled();
  });

  it('scopes student self-service list and lookup to the linked account', async () => {
    const self = { ...auth, role: 'STUDENT' as const };
    mocks.studentList.mockResolvedValue({ items: [student], total: 1 });
    mocks.studentFindById.mockResolvedValue(student);
    await studentAdmissionService.listStudents(self, 1, 20);
    expect(mocks.studentList).toHaveBeenCalledWith(self.instituteId, 1, 20, undefined, undefined, self.objectId);
    await studentAdmissionService.getStudent(self, student.studentId);
    expect(mocks.studentFindById).toHaveBeenCalledWith(self.instituteId, student.studentId, undefined, self.objectId);
  });

  it('does not return another student in the same institute to a student account', async () => {
    const self = { ...auth, role: 'STUDENT' as const };
    mocks.studentFindById.mockResolvedValue(null);
    await expect(studentAdmissionService.getStudent(self, 'SN-STU-2026-OTHER')).rejects.toMatchObject({ statusCode: 404, code: 'STUDENT_NOT_FOUND' });
    expect(mocks.studentFindById).toHaveBeenCalledWith(self.instituteId, 'SN-STU-2026-OTHER', undefined, self.objectId);
  });

  it('prevents converting the same admission twice', async () => {
    mocks.admissionFindById.mockResolvedValue({ ...admission, status: 'CONVERTED', studentObjectId: student._id });
    await expect(studentAdmissionService.convertAdmission(auth, req, admission.admissionId)).rejects.toMatchObject({ statusCode: 409, code: 'ADMISSION_ALREADY_CONVERTED' });
    expect(mocks.studentCreate).not.toHaveBeenCalled();
  });
});
