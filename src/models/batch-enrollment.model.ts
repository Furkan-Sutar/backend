import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const schema = new Schema({
  enrollmentId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, immutable: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true, index: true },
  admissionId: { type: Schema.Types.ObjectId, ref: 'Admission' },
  status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'WITHDRAWN'], required: true, default: 'ACTIVE', index: true },
  capacityOverride: { authorizedBy: { type: Schema.Types.ObjectId, ref: 'User' }, reason: { type: String, trim: true, maxlength: 500 }, authorizedAt: { type: Date } },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.enrollmentId = await generateBusinessId('ENR'); });
schema.index({ instituteId: 1, batchId: 1, studentId: 1 }, { unique: true });
schema.index({ instituteId: 1, batchId: 1, status: 1 });
export type BatchEnrollment = InferSchemaType<typeof schema>;
export const BatchEnrollmentModel = model('BatchEnrollment', schema);
