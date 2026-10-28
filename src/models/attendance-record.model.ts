import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const schema = new Schema({
  recordId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  sessionId: { type: String, required: true, immutable: true, index: true },
  sessionObjectId: { type: Schema.Types.ObjectId, ref: 'AttendanceSession', required: true, immutable: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, immutable: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true, index: true },
  status: { type: String, enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'], required: true },
  markedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  history: [{ status: { type: String, enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'], required: true }, changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, changedAt: { type: Date, required: true }, reason: { type: String, required: true, maxlength: 500 } }]
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.recordId = await generateBusinessId('ATR'); });
schema.index({ instituteId: 1, sessionObjectId: 1, studentId: 1 }, { unique: true });
schema.index({ instituteId: 1, studentId: 1, timestamp: -1 });
schema.index({ instituteId: 1, batchId: 1, status: 1, timestamp: -1 });
export type AttendanceRecord = InferSchemaType<typeof schema>;
export const AttendanceRecordModel = model('AttendanceRecord', schema);
