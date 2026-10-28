import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const schema = new Schema({
  timetableId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  room: { type: String, trim: true, uppercase: true, maxlength: 100 },
  weekday: { type: Number, required: true, min: 0, max: 6, index: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  effectiveFrom: { type: Date, required: true, index: true },
  effectiveTo: { type: Date, required: true, index: true },
  status: { type: String, enum: ['SCHEDULED', 'CANCELLED'], default: 'SCHEDULED', required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.timetableId = await generateBusinessId('TIM'); });
schema.index({ instituteId: 1, weekday: 1, status: 1, effectiveFrom: 1, effectiveTo: 1 });
schema.index({ instituteId: 1, teacherId: 1, weekday: 1, startTime: 1, endTime: 1 });
schema.index({ instituteId: 1, room: 1, weekday: 1, startTime: 1, endTime: 1 });
export type Timetable = InferSchemaType<typeof schema>;
export const TimetableModel = model('Timetable', schema);
