import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const historySchema = new Schema({ status: { type: String, enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'], required: true }, changedAt: { type: Date, required: true }, changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, note: { type: String, trim: true, maxlength: 500 } }, { _id: false });
const schema = new Schema({
  progressId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  moduleId: { type: Schema.Types.ObjectId, ref: 'CourseModule', required: true, index: true },
  topic: { type: String, required: true, trim: true, maxlength: 200 },
  status: { type: String, enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'], required: true, default: 'NOT_STARTED', index: true },
  completionDate: { type: Date },
  history: { type: [historySchema], default: [] },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.progressId = await generateBusinessId('PRG'); });
schema.index({ instituteId: 1, studentId: 1, courseId: 1, moduleId: 1, topic: 1 }, { unique: true });
schema.index({ instituteId: 1, status: 1, updatedAt: 1 });
schema.index({ instituteId: 1, courseId: 1, studentId: 1, status: 1 });
export type CourseProgress = InferSchemaType<typeof schema>;
export const CourseProgressModel = model('CourseProgress', schema);
