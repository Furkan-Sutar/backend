import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../types/auth.js';
import { ROLE_PERMISSIONS } from '../types/rbac.js';
import { ApiError } from '../utils/api-error.js';
import { LeadModel } from '../models/lead.model.js';
import { FollowUpModel } from '../models/follow-up.model.js';
import { AdmissionModel } from '../models/admission.model.js';
import { StudentModel } from '../models/student.model.js';
import { FeePlanModel } from '../models/fee-plan.model.js';
import { PaymentModel } from '../models/payment.model.js';
import { ExpenseModel } from '../models/expense.model.js';
import { StaffSalaryModel } from '../models/staff-salary.model.js';
import { FinancialAccountModel } from '../models/financial-account.model.js';
import { AccountTransactionModel } from '../models/account-transaction.model.js';
import { BatchModel } from '../models/batch.model.js';
import { BatchEnrollmentModel } from '../models/batch-enrollment.model.js';
import { CourseModel } from '../models/course.model.js';
import { CourseProgressModel } from '../models/course-progress.model.js';
import { AttendanceRecordModel } from '../models/attendance-record.model.js';
import { AttendanceSessionModel } from '../models/attendance-session.model.js';
import { AssignmentModel } from '../models/assignment.model.js';
import { ExamModel } from '../models/exam.model.js';
import { TimetableModel } from '../models/timetable.model.js';
import { ExpenseApprovalModel } from '../models/expense-approval.model.js';
import { LeadSourceModel } from '../models/lead-source.model.js';
import { TeacherAssignmentModel } from '../models/teacher-assignment.model.js';
import { CollectionResponsibilityModel } from '../models/collection-responsibility.model.js';
import { StaffModel } from '../models/staff.model.js';
import { CourseCostAllocationModel } from '../models/course-cost-allocation.model.js';
import { SalaryPaymentModel } from '../models/salary-payment.model.js';
import { AuditService } from './audit.service.js';
import { auditRequestMetadata } from '../utils/audit-request.js';
import { inTransaction } from '../utils/transaction.js';
import type { Request } from 'express';
import { calculateCourseProfitability } from '../utils/course-profitability.js';
import { CourseProfitabilityPolicyModel } from '../models/course-profitability-policy.model.js';
import { calculateCashFlow, calculateCollectionTotals, estimateCashBasisOperatingSurplus } from '../utils/report-calculations.js';

export interface ReportFilters { from?: Date; to?: Date; courseId?: string; batchId?: string; staffId?: string; sourceId?: string; accountId?: string; includeDetails?: boolean }
type Auth = AuthenticatedUser;
const DAY = 86_400_000;
const fail = (status: number, code: string, message: string) => new ApiError(status, code, message);
function authorize(auth: Auth) { if (!ROLE_PERMISSIONS[auth.role].includes('report.view')) throw fail(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to view reports'); }
function authorizeFinancialReports(auth: Auth) {
  authorize(auth);
  if (!['payment.view', 'fee.view', 'expense.view', 'salary.view', 'accounttransaction.view'].every((permission) => ROLE_PERMISSIONS[auth.role].includes(permission as never))) {
    throw fail(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to view institute financial reports');
  }
}
function range(filters: ReportFilters, field: string) {
  const date: Record<string, Date> = {};
  if (filters.from) date.$gte = filters.from;
  if (filters.to) date.$lt = new Date(filters.to.getTime() + 1);
  return Object.keys(date).length ? { [field]: date } : {};
}
function oid(value?: string) { return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined; }
function sumRows(rows: Array<{ _id?: unknown; amount?: number; count?: number }>) { return rows[0] ?? { amount: 0, count: 0 }; }
function base(auth: Auth) { return { instituteId: new Types.ObjectId(auth.instituteId) }; }
function leadFilter(auth: Auth, filters: ReportFilters, field = 'createdAt'): Record<string, any> { return { ...base(auth), ...range(filters, field), ...(oid(filters.sourceId) ? { sourceId: oid(filters.sourceId) } : {}), ...(oid(filters.courseId) ? { interestedCourseId: oid(filters.courseId) } : {}), ...(oid(filters.staffId) ? { assignedTo: oid(filters.staffId) } : {}) }; }
function admissionFilter(auth: Auth, filters: ReportFilters, field = 'createdAt') { return { ...base(auth), ...range(filters, field), ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}), ...(oid(filters.staffId) ? { contributedByStaffId: oid(filters.staffId) } : {}), ...(oid(filters.sourceId) ? { sourceId: oid(filters.sourceId) } : {}) }; }
function financialFilter(auth: Auth, filters: ReportFilters, field: string) { return { ...base(auth), ...range(filters, field), ...(oid(filters.accountId) ? { $or: [{ accountId: oid(filters.accountId) }, { financialAccountId: oid(filters.accountId) }] } : {}) }; }
async function feePlanPipeline(auth: Auth, filters: ReportFilters): Promise<any[]> {
  const stages: Record<string, unknown>[] = [{ $match: { ...base(auth), ...range(filters, 'createdAt'), status: { $ne: 'CANCELLED' }, ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}) } }];
  if (filters.batchId || filters.sourceId || filters.staffId) {
    stages.push({ $lookup: { from: 'admissions', localField: 'admissionId', foreignField: '_id', as: 'admission' } }, { $unwind: '$admission' });
    const match: Record<string, unknown> = {};
    if (oid(filters.batchId)) match['admission.batchId'] = oid(filters.batchId);
    if (oid(filters.sourceId)) match['admission.sourceId'] = oid(filters.sourceId);
    if (oid(filters.staffId)) match['admission.contributedByStaffId'] = oid(filters.staffId);
    stages.push({ $match: match });
  }
  return stages;
}
async function paymentPipeline(auth: Auth, filters: ReportFilters): Promise<any[]> {
  const match: Record<string, unknown> = { ...base(auth), ...range(filters, 'date'), transactionType: { $in: ['PAYMENT', 'REFUND', 'REVERSAL'] }, ...(oid(filters.accountId) ? { financialAccountId: oid(filters.accountId) } : {}) };
  if (filters.staffId) {
    const staff = await StaffModel.findOne({ _id: oid(filters.staffId), instituteId: auth.instituteId }).select('userId').lean() as { userId?: unknown } | null;
    match.authorizedBy = staff?.userId ?? null;
  }
  const stages: Record<string, unknown>[] = [{ $match: match }];
  if (filters.courseId) {
    stages.push({ $lookup: { from: 'feeplans', localField: 'feePlanId', foreignField: '_id', as: 'feePlan' } }, { $unwind: '$feePlan' }, { $match: { 'feePlan.courseId': oid(filters.courseId) } });
  }
  if (filters.batchId || filters.sourceId) {
    stages.push({ $lookup: { from: 'admissions', localField: 'admissionId', foreignField: '_id', as: 'admission' } }, { $unwind: '$admission' });
    const admissionMatch: Record<string, unknown> = {};
    if (oid(filters.batchId)) admissionMatch['admission.batchId'] = oid(filters.batchId);
    if (oid(filters.sourceId)) admissionMatch['admission.sourceId'] = oid(filters.sourceId);
    stages.push({ $match: admissionMatch });
  }
  stages.push({ $group: { _id: '$transactionType', amount: { $sum: '$amount' }, count: { $sum: 1 } } });
  return stages;
}

export const reportsService = {
  async revenue(auth: Auth, filters: ReportFilters) {
    authorizeFinancialReports(auth);
    const feeStages = await feePlanPipeline(auth, filters);
    const paymentStages = await paymentPipeline(auth, filters);
    const [billed, payments, courseBreakdown, details] = await Promise.all([
      FeePlanModel.aggregate([...feeStages, { $group: { _id: null, billedRevenue: { $sum: '$finalFee' }, amountDue: { $sum: '$amountDue' }, plans: { $sum: 1 } } }]),
      PaymentModel.aggregate(paymentStages),
      FeePlanModel.aggregate([...feeStages, { $group: { _id: '$courseId', billedRevenue: { $sum: '$finalFee' }, amountDue: { $sum: '$amountDue' }, feePlans: { $sum: 1 } } }, { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'course' } }, { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } }, { $project: { courseId: '$_id', courseName: '$course.name', courseCode: '$course.code', billedRevenue: 1, amountDue: 1, feePlans: 1 } }, { $sort: { billedRevenue: -1 } }]),
      filters.includeDetails ? FeePlanModel.aggregate([...feeStages, { $project: { feePlanId: 1, studentId: 1, admissionId: 1, courseId: 1, finalFee: 1, amountPaid: 1, amountDue: 1, status: 1, createdAt: 1 } }, { $sort: { createdAt: -1 } }, { $limit: 100 }]) : Promise.resolve(undefined)
    ]);
    const collectionTotals = calculateCollectionTotals(payments.map((row: any) => ({ transactionType: row._id, amount: row.amount })));
    return { basis: 'Billed revenue is the final fee on non-cancelled fee plans created in the selected period. Collections are posted payment transactions; refunds and reversals are shown separately.', billedRevenue: billed[0]?.billedRevenue ?? 0, ...collectionTotals, amountDue: billed[0]?.amountDue ?? 0, feePlanCount: billed[0]?.plans ?? 0, courseBreakdown, ...(details ? { details } : {}) };
  },
  async expenses(auth: Auth, filters: ReportFilters) {
    authorizeFinancialReports(auth);
    const match: Record<string, any> = { ...financialFilter(auth, filters, 'date'), status: { $ne: 'CANCELLED' } };
    const staffProfile = filters.staffId ? await StaffModel.findOne({ _id: oid(filters.staffId), instituteId: auth.instituteId }).select('userId').lean() as { userId?: unknown } | null : null;
    const cashExpenseMatch: Record<string, any> = { ...financialFilter(auth, filters, 'paidAt'), status: 'PAID' };
    if (filters.staffId) {
      const staffCondition = { $or: staffProfile?.userId ? [{ createdBy: staffProfile.userId }, { paidBy: staffProfile.userId }] : [{ _id: { $exists: false } }] };
      match.$and = [...(match.$or ? [{ $or: match.$or }] : []), staffCondition]; delete match.$or;
      cashExpenseMatch.$and = [...(cashExpenseMatch.$or ? [{ $or: cashExpenseMatch.$or }] : []), staffCondition]; delete cashExpenseMatch.$or;
    }
    const salaryMatch = { ...base(auth), ...range(filters, 'paidAt'), status: 'PAID', ...(filters.staffId ? { staffUserId: staffProfile?.userId ?? null } : {}) };
    const [expenseRows, cashExpenseRows, salaryRows, categoryBreakdown, expenseDetails, salaryDetails] = await Promise.all([
      ExpenseModel.aggregate([{ $match: match }, { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      ExpenseModel.aggregate([{ $match: cashExpenseMatch }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      StaffSalaryModel.aggregate([{ $match: salaryMatch }, { $group: { _id: '$status', amount: { $sum: '$netPayable' }, count: { $sum: 1 } } }]),
      ExpenseModel.aggregate([{ $match: match }, { $group: { _id: '$categoryId', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $lookup: { from: 'expensecategories', localField: '_id', foreignField: '_id', as: 'category' } }, { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } }, { $project: { categoryId: '$_id', categoryName: '$category.name', amount: 1, count: 1 } }, { $sort: { amount: -1 } }]),
      filters.includeDetails ? ExpenseModel.find(match).select('expenseId categoryId amount date vendorPayee approvalStatus status paidAt paidBy accountId').sort({ date: -1 }).limit(100).lean() : Promise.resolve(undefined),
      filters.includeDetails ? StaffSalaryModel.find(salaryMatch).select('salaryId staffUserId payPeriod netPayable status paidAt').sort({ paidAt: -1 }).limit(100).lean() : Promise.resolve(undefined)
    ]);
    const paid = cashExpenseRows[0]?.amount ?? 0;
    const unpaid = expenseRows.filter((row: any) => row._id === 'UNPAID').reduce((sum: number, row: any) => sum + row.amount, 0);
    const pendingApprovals = await ExpenseModel.countDocuments({ ...match, approvalStatus: 'PENDING' });
    return { expenseAmount: expenseRows.reduce((sum: number, row: any) => sum + row.amount, 0), paidExpenses: paid, unpaidExpenses: unpaid, paidSalaries: salaryRows[0]?.amount ?? 0, pendingExpenseApprovals: pendingApprovals, categoryBreakdown, salaryPaymentsCount: salaryRows[0]?.count ?? 0, expensePeriodBasis: 'expenseAmount is grouped by expense date; paidExpenses is grouped by paidAt for cash-basis reporting.', ...(expenseDetails ? { expenseDetails, salaryDetails } : {}) };
  },
  async pnl(auth: Auth, filters: ReportFilters) {
    authorize(auth);
    const [revenue, expenses] = await Promise.all([this.revenue(auth, filters), this.expenses(auth, filters)]);
    const cashBasisOperatingCosts = expenses.paidExpenses + expenses.paidSalaries;
    return { billedRevenue: revenue.billedRevenue, netCollections: revenue.netCollections, paidExpenses: expenses.paidExpenses, paidSalaries: expenses.paidSalaries, cashBasisOperatingCosts, estimatedCashBasisOperatingSurplus: estimateCashBasisOperatingSurplus(revenue.netCollections, expenses.paidExpenses, expenses.paidSalaries), unpaidExpenses: expenses.unpaidExpenses, amountDue: revenue.amountDue, calculationBasis: 'Estimated cash-basis operating surplus = posted collections less refunds and reversals, paid expenses, and paid salaries. Billed revenue and unpaid fees are reported separately; this is not accrual accounting.' };
  },
  async cashFlow(auth: Auth, filters: ReportFilters) {
    authorizeFinancialReports(auth);
    const match = { ...base(auth), ...range(filters, 'date'), ...(oid(filters.accountId) ? { accountId: oid(filters.accountId) } : {}) };
    const [transactions, accounts, accountTotals, details] = await Promise.all([
      AccountTransactionModel.aggregate([{ $match: match }, { $group: { _id: { category: '$category', direction: '$direction' }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      FinancialAccountModel.find({ ...base(auth), ...(oid(filters.accountId) ? { _id: oid(filters.accountId) } : {}) }).select('accountId name type openingBalance isActive').lean(),
      AccountTransactionModel.aggregate([{ $match: { ...base(auth), ...(filters.to ? { date: { $lte: filters.to } } : {}), ...(oid(filters.accountId) ? { accountId: oid(filters.accountId) } : {}) } }, { $group: { _id: { accountId: '$accountId', direction: '$direction' }, amount: { $sum: '$amount' } } }]),
      filters.includeDetails ? AccountTransactionModel.find(match).select('transactionId accountId date direction category amount sourceType sourceReference description').sort({ date: -1 }).limit(200).lean() : Promise.resolve(undefined)
    ]);
    const flow = calculateCashFlow((transactions as any[]).map((row) => ({ category: row._id.category, direction: row._id.direction, amount: row.amount })));
    const balances = (accounts as any[]).map((account) => {
      const inflow = (accountTotals as any[]).filter((row) => String(row._id.accountId) === String(account._id) && row._id.direction === 'INFLOW').reduce((sum, row) => sum + row.amount, 0);
      const outflow = (accountTotals as any[]).filter((row) => String(row._id.accountId) === String(account._id) && row._id.direction === 'OUTFLOW').reduce((sum, row) => sum + row.amount, 0);
      return { accountId: account.accountId, name: account.name, type: account.type, openingBalance: account.openingBalance, balance: account.openingBalance + inflow - outflow };
    });
    return { ...flow, balances, totalCash: balances.filter((x) => x.type === 'CASH').reduce((sum, x) => sum + x.balance, 0), totalBank: balances.filter((x) => x.type === 'BANK').reduce((sum, x) => sum + x.balance, 0), totalUpi: balances.filter((x) => ['UPI', 'WALLET'].includes(x.type)).reduce((sum, x) => sum + x.balance, 0), ...(details ? { details } : {}) };
  },
  async courseProfitability(auth: Auth, filters: ReportFilters) {
    authorizeFinancialReports(auth);
    const policy = await CourseProfitabilityPolicyModel.findOne(base(auth)).lean() as { revenueBasis?: 'BILLED_FEES' | 'NET_POSTED_PAYMENTS' } | null;
    const revenueBasis = policy?.revenueBasis ?? 'BILLED_FEES';
    const match = { ...base(auth), status: { $ne: 'CANCELLED' }, ...range(filters, 'createdAt'), ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}) };
    const [revenue, admissions, enrollments, demand, completions] = await Promise.all([
      FeePlanModel.aggregate([{ $match: match }, { $group: { _id: '$courseId', billedRevenue: { $sum: '$finalFee' }, collectionsApplied: { $sum: '$amountPaid' }, pendingFees: { $sum: '$amountDue' } } }]),
      AdmissionModel.aggregate([{ $match: { ...base(auth), ...range(filters, 'createdAt'), ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}) } }, { $group: { _id: '$courseId', admissions: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'CONVERTED'] }, 1, 0] } } } }]),
      BatchEnrollmentModel.aggregate([{ $match: { ...base(auth), status: { $ne: 'WITHDRAWN' }, ...range(filters, 'createdAt'), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}) } }, { $lookup: { from: 'batches', localField: 'batchId', foreignField: '_id', as: 'batch' } }, { $unwind: '$batch' }, ...(oid(filters.courseId) ? [{ $match: { 'batch.courseId': oid(filters.courseId) } }] : []), { $group: { _id: '$batch.courseId', enrollments: { $sum: 1 }, completions: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } } } }]),
      LeadModel.aggregate([{ $match: { ...leadFilter(auth, filters), interestedCourseId: { $ne: null } } }, { $group: { _id: '$interestedCourseId', demandLeads: { $sum: 1 } } }]),
      CourseProgressModel.aggregate([{ $match: { ...base(auth), status: 'COMPLETED', ...range(filters, 'completionDate'), ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}) } }, { $group: { _id: '$courseId', completedTopics: { $sum: 1 }, students: { $addToSet: '$studentId' } } }, { $project: { completedTopics: 1, completedStudents: { $size: '$students' } } }])
    ]);
    const courseCatalog = await CourseModel.find({ ...base(auth), ...(oid(filters.courseId) ? { _id: oid(filters.courseId) } : {}) }).select('courseCode name code').lean();
    const allocationsMatch: Record<string, any> = { ...base(auth), ...range(filters, 'allocationPeriod'), ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}), ...(oid(filters.staffId) ? { staffId: oid(filters.staffId) } : {}) };
    const [allocations, paymentRows] = await Promise.all([
      CourseCostAllocationModel.aggregate([{ $match: allocationsMatch }, { $group: { _id: { courseId: '$courseId', behavior: '$costBehavior', type: '$costType' }, amount: { $sum: '$amount' }, allocationCount: { $sum: 1 } } }]),
      PaymentModel.aggregate([{ $match: { ...base(auth), ...range(filters, 'date'), status: 'POSTED', transactionType: { $in: ['PAYMENT', 'REFUND', 'REVERSAL'] } } }, { $lookup: { from: 'feeplans', localField: 'feePlanId', foreignField: '_id', as: 'feePlan' } }, { $unwind: '$feePlan' }, ...(oid(filters.courseId) ? [{ $match: { 'feePlan.courseId': oid(filters.courseId) } }] : []), { $group: { _id: { courseId: '$feePlan.courseId', type: '$transactionType' }, amount: { $sum: '$amount' } } }])
    ]);
    const ids = new Set([...courseCatalog.map((course: any) => String(course._id)), ...[...revenue, ...admissions, ...enrollments, ...demand, ...completions, ...allocations.map((x: any) => ({ _id: x._id.courseId })), ...paymentRows.map((x: any) => ({ _id: x._id.courseId }))].map((row: any) => String(row._id))]);
    const courses = courseCatalog;
    const byId = (rows: any[], id: string) => rows.find((row) => String(row._id) === id) ?? {};
    const courseBreakdown = [...ids].map((id) => {
      const r = byId(revenue, id), a = byId(admissions, id), e = byId(enrollments, id), d = byId(demand, id), c = byId(completions, id), course = courses.find((item: any) => String(item._id) === id);
      const courseAllocations = allocations.filter((x: any) => String(x._id.courseId) === id);
      const fixedCosts = courseAllocations.filter((x: any) => x._id.behavior === 'FIXED').reduce((n: number, x: any) => n + x.amount, 0);
      const variableCosts = courseAllocations.filter((x: any) => x._id.behavior === 'VARIABLE').reduce((n: number, x: any) => n + x.amount, 0);
      const payments = paymentRows.filter((x: any) => String(x._id.courseId) === id);
      const collections = payments.filter((x: any) => x._id.type === 'PAYMENT').reduce((n: number, x: any) => n + x.amount, 0);
      const refunds = payments.filter((x: any) => x._id.type === 'REFUND').reduce((n: number, x: any) => n + x.amount, 0);
      const reversals = payments.filter((x: any) => x._id.type === 'REVERSAL').reduce((n: number, x: any) => n + x.amount, 0);
      const netPostedCollections = collections - refunds - reversals;
      const profit = calculateCourseProfitability({ revenue: revenueBasis === 'BILLED_FEES' ? r.billedRevenue ?? 0 : netPostedCollections, fixedCosts, variableCosts, enrollments: e.enrollments ?? 0 });
      return { courseId: id, courseName: course?.name, courseCode: course?.code ?? course?.courseCode, revenueBasis, billedRevenue: r.billedRevenue ?? 0, collectionsAppliedToFeePlans: r.collectionsApplied ?? 0, postedCollections: collections, refunds, reversals, netPostedCollections, pendingFees: r.pendingFees ?? 0, admissions: a.admissions ?? 0, convertedAdmissions: a.converted ?? 0, completions: e.completions ?? 0, completedStudents: c.completedStudents ?? 0, demandLeads: d.demandLeads ?? 0, ...profit, allocationCount: courseAllocations.reduce((n: number, x: any) => n + x.allocationCount, 0) };
    });
    return { revenuePolicy: revenueBasis, revenueDefinition: revenueBasis === 'BILLED_FEES' ? 'Sum of finalFee on non-cancelled fee plans created in the selected period.' : 'Posted payments less posted refunds and reversals in the selected period, attributed through each payment fee plan to its course.', cashMovementDefinition: 'Collections, refunds, and reversals are shown separately and do not drive revenue unless NET_POSTED_PAYMENTS is the configured revenue basis.', costDefinition: 'Append-only allocations against paid expenses or posted salary payments; each allocation is bounded by its actual source amount.', enrollmentDefinition: 'Non-withdrawn batch enrollments created in the selected period.', formulae: { contribution: 'revenue - variable costs', contributionMargin: 'contribution / revenue * 100', estimatedProfit: 'revenue - fixed costs - variable costs', breakEvenEnrollments: 'ceil(fixed costs / contribution per enrollment)' }, courseBreakdown };
  },
  async getCourseProfitabilityPolicy(auth: Auth) { authorizeFinancialReports(auth); return (await CourseProfitabilityPolicyModel.findOne(base(auth)).lean()) ?? { instituteId: auth.instituteId, revenueBasis: 'BILLED_FEES' as const }; },
  async setCourseProfitabilityPolicy(req: Request, auth: Auth, revenueBasis: 'BILLED_FEES' | 'NET_POSTED_PAYMENTS') {
    if (!ROLE_PERMISSIONS[auth.role].includes('course_profitability.manage')) throw fail(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to configure course profitability');
    return inTransaction(async (session) => {
      const existing = await CourseProfitabilityPolicyModel.findOne(base(auth)).session(session).lean();
      const updated = await CourseProfitabilityPolicyModel.findOneAndUpdate(base(auth), { $set: { revenueBasis, updatedBy: new Types.ObjectId(auth.objectId) }, $setOnInsert: { instituteId: new Types.ObjectId(auth.instituteId) } }, { upsert: true, new: true, runValidators: true, session });
      await AuditService.record({ instituteId: auth.instituteId, actorUserId: auth.objectId, action: 'course_profitability.policy.update', entityType: 'CourseProfitabilityPolicy', entityId: auth.instituteId, ...(existing ? { before: existing } : {}), after: updated?.toJSON(), request: auditRequestMetadata(req), session });
      return updated;
    });
  },
  async allocateCourseCost(req: Request, auth: Auth, input: { courseId: string; batchId?: string | undefined; staffId?: string | undefined; costType: string; costBehavior: string; amount: number; sourceType: string; sourceObjectId: string; allocationPeriod: Date; note?: string | undefined }) {
    if (!ROLE_PERMISSIONS[auth.role].includes('course_profitability.manage')) throw fail(403, 'PERMISSION_FORBIDDEN', 'You do not have permission to allocate course costs');
    return inTransaction(async (session) => {
      const instituteId = new Types.ObjectId(auth.instituteId), sourceId = new Types.ObjectId(input.sourceObjectId);
      const course = await CourseModel.findOne({ _id: oid(input.courseId), instituteId }).session(session);
      if (!course) throw fail(404, 'COURSE_NOT_FOUND', 'Course was not found in this institute');
      if (input.batchId && !await BatchModel.exists({ _id: oid(input.batchId), instituteId, courseId: course._id }).session(session)) throw fail(400, 'BATCH_COURSE_MISMATCH', 'Batch must belong to the selected course');
      let sourceAmount: number, sourceReference: string;
      if (input.sourceType === 'EXPENSE') {
        if (!['COURSE_EXPENSE', 'MARKETING_ALLOCATION'].includes(input.costType)) throw fail(400, 'INVALID_COST_SOURCE', 'Expense source can fund course or marketing allocations');
        const source: any = await ExpenseModel.findOne({ _id: sourceId, instituteId, status: 'PAID', approvalStatus: { $in: ['APPROVED', 'NOT_REQUIRED'] } }).session(session).lean();
        if (!source) throw fail(404, 'PAID_EXPENSE_NOT_FOUND', 'A paid and approved expense in this institute is required');
        sourceAmount = source.amount; sourceReference = source.expenseId;
      } else if (input.sourceType === 'SALARY_PAYMENT') {
        if (input.costType !== 'TEACHER_ALLOCATION') throw fail(400, 'INVALID_COST_SOURCE', 'Salary payment source can fund teacher allocations');
        const source: any = await SalaryPaymentModel.findOne({ _id: sourceId, instituteId }).session(session).lean();
        if (!source) throw fail(404, 'SALARY_PAYMENT_NOT_FOUND', 'A posted salary payment in this institute is required');
        sourceAmount = source.amount; sourceReference = source.salaryPaymentId;
        const staff = await StaffModel.findOne({ instituteId, userId: source.staffUserId }).select('_id').session(session).lean() as { _id: Types.ObjectId } | null;
        if (!input.staffId && staff) input.staffId = String(staff._id);
      } else throw fail(400, 'INVALID_COST_SOURCE', 'sourceType must be EXPENSE or SALARY_PAYMENT');
      const alreadyAllocated = await CourseCostAllocationModel.aggregate([{ $match: { instituteId, sourceType: input.sourceType, sourceObjectId: sourceId } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]).session(session);
      if ((alreadyAllocated[0]?.amount ?? 0) + input.amount > sourceAmount + 0.00001) throw fail(409, 'ALLOCATION_EXCEEDS_SOURCE', 'Total course allocations cannot exceed the paid source amount');
      const [allocation] = await CourseCostAllocationModel.create([{ instituteId, courseId: course._id, ...(input.batchId ? { batchId: oid(input.batchId) } : {}), ...(input.staffId ? { staffId: oid(input.staffId) } : {}), costType: input.costType, costBehavior: input.costBehavior, amount: input.amount, sourceType: input.sourceType, sourceObjectId: sourceId, sourceReference, allocationPeriod: input.allocationPeriod, ...(input.note ? { note: input.note } : {}), createdBy: new Types.ObjectId(auth.objectId) }], { session });
      if (!allocation) throw fail(500, 'ALLOCATION_FAILED', 'Cost allocation could not be created');
      await AuditService.record({ instituteId: auth.instituteId, actorUserId: auth.objectId, action: 'course_cost.allocate', entityType: 'CourseCostAllocation', entityId: allocation.allocationId, after: allocation.toJSON(), request: auditRequestMetadata(req), session });
      return allocation;
    });
  },
  async listCourseCostAllocations(auth: Auth, filters: ReportFilters) {
    authorizeFinancialReports(auth);
    return CourseCostAllocationModel.find({ ...base(auth), ...range(filters, 'allocationPeriod'), ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}), ...(oid(filters.staffId) ? { staffId: oid(filters.staffId) } : {}) }).sort({ allocationPeriod: -1, createdAt: -1 }).limit(500).lean();
  },
  async crm(auth: Auth, filters: ReportFilters) {
    authorize(auth);
    const { staffId, ...crmFilters } = filters;
    const match = leadFilter(auth, crmFilters);
    if (staffId) {
      const profile = await StaffModel.findOne({ _id: oid(staffId), instituteId: auth.instituteId }).select('userId').lean() as { userId?: unknown } | null;
      if (profile?.userId) match.assignedTo = profile.userId as Types.ObjectId;
      else match._id = { $exists: false };
    }
    const today = new Date(); today.setUTCHours(0, 0, 0, 0); const tomorrow = new Date(today.getTime() + DAY);
    const [status, sources, counsellors, newLeads, contacted, pending, missed, todayFollowUps, overdueFollowUps] = await Promise.all([
      LeadModel.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      LeadModel.aggregate([{ $match: match }, { $group: { _id: '$sourceId', leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'ADMISSION'] }, 1, 0] } } } }, { $lookup: { from: 'leadsources', localField: '_id', foreignField: '_id', as: 'source' } }, { $unwind: { path: '$source', preserveNullAndEmptyArrays: true } }, { $project: { sourceId: '$_id', sourceName: '$source.name', leads: 1, converted: 1 } }]),
      LeadModel.aggregate([{ $match: match }, { $group: { _id: '$assignedTo', leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'ADMISSION'] }, 1, 0] } } } }, { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'counsellor' } }, { $unwind: { path: '$counsellor', preserveNullAndEmptyArrays: true } }, { $project: { staffId: '$_id', staffName: '$counsellor.name', leads: 1, converted: 1 } }]),
      LeadModel.countDocuments({ ...match, enquiryDate: filters.from || filters.to ? range(filters, 'enquiryDate').enquiryDate : { $gte: today, $lt: tomorrow } }),
      LeadModel.countDocuments({ ...match, status: 'CONTACTED' }),
      FollowUpModel.countDocuments({ ...base(auth), status: 'SCHEDULED', scheduledAt: { $gte: new Date() } }),
      FollowUpModel.countDocuments({ ...base(auth), status: 'SCHEDULED', scheduledAt: { $lt: new Date() } }),
      FollowUpModel.find({ ...base(auth), status: 'SCHEDULED', scheduledAt: { $gte: today, $lt: tomorrow } }).populate('leadObjectId', 'leadId name mobile').sort({ scheduledAt: 1 }).lean(),
      FollowUpModel.find({ ...base(auth), status: 'SCHEDULED', scheduledAt: { $lt: today } }).populate('leadObjectId', 'leadId name mobile').sort({ scheduledAt: 1 }).limit(100).lean()
    ]);
    const statusCounts = Object.fromEntries(status.map((row: any) => [row._id, row.count])); const total = Object.values(statusCounts).reduce((sum: number, value: any) => sum + value, 0);
    const converted = statusCounts.ADMISSION ?? 0;
    return { newLeads, contacted, pendingFollowUps: pending, missedFollowUps: missed, conversionRate: total ? Math.round((converted / total) * 10000) / 100 : 0, conversionRateBasis: 'leads currently in ADMISSION divided by filtered leads', statusFunnel: status, sourcePerformance: sources, counsellorPerformance: counsellors, ...(filters.includeDetails ? { todaysFollowUps: todayFollowUps, overdueFollowUps } : {}) };
  },
  async admissions(auth: Auth, filters: ReportFilters) {
    authorize(auth);
    const match = admissionFilter(auth, filters);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0); const tomorrow = new Date(today.getTime() + DAY); const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const [status, byCourse, byBatch, todayCount, monthCount, leads] = await Promise.all([
      AdmissionModel.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      AdmissionModel.aggregate([{ $match: match }, { $group: { _id: '$courseId', admissions: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'CONVERTED'] }, 1, 0] } } } }, { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'course' } }, { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } }, { $project: { courseId: '$_id', courseName: '$course.name', admissions: 1, converted: 1 } }]),
      BatchModel.aggregate([{ $match: { ...base(auth), ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}), ...(oid(filters.batchId) ? { _id: oid(filters.batchId) } : {}) } }, { $project: { batchCode: 1, name: 1, courseId: 1, capacity: 1, enrolledCount: 1, occupancyPercentage: { $cond: [{ $gt: ['$capacity', 0] }, { $multiply: [{ $divide: ['$enrolledCount', '$capacity'] }, 100] }, 0] } } }]),
      AdmissionModel.countDocuments({ ...match, createdAt: { $gte: today, $lt: tomorrow } }),
      AdmissionModel.countDocuments({ ...match, createdAt: { $gte: monthStart, $lt: tomorrow } }),
      LeadModel.aggregate([{ $match: leadFilter(auth, filters) }, { $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);
    return { today: todayCount, monthToDate: monthCount, statusFunnel: status, courseWise: byCourse, batchOccupancy: byBatch, crmFunnel: leads, ...(filters.includeDetails ? { details: await AdmissionModel.find(match).select('admissionId leadId courseId batchId status createdAt convertedAt contributedByStaffId sourceId').sort({ createdAt: -1 }).limit(200).lean() } : {}) };
  },
  async students(auth: Auth, filters: ReportFilters) {
    authorize(auth);
    const match: Record<string, unknown> = { ...base(auth), ...range(filters, 'createdAt') };
    const studentIdSets: Types.ObjectId[][] = [];
    if (filters.courseId || filters.batchId) {
      const enrollments = await BatchEnrollmentModel.aggregate([{ $match: { ...base(auth), status: { $ne: 'WITHDRAWN' }, ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}) } }, { $lookup: { from: 'batches', localField: 'batchId', foreignField: '_id', as: 'batch' } }, { $unwind: '$batch' }, ...(oid(filters.courseId) ? [{ $match: { 'batch.courseId': oid(filters.courseId) } }] : []), { $group: { _id: '$studentId' } }]);
      studentIdSets.push(enrollments.map((row: any) => row._id));
    }
    if (filters.sourceId || filters.staffId) {
      const attributed = await AdmissionModel.find({ ...base(auth), status: 'CONVERTED', studentObjectId: { $exists: true }, ...(oid(filters.sourceId) ? { sourceId: oid(filters.sourceId) } : {}), ...(oid(filters.staffId) ? { contributedByStaffId: oid(filters.staffId) } : {}) }).distinct('studentObjectId');
      studentIdSets.push(attributed as Types.ObjectId[]);
    }
    if (studentIdSets.length) {
      const permitted = studentIdSets.slice(1).reduce((ids, next) => ids.filter((id) => next.some((candidate) => String(candidate) === String(id))), studentIdSets[0]!);
      match._id = { $in: permitted };
    }
    const [statuses, riskRows, progressRiskRows, byCourse] = await Promise.all([
      StudentModel.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      AttendanceRecordModel.aggregate([{ $match: { ...base(auth), ...range(filters, 'timestamp'), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}) } }, { $group: { _id: '$studentId', records: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE']] }, 1, 0] } } } }, { $project: { records: 1, attendancePercentage: { $multiply: [{ $divide: ['$present', '$records'] }, 100] } } }, { $match: { attendancePercentage: { $lt: 75 } } }, { $count: 'count' }]),
      CourseProgressModel.aggregate([{ $match: { ...base(auth), status: 'IN_PROGRESS', updatedAt: { $lt: new Date(Date.now() - 14 * DAY) }, ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}) } }, { $group: { _id: '$studentId' } }, { $count: 'count' }]),
      BatchEnrollmentModel.aggregate([{ $match: { ...base(auth), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}) } }, { $lookup: { from: 'batches', localField: 'batchId', foreignField: '_id', as: 'batch' } }, { $unwind: '$batch' }, ...(oid(filters.courseId) ? [{ $match: { 'batch.courseId': oid(filters.courseId) } }] : []), { $group: { _id: '$batch.courseId', students: { $sum: 1 } } }])
    ]);
    const countBy = Object.fromEntries(statuses.map((row: any) => [row._id, row.count]));
    return { active: countBy.ACTIVE ?? 0, completed: countBy.COMPLETED ?? 0, dropped: countBy.DROPPED ?? 0, attendanceRisk: riskRows[0]?.count ?? 0, stalledProgress: progressRiskRows[0]?.count ?? 0, courseEnrollments: byCourse, ...(filters.includeDetails ? { attendanceRiskStudents: await AttendanceRecordModel.aggregate([{ $match: { ...base(auth), ...range(filters, 'timestamp'), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}) } }, { $group: { _id: '$studentId', records: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE']] }, 1, 0] } } } }, { $project: { studentId: '$_id', records: 1, attendancePercentage: { $multiply: [{ $divide: ['$present', '$records'] }, 100] } } }, { $match: { attendancePercentage: { $lt: 75 } } }, { $limit: 100 }]) } : {}) };
  },
  async attendance(auth: Auth, filters: ReportFilters) {
    authorize(auth);
    const attendanceFilter: Record<string, any> = { ...base(auth), ...range(filters, 'timestamp'), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}) };
    if (filters.courseId) {
      const batches = await BatchModel.find({ ...base(auth), courseId: oid(filters.courseId), ...(oid(filters.batchId) ? { _id: oid(filters.batchId) } : {}) }).select('_id').lean();
      attendanceFilter.batchId = { $in: batches.map((batch: any) => batch._id) };
    }
    if (filters.staffId) {
      const staff = await StaffModel.findOne({ _id: oid(filters.staffId), instituteId: auth.instituteId }).select('userId').lean() as { userId?: unknown } | null;
      attendanceFilter.markedBy = staff?.userId ?? null;
    }
    const [sessions, statusBreakdown, studentRows] = await Promise.all([
      AttendanceSessionModel.aggregate([{ $match: { ...base(auth), ...range(filters, 'date'), ...(attendanceFilter.batchId ? { batchId: attendanceFilter.batchId } : {}) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      AttendanceRecordModel.aggregate([{ $match: attendanceFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      AttendanceRecordModel.aggregate([{ $match: attendanceFilter }, { $group: { _id: '$studentId', records: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE']] }, 1, 0] } } } }, { $project: { studentId: '$_id', records: 1, attendancePercentage: { $multiply: [{ $divide: ['$present', '$records'] }, 100] } } }, { $sort: { attendancePercentage: 1 } }, { $limit: 200 }])
    ]);
    return { sessions: Object.fromEntries(sessions.map((row: any) => [row._id, row.count])), records: Object.fromEntries(statusBreakdown.map((row: any) => [row._id, row.count])), attendanceByStudent: studentRows };
  },
  async staff(auth: Auth, filters: ReportFilters) {
    authorize(auth);
    const [admissions, collections, assignments, salaries, responsibilities] = await Promise.all([
      AdmissionModel.aggregate([{ $match: { ...admissionFilter(auth, filters), ...(oid(filters.staffId) ? { contributedByStaffId: oid(filters.staffId) } : {}) } }, { $group: { _id: '$contributedByStaffId', admissions: { $sum: 1 } } }]),
      PaymentModel.aggregate([{ $match: { ...base(auth), ...range(filters, 'date'), transactionType: 'PAYMENT', ...(oid(filters.accountId) ? { financialAccountId: oid(filters.accountId) } : {}) } }, { $group: { _id: '$authorizedBy', collections: { $sum: '$amount' }, paymentCount: { $sum: 1 } } }]),
      TeacherAssignmentModel.aggregate([{ $match: { ...base(auth), ...(oid(filters.staffId) ? { staffId: oid(filters.staffId) } : {}) } }, { $group: { _id: '$staffId', activeTeachingAssignments: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } } } }]),
      StaffSalaryModel.aggregate([{ $match: { ...base(auth), ...range(filters, 'createdAt'), status: { $in: ['PAID', 'APPROVED', 'PENDING_APPROVAL'] } } }, { $group: { _id: '$staffUserId', salaryPayable: { $sum: '$netPayable' }, paidSalaries: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, '$netPayable', 0] } }, payrollRecords: { $sum: 1 } } }]),
      CollectionResponsibilityModel.aggregate([{ $match: { ...base(auth), status: 'ACTIVE', ...(oid(filters.staffId) ? { staffId: oid(filters.staffId) } : {}) } }, { $group: { _id: '$staffId', activeCollectionResponsibilities: { $sum: 1 } } }])
    ]);
    const staff = await StaffModel.find({ ...base(auth), ...(oid(filters.staffId) ? { _id: oid(filters.staffId) } : {}) }).select('staffId userId name role status').lean();
    return { staff, admissions, collectionsByUser: collections, teachingAssignments: assignments, payroll: salaries, collectionResponsibilities: responsibilities };
  },
  async dashboard(auth: Auth, filters: ReportFilters) {
    authorizeFinancialReports(auth);
    const now = new Date(); const start = new Date(now); start.setUTCHours(0, 0, 0, 0); const end = new Date(start.getTime() + DAY); const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const todayFilters = { ...filters, from: start, to: new Date(end.getTime() - 1) };
    const monthFilters = { ...filters, from: month, to: now };
    const [crm, admissionMetrics, studentMetrics, revenueMetrics, expenseMetrics, cash, courseMetrics, approvals, followUpsToday, classesToday, attendancePending, assignmentPending, examPending] = await Promise.all([
      this.crm(auth, filters), this.admissions(auth, monthFilters), this.students(auth, filters), this.revenue(auth, filters), this.expenses(auth, filters), this.cashFlow(auth, filters), this.courseProfitability(auth, filters),
      ExpenseModel.countDocuments({ ...base(auth), approvalStatus: 'PENDING', ...(oid(filters.accountId) ? { accountId: oid(filters.accountId) } : {}) }).then(async (expenseApprovals) => ({ expenses: expenseApprovals, salaries: await StaffSalaryModel.countDocuments({ ...base(auth), status: 'PENDING_APPROVAL', ...(oid(filters.staffId) ? { staffUserId: oid(filters.staffId) } : {}) }) })),
      FollowUpModel.find({ ...base(auth), status: 'SCHEDULED', scheduledAt: { $gte: start, $lt: end } }).populate('leadObjectId', 'leadId name mobile').sort({ scheduledAt: 1 }).lean(),
      TimetableModel.find({ ...base(auth), status: 'SCHEDULED', weekday: now.getUTCDay(), effectiveFrom: { $lte: now }, effectiveTo: { $gte: now } }).populate('batchId', 'batchCode name courseId').sort({ startTime: 1 }).lean(),
      AttendanceSessionModel.countDocuments({ ...base(auth), status: 'OPEN', date: { $gte: start, $lt: end }, ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}) }),
      AssignmentModel.countDocuments({ ...base(auth), status: 'OPEN', ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}) }),
      ExamModel.countDocuments({ ...base(auth), status: 'ACTIVE', ...(oid(filters.courseId) ? { courseId: oid(filters.courseId) } : {}), ...(oid(filters.batchId) ? { batchId: oid(filters.batchId) } : {}) })
    ]);
    const admissionToday = await AdmissionModel.countDocuments({ ...admissionFilter(auth, todayFilters) });
    return { period: { from: filters.from ?? start, to: filters.to ?? now, timezone: 'UTC' }, crm, admissions: { ...admissionMetrics, today: admissionToday }, students: studentMetrics, finance: { billedRevenue: revenueMetrics.billedRevenue, collections: revenueMetrics.collections, refunds: revenueMetrics.refunds, reversals: revenueMetrics.reversals, netCollections: revenueMetrics.netCollections, pendingFees: revenueMetrics.amountDue, expensesRecorded: expenseMetrics.expenseAmount, paidExpenses: expenseMetrics.paidExpenses, unpaidExpenses: expenseMetrics.unpaidExpenses, paidSalary: expenseMetrics.paidSalaries, cash: cash.totalCash, bank: cash.totalBank, upi: cash.totalUpi, estimatedProfit: estimateCashBasisOperatingSurplus(revenueMetrics.netCollections, expenseMetrics.paidExpenses, expenseMetrics.paidSalaries), estimatedProfitBasis: 'net collections less paid expenses and paid salaries' }, courses: courseMetrics, operations: { todaysFollowUps: followUpsToday, todaysClasses: classesToday, attendancePending, assignmentsPending: assignmentPending, examsPending: examPending, approvalsPending: approvals } };
  }
};
