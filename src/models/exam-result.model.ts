import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const resultHistorySchema = new Schema({ marks: { type: Number, required: true }, percentage: { type: Number, required: true }, grade: { type: String, required: true }, passFail: { type: String, enum: ['PASS', 'FAIL'], required: true }, changedAt: { type: Date, required: true }, changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, reason: { type: String, trim: true, maxlength: 500 } }, { _id: false });
const schema = new Schema({
  resultId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, immutable: true, index: true },
  attemptId: { type: Schema.Types.ObjectId, ref: 'ExamAttempt', required: true, immutable: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true, index: true },
  marks: { type: Number, required: true, min: 0 },
  totalMarks: { type: Number, required: true, min: 1 },
  percentage: { type: Number, required: true, min: 0, max: 100 },
  grade: { type: String, required: true },
  passFail: { type: String, enum: ['PASS', 'FAIL'], required: true, index: true },
  publicationStatus: { type: String, enum: ['DRAFT', 'PUBLISHED', 'REVOKED'], required: true, default: 'DRAFT', index: true },
  publishedAt: { type: Date },
  publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  calculatedBy: { type: String, enum: ['SERVER_AUTO', 'INSTRUCTOR_ADJUSTED'], required: true, default: 'SERVER_AUTO' },
  history: { type: [resultHistorySchema], default: [] },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.resultId = await generateBusinessId('RES'); });
schema.index({ instituteId: 1, attemptId: 1 }, { unique: true });
schema.index({ instituteId: 1, studentId: 1, publicationStatus: 1, createdAt: -1 });
schema.index({ instituteId: 1, examId: 1, publicationStatus: 1, passFail: 1 });
export type ExamResult = InferSchemaType<typeof schema>;
export const ExamResultModel = model('ExamResult', schema);
