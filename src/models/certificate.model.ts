import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

const schema = new Schema({
  certificateId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true, index: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, immutable: true, index: true },
  issueDate: { type: Date, required: true, immutable: true, default: Date.now },
  resultStatus: { type: String, enum: ['PASS', 'NOT_APPLICABLE'], required: true, immutable: true },
  completionStatus: { type: String, enum: ['COMPLETED'], required: true, immutable: true },
  verificationCode: { type: String, required: true, unique: true, immutable: true, select: false },
  verificationMetadata: { type: Schema.Types.Mixed, required: true, immutable: true }
}, { timestamps: true, versionKey: false, toJSON: { transform: (_doc, ret) => { const safe = ret as Record<string, unknown>; delete safe.verificationCode; return safe; } } });
schema.pre('validate', async function () { if (this.isNew) this.certificateId = await generateBusinessId('CERT'); });
schema.index({ instituteId: 1, studentId: 1, courseId: 1, batchId: 1 }, { unique: true });
export type Certificate = InferSchemaType<typeof schema>;
export const CertificateModel = model('Certificate', schema);
