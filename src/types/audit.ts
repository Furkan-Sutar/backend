export const AUDIT_ACTIONS = [
  'auth.login', 'auth.logout',
  'user.create', 'user.update', 'permission.change',
  'lead.create', 'lead.update', 'lead.assign', 'lead.convert', 'followup.create', 'counselling.create',
  'admission.create', 'admission.update',
  'course.create', 'course.update', 'course.deactivate', 'batch.create', 'batch.update', 'batch.deactivate', 'batch.enrollment.create', 'batch.capacity.override', 'timetable.create', 'timetable.update',
  'student.create', 'student.update', 'student.archive',
  'attendance.create', 'attendance.sensitive_update', 'progress.create', 'progress.update', 'result.create', 'result.update', 'result.publish',
  'assignment.create', 'assignment.update', 'assignment.submission.create', 'assignment.submission.assess', 'exam.create', 'exam.update', 'exam.question.create', 'exam.attempt.submit',
  'feeplan.create', 'discount.create', 'payment.create', 'payment.reverse', 'refund.create', 'receipt.create', 'financial_account.create', 'account_transaction.create', 'account_transaction.transfer', 'account_transaction.adjust', 'financial_period.create', 'financial_period.close',
  'expense.category.create', 'expense.create', 'expense.approve', 'expense.pay', 'salary.create', 'salary.approve', 'salary.pay',
  'certificate.issue', 'financial_period.close', 'settings.sensitive_update'
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];

export interface AuditRequestMetadata {
  requestId: string;
  ip?: string;
  userAgent?: string;
  device?: { id?: string; name?: string; platform?: string };
}

export interface AuditFilters {
  instituteId: string;
  date?: string;
  actor?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  page: number;
  limit: number;
}
