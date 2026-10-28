import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const scheduleSchema = new Schema({ weekday: { type: Number, required: true, min: 0, max: 6 }, startTime: { type: String, required: true }, endTime: { type: String, required: true } }, { _id: false });
const schema = new Schema({
  batchCode: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  capacity: { type: Number, required: true, min: 1 },
  enrolledCount: { type: Number, required: true, default: 0, min: 0 },
  schedule: { type: [scheduleSchema], default: [] },
  room: { type: String, trim: true, uppercase: true, maxlength: 100 },
  mode: { type: String, enum: ['IN_PERSON', 'ONLINE', 'HYBRID'], required: true, default: 'IN_PERSON' },
  status: { type: String, enum: ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'INACTIVE'], default: 'PLANNED', required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.batchCode = await generateBusinessId('BAT'); });
schema.index({ instituteId: 1, courseId: 1, status: 1, startDate: 1 });
schema.index({ instituteId: 1, teacherId: 1, status: 1 });
export type Batch = InferSchemaType<typeof schema>;
export const BatchModel = model('Batch', schema);
