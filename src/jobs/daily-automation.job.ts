import { Types } from 'mongoose';
import { ScheduledJobModel } from '../models/scheduled-job.model.js';
import { AutomationRuleModel } from '../models/automation-rule.model.js';
import { NotificationService, dailyNotificationDedupeKey, type NotificationType } from '../services/notification.service.js';
import { FollowUpModel } from '../models/follow-up.model.js';
import { FeePlanModel } from '../models/fee-plan.model.js';
import { FeeInstallmentModel } from '../models/fee-installment.model.js';
import { StudentModel } from '../models/student.model.js';
import { AttendanceRecordModel } from '../models/attendance-record.model.js';
import { BatchEnrollmentModel } from '../models/batch-enrollment.model.js';
import { BatchModel } from '../models/batch.model.js';
import { ExpenseModel } from '../models/expense.model.js';
import { StaffSalaryModel } from '../models/staff-salary.model.js';
import { UserModel } from '../models/user.model.js';
import { CertificateService } from '../services/certificate.service.js';

const DAY = 86_400_000;
const toId = (id: unknown) => String(id);
const dayStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

async function notify(input: { instituteId: string; type: NotificationType; recipientUserId?: unknown; title: string; message: string; entityType?: string; entityId?: string; dayKey: string; data?: unknown }) {
  if (!input.recipientUserId) return false;
  const result = await NotificationService.create({
    instituteId: input.instituteId, recipientUserId: toId(input.recipientUserId), type: input.type,
    title: input.title, message: input.message, dedupeKey: dailyNotificationDedupeKey(input.type, input.entityId ?? input.instituteId, input.dayKey),
    ...(input.entityType ? { entityType: input.entityType } : {}), ...(input.entityId ? { entityId: input.entityId } : {}), ...(input.data === undefined ? {} : { data: input.data }),
    expiresAt: new Date(Date.now() + 30 * DAY)
  });
  return result.created;
}

async function recipientsWithPermission(instituteId: string, roles: string[]) {
  return UserModel.find({ instituteId, role: { $in: roles }, status: 'active' }).select('_id').lean() as Promise<Array<{ _id: Types.ObjectId }>>;
}

async function executeDailyAutomation(instituteId: string, date: Date) {
  const start = dayStart(date), end = new Date(start.getTime() + DAY), dayKey = start.toISOString().slice(0, 10);
  const rules = await AutomationRuleModel.find({ instituteId, enabled: true, frequency: 'DAILY' }).lean() as Array<{ key: NotificationType; configuration?: Record<string, unknown>; frequency: string }>;
  const enabled = new Set(rules.map((rule) => rule.key));
  const config = (type: NotificationType) => rules.find((rule) => rule.key === type)?.configuration ?? {};
  let created = 0;
  const send = async (input: Parameters<typeof notify>[0]) => { if (enabled.has(input.type) && await notify(input)) created += 1; };

  if (enabled.has('PENDING_FOLLOW_UP') || enabled.has('MISSED_FOLLOW_UP')) {
    const due = await FollowUpModel.find({ instituteId, status: 'SCHEDULED', scheduledAt: { $lt: end } }).sort({ scheduledAt: 1 }).limit(1000).lean();
    for (const item of due) {
      const missed = item.scheduledAt < start;
      await send({ instituteId, type: missed ? 'MISSED_FOLLOW_UP' : 'PENDING_FOLLOW_UP', recipientUserId: item.assignedTo, title: missed ? 'Missed follow-up' : 'Follow-up due today', message: `Lead ${item.leadId} has a ${missed ? 'missed' : 'pending'} follow-up.`, entityType: 'FollowUp', entityId: item.followUpId, dayKey });
    }
  }

  if (enabled.has('PENDING_FEE')) {
    const fallbackRecipients = await recipientsWithPermission(instituteId, ['OWNER_ADMIN', 'ACCOUNTANT']);
    const plans = await FeePlanModel.find({ instituteId, status: 'ACTIVE', amountDue: { $gt: 0 } }).select('feePlanId studentId amountDue').limit(1000).lean();
    for (const plan of plans) {
      const student = await StudentModel.findOne({ _id: plan.studentId, instituteId }).select('userId studentId').lean() as { userId?: unknown; studentId: string } | null;
      const recipients = student?.userId ? [student.userId] : fallbackRecipients.map((user) => user._id);
      for (const recipientUserId of recipients) await send({ instituteId, type: 'PENDING_FEE', recipientUserId, title: 'Pending fee', message: `A fee balance of ${plan.amountDue} is pending for student ${student?.studentId ?? ''}.`, entityType: 'FeePlan', entityId: plan.feePlanId, dayKey });
    }
  }

  if (enabled.has('UPCOMING_INSTALLMENT')) {
    const daysAhead = Math.max(1, Math.min(60, Number(config('UPCOMING_INSTALLMENT').daysAhead) || 7));
    const fallbackRecipients = await recipientsWithPermission(instituteId, ['OWNER_ADMIN', 'ACCOUNTANT']);
    const installments = await FeeInstallmentModel.find({ instituteId, status: { $in: ['PENDING', 'PARTIAL'] }, dueDate: { $gte: start, $lt: new Date(start.getTime() + (daysAhead + 1) * DAY) } }).limit(1000).lean();
    for (const item of installments) {
      const plan = await FeePlanModel.findOne({ _id: item.feePlanId, instituteId }).select('studentId').lean() as { studentId: unknown } | null;
      const student = plan ? await StudentModel.findOne({ _id: plan.studentId, instituteId }).select('userId studentId').lean() as { userId?: unknown; studentId: string } | null : null;
      const recipients = student?.userId ? [student.userId] : fallbackRecipients.map((user) => user._id);
      for (const recipientUserId of recipients) await send({ instituteId, type: 'UPCOMING_INSTALLMENT', recipientUserId, title: 'Upcoming installment', message: `An installment of ${Math.max(0, item.amount - item.amountPaid)} is due on ${item.dueDate.toISOString().slice(0, 10)}.`, entityType: 'FeeInstallment', entityId: item.installmentId, dayKey });
    }
  }

  if (enabled.has('ATTENDANCE_RISK')) {
    const minimumSessions = Math.max(1, Math.min(90, Number(config('ATTENDANCE_RISK').minimumSessions) || 4));
    const maxAbsenceRate = Math.max(0.01, Math.min(1, Number(config('ATTENDANCE_RISK').maximumAbsenceRate) || 0.25));
    const rows = await AttendanceRecordModel.aggregate([{ $match: { instituteId: new Types.ObjectId(instituteId), timestamp: { $gte: new Date(start.getTime() - 30 * DAY), $lt: end } } }, { $group: { _id: '$studentId', sessions: { $sum: 1 }, absences: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } } } }, { $match: { sessions: { $gte: minimumSessions } } }, { $limit: 1000 }]);
    const fallbackRecipients = await recipientsWithPermission(instituteId, ['OWNER_ADMIN']);
    for (const row of rows) if (row.sessions >= minimumSessions && row.absences / row.sessions >= maxAbsenceRate) {
      const student = await StudentModel.findOne({ _id: row._id, instituteId }).select('userId studentId').lean() as { userId?: unknown; studentId: string } | null;
      const recipients = student?.userId ? [student.userId] : fallbackRecipients.map((user) => user._id);
      for (const recipientUserId of recipients) await send({ instituteId, type: 'ATTENDANCE_RISK', recipientUserId, title: 'Attendance risk', message: `Attendance records show ${row.absences} absences across ${row.sessions} marked sessions.`, entityType: 'Student', ...(student?.studentId ? { entityId: student.studentId } : {}), dayKey, data: { sessions: row.sessions, absences: row.absences } });
    }
  }

  if (enabled.has('COURSE_COMPLETION') || enabled.has('CERTIFICATE_ELIGIBILITY')) {
    const fallbackRecipients = await recipientsWithPermission(instituteId, ['OWNER_ADMIN']);
    const completed = await BatchEnrollmentModel.find({ instituteId, status: 'COMPLETED' }).select('studentId batchId enrollmentId').limit(1000).lean();
    for (const enrollment of completed) {
      const [student, batch] = await Promise.all([
        StudentModel.findOne({ _id: enrollment.studentId, instituteId }).select('userId studentId').lean() as Promise<{ userId?: unknown; studentId: string } | null>,
        BatchModel.findOne({ _id: enrollment.batchId, instituteId }).select('courseId batchCode').lean() as Promise<{ courseId: unknown; batchCode: string } | null>
      ]);
      if (!student || !batch) continue;
      const recipients = student.userId ? [student.userId] : fallbackRecipients.map((user) => user._id);
      for (const recipientUserId of recipients) await send({ instituteId, type: 'COURSE_COMPLETION', recipientUserId, title: 'Course completed', message: `Enrollment ${enrollment.enrollmentId} in batch ${batch.batchCode} is marked complete.`, entityType: 'Student', entityId: student.studentId, dayKey });
      if (enabled.has('CERTIFICATE_ELIGIBILITY')) {
        const check = await CertificateService.eligibility({ instituteId, studentId: toId(enrollment.studentId), courseId: toId(batch.courseId), batchId: toId(enrollment.batchId) });
        if (check.eligible) for (const recipientUserId of recipients) await send({ instituteId, type: 'CERTIFICATE_ELIGIBILITY', recipientUserId, title: 'Certificate eligible', message: `Student ${student.studentId} meets the current certificate requirements.`, entityType: 'Student', entityId: student.studentId, dayKey });
      }
    }
  }

  if (enabled.has('PENDING_EXPENSE_APPROVAL')) {
    const expenses = await ExpenseModel.find({ instituteId, approvalStatus: 'PENDING', status: 'UNPAID' }).select('expenseId amount vendorPayee').limit(1000).lean();
    const reviewers = await recipientsWithPermission(instituteId, ['OWNER_ADMIN', 'ACCOUNTANT']);
    for (const expense of expenses) for (const reviewer of reviewers) await send({ instituteId, type: 'PENDING_EXPENSE_APPROVAL', recipientUserId: reviewer._id, title: 'Expense approval pending', message: `${expense.vendorPayee}: ${expense.amount} is awaiting approval.`, entityType: 'Expense', entityId: expense.expenseId, dayKey });
  }

  if (enabled.has('PENDING_SALARY_APPROVAL')) {
    const salaries = await StaffSalaryModel.find({ instituteId, status: 'PENDING_APPROVAL' }).select('salaryId netPayable').limit(1000).lean();
    const reviewers = await recipientsWithPermission(instituteId, ['OWNER_ADMIN', 'ACCOUNTANT']);
    for (const salary of salaries) for (const reviewer of reviewers) await send({ instituteId, type: 'PENDING_SALARY_APPROVAL', recipientUserId: reviewer._id, title: 'Salary approval pending', message: `Salary ${salary.salaryId} for ${salary.netPayable} is awaiting approval.`, entityType: 'StaffSalary', entityId: salary.salaryId, dayKey });
  }

  if (enabled.has('OWNER_DAILY_SUMMARY')) {
    const [followUps, missedFollowUps, pendingFees, expenseApprovals, salaryApprovals] = await Promise.all([
      FollowUpModel.countDocuments({ instituteId, status: 'SCHEDULED', scheduledAt: { $gte: start, $lt: end } }),
      FollowUpModel.countDocuments({ instituteId, status: 'SCHEDULED', scheduledAt: { $lt: start } }),
      FeePlanModel.countDocuments({ instituteId, status: 'ACTIVE', amountDue: { $gt: 0 } }),
      ExpenseModel.countDocuments({ instituteId, status: 'UNPAID', approvalStatus: 'PENDING' }),
      StaffSalaryModel.countDocuments({ instituteId, status: 'PENDING_APPROVAL' })
    ]);
    const owners = await recipientsWithPermission(instituteId, ['OWNER_ADMIN']);
    const summary = { followUps, missedFollowUps, pendingFees, expenseApprovals, salaryApprovals };
    for (const owner of owners) await send({ instituteId, type: 'OWNER_DAILY_SUMMARY', recipientUserId: owner._id, title: 'Daily institute summary', message: `Today: ${followUps} follow-ups; ${missedFollowUps} missed follow-ups; ${pendingFees} pending fee plans; ${expenseApprovals} expense approvals; ${salaryApprovals} salary approvals.`, entityType: 'Institute', dayKey, data: summary });
  }
  return { notificationsCreated: created, rulesEvaluated: rules.length, completedAt: new Date().toISOString() };
}

/** Called by a scheduler/worker process. Unique job keys and atomic claims make retries idempotent. */
export async function runDailyAutomation(instituteId: string, date = new Date()) {
  const scheduledFor = dayStart(date);
  try {
    await ScheduledJobModel.create({ instituteId, jobKey: 'DAILY_NOTIFICATIONS', scheduledFor, status: 'SCHEDULED' });
  } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  const staleBefore = new Date(Date.now() - 15 * 60_000);
  const job = await ScheduledJobModel.findOneAndUpdate({ instituteId, jobKey: 'DAILY_NOTIFICATIONS', scheduledFor, $or: [{ status: { $in: ['SCHEDULED', 'FAILED'] } }, { status: 'RUNNING', startedAt: { $lt: staleBefore } }] }, { $set: { status: 'RUNNING', startedAt: new Date(), error: null }, $inc: { attemptCount: 1 } }, { new: true });
  if (!job) return await ScheduledJobModel.findOne({ instituteId, jobKey: 'DAILY_NOTIFICATIONS', scheduledFor }).lean();
  try {
    const owner = await UserModel.findOne({ instituteId, role: 'OWNER_ADMIN', status: 'active' }).select('_id').lean() as { _id: Types.ObjectId } | null;
    if (owner) await NotificationService.ensureDefaultRules(instituteId, toId(owner._id));
    const result = await executeDailyAutomation(instituteId, date);
    await ScheduledJobModel.updateOne({ _id: job._id }, { $set: { status: 'SUCCEEDED', completedAt: new Date(), result } });
  } catch (error) {
    await ScheduledJobModel.updateOne({ _id: job._id }, { $set: { status: 'FAILED', completedAt: new Date(), error: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown automation error' } });
    throw error;
  }
  return ScheduledJobModel.findById(job._id).lean();
}
