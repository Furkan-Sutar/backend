import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const studentDocumentSchema = new Schema({
  documentId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true, index: true },
  documentType: { type: String, required: true, trim: true, maxlength: 100 },
  verificationStatus: { type: String, required: true, enum: ['PENDING', 'VERIFIED', 'REJECTED'], default: 'PENDING', index: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedAt: { type: Date, required: true, default: Date.now },
  secureStorageReference: { type: String, required: true, trim: true, maxlength: 1000, select: false },
  archivedAt: { type: Date, default: null, index: true }
}, { timestamps: true, versionKey: false });
studentDocumentSchema.pre('validate', async function () { if (this.isNew) this.documentId = await generateBusinessId('DOC'); });
export type StudentDocument = InferSchemaType<typeof studentDocumentSchema>;
export const StudentDocumentModel = model('StudentDocument', studentDocumentSchema);
