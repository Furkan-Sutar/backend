import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const answerSchema = new Schema({ questionId: { type: Schema.Types.ObjectId, ref: 'ExamQuestion', required: true }, answer: { type: String, required: true, maxlength: 5000 } }, { _id: false });
const schema = new Schema({
  attemptId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, immutable: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true, index: true },
  attemptNumber: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['IN_PROGRESS', 'SUBMITTED', 'EXPIRED'], required: true, default: 'IN_PROGRESS', index: true },
  startedAt: { type: Date, required: true, default: Date.now },
  submittedAt: { type: Date },
  answers: { type: [answerSchema], default: [] },
  marksAwarded: { type: Number, min: 0 },
  gradedAt: { type: Date }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.attemptId = await generateBusinessId('ATT'); });
schema.index({ instituteId: 1, examId: 1, studentId: 1, attemptNumber: 1 }, { unique: true });
schema.index({ instituteId: 1, studentId: 1, status: 1, startedAt: -1 });
export type ExamAttempt = InferSchemaType<typeof schema>;
export const ExamAttemptModel = model('ExamAttempt', schema);
