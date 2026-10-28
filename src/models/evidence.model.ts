import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

const schema = new Schema({
  evidenceId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  type: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  relatedEntity: { entityType: { type: String, required: true, trim: true, maxlength: 80 }, entityId: { type: String, required: true, trim: true, maxlength: 200 } },
  fileReference: { type: String, required: true, immutable: true, select: false },
  mimeType: { type: String, required: true, immutable: true, maxlength: 120 },
  sizeBytes: { type: Number, required: true, immutable: true, min: 1 },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  date: { type: Date, required: true, default: Date.now, immutable: true },
  verificationStatus: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], required: true, default: 'PENDING', index: true },
  archivedAt: { type: Date, default: null, index: true },
  notes: { type: String, trim: true, maxlength: 1000 }
}, { timestamps: true, versionKey: false, toJSON: { transform: (_doc, ret) => { const safe = ret as Record<string, unknown>; delete safe.fileReference; return safe; } } });
schema.pre('validate', async function () { if (this.isNew) this.evidenceId = await generateBusinessId('EVD'); });
schema.index({ instituteId: 1, 'relatedEntity.entityType': 1, 'relatedEntity.entityId': 1 });
export type Evidence = InferSchemaType<typeof schema>;
export const EvidenceModel = model('Evidence', schema);
