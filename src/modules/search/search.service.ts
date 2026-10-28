import { Types, type FilterQuery, type Model } from 'mongoose';
import { LeadModel } from '../../models/lead.model.js';
import { StudentModel } from '../../models/student.model.js';
import { AdmissionModel } from '../../models/admission.model.js';
import { CourseModel } from '../../models/course.model.js';
import { BatchModel } from '../../models/batch.model.js';
import { PaymentModel } from '../../models/payment.model.js';
import { ReceiptModel } from '../../models/receipt.model.js';
import { ExpenseModel } from '../../models/expense.model.js';
import { StaffModel } from '../../models/staff.model.js';
import { CertificateModel } from '../../models/certificate.model.js';
import { BatchEnrollmentModel } from '../../models/batch-enrollment.model.js';
import { TeacherAssignmentModel } from '../../models/teacher-assignment.model.js';
import { ROLE_PERMISSIONS, type Permission } from '../../types/rbac.js';
import type { AuthenticatedUser } from '../../types/auth.js';

type SearchType = 'lead' | 'student' | 'admission' | 'course' | 'batch' | 'payment' | 'receipt' | 'expense' | 'staff' | 'certificate';
type SearchItem = { type: SearchType; businessId: string; title: string; status: string; date: Date; navigationReference: string };
type Candidate = { model: Model<any>; type: SearchType; permission: Permission; idField: string; titleField: string; dateField: string; route: string; searchFields: string[]; extra?: FilterQuery<any> | undefined; projection?: string };

function prefix(value: string): RegExp { return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'); }

export class SearchService {
  static async search(user: AuthenticatedUser, query: string, page: number, limit: number) {
    const instituteId = new Types.ObjectId(user.instituteId);
    const permissions = ROLE_PERMISSIONS[user.role] as readonly string[];
    const ownStudent = user.role === 'STUDENT'
      ? await StudentModel.findOne({ instituteId, userId: new Types.ObjectId(user.objectId) }).select('_id').lean()
      : null;
    const teacherAssignments = user.role === 'TEACHER'
      ? await TeacherAssignmentModel.find({ instituteId, userId: new Types.ObjectId(user.objectId), status: 'ACTIVE' }).select('courseId batchId').lean()
      : [];
    const studentEnrollments = user.role === 'STUDENT' && ownStudent
      ? await BatchEnrollmentModel.find({ instituteId, studentId: ownStudent._id, status: 'ACTIVE' }).select('batchId').lean()
      : [];
    const allowedBatchIds = user.role === 'TEACHER'
      ? teacherAssignments.map((item) => item.batchId)
      : user.role === 'STUDENT' ? studentEnrollments.map((item) => item.batchId) : [];
    const assignedStudentIds = user.role === 'TEACHER' && allowedBatchIds.length
      ? await BatchEnrollmentModel.find({ instituteId, batchId: { $in: allowedBatchIds }, status: { $in: ['ACTIVE', 'COMPLETED'] } }).distinct('studentId')
      : [];
    const allowedCourseIds = user.role === 'TEACHER'
      ? teacherAssignments.map((item) => item.courseId)
      : user.role === 'STUDENT' && allowedBatchIds.length
        ? await BatchModel.find({ instituteId, _id: { $in: allowedBatchIds } }).distinct('courseId')
        : [];
    const escaped = prefix(query);
    const scoped = (fields: string[]): FilterQuery<any> => ({ instituteId, $or: fields.map((field) => ({ [field]: escaped })) });
    const candidates: Candidate[] = [
      { model: LeadModel, type: 'lead', permission: 'lead.view', idField: 'leadId', titleField: 'name', dateField: 'enquiryDate', route: '/leads', searchFields: ['leadId', 'name', 'mobile', 'email'] },
      { model: StudentModel, type: 'student', permission: 'student.view', idField: 'studentId', titleField: 'name', dateField: 'createdAt', route: '/students', searchFields: ['studentId', 'name', 'mobile', 'email'], extra: user.role === 'STUDENT' ? { _id: ownStudent?._id ?? null } : user.role === 'TEACHER' ? { _id: { $in: assignedStudentIds } } : undefined },
      { model: AdmissionModel, type: 'admission', permission: 'admission.view', idField: 'admissionId', titleField: 'studentDetails.name', dateField: 'createdAt', route: '/admissions', searchFields: ['admissionId', 'studentDetails.name', 'studentDetails.mobile', 'studentDetails.email'], projection: 'admissionId studentDetails.name status createdAt' },
      { model: CourseModel, type: 'course', permission: 'course.view', idField: 'courseCode', titleField: 'name', dateField: 'updatedAt', route: '/courses', searchFields: ['courseCode', 'code', 'name'], extra: user.role === 'TEACHER' || user.role === 'STUDENT' ? { _id: { $in: allowedCourseIds } } : undefined },
      { model: BatchModel, type: 'batch', permission: 'batch.view', idField: 'batchCode', titleField: 'name', dateField: 'startDate', route: '/batches', searchFields: ['batchCode', 'name', 'room'], extra: user.role === 'TEACHER' || user.role === 'STUDENT' ? { _id: { $in: allowedBatchIds } } : undefined },
      { model: PaymentModel, type: 'payment', permission: 'payment.view', idField: 'paymentId', titleField: 'paymentId', dateField: 'date', route: '/payments', searchFields: ['paymentId', 'reference'], extra: user.role === 'STUDENT' ? { studentId: ownStudent?._id ?? null } : undefined },
      { model: ReceiptModel, type: 'receipt', permission: 'receipt.view', idField: 'receiptId', titleField: 'receiptId', dateField: 'issuedAt', route: '/receipts', searchFields: ['receiptId'], extra: user.role === 'STUDENT' ? { studentId: ownStudent?._id ?? null } : undefined },
      { model: ExpenseModel, type: 'expense', permission: 'expense.view', idField: 'expenseId', titleField: 'vendorPayee', dateField: 'date', route: '/expenses', searchFields: ['expenseId', 'vendorPayee', 'reason'] },
      { model: StaffModel, type: 'staff', permission: 'staff.view', idField: 'staffId', titleField: 'name', dateField: 'joiningDate', route: '/staff', searchFields: ['staffId', 'name', 'contact.mobile', 'contact.email', 'role'] },
      { model: CertificateModel, type: 'certificate', permission: 'certificate.view', idField: 'certificateId', titleField: 'certificateId', dateField: 'issueDate', route: '/certificates', searchFields: ['certificateId'], extra: user.role === 'STUDENT' ? { studentId: ownStudent?._id ?? null } : user.role === 'TEACHER' ? { batchId: { $in: allowedBatchIds } } : undefined }
    ];
    const active = candidates.filter((candidate) => permissions.includes(candidate.permission));
    const offset = (page - 1) * limit;
    const windowSize = offset + limit;
    const batches = await Promise.all(active.map(async (candidate) => {
      const filter: FilterQuery<any> = { ...scoped(candidate.searchFields), ...(candidate.extra ?? {}) };
      const projection = candidate.projection ?? `${candidate.idField} ${candidate.titleField} status ${candidate.dateField}`;
      const [docs, total] = await Promise.all([
        candidate.model.find(filter).select(projection).sort({ [candidate.dateField]: -1, _id: -1 }).limit(windowSize).lean(),
        candidate.model.countDocuments(filter)
      ]);
      const items = docs.map((doc: any) => {
        const title = candidate.titleField.split('.').reduce((value: any, key: string) => value?.[key], doc);
        const date = doc[candidate.dateField] ?? doc.createdAt;
        return { type: candidate.type, businessId: String(doc[candidate.idField]), title: String(title ?? doc[candidate.idField]), status: String(doc.status ?? 'ACTIVE'), date: new Date(date), navigationReference: `${candidate.route}/${encodeURIComponent(String(doc[candidate.idField]))}` } as SearchItem;
      });
      return { total, items };
    }));
    const allItems = batches.flatMap((batch) => batch.items).sort((a, b) => b.date.getTime() - a.date.getTime() || a.businessId.localeCompare(b.businessId));
    const total = batches.reduce((sum, batch) => sum + batch.total, 0);
    return { items: allItems.slice(offset, offset + limit), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
