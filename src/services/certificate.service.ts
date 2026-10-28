import { randomUUID } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { AttendanceRecordModel } from '../models/attendance-record.model.js';
import { AttendanceSessionModel } from '../models/attendance-session.model.js';
import { BatchEnrollmentModel } from '../models/batch-enrollment.model.js';
import { BatchModel } from '../models/batch.model.js';
import { CertificateModel } from '../models/certificate.model.js';
import { CertificateRuleModel } from '../models/certificate-rule.model.js';
import { CourseModel } from '../models/course.model.js';
import { CourseModuleModel } from '../models/course-module.model.js';
import { CourseProgressModel } from '../models/course-progress.model.js';
import { ExamModel } from '../models/exam.model.js';
import { ExamResultModel } from '../models/exam-result.model.js';
import { FeePlanModel } from '../models/fee-plan.model.js';
import { StudentDocumentModel } from '../models/student-document.model.js';
import { StudentModel } from '../models/student.model.js';
import { AuditService } from './audit.service.js';
import type { AuditRequestMetadata } from '../types/audit.js';
import { ApiError } from '../utils/api-error.js';

export interface CertificateEligibilityInput { instituteId: string; studentId: string; courseId: string; batchId: string; session?: ClientSession }

export class CertificateService {
  static async eligibility(input: CertificateEligibilityInput) {
    const { instituteId, studentId, courseId, batchId, session } = input;
    const options = session ? { session } : {};
    const [student, course, batch, enrollment] = await Promise.all([
      StudentModel.findOne({ _id: studentId, instituteId, status: { $in: ['ACTIVE', 'COMPLETED', 'ALUMNI'] } }, null, options),
      CourseModel.findOne({ _id: courseId, instituteId }, null, options),
      BatchModel.findOne({ _id: batchId, instituteId, courseId }, null, options),
      BatchEnrollmentModel.findOne({ instituteId, studentId, batchId, status: { $in: ['ACTIVE', 'COMPLETED'] } }, null, options)
    ]);
    if (!student || !course || !batch || !enrollment) throw new ApiError(404, 'CERTIFICATE_SUBJECT_NOT_FOUND', 'Student, course, batch, or enrollment was not found in this institute');
    const rule = await CertificateRuleModel.findOne({ instituteId, courseId }, null, options).lean();
    const missingRequirements: Array<{ code: string; message: string; details?: unknown }> = [];
    const checks: Record<string, unknown> = {};

    if (rule?.requireCourseCompletion !== false) {
      const modules = await CourseModuleModel.find({ instituteId, courseId, isActive: true }, { _id: 1 }, options).lean();
      const progress = await CourseProgressModel.find({ instituteId, studentId, courseId }, { moduleId: 1, status: 1 }, options).lean();
      const progressByModule = new Map<string, typeof progress>();
      for (const entry of progress) {
        const key = String(entry.moduleId);
        progressByModule.set(key, [...(progressByModule.get(key) ?? []), entry]);
      }
      const outstanding = modules.filter((module) => {
        const entries = progressByModule.get(String(module._id)) ?? [];
        return entries.length === 0 || entries.some((entry) => entry.status !== 'COMPLETED');
      }).length;
      const complete = modules.length > 0 && outstanding === 0;
      checks.courseCompletion = { required: true, complete, modules: modules.length, outstandingModules: outstanding };
      if (!complete) missingRequirements.push({ code: 'COURSE_INCOMPLETE', message: 'All active course modules must be completed', details: { outstandingModules: outstanding } });
    } else checks.courseCompletion = { required: false, complete: true };

    if (rule?.attendanceMinimumPercentage !== undefined && rule.attendanceMinimumPercentage !== null) {
      const sessions = await AttendanceSessionModel.find({ instituteId, batchId, status: 'COMPLETED' }, { _id: 1 }, options).lean();
      const sessionIds = sessions.map((item) => item._id);
      const records = sessionIds.length ? await AttendanceRecordModel.find({ instituteId, studentId, sessionObjectId: { $in: sessionIds } }, { status: 1 }, options).lean() : [];
      const attended = records.filter((item) => ['PRESENT', 'LATE'].includes(item.status)).length;
      const percentage = sessionIds.length ? Math.round((attended / sessionIds.length) * 10000) / 100 : 0;
      const complete = percentage >= rule.attendanceMinimumPercentage;
      checks.attendance = { required: true, minimumPercentage: rule.attendanceMinimumPercentage, percentage, completedSessions: sessionIds.length };
      if (!complete) missingRequirements.push({ code: 'ATTENDANCE_REQUIREMENT_NOT_MET', message: `Attendance must be at least ${rule.attendanceMinimumPercentage}%`, details: { percentage, required: rule.attendanceMinimumPercentage } });
    } else checks.attendance = { required: false };

    const requiredAssessmentIds = (rule?.requiredAssessmentIds ?? []).map(String);
    if (requiredAssessmentIds.length) {
      const exams = await ExamModel.find({ _id: { $in: requiredAssessmentIds }, instituteId, courseId }, { _id: 1, title: 1 }, options).lean();
      const results = await ExamResultModel.find({ instituteId, studentId, examId: { $in: requiredAssessmentIds }, publicationStatus: 'PUBLISHED', passFail: 'PASS' }, { examId: 1 }, options).lean();
      const passed = new Set(results.map((result) => String(result.examId)));
      const outstanding = exams.filter((exam) => !passed.has(String(exam._id)));
      checks.requiredAssessments = { required: true, count: requiredAssessmentIds.length, passed: requiredAssessmentIds.length - outstanding.length };
      for (const examId of requiredAssessmentIds.filter((id) => !passed.has(id))) {
        const exam = exams.find((item) => String(item._id) === examId);
        missingRequirements.push({ code: 'ASSESSMENT_NOT_PASSED', message: 'A required published assessment has not been passed', details: { assessmentId: examId, title: exam?.title ?? 'Configured assessment' } });
      }
    } else checks.requiredAssessments = { required: false };

    if (rule?.requireFeesPaid) {
      const fee = await FeePlanModel.findOne({ instituteId, studentId, courseId, amountDue: { $gt: 0 }, status: { $ne: 'CANCELLED' } }, { amountDue: 1 }, options).lean();
      checks.fees = { required: true, paid: !fee };
      if (fee) missingRequirements.push({ code: 'FEES_OUTSTANDING', message: 'All course fees must be paid', details: { amountDue: fee.amountDue } });
    } else checks.fees = { required: false };

    const requiredDocuments = rule?.requiredDocumentTypes ?? [];
    if (requiredDocuments.length) {
      const documents = await StudentDocumentModel.find({ instituteId, studentId, documentType: { $in: requiredDocuments }, verificationStatus: 'VERIFIED', archivedAt: null }, { documentType: 1 }, options).lean();
      const verified = new Set(documents.map((document) => document.documentType));
      const outstanding = requiredDocuments.filter((type) => !verified.has(type));
      checks.documents = { required: true, complete: outstanding.length === 0 };
      for (const documentType of outstanding) missingRequirements.push({ code: 'DOCUMENT_NOT_VERIFIED', message: 'A required document is missing or not verified', details: { documentType } });
    } else checks.documents = { required: false };

    return { eligible: missingRequirements.length === 0, studentId: student.studentId, courseId, batchId, checks, missingRequirements };
  }

  static async issue(input: CertificateEligibilityInput & { actorUserId: string; request: AuditRequestMetadata }) {
    const session = await mongoose.startSession();
    try {
      let issued: any;
      await session.withTransaction(async () => {
        const eligibility = await this.eligibility({ ...input, session });
        if (!eligibility.eligible) throw new ApiError(409, 'CERTIFICATE_INELIGIBLE', 'Certificate issuance requirements are not met', eligibility.missingRequirements);
        const prior = await CertificateModel.findOne({ instituteId: input.instituteId, studentId: input.studentId, courseId: input.courseId, batchId: input.batchId }).session(session);
        if (prior) throw new ApiError(409, 'CERTIFICATE_ALREADY_ISSUED', 'A certificate has already been issued for this enrollment');
        const rule = await CertificateRuleModel.findOne({ instituteId: input.instituteId, courseId: input.courseId }).session(session).lean();
        [issued] = await CertificateModel.create([{
          instituteId: input.instituteId, studentId: input.studentId, courseId: input.courseId, batchId: input.batchId,
          issueDate: new Date(), resultStatus: (rule?.requiredAssessmentIds?.length ?? 0) > 0 ? 'PASS' : 'NOT_APPLICABLE', completionStatus: 'COMPLETED',
          verificationCode: randomUUID(), verificationMetadata: { checkedAt: new Date(), ruleSnapshot: rule ?? { requireCourseCompletion: true } }
        }], { session });
        await AuditService.record({ instituteId: input.instituteId, actorUserId: input.actorUserId, action: 'certificate.issue', entityType: 'Certificate', entityId: issued.certificateId, after: issued.toJSON(), request: input.request, session });
      });
      return issued;
    } finally { await session.endSession(); }
  }
}
