import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { CertificateModel } from '../../models/certificate.model.js';
import { CertificateRuleModel } from '../../models/certificate-rule.model.js';
import { EvidenceModel } from '../../models/evidence.model.js';
import { StudentModel } from '../../models/student.model.js';
import { FileStorageService } from '../../services/file-storage.service.js';
import { CertificateService } from '../../services/certificate.service.js';
import { auditRequestMetadata } from '../../utils/audit-request.js';
import { ApiError } from '../../utils/api-error.js';

function requireAuth(req: Request) {
  if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
  return req.auth;
}
function objectId(value: string, field: string) {
  if (!Types.ObjectId.isValid(value)) throw new ApiError(400, 'INVALID_ID', `${field} is invalid`);
  return value;
}

export const certificateController = {
  async eligibility(req: Request, res: Response) {
    const auth = requireAuth(req);
    const studentId = objectId(String(req.query.studentId ?? ''), 'studentId');
    const result = await CertificateService.eligibility({ instituteId: auth.instituteId, studentId, courseId: objectId(String(req.query.courseId ?? ''), 'courseId'), batchId: objectId(String(req.query.batchId ?? ''), 'batchId') });
    if (auth.role === 'STUDENT' && result.studentId !== auth.userId) {
      const student = await StudentModel.findOne({ _id: studentId, instituteId: auth.instituteId, userId: auth.objectId }).select('_id');
      if (!student) throw new ApiError(403, 'STUDENT_ACCESS_DENIED', 'You may only view your own certificate eligibility');
    }
    res.json({ success: true, data: result });
  },
  async issue(req: Request, res: Response) {
    const auth = requireAuth(req);
    const { studentId, courseId, batchId } = req.body as Record<string, string>;
    if (!studentId || !courseId || !batchId) throw new ApiError(400, 'VALIDATION_ERROR', 'studentId, courseId, and batchId are required');
    const certificate = await CertificateService.issue({ instituteId: auth.instituteId, studentId: objectId(studentId, 'studentId'), courseId: objectId(courseId, 'courseId'), batchId: objectId(batchId, 'batchId'), actorUserId: auth.objectId, request: auditRequestMetadata(req) });
    res.status(201).json({ success: true, data: certificate.toJSON() });
  },
  async get(req: Request, res: Response) {
    const auth = requireAuth(req);
    const id = String(req.params.id);
    const query = Types.ObjectId.isValid(id) ? { _id: id } : { certificateId: id };
    const certificate = await CertificateModel.findOne({ ...query, instituteId: auth.instituteId }).lean();
    if (!certificate) throw new ApiError(404, 'CERTIFICATE_NOT_FOUND', 'Certificate was not found');
    if (auth.role === 'STUDENT') {
      const student = await StudentModel.findOne({ _id: certificate.studentId, instituteId: auth.instituteId, userId: auth.objectId }).select('_id');
      if (!student) throw new ApiError(403, 'CERTIFICATE_ACCESS_DENIED', 'You may only view your own certificates');
    }
    res.json({ success: true, data: certificate });
  },
  async verify(req: Request, res: Response) {
    const auth = requireAuth(req);
    const certificate = await CertificateModel.findOne({ certificateId: String(req.params.certificateId), instituteId: auth.instituteId }).lean();
    if (!certificate) throw new ApiError(404, 'CERTIFICATE_NOT_FOUND', 'Certificate is not valid');
    const studentFilter = { _id: certificate.studentId, instituteId: auth.instituteId, ...(auth.role === 'STUDENT' ? { userId: auth.objectId } : {}) };
    const student = await StudentModel.findOne(studentFilter).select('studentId name');
    if (!student) throw new ApiError(404, 'CERTIFICATE_NOT_FOUND', 'Certificate is not valid');
    res.json({ success: true, data: { valid: true, certificateId: certificate.certificateId, issueDate: certificate.issueDate, resultStatus: certificate.resultStatus, completionStatus: certificate.completionStatus, student: student ? { studentId: student.studentId, name: student.name } : undefined } });
  },
  async getRules(req: Request, res: Response) {
    const auth = requireAuth(req);
    const rules = await CertificateRuleModel.findOne({ instituteId: auth.instituteId, courseId: objectId(String(req.params.courseId), 'courseId') }).lean();
    res.json({ success: true, data: rules ?? { requireCourseCompletion: true, attendanceMinimumPercentage: null, requiredAssessmentIds: [], requireFeesPaid: false, requiredDocumentTypes: [] } });
  },
  async putRules(req: Request, res: Response) {
    const auth = requireAuth(req);
    const courseId = objectId(String(req.params.courseId), 'courseId');
    const body = req.body as Record<string, unknown>;
    const attendance = body.attendanceMinimumPercentage;
    if (attendance !== undefined && (typeof attendance !== 'number' || attendance < 0 || attendance > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'attendanceMinimumPercentage must be between 0 and 100');
    for (const flag of ['requireCourseCompletion', 'requireFeesPaid']) if (body[flag] !== undefined && typeof body[flag] !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', `${flag} must be boolean`);
    const requiredAssessmentIds = body.requiredAssessmentIds ?? [];
    const requiredDocumentTypes = body.requiredDocumentTypes ?? [];
    if (!Array.isArray(requiredAssessmentIds) || requiredAssessmentIds.some((id) => typeof id !== 'string' || !Types.ObjectId.isValid(id))) throw new ApiError(400, 'VALIDATION_ERROR', 'requiredAssessmentIds must be valid assessment IDs');
    if (!Array.isArray(requiredDocumentTypes) || requiredDocumentTypes.some((type) => typeof type !== 'string' || !type.trim() || type.length > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'requiredDocumentTypes must be non-empty strings up to 100 characters');
    const update: Record<string, unknown> = { updatedBy: auth.objectId, requireCourseCompletion: body.requireCourseCompletion ?? true, requireFeesPaid: body.requireFeesPaid ?? false, requiredAssessmentIds, requiredDocumentTypes };
    if (attendance !== undefined) update.attendanceMinimumPercentage = attendance;
    const rules = await CertificateRuleModel.findOneAndUpdate({ instituteId: auth.instituteId, courseId }, { $set: update, $unset: attendance === undefined ? { attendanceMinimumPercentage: 1 } : {} }, { upsert: true, new: true, runValidators: true });
    res.json({ success: true, data: rules });
  },
  async uploadEvidence(req: Request, res: Response) {
    const auth = requireAuth(req);
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const type = req.header('x-evidence-type')?.trim();
    const description = req.header('x-evidence-description')?.trim();
    const entityType = req.header('x-related-entity-type')?.trim();
    const entityId = req.header('x-related-entity-id')?.trim();
    const mimeType = req.header('content-type')?.split(';')[0]?.trim() ?? '';
    if (!type || !description || !entityType || !entityId || !mimeType || type.length > 100 || description.length > 1000 || entityType.length > 80 || entityId.length > 200) throw new ApiError(400, 'VALIDATION_ERROR', 'Evidence metadata headers are required and must be within limits');
    if (!['Student', 'Staff', 'Certificate', 'Admission', 'Payment', 'Expense', 'StaffSalary'].includes(entityType)) throw new ApiError(400, 'INVALID_ENTITY_TYPE', 'Unsupported evidence entity type');
    const extension: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'text/plain': '.txt' };
    const upload = await FileStorageService.upload(auth, { bytes, originalName: req.header('x-file-name')?.trim() || `evidence${extension[mimeType] ?? ''}`, mimeType, entityType: entityType as 'Student' | 'Staff' | 'Certificate' | 'Admission' | 'Payment' | 'Expense' | 'StaffSalary', entityId, documentType: type, description }, auditRequestMetadata(req));
    const evidence = await EvidenceModel.findOne({ evidenceId: upload.evidenceId, instituteId: auth.instituteId });
    if (!evidence) throw new ApiError(500, 'EVIDENCE_METADATA_FAILED', 'Evidence metadata could not be loaded');
    res.status(201).json({ success: true, data: evidence.toJSON() });
  },
  async readEvidence(req: Request, res: Response) {
    const auth = requireAuth(req);
    const evidence = await FileStorageService.downloadEvidence(auth, String(req.params.evidenceId), auditRequestMetadata(req));
    const safeName = evidence.originalName.replace(/["\\]/g, '_').replace(/[^\x20-\x7E]/g, '_');
    res.set({ 'Content-Type': evidence.mimeType, 'Content-Length': String(evidence.size), 'Content-Disposition': `attachment; filename="${safeName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.send(evidence.bytes);
  }
};
