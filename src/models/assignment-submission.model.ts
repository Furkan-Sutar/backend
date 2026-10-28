import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const schema = new Schema({
  submissionId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true, index: true },
  assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true, immutable: true, index: true },
  submittedAt: { type: Date, required: true, default: Date.now },
  status: { type: String, enum: ['SUBMITTED', 'LATE', 'ASSESSED'], required: true, default: 'SUBMITTED', index: true },
  content: { type: String, trim: true, maxlength: 20000 },
  secureStorageReferences: { type: [String], default: [], select: false },
  marks: { type: Number, min: 0 },
  feedback: { type: String, trim: true, maxlength: 5000 },
  assessedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  assessedAt: { type: Date }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.submissionId = await generateBusinessId('SUB'); });
schema.index({ instituteId: 1, assignmentId: 1, studentId: 1 }, { unique: true });
schema.index({ instituteId: 1, assignmentId: 1, status: 1, submittedAt: -1 });
export type AssignmentSubmission = InferSchemaType<typeof schema>;
export const AssignmentSubmissionModel = model('AssignmentSubmission', schema);
