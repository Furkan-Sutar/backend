import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

const schema = new Schema({
  allocationId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true, index: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', immutable: true, index: true },
  staffId: { type: Schema.Types.ObjectId, ref: 'Staff', immutable: true, index: true },
  costType: { type: String, enum: ['TEACHER_ALLOCATION', 'MARKETING_ALLOCATION', 'COURSE_EXPENSE'], required: true, immutable: true },
  costBehavior: { type: String, enum: ['FIXED', 'VARIABLE'], required: true, immutable: true },
  amount: { type: Number, required: true, min: 0.01, immutable: true },
  sourceType: { type: String, enum: ['EXPENSE', 'SALARY_PAYMENT'], required: true, immutable: true },
  sourceObjectId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  sourceReference: { type: String, required: true, immutable: true },
  allocationPeriod: { type: Date, required: true, immutable: true, index: true },
  note: { type: String, trim: true, maxlength: 500 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.allocationId = await generateBusinessId('CPA'); });
schema.index({ instituteId: 1, courseId: 1, allocationPeriod: 1 });
schema.index({ instituteId: 1, sourceType: 1, sourceObjectId: 1 });
const immutable = () => { throw new Error('Course cost allocations are append-only; create an audited correction allocation'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) schema.pre(op, immutable);
schema.pre('deleteOne', { document: true, query: false }, immutable);
export type CourseCostAllocation = InferSchemaType<typeof schema>;
export const CourseCostAllocationModel = model('CourseCostAllocation', schema);
