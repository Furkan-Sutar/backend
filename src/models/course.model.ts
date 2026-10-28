import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const courseVersionSchema = new Schema({ version: { type: Number, required: true }, changedAt: { type: Date, required: true }, changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, snapshot: { type: Schema.Types.Mixed, required: true } }, { _id: false });
const schema = new Schema({
  courseCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  duration: { value: { type: Number, required: true, min: 1 }, unit: { type: String, enum: ['DAYS', 'WEEKS', 'MONTHS', 'YEARS'], required: true } },
  fee: { type: Number, required: true, min: 0 },
  description: { type: String, trim: true, maxlength: 5000 },
  eligibility: { type: String, trim: true, maxlength: 3000 },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], required: true, default: 'ACTIVE', index: true },
  version: { type: Number, required: true, default: 1 },
  history: { type: [courseVersionSchema], default: [] },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.courseCode = await generateBusinessId('CRS'); });
schema.index({ instituteId: 1, code: 1 }, { unique: true });
schema.index({ instituteId: 1, status: 1, name: 1 });
schema.index({ instituteId: 1, courseCode: 1 }, { unique: true });
export type Course = InferSchemaType<typeof schema>;
export const CourseModel = model('Course', schema);
