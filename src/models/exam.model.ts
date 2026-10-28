import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const schema = new Schema({
  examId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  moduleId: { type: Schema.Types.ObjectId, ref: 'CourseModule', required: true, index: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 5000 },
  totalMarks: { type: Number, required: true, min: 1 },
  passMarks: { type: Number, required: true, min: 0 },
  duration: { type: Number, required: true, min: 1, max: 1440 },
  attemptRules: { maxAttempts: { type: Number, required: true, min: 1, max: 10, default: 1 }, allowRetakeAfterFailure: { type: Boolean, default: false } },
  status: { type: String, enum: ['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'], required: true, default: 'DRAFT', index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.examId = await generateBusinessId('EXM'); if (this.passMarks > this.totalMarks) this.invalidate('passMarks', 'passMarks cannot exceed totalMarks'); });
schema.index({ instituteId: 1, batchId: 1, status: 1, createdAt: -1 });
export type Exam = InferSchemaType<typeof schema>;
export const ExamModel = model('Exam', schema);
