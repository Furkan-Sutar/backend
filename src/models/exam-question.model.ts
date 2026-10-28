import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const schema = new Schema({
  questionId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, immutable: true, index: true },
  question: { type: String, required: true, trim: true, maxlength: 5000 },
  type: { type: String, enum: ['MULTIPLE_CHOICE', 'TRUE_FALSE'], required: true },
  options: { type: [String], default: [] },
  correctAnswer: { type: String, required: true, select: false },
  marks: { type: Number, required: true, min: 0.01 },
  sequence: { type: Number, required: true, min: 1 },
  isActive: { type: Boolean, default: true, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false, toJSON: { transform: (_doc, ret) => { delete (ret as Record<string, unknown>).correctAnswer; return ret; } } });
schema.pre('validate', async function () { if (this.isNew) this.questionId = await generateBusinessId('QUE'); if (this.type === 'MULTIPLE_CHOICE' && this.options.length < 2) this.invalidate('options', 'Multiple choice questions require at least two options'); if (this.type === 'TRUE_FALSE' && this.correctAnswer !== 'true' && this.correctAnswer !== 'false') this.invalidate('correctAnswer', 'True/false answer must be true or false'); });
schema.index({ instituteId: 1, examId: 1, sequence: 1 }, { unique: true });
schema.index({ instituteId: 1, examId: 1, isActive: 1 });
export type ExamQuestion = InferSchemaType<typeof schema>;
export const ExamQuestionModel = model('ExamQuestion', schema);
