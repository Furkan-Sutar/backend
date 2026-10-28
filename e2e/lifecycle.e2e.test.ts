import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import request, { type Test } from 'supertest';
import jwt from 'jsonwebtoken';

// Run against a disposable Mongo replica set. Example: MONGO_TEST_URI=mongodb://.../?replicaSet=rs0 npm run test:e2e
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.MONGO_URI ??= process.env.MONGO_TEST_URI ?? 'mongodb://127.0.0.1:27017/skill_nova_test';
process.env.JWT_ACCESS_SECRET ??= 'lifecycle-test-access-secret-at-least-32-characters';
const testUri = process.env.MONGO_TEST_URI;
const { app } = await import('../src/app.js');
const { InstituteModel } = await import('../src/models/institute.model.js');
const { UserModel } = await import('../src/models/user.model.js');
const { StudentModel } = await import('../src/models/student.model.js');
const { FeePlanModel } = await import('../src/models/fee-plan.model.js');
const { FeeInstallmentModel } = await import('../src/models/fee-installment.model.js');
const { AccountTransactionModel } = await import('../src/models/account-transaction.model.js');

type Role = 'OWNER_ADMIN' | 'COUNSELLOR' | 'TEACHER' | 'ACCOUNTANT' | 'STUDENT';
type HttpMethod = 'get' | 'post' | 'patch' | 'put';
const { MongoMemoryReplSet } = await import('mongodb-memory-server');
const password = 'SkillNova-E2E-Password-2030';
const users = new Map<Role, { id: string; email: string; token?: string }>();
let instituteId = '';
let instituteBusinessId = '';
let foreignStudentId = '';
let foreignInstituteBusinessId = '';
let lifecycleStudentId = '';
let replicaSet: InstanceType<typeof MongoMemoryReplSet> | undefined;

function http(method: HttpMethod, path: string, token?: string, body?: object) {
  const req = (request(app) as unknown as Record<HttpMethod, (path: string) => Test>)[method](path);
  if (token) req.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) req.send(body);
  return req;
}

function token(role: Role) {
  const value = users.get(role)?.token;
  if (!value) throw new Error(`Missing token for ${role}`);
  return value;
}

async function loginAll() {
  for (const [role, user] of users) {
    const response = await request(app).post('/api/v1/auth/login').send({ instituteId: instituteBusinessId, identifier: user.email, password });
    expect(response.status, `${role} login: ${JSON.stringify(response.body)}`).toBe(200);
    user.token = response.body.data.accessToken as string;
  }
}

const e2e = describe;

e2e('Skill Nova lifecycle — HTTP + MongoDB replica set', () => {
  beforeAll(async () => {
    let uri = testUri;
    if (!uri) {
      replicaSet = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
      uri = replicaSet.getUri();
    }
    await mongoose.connect(uri);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await mongoose.connection.db!.collection('__lifecycle_transaction_probe').insertOne({ ok: true }, { session });
      });
    } finally { await session.endSession(); }
    await mongoose.connection.db!.dropDatabase();

    const institute = await InstituteModel.create({ name: 'Lifecycle Test Institute', email: 'owner@lifecycle.test', status: 'active' });
    instituteId = String(institute._id);
    instituteBusinessId = institute.instituteId;
    const roleRows: Array<[Role, string]> = [
      ['OWNER_ADMIN', 'owner'], ['COUNSELLOR', 'counsellor'], ['TEACHER', 'teacher'], ['ACCOUNTANT', 'accountant'], ['STUDENT', 'student']
    ];
    for (const [role, name] of roleRows) {
      const email = `${name}@lifecycle.test`;
      const user = await UserModel.create({ instituteId, name, email, passwordHash: password, role, status: 'active' });
      users.set(role, { id: String(user._id), email });
    }

    const foreignInstitute = await InstituteModel.create({ name: 'Foreign Test Institute', email: 'foreign@lifecycle.test', status: 'active' });
    foreignInstituteBusinessId = String(foreignInstitute.instituteId);
    const foreignOwner = await UserModel.create({ instituteId: foreignInstitute._id, name: 'Foreign Owner', email: 'foreign.owner@lifecycle.test', passwordHash: password, role: 'OWNER_ADMIN', status: 'active' });
    const foreignStudent = await StudentModel.create({ instituteId: foreignInstitute._id, name: 'Foreign Student', mobile: '+19990000001', email: 'foreign.student@lifecycle.test', status: 'ACTIVE', createdBy: foreignOwner._id, updatedBy: foreignOwner._id });
    foreignStudentId = String(foreignStudent.studentId);
    await loginAll();
  }, 180_000);

  afterAll(async () => { await mongoose.disconnect(); await replicaSet?.stop(); });

  it('runs CRM → student → academics → assessment → certificate and exercises role boundaries', async () => {
    const owner = token('OWNER_ADMIN');
    const counsellor = token('COUNSELLOR');
    const teacher = token('TEACHER');
    const accountant = token('ACCOUNTANT');
    const studentToken = token('STUDENT');

    const courseResponse = await http('post', '/api/v1/courses', owner, {
      name: 'Lifecycle Basics', code: 'LIFE-101', duration: { value: 8, unit: 'WEEKS' }, fee: 1000, description: 'Lifecycle test course'
    });
    expect(courseResponse.status).toBe(201);
    const course = courseResponse.body.data;
    const moduleResponse = await http('post', `/api/v1/courses/${course._id}/modules`, owner, {
      moduleCode: 'M1', name: 'Foundations', sequence: 1, hours: 8, objectives: ['Complete the course']
    });
    expect(moduleResponse.status).toBe(201);
    const module = moduleResponse.body.data;

    const startDate = new Date(Date.now() - 86_400_000);
    const endDate = new Date(Date.now() + 90 * 86_400_000);
    const timetable = [{ weekday: 1, startTime: '09:00', endTime: '10:00' }];
    const batchResponse = await http('post', '/api/v1/batches', owner, {
      name: 'Lifecycle Batch', courseId: course._id, teacherId: users.get('TEACHER')!.id,
      startDate, endDate, capacity: 1, schedule: timetable, room: 'L-101', mode: 'IN_PERSON', status: 'ACTIVE'
    });
    expect(batchResponse.status, JSON.stringify(batchResponse.body)).toBe(201);
    const batch = batchResponse.body.data;

    const leadBody = { name: 'Aarav Lifecycle', mobile: '+919876500001', email: 'aarav.lifecycle@test.invalid', interestedCourseId: course._id, notes: 'E2E lead' };
    const leadResponse = await http('post', '/api/v1/leads', counsellor, leadBody);
    expect(leadResponse.status).toBe(201);
    const lead = leadResponse.body.data;
    const followUp = await http('post', `/api/v1/leads/${lead.leadId}/follow-ups`, counsellor, { scheduledAt: new Date(Date.now() + 86_400_000), notes: 'Call tomorrow' });
    expect(followUp.status).toBe(201);
    const counselling = await http('post', `/api/v1/leads/${lead.leadId}/activities`, counsellor, { type: 'COUNSELLING', summary: 'Initial counselling' });
    expect(counselling.status).toBe(201);
    const duplicateLead = await http('post', '/api/v1/leads', counsellor, { ...leadBody, name: 'Duplicate Lead' });
    expect(duplicateLead.status).toBe(409);
    expect(duplicateLead.body.code).toBe('DUPLICATE_LEAD');
    const invalidLead = await http('post', '/api/v1/leads', counsellor, { name: '', mobile: 'bad', extra: 'mass assignment' });
    expect(invalidLead.status).toBe(400);

    // Admission creation requires an active fee-plan reference, while the real fee plan is only
    // creatable after conversion. Seed a reference plan to satisfy that existing API contract.
    const bootstrapStudent = await StudentModel.create({ instituteId, name: 'Bootstrap Student', mobile: '+919876599999', email: 'bootstrap@lifecycle.test', createdBy: users.get('OWNER_ADMIN')!.id, updatedBy: users.get('OWNER_ADMIN')!.id });
    const bootstrapPlan = await FeePlanModel.create({
      instituteId, studentId: bootstrapStudent._id, admissionId: new Types.ObjectId(), courseId: course._id,
      courseFee: course.fee, discountAmount: 0, finalFee: course.fee, amountPaid: 0, amountDue: course.fee,
      status: 'ACTIVE', createdBy: users.get('OWNER_ADMIN')!.id, updatedBy: users.get('OWNER_ADMIN')!.id
    });
    const admissionResponse = await http('post', '/api/v1/admissions', counsellor, {
      leadId: lead.leadId, courseId: course._id, batchId: batch._id, feePlanId: bootstrapPlan._id,
      student: { name: lead.name, mobile: lead.mobile, email: lead.email, guardians: [{ name: 'Guardian', relationship: 'Parent', mobile: '+919876500002', isPrimary: true }] }
    });
    expect(admissionResponse.status, JSON.stringify(admissionResponse.body)).toBe(201);
    const admission = admissionResponse.body.data;
    const conversion = await http('post', `/api/v1/admissions/${admission.admissionId}/convert`, owner, {});
    expect(conversion.status, JSON.stringify(conversion.body)).toBe(201);
    const student = conversion.body.data.student;
    lifecycleStudentId = student.studentId as string;
    const linked = await http('patch', `/api/v1/students/${student.studentId}`, owner, { userId: users.get('STUDENT')!.id });
    expect(linked.status).toBe(200);
    const duplicateStudent = await http('post', '/api/v1/students', owner, { name: 'Aarav duplicate', mobile: lead.mobile, email: lead.email });
    expect(duplicateStudent.status).toBe(409);
    expect(duplicateStudent.body.code).toBe('DUPLICATE_STUDENT');
    expect((await http('get', `/api/v1/students/${student.studentId}`, studentToken)).status).toBe(200);
    expect((await http('get', `/api/v1/students/${foreignStudentId}`, owner)).status).toBe(404);
    expect((await http('get', `/api/v1/admissions`, teacher)).status).toBe(403);

    const feePlanResponse = await http('post', '/api/v1/fee-plans', owner, {
      admissionId: admission._id, courseId: course._id,
      installments: [
        { dueDate: new Date(Date.now() + 10 * 86_400_000), amount: 500 },
        { dueDate: new Date(Date.now() + 40 * 86_400_000), amount: 500 }
      ]
    });
    expect(feePlanResponse.status, JSON.stringify(feePlanResponse.body)).toBe(201);
    const feePlan = feePlanResponse.body.data;
    const installments = await FeeInstallmentModel.find({ instituteId, feePlanId: feePlan._id }).sort({ sequence: 1 });
    expect(installments).toHaveLength(2);

    const enrollment = await http('post', `/api/v1/batches/${batch._id}/enrollments`, owner, { studentId: student._id, admissionId: admission._id });
    expect(enrollment.status).toBe(201);
    const overflowStudent = await http('post', '/api/v1/students', owner, { name: 'Overflow Student', mobile: '+919876500099', email: 'overflow@lifecycle.test' });
    expect(overflowStudent.status).toBe(201);
    const fullBatch = await http('post', `/api/v1/batches/${batch._id}/enrollments`, owner, { studentId: overflowStudent.body.data._id });
    expect(fullBatch.status).toBe(409);
    expect(fullBatch.body.code).toBe('BATCH_CAPACITY_REACHED');
    const timetableConflict = await http('post', '/api/v1/batches', owner, {
      name: 'Conflicting Batch', courseId: course._id, teacherId: users.get('TEACHER')!.id,
      startDate, endDate, capacity: 2, schedule: timetable, room: 'L-101', mode: 'IN_PERSON', status: 'ACTIVE'
    });
    expect(timetableConflict.status).toBe(409);
    expect(timetableConflict.body.code).toBe('TIMETABLE_CONFLICT');

    const attendanceSession = await http('post', '/api/v1/attendance/sessions', teacher, { batchId: batch._id, date: new Date(), subject: 'Foundations' });
    expect(attendanceSession.status).toBe(201);
    const sessionId = attendanceSession.body.data._id;
    const marked = await http('post', `/api/v1/attendance/sessions/${sessionId}/records`, teacher, { records: [{ studentId: student._id, status: 'PRESENT' }] });
    expect(marked.status).toBe(201);
    const duplicateAttendance = await http('post', `/api/v1/attendance/sessions/${sessionId}/records`, teacher, { records: [{ studentId: student._id, status: 'PRESENT' }] });
    expect(duplicateAttendance.status).toBe(409);
    const attendancePercent = await http('get', `/api/v1/attendance/students/${student._id}/percentage`, teacher);
    expect(attendancePercent.status).toBe(200);
    expect(JSON.stringify(attendancePercent.body.data)).toContain('100');

    const notYetEligible = await http('get', `/api/v1/certificates/eligibility?studentId=${student._id}&courseId=${course._id}&batchId=${batch._id}`, owner);
    expect(notYetEligible.status).toBe(200);
    expect(notYetEligible.body.data.eligible).toBe(false);
    expect(notYetEligible.body.data.missingRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'COURSE_INCOMPLETE' })]));

    const progress = await http('post', '/api/v1/progress', teacher, { studentId: student._id, courseId: course._id, moduleId: module._id, topic: 'Completion', status: 'COMPLETED' });
    expect(progress.status).toBe(201);
    expect((await http('get', `/api/v1/progress/students/${student._id}/history`, teacher)).status).toBe(200);

    const assignment = await http('post', '/api/v1/assignments', teacher, {
      courseId: course._id, moduleId: module._id, batchId: batch._id, title: 'Lifecycle assignment', description: 'Submit once', deadline: new Date(Date.now() + 10 * 86_400_000), totalMarks: 10, status: 'OPEN'
    });
    expect(assignment.status).toBe(201);
    const submission = await http('post', `/api/v1/assignments/${assignment.body.data._id}/submissions`, studentToken, { content: 'Completed' });
    expect(submission.status).toBe(201);

    const exam = await http('post', '/api/v1/exams', teacher, { courseId: course._id, moduleId: module._id, batchId: batch._id, title: 'Lifecycle exam', totalMarks: 10, passMarks: 5, duration: 30, status: 'DRAFT' });
    expect(exam.status).toBe(201);
    const question = await http('post', `/api/v1/exams/${exam.body.data._id}/questions`, teacher, { question: 'Is this an end-to-end test?', type: 'TRUE_FALSE', options: ['true', 'false'], correctAnswer: 'true', marks: 10, sequence: 1 });
    expect(question.status).toBe(201);
    expect((await http('patch', `/api/v1/exams/${exam.body.data._id}`, teacher, { status: 'ACTIVE' })).status).toBe(200);
    const attempt = await http('post', `/api/v1/exams/${exam.body.data._id}/attempts`, studentToken, {});
    expect(attempt.status).toBe(201);
    const result = await http('post', `/api/v1/exams/attempts/${attempt.body.data.attempt._id}/submit`, studentToken, { answers: [{ questionId: attempt.body.data.questions[0]._id, answer: 'true' }] });
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ marks: 10, percentage: 100, passFail: 'PASS', publicationStatus: 'DRAFT' });
    expect((await http('post', `/api/v1/results/${result.body.data._id}/publish`, teacher, {})).status).toBe(200);
    expect((await http('get', `/api/v1/results/${result.body.data._id}`, studentToken)).status).toBe(200);

    const eligible = await http('get', `/api/v1/certificates/eligibility?studentId=${student._id}&courseId=${course._id}&batchId=${batch._id}`, owner);
    expect(eligible.status).toBe(200);
    expect(eligible.body.data.eligible).toBe(true);
    const certificate = await http('post', '/api/v1/certificates/issue', owner, { studentId: student._id, courseId: course._id, batchId: batch._id });
    expect(certificate.status).toBe(201);
    expect((await http('get', `/api/v1/certificates/verify/${certificate.body.data.certificateId}`, owner)).body.data.valid).toBe(true);
  }, 180_000);

  it('runs fee collection → cash/bank/UPI ledger → expense/salary → reports, and tests financial controls', async () => {
    const owner = token('OWNER_ADMIN');
    const accountant = token('ACCOUNTANT');
    const studentToken = token('STUDENT');
    const student = await StudentModel.findOne({ instituteId, email: 'aarav.lifecycle@test.invalid' });
    const feePlan = await FeePlanModel.findOne({ instituteId, studentId: student?._id });
    expect(student).toBeTruthy();
    expect(feePlan).toBeTruthy();

    const cash = await http('post', '/api/v1/accounts', owner, { name: 'E2E Cash', type: 'CASH', openingBalance: 0 });
    const bank = await http('post', '/api/v1/accounts', owner, { name: 'E2E Bank', type: 'BANK', openingBalance: 0 });
    const upi = await http('post', '/api/v1/accounts', owner, { name: 'E2E UPI', type: 'UPI', openingBalance: 0 });
    expect(cash.status).toBe(201); expect(bank.status).toBe(201); expect(upi.status).toBe(201);
    const firstInstallment = await FeeInstallmentModel.findOne({ instituteId, feePlanId: feePlan!._id }).sort({ sequence: 1 });
    const paymentBody = { feePlanId: feePlan!._id, studentId: student!._id, admissionId: feePlan!.admissionId, installmentId: firstInstallment!._id, amount: 500, paymentMethod: 'CASH', financialAccountId: cash.body.data._id };
    const unauthorizedPayment = await http('post', '/api/v1/payments', studentToken, paymentBody);
    expect(unauthorizedPayment.status).toBe(403);
    const overpayment = await http('post', '/api/v1/payments', accountant, { ...paymentBody, amount: 500.01 });
    expect(overpayment.status).toBe(409);
    expect(overpayment.body.code).toBe('OVERPAYMENT');
    const firstPayment = await http('post', '/api/v1/payments', accountant, paymentBody);
    expect(firstPayment.status).toBe(201);
    expect(firstPayment.body.data.receipt.receiptId).toMatch(/^SN-REC-/);
    const reversal = await http('post', `/api/v1/payments/${firstPayment.body.data.payment._id}/reverse`, owner, { reason: 'E2E reversal check' });
    expect(reversal.status).toBe(201);
    expect(reversal.body.data).toMatchObject({ transactionType: 'REVERSAL', amount: 500 });
    const installments = await FeeInstallmentModel.find({ instituteId, feePlanId: feePlan!._id }).sort({ sequence: 1 });
    const payAgain = await http('post', '/api/v1/payments', accountant, { ...paymentBody, amount: 500 });
    expect(payAgain.status).toBe(201);
    const secondPayment = await http('post', '/api/v1/payments', accountant, { ...paymentBody, installmentId: installments[1]!._id, amount: 500, paymentMethod: 'BANK', financialAccountId: bank.body.data._id });
    expect(secondPayment.status).toBe(201);
    expect((await http('get', '/api/v1/receipts', accountant)).body.data.length).toBeGreaterThanOrEqual(2);
    expect((await AccountTransactionModel.countDocuments({ instituteId, sourceType: { $in: ['PAYMENT', 'REVERSAL'] } })).valueOf()).toBeGreaterThanOrEqual(4);

    const category = await http('post', '/api/v1/expense-categories', owner, { name: 'Lifecycle supplies', code: 'LIFECYCLE', requiresApproval: true });
    expect(category.status).toBe(201);
    const expense = await http('post', '/api/v1/expenses', accountant, { categoryId: category.body.data._id, amount: 100, date: new Date(), vendorPayee: 'Test supplier', accountId: cash.body.data._id, reason: 'E2E supplies' });
    expect(expense.status).toBe(201);
    expect((await http('post', `/api/v1/expenses/${expense.body.data._id}/pay`, accountant, { evidenceReference: 'private:e2e-receipt' })).body.code).toBe('EXPENSE_APPROVAL_REQUIRED');
    const selfApprove = await http('post', `/api/v1/expenses/${expense.body.data._id}/approve`, accountant, { action: 'APPROVED', reason: 'Self review' });
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect((await http('post', `/api/v1/expenses/${expense.body.data._id}/approve`, owner, { action: 'APPROVED', reason: 'Reviewed independently' })).status).toBe(200);
    expect((await http('post', `/api/v1/expenses/${expense.body.data._id}/pay`, accountant, { evidenceReference: 'private:e2e-receipt' })).status).toBe(200);

    const salary = await http('post', '/api/v1/staff-salaries', accountant, { staffUserId: users.get('TEACHER')!.id, payPeriod: '2026-10', grossBase: 20000, adjustments: [{ label: 'Allowance', amount: 1000, direction: 'ADD' }], deductions: [{ label: 'Deduction', amount: 1000 }] });
    expect(salary.status).toBe(201);
    const selfSalaryApproval = await http('post', `/api/v1/staff-salaries/${salary.body.data._id}/approve`, accountant, { reason: 'Self approval' });
    expect(selfSalaryApproval.status).toBe(403);
    expect(selfSalaryApproval.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect((await http('post', `/api/v1/staff-salaries/${salary.body.data._id}/approve`, owner, { reason: 'Independent approval' })).status).toBe(200);
    expect((await http('post', `/api/v1/staff-salaries/${salary.body.data._id}/payments`, accountant, { accountId: bank.body.data._id, evidenceReference: 'private:e2e-payslip' })).status).toBe(201);

    const from = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 365 * 86_400_000).toISOString();
    expect((await http('get', `/api/v1/ledger?accountId=${cash.body.data._id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, accountant)).status).toBe(200);
    expect((await http('get', `/api/v1/cash-book?accountId=${cash.body.data._id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, accountant)).status).toBe(200);
    expect((await http('get', `/api/v1/reports/cash-flow?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, owner)).status).toBe(200);
    expect((await http('get', `/api/v1/reports/pnl?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, owner)).status).toBe(200);

    const period = await http('post', '/api/v1/financial-periods', owner, { name: 'E2E closed period', startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 86_400_000) });
    expect(period.status).toBe(201);
    expect((await http('post', `/api/v1/financial-periods/${period.body.data._id}/close`, owner, { reason: 'E2E close' })).status).toBe(200);
    const closedWrite = await http('post', '/api/v1/account-transactions', owner, { type: 'TRANSFER', accountId: cash.body.data._id, destinationAccountId: bank.body.data._id, amount: 1, date: new Date() });
    expect(closedWrite.status).toBe(409);
    expect(closedWrite.body.code).toBe('FINANCIAL_PERIOD_CLOSED');
  }, 180_000);

  it('rejects expired sessions, foreign tenant records, invalid files, and enforces role permissions', async () => {
    const student = token('STUDENT');
    const invalidToken = jwt.sign({ sub: users.get('OWNER_ADMIN')!.id, iid: instituteId, ins: instituteBusinessId, role: 'OWNER_ADMIN', ver: 0 }, process.env.JWT_ACCESS_SECRET!, { expiresIn: -1 });
    expect((await http('get', '/api/v1/auth/me', invalidToken)).body.code).toBe('TOKEN_EXPIRED');
    expect((await http('get', `/api/v1/students/${foreignStudentId}`, student)).status).toBe(404);
    const crossInstitute = await http('get', `/api/v1/students?instituteId=${foreignInstituteBusinessId}`, student);
    expect(crossInstitute.status).toBe(403);
    expect(crossInstitute.body.code).toBe('INSTITUTE_ACCESS_DENIED');

    const evidence = await http('post', '/api/v1/files', token('OWNER_ADMIN'))
      .set('x-document-type', 'IDENTITY')
      .set('x-file-description', 'Malformed upload')
      .set('x-related-entity-type', 'Student')
      .set('x-related-entity-id', lifecycleStudentId)
      .set('x-file-name', 'fake.pdf')
      .send(Buffer.from('not a pdf'))
      .set('Content-Type', 'application/pdf');
    expect(evidence.status, JSON.stringify(evidence.body)).toBe(415);
    expect(evidence.body.code).toBe('FILE_TYPE_INVALID');

    const paymentDraft = { feePlanId: new Types.ObjectId().toString(), amount: 10, paymentMethod: 'CASH', financialAccountId: new Types.ObjectId().toString() };
    for (const role of ['COUNSELLOR', 'TEACHER', 'STUDENT'] as const) {
      const response = await http('post', '/api/v1/payments', token(role), paymentDraft);
      expect(response.status, `${role} must not create payments`).toBe(403);
      expect(response.body.code).toBe('PERMISSION_FORBIDDEN');
    }
    const accountantDeniedCrmWrite = await http('post', '/api/v1/leads', token('ACCOUNTANT'), { name: 'Not permitted', mobile: '+919876500777' });
    expect(accountantDeniedCrmWrite.status).toBe(403);
  }, 60_000);
});
