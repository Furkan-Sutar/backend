import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../types/auth.js';
import { ROLE_PERMISSIONS, type Permission } from '../types/rbac.js';
import { PrivateFileModel, FILE_ENTITY_TYPES } from '../models/private-file.model.js';
import { EvidenceModel } from '../models/evidence.model.js';
import { StudentDocumentModel } from '../models/student-document.model.js';
import { StudentModel } from '../models/student.model.js';
import { StaffModel } from '../models/staff.model.js';
import { CertificateModel } from '../models/certificate.model.js';
import { ReceiptModel } from '../models/receipt.model.js';
import { AssignmentSubmissionModel } from '../models/assignment-submission.model.js';
import { AssignmentModel } from '../models/assignment.model.js';
import { TeacherAssignmentModel } from '../models/teacher-assignment.model.js';
import { InternshipRecordModel } from '../models/internship-record.model.js';
import { AdmissionModel } from '../models/admission.model.js';
import { PaymentModel } from '../models/payment.model.js';
import { ExpenseModel } from '../models/expense.model.js';
import { StaffSalaryModel } from '../models/staff-salary.model.js';
import { documentStorage } from './private-document-storage.service.js';
import { inTransaction } from '../utils/transaction.js';
import { ApiError } from '../utils/api-error.js';
import { AuditService } from './audit.service.js';
import type { AuditRequestMetadata } from '../types/audit.js';

export type FileEntityType = typeof FILE_ENTITY_TYPES[number];
export interface FileUploadInput { bytes: Buffer; originalName: string; mimeType: string; entityType: FileEntityType; entityId: string; documentType: string; description?: string | undefined }
export interface FileMetadata { fileId: string; originalName: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: Date; instituteId: string; relatedEntityType: FileEntityType; relatedEntityId: string; documentType: string; description?: string; evidenceId?: string; archivedAt?: Date | null }
export interface SecureFileStorage {
  upload(auth: AuthenticatedUser, input: FileUploadInput, request: AuditRequestMetadata): Promise<{ file: FileMetadata; evidenceId?: string }>;
  download(auth: AuthenticatedUser, fileId: string, request: AuditRequestMetadata): Promise<{ metadata: FileMetadata; bytes: Buffer }>;
  archive(auth: AuthenticatedUser, fileId: string, request: AuditRequestMetadata): Promise<FileMetadata>;
  metadata(auth: AuthenticatedUser, fileId: string): Promise<FileMetadata>;
  authorize(auth: AuthenticatedUser, fileId: string, action: 'download' | 'archive'): Promise<void>;
}

const permissionMap: Record<FileEntityType, Permission> = {
  Student: 'student.view', Staff: 'staff.view', Certificate: 'certificate.view', Receipt: 'receipt.view',
  AssignmentSubmission: 'assignment.view', Evidence: 'evidence.view', InternshipRecord: 'student.view',
  Admission: 'admission.view', Payment: 'payment.view', Expense: 'expense.view', StaffSalary: 'salary.view'
};
function has(auth: AuthenticatedUser, permissions: Permission[]) { return permissions.some((permission) => ROLE_PERMISSIONS[auth.role].includes(permission)); }
function deny(message = 'You are not authorized to access this file') { throw new ApiError(403, 'FILE_ACCESS_DENIED', message); }
function notFound() { throw new ApiError(404, 'RELATED_ENTITY_NOT_FOUND', 'The related record was not found in this institute'); }
function queryFor(id: string, field: string, instituteId: string) { return { instituteId, ...(Types.ObjectId.isValid(id) ? { _id: id } : { [field]: id }) }; }

export function validatePrivateFile(bytes: Buffer, originalName: string, declaredMimeType: string) {
  const name = originalName.trim();
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new ApiError(413, 'FILE_SIZE_INVALID', 'File size must be between 1 byte and 20 MB');
  if (!name || name.length > 255 || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name) || name.includes('..')) throw new ApiError(400, 'INVALID_FILE_NAME', 'File name is invalid');
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  let detected: string | undefined;
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-' && bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1').includes('%%EOF')) detected = 'application/pdf';
  else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) detected = 'image/jpeg';
  else if (bytes.length >= 20 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(bytes.length - 8, bytes.length - 4).toString('ascii') === 'IEND') detected = 'image/png';
  else if (bytes.length >= 16 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' && bytes.readUInt32LE(4) === bytes.length - 8) detected = 'image/webp';
  else if (bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) && bytes[bytes.length - 1] === 0x3b) detected = 'image/gif';
  else if (declaredMimeType === 'text/plain') {
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (!text.includes('\u0000')) detected = 'text/plain'; } catch { /* rejected below */ }
  }
  const extensions: Record<string, string[]> = { 'application/pdf': ['.pdf'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'], 'image/gif': ['.gif'], 'text/plain': ['.txt'] };
  if (!detected || detected !== declaredMimeType || !extensions[detected]?.includes(ext)) throw new ApiError(415, 'FILE_TYPE_INVALID', 'File content, extension, and declared MIME type must match an allowed private document format');
  return { originalName: name, mimeType: detected, size: bytes.length };
}

async function assertRecordPermission(auth: AuthenticatedUser, type: FileEntityType, entityId: string, action: 'upload' | 'download' | 'archive', depth = 0): Promise<any> {
  if (depth > 2) throw new ApiError(400, 'RELATED_ENTITY_NESTING_INVALID', 'Related file records cannot be nested');
  const instituteId = auth.instituteId;
  const required = permissionMap[type];
  const ownerOnly = auth.role === 'STUDENT';
  const viewOwn = async (studentId: unknown) => {
    if (!ownerOnly) return;
    if (!studentId) deny('Students can access files only for their own records');
    const student = await StudentModel.findOne({ _id: studentId, instituteId, userId: auth.objectId }).select('_id').lean();
    if (!student) deny('Students can access files only for their own records');
  };

  if (type === 'Student') {
    const row: any = await StudentModel.findOne(queryFor(entityId, 'studentId', instituteId)).lean(); if (!row) notFound();
    const own = auth.role === 'STUDENT' && String(row.userId) === auth.objectId;
    if (action === 'upload') { if (!(own ? has(auth, ['evidence.create']) : has(auth, ['student.update']))) deny(); }
    else { if (!has(auth, [required])) deny(); if (ownerOnly && !own) deny(); }
    return row;
  }
  if (type === 'Staff') {
    const row: any = await StaffModel.findOne(queryFor(entityId, 'staffId', instituteId)).lean(); if (!row) notFound();
    const own = String(row.userId ?? '') === auth.objectId;
    if (action === 'upload') { if (!(own ? has(auth, ['evidence.create']) : has(auth, ['staff.update']))) deny(); }
    else if (action === 'archive') { if (!has(auth, ['file.archive'])) deny(); }
    else if (own ? !has(auth, ['auth.me']) : !has(auth, [required])) deny();
    return row;
  }
  if (type === 'Certificate') {
    const row: any = await CertificateModel.findOne(queryFor(entityId, 'certificateId', instituteId)).lean(); if (!row) notFound();
    if (action === 'upload' ? !has(auth, ['evidence.create', 'certificate.issue']) : !has(auth, [required])) deny();
    await viewOwn(row.studentId); return row;
  }
  if (type === 'Receipt') {
    const row: any = await ReceiptModel.findOne(queryFor(entityId, 'receiptId', instituteId)).lean(); if (!row) notFound();
    if (action === 'upload' ? !has(auth, ['evidence.create', 'payment.create']) : !has(auth, [required])) deny();
    await viewOwn(row.studentId); return row;
  }
  if (type === 'AssignmentSubmission') {
    const row: any = await AssignmentSubmissionModel.findOne(queryFor(entityId, 'submissionId', instituteId)).lean(); if (!row) notFound();
    const own = auth.role === 'STUDENT' && String((await StudentModel.findOne({ _id: row.studentId, instituteId }).select('userId').lean() as any)?.userId ?? '') === auth.objectId;
    const assignment: any = await AssignmentModel.findOne({ _id: row.assignmentId, instituteId }).lean(); if (!assignment) notFound();
    if (action === 'upload') {
      if (own) { if (!has(auth, ['assignment.submit']) || assignment.status !== 'OPEN') deny('Assignment is not open for submission'); }
      else if (!has(auth, ['assignment.update']) || (auth.role === 'TEACHER' && !await TeacherAssignmentModel.exists({ instituteId, batchId: assignment.batchId, userId: auth.objectId, status: 'ACTIVE' }))) deny();
    } else {
      if (!has(auth, [required]) || (ownerOnly && !own)) deny();
      if (auth.role === 'TEACHER' && !await TeacherAssignmentModel.exists({ instituteId, batchId: assignment.batchId, userId: auth.objectId, status: 'ACTIVE' })) deny();
    }
    return row;
  }
  if (type === 'Evidence') {
    if (!has(auth, action === 'upload' ? ['evidence.create'] : action === 'archive' ? ['file.archive'] : ['evidence.view'])) deny();
    const row: any = await EvidenceModel.findOne({ ...queryFor(entityId, 'evidenceId', instituteId), archivedAt: null }).lean(); if (!row) notFound();
    await assertRecordPermission(auth, row.relatedEntity.entityType as FileEntityType, row.relatedEntity.entityId, 'download', depth + 1); return row;
  }
  if (type === 'InternshipRecord') {
    const row: any = await InternshipRecordModel.findOne(queryFor(entityId, 'internshipId', instituteId)).lean(); if (!row) notFound();
    const own = auth.role === 'STUDENT' && String((await StudentModel.findOne({ _id: row.studentId, instituteId }).select('userId').lean() as any)?.userId ?? '') === auth.objectId;
    if (action === 'upload' ? !(own ? has(auth, ['evidence.create']) : has(auth, ['student.update'])) : !has(auth, [required]) || (ownerOnly && !own)) deny(); return row;
  }
  if (type === 'Admission') {
    const row: any = await AdmissionModel.findOne(queryFor(entityId, 'admissionId', instituteId)).lean(); if (!row) notFound();
    if (action === 'upload') {
      if (auth.role === 'STUDENT') { if (!has(auth, ['student.view'])) deny(); await viewOwn(row.studentObjectId); }
      else if (!has(auth, ['evidence.create', 'admission.update'])) deny();
    }
    else if (auth.role === 'STUDENT') { if (!has(auth, ['student.view'])) deny(); await viewOwn(row.studentObjectId); }
    else if (!has(auth, [required])) deny(); return row;
  }
  if (type === 'Payment') {
    const row: any = await PaymentModel.findOne(queryFor(entityId, 'paymentId', instituteId)).lean(); if (!row) notFound();
    if (action === 'upload' ? !has(auth, ['evidence.create', 'payment.create']) : !has(auth, [required])) deny(); await viewOwn(row.studentId); return row;
  }
  if (type === 'Expense') {
    const row: any = await ExpenseModel.findOne(queryFor(entityId, 'expenseId', instituteId)).lean(); if (!row) notFound();
    if (action === 'upload' ? auth.role === 'STUDENT' || !has(auth, ['evidence.create', 'expense.create', 'expense.pay']) : !has(auth, [required])) deny(); return row;
  }
  if (type === 'StaffSalary') {
    const row: any = await StaffSalaryModel.findOne(queryFor(entityId, 'salaryId', instituteId)).lean(); if (!row) notFound();
    const own = String(row.staffUserId) === auth.objectId;
    if (action === 'upload' ? auth.role === 'STUDENT' || !has(auth, ['evidence.create', 'salary.create']) : own ? !has(auth, ['auth.me']) : !has(auth, [required])) deny(); return row;
  }
  deny();
}

export class FileStorageService {
  static readonly maxBytes = 20 * 1024 * 1024;
  static async authorize(auth: AuthenticatedUser, fileId: string, action: 'download' | 'archive') {
    const file: any = await PrivateFileModel.findOne({ fileId, instituteId: auth.instituteId, archivedAt: null }).lean();
    if (!file) throw new ApiError(404, 'FILE_NOT_FOUND', 'File was not found');
    if (action === 'archive' && !has(auth, ['file.archive'])) deny();
    await assertRecordPermission(auth, file.relatedEntityType as FileEntityType, file.relatedEntityId, action);
  }
  static async upload(auth: AuthenticatedUser, input: FileUploadInput, request: AuditRequestMetadata) {
    const validated = validatePrivateFile(input.bytes, input.originalName, input.mimeType);
    if (!input.documentType.trim() || input.documentType.trim().length > 100 || (input.description && input.description.length > 1000)) throw new ApiError(400, 'FILE_METADATA_INVALID', 'Document type or description is invalid');
    const entity = await assertRecordPermission(auth, input.entityType, input.entityId, 'upload');
    const stored = await documentStorage.put(input.bytes);
    try {
      return await inTransaction(async (session) => {
        let evidenceId: string | undefined;
        if (input.entityType !== 'Evidence') {
          const evidence = await EvidenceModel.create([{
            instituteId: auth.instituteId, type: input.documentType.trim(), description: input.description?.trim() || input.documentType.trim(),
            relatedEntity: { entityType: input.entityType, entityId: input.entityId }, fileReference: stored.reference,
            mimeType: validated.mimeType, sizeBytes: validated.size, uploadedBy: auth.objectId
          }], { session }).then((xs) => xs[0]!);
          evidenceId = String(evidence.evidenceId);
        }
        if (input.entityType === 'Student') await StudentDocumentModel.create([{
          instituteId: auth.instituteId, studentId: entity._id, documentType: input.documentType.trim(), uploadedBy: auth.objectId,
          uploadedAt: new Date(), secureStorageReference: stored.reference
        }], { session });
        if (input.entityType === 'AssignmentSubmission') {
          const submission = await AssignmentSubmissionModel.findById(entity._id).select('+secureStorageReferences').session(session);
          if (submission && !submission.secureStorageReferences.includes(stored.reference)) { submission.secureStorageReferences.push(stored.reference); await submission.save({ session }); }
        }
        const [file] = await PrivateFileModel.create([{
          originalName: validated.originalName, mimeType: validated.mimeType, size: validated.size, storageReference: stored.reference,
          uploadedBy: auth.objectId, instituteId: auth.instituteId, relatedEntityType: input.entityType, relatedEntityId: input.entityId,
          documentType: input.documentType.trim(), ...(input.description ? { description: input.description.trim() } : {}), ...(evidenceId ? { evidenceId } : {})
        }], { session });
        if (!file) throw new ApiError(500, 'FILE_METADATA_FAILED', 'File metadata could not be created');
        await AuditService.record({ instituteId: auth.instituteId, actorUserId: auth.objectId, action: 'file.upload', entityType: 'PrivateFile', entityId: String(file.fileId), after: file.toJSON(), request, session });
        return { file: file.toJSON() as unknown as FileMetadata, ...(evidenceId ? { evidenceId } : {}) };
      });
    } catch (error) {
      try { await documentStorage.delete(stored.reference); } catch { /* preserve the original failure; no metadata was committed */ }
      throw error;
    }
  }

  static async metadata(auth: AuthenticatedUser, fileId: string) {
    await this.authorize(auth, fileId, 'download');
    const file: any = await PrivateFileModel.findOne({ fileId, instituteId: auth.instituteId, archivedAt: null }).lean();
    if (!file) throw new ApiError(404, 'FILE_NOT_FOUND', 'File was not found');
    await assertRecordPermission(auth, file.relatedEntityType as FileEntityType, file.relatedEntityId, 'download');
    return file as unknown as FileMetadata;
  }

  static async download(auth: AuthenticatedUser, fileId: string, request: AuditRequestMetadata) {
    await this.authorize(auth, fileId, 'download');
    const file: any = await PrivateFileModel.findOne({ fileId, instituteId: auth.instituteId, archivedAt: null }).select('+storageReference');
    if (!file) throw new ApiError(404, 'FILE_NOT_FOUND', 'File was not found');
    await assertRecordPermission(auth, file.relatedEntityType as FileEntityType, file.relatedEntityId, 'download');
    const bytes = await documentStorage.get(file.get('storageReference') as string);
    if (bytes.length !== file.size) throw new ApiError(500, 'FILE_INTEGRITY_ERROR', 'Stored file size does not match its metadata');
    validatePrivateFile(bytes, file.originalName, file.mimeType);
    await AuditService.record({ instituteId: auth.instituteId, actorUserId: auth.objectId, action: 'file.download', entityType: 'PrivateFile', entityId: file.fileId, request });
    return { metadata: file.toJSON() as FileMetadata, bytes };
  }

  static async downloadEvidence(auth: AuthenticatedUser, evidenceId: string, request: AuditRequestMetadata) {
    if (!has(auth, ['evidence.view'])) deny();
    const evidence: any = await EvidenceModel.findOne({ evidenceId, instituteId: auth.instituteId, archivedAt: null }).select('+fileReference');
    if (!evidence) throw new ApiError(404, 'EVIDENCE_NOT_FOUND', 'Evidence was not found');
    const related = evidence.relatedEntity as { entityType: string; entityId: string };
    await assertRecordPermission(auth, related.entityType as FileEntityType, related.entityId, 'download');
    const bytes = await documentStorage.get(evidence.get('fileReference') as string);
    if (bytes.length !== evidence.sizeBytes) throw new ApiError(500, 'FILE_INTEGRITY_ERROR', 'Stored evidence size does not match its metadata');
    const extension: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'text/plain': '.txt' };
    const safeBase = String(evidence.type).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'evidence';
    validatePrivateFile(bytes, `${safeBase}${extension[evidence.mimeType] ?? ''}`, evidence.mimeType);
    await AuditService.record({ instituteId: auth.instituteId, actorUserId: auth.objectId, action: 'evidence.download', entityType: 'Evidence', entityId: evidenceId, request });
    return { mimeType: evidence.mimeType, size: evidence.sizeBytes, bytes, originalName: `${safeBase}${extension[evidence.mimeType] ?? ''}` };
  }

  static async archive(auth: AuthenticatedUser, fileId: string, request: AuditRequestMetadata) {
    await this.authorize(auth, fileId, 'archive');
    return inTransaction(async (session) => {
      const file: any = await PrivateFileModel.findOne({ fileId, instituteId: auth.instituteId, archivedAt: null }).select('+storageReference').session(session);
      if (!file) throw new ApiError(404, 'FILE_NOT_FOUND', 'File was not found');
      const before = file.toJSON();
      const storageReference = file.get('storageReference') as string;
      file.archivedAt = new Date(); file.archivedBy = new Types.ObjectId(auth.objectId); await file.save({ session });
      if (file.evidenceId) await EvidenceModel.updateOne({ instituteId: auth.instituteId, evidenceId: file.evidenceId }, { $set: { archivedAt: file.archivedAt } }, { session });
      await StudentDocumentModel.updateMany({ instituteId: auth.instituteId, secureStorageReference: storageReference, archivedAt: null }, { $set: { archivedAt: file.archivedAt } }, { session });
      await AssignmentSubmissionModel.updateMany({ instituteId: auth.instituteId, secureStorageReferences: storageReference }, { $pull: { secureStorageReferences: storageReference } }, { session });
      await AuditService.record({ instituteId: auth.instituteId, actorUserId: auth.objectId, action: 'file.archive', entityType: 'PrivateFile', entityId: String(file.fileId), before, after: file.toJSON(), request, session });
      return file.toJSON() as unknown as FileMetadata;
    });
  }
}

export const privateFileStorage: SecureFileStorage = {
  upload: (auth, input, request) => FileStorageService.upload(auth, input, request),
  download: (auth, fileId, request) => FileStorageService.download(auth, fileId, request),
  archive: (auth, fileId, request) => FileStorageService.archive(auth, fileId, request),
  metadata: (auth, fileId) => FileStorageService.metadata(auth, fileId),
  authorize: (auth, fileId, action) => FileStorageService.authorize(auth, fileId, action)
};
