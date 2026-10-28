import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const schema = new Schema({
  assignmentId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  moduleId: { type: Schema.Types.ObjectId, ref: 'CourseModule', required: true, index: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 10000 },
  deadline: { type: Date, required: true, index: true },
  totalMarks: { type: Number, required: true, min: 1, default: 100 },
  status: { type: String, enum: ['DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED'], required: true, default: 'DRAFT', index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.assignmentId = await generateBusinessId('ASG'); });
schema.index({ instituteId: 1, batchId: 1, status: 1, deadline: 1 });
export type Assignment = InferSchemaType<typeof schema>;
export const AssignmentModel = model('Assignment', schema);
