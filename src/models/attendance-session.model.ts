import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const schema = new Schema({
  sessionId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, immutable: true, index: true },
  date: { type: Date, required: true, index: true },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  status: { type: String, enum: ['OPEN', 'COMPLETED', 'CANCELLED'], required: true, default: 'OPEN', index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.sessionId = await generateBusinessId('ASN'); });
schema.index({ instituteId: 1, batchId: 1, date: 1, subject: 1 }, { unique: true });
schema.index({ instituteId: 1, batchId: 1, status: 1, date: -1 });
export type AttendanceSession = InferSchemaType<typeof schema>;
export const AttendanceSessionModel = model('AttendanceSession', schema);
