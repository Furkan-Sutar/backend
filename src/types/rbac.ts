export const ROLES = [
  'OWNER_ADMIN',
  'COUNSELLOR',
  'TEACHER',
  'ACCOUNTANT',
  'STUDENT'
] as const;

export type Role = typeof ROLES[number];

export const PERMISSION_DEFINITIONS = [
  { key: 'auth.me', area: 'Authentication', description: 'Read the authenticated user profile' },
  { key: 'auth.logout', area: 'Authentication', description: 'End an authenticated refresh session' },
  { key: 'lead.view', area: 'CRM', description: 'View leads' },
  { key: 'lead.create', area: 'CRM', description: 'Create leads' },
  { key: 'lead.update', area: 'CRM', description: 'Update leads' },
  { key: 'lead.assign', area: 'CRM', description: 'Assign leads to counsellors' },
  { key: 'lead.convert', area: 'CRM', description: 'Convert leads to admissions' },
  { key: 'lead.archive', area: 'CRM', description: 'Archive leads without hard deletion' },
  { key: 'lead.delete', area: 'CRM', description: 'Legacy alias for lead.archive; never permits hard deletion' },
  { key: 'admission.view', area: 'Admissions', description: 'View admissions' },
  { key: 'admission.create', area: 'Admissions', description: 'Create admissions' },
  { key: 'admission.update', area: 'Admissions', description: 'Update admissions' },
  { key: 'student.view', area: 'Students', description: 'View students' },
  { key: 'student.create', area: 'Students', description: 'Create students' },
  { key: 'student.update', area: 'Students', description: 'Update students' },
  { key: 'student.archive', area: 'Students', description: 'Archive students without hard deletion' },
  { key: 'course.view', area: 'Academics', description: 'View courses' },
  { key: 'course.create', area: 'Academics', description: 'Create courses' },
  { key: 'course.update', area: 'Academics', description: 'Update courses' },
  { key: 'batch.view', area: 'Academics', description: 'View batches' },
  { key: 'batch.create', area: 'Academics', description: 'Create batches' },
  { key: 'batch.update', area: 'Academics', description: 'Update batches' },
  { key: 'batch.enroll', area: 'Academics', description: 'Enroll students in batches' },
  { key: 'batch.capacity.override', area: 'Academics', description: 'Override batch capacity with a recorded reason' },
  { key: 'attendance.view', area: 'Academics', description: 'View attendance' },
  { key: 'attendance.create', area: 'Academics', description: 'Record attendance' },
  { key: 'attendance.update', area: 'Academics', description: 'Update attendance' },
  { key: 'progress.view', area: 'Academics', description: 'View student progress' },
  { key: 'progress.update', area: 'Academics', description: 'Update student progress' },
  { key: 'assignment.view', area: 'Academics', description: 'View assignments' },
  { key: 'assignment.create', area: 'Academics', description: 'Create assignments' },
  { key: 'assignment.update', area: 'Academics', description: 'Update assignments' },
  { key: 'assignment.submit', area: 'Academics', description: 'Submit assignments as a student' },
  { key: 'exam.view', area: 'Academics', description: 'View exams' },
  { key: 'exam.create', area: 'Academics', description: 'Create exams' },
  { key: 'exam.update', area: 'Academics', description: 'Update exams' },
  { key: 'exam.attempt', area: 'Academics', description: 'Attempt published exams as a student' },
  { key: 'result.view', area: 'Academics', description: 'View results' },
  { key: 'result.update', area: 'Academics', description: 'Update results' },
  { key: 'result.publish', area: 'Academics', description: 'Publish results' },
  { key: 'fee.view', area: 'Finance', description: 'View fees' },
  { key: 'fee.create', area: 'Finance', description: 'Create fee records' },
  { key: 'discount.create', area: 'Finance', description: 'Apply discounts with an audit reason' },
  { key: 'account.create', area: 'Finance', description: 'Create financial accounts' },
  { key: 'accounttransaction.view', area: 'Finance', description: 'View account transactions and ledger entries' },
  { key: 'accounttransaction.create', area: 'Finance', description: 'Record expenses, transfers, and adjustments' },
  { key: 'financial.adjust', area: 'Finance', description: 'Post authorized adjustments with a reason' },
  { key: 'financial_period.view', area: 'Finance', description: 'View financial periods' },
  { key: 'financial_period.create', area: 'Finance', description: 'Create financial periods' },
  { key: 'payment.view', area: 'Finance', description: 'View payments' },
  { key: 'payment.create', area: 'Finance', description: 'Create payments' },
  { key: 'payment.reverse', area: 'Finance', description: 'Reverse payments with compensating transactions' },
  { key: 'receipt.view', area: 'Finance', description: 'View receipts' },
  { key: 'expense.view', area: 'Finance', description: 'View expenses' },
  { key: 'expense.category.manage', area: 'Finance', description: 'Manage expense categories and approval requirements' },
  { key: 'expense.create', area: 'Finance', description: 'Create expenses' },
  { key: 'expense.approve', area: 'Finance', description: 'Approve expenses' },
  { key: 'expense.pay', area: 'Finance', description: 'Pay approved expenses' },
  { key: 'salary.view', area: 'Finance', description: 'View salaries' },
  { key: 'salary.create', area: 'Finance', description: 'Create salary records' },
  { key: 'salary.approve', area: 'Finance', description: 'Approve salary records' },
  { key: 'salary.pay', area: 'Finance', description: 'Pay approved salaries' },
  { key: 'account.view', area: 'Finance', description: 'View accounts' },
  { key: 'ledger.view', area: 'Finance', description: 'View ledger entries' },
  { key: 'period.close', area: 'Finance', description: 'Close accounting periods' },
  { key: 'certificate.view', area: 'Certificates', description: 'View certificates' },
  { key: 'certificate.issue', area: 'Certificates', description: 'Issue certificates' },
  { key: 'certificate.verify', area: 'Certificates', description: 'Verify certificates' },
  { key: 'staff.view', area: 'Staff', description: 'View staff records and work links' },
  { key: 'staff.create', area: 'Staff', description: 'Create staff records' },
  { key: 'staff.update', area: 'Staff', description: 'Update staff records' },
  { key: 'staff.assignment.manage', area: 'Staff', description: 'Manage teaching and collection responsibilities' },
  { key: 'evidence.create', area: 'Certificates', description: 'Upload private evidence documents' },
  { key: 'evidence.view', area: 'Certificates', description: 'Access private evidence documents' },
  { key: 'file.archive', area: 'Certificates', description: 'Archive private files while retaining their audit history' },
  { key: 'report.view', area: 'Reports', description: 'View reports' },
  { key: 'course_profitability.manage', area: 'Reports', description: 'Configure course cost allocations for profitability reporting' },
  { key: 'user.view', area: 'Admin', description: 'View institute users' },
  { key: 'user.create', area: 'Admin', description: 'Create institute users' },
  { key: 'user.update', area: 'Admin', description: 'Update institute users' },
  { key: 'user.disable', area: 'Admin', description: 'Disable institute users' },
  { key: 'role.manage', area: 'Admin', description: 'Manage role assignments' },
  { key: 'permission.manage', area: 'Admin', description: 'Manage permission assignments' },
  { key: 'settings.manage', area: 'Admin', description: 'Manage institute settings' },
  { key: 'audit.view', area: 'Admin', description: 'View audit records' }
] as const;

export type Permission = typeof PERMISSION_DEFINITIONS[number]['key'];
export const PERMISSIONS = PERMISSION_DEFINITIONS.map(({ key }) => key) as readonly Permission[];

const allPermissions: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  OWNER_ADMIN: allPermissions,
  COUNSELLOR: [
    'auth.me', 'auth.logout',
    'lead.view', 'lead.create', 'lead.update', 'lead.assign', 'lead.convert', 'lead.archive', 'lead.delete',
    'admission.view', 'admission.create', 'admission.update',
    'student.view', 'student.create', 'student.update',
    'course.view', 'batch.view', 'batch.enroll', 'report.view'
  ],
  TEACHER: [
    'auth.me', 'auth.logout', 'student.view', 'course.view', 'batch.view',
    'attendance.view', 'attendance.create', 'attendance.update',
    'progress.view', 'progress.update',
    'assignment.view', 'assignment.create', 'assignment.update',
    'exam.view', 'exam.create', 'exam.update', 'result.view', 'result.update', 'result.publish', 'certificate.view'
  ],
  ACCOUNTANT: [
    'auth.me', 'auth.logout', 'admission.view', 'student.view', 'report.view',
    'fee.view', 'fee.create', 'discount.create', 'payment.view', 'payment.create', 'payment.reverse', 'receipt.view', 'account.create', 'accounttransaction.view', 'accounttransaction.create', 'financial.adjust', 'financial_period.view', 'financial_period.create',
    'expense.view', 'expense.create', 'expense.approve', 'expense.pay', 'expense.category.manage',
    'salary.view', 'salary.create', 'salary.approve', 'salary.pay', 'staff.view',
    'account.view', 'ledger.view', 'period.close'
  ],
  STUDENT: [
    'auth.me', 'auth.logout', 'student.view', 'course.view', 'batch.view',
    'attendance.view', 'progress.view', 'assignment.view', 'assignment.submit', 'exam.view', 'exam.attempt', 'result.view',
    'fee.view', 'payment.view', 'receipt.view', 'certificate.view', 'certificate.verify', 'evidence.create', 'evidence.view'
  ]
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
