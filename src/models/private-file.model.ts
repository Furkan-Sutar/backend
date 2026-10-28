import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

export const FILE_ENTITY_TYPES = ['Student', 'Staff', 'Certificate', 'Receipt', 'AssignmentSubmission', 'Evidence', 'InternshipRecord', 'Admission', 'Payment', 'Expense', 'StaffSalary'] as const;
const schema = new Schema({
  fileId: { type: String, required: true, unique: true, immutable: true },
  originalName: { type: String, required: true, trim: true, maxlength: 255, immutable: true },
  mimeType: { type: String, required: true, enum: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain'], immutable: true },
  size: { type: Number, required: true, min: 1, immutable: true },
  storageReference: { type: String, required: true, immutable: true, select: false },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  uploadedAt: { type: Date, required: true, default: Date.now, immutable: true, index: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  relatedEntityType: { type: String, enum: FILE_ENTITY_TYPES, required: true, immutable: true, index: true },
  relatedEntityId: { type: String, required: true, trim: true, maxlength: 200, immutable: true, index: true },
  documentType: { type: String, required: true, trim: true, maxlength: 100, immutable: true },
  description: { type: String, trim: true, maxlength: 1000, immutable: true },
  evidenceId: { type: String, maxlength: 40, immutable: true },
  archivedAt: { type: Date, default: null, index: true },
  archivedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true, versionKey: false, toJSON: { transform: (_doc, ret) => { delete (ret as Record<string, unknown>).storageReference; return ret; } } });
schema.pre('validate', async function () { if (this.isNew) this.fileId = await generateBusinessId('FILE'); });
schema.index({ instituteId: 1, relatedEntityType: 1, relatedEntityId: 1, uploadedAt: -1 });
schema.index({ instituteId: 1, uploadedBy: 1, uploadedAt: -1 });
export type PrivateFile = InferSchemaType<typeof schema>;
export const PrivateFileModel = model('PrivateFile', schema);
