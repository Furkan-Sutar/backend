import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

const schema = new Schema({
  internshipId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true, immutable: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true, immutable: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED'], required: true, default: 'PENDING', index: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.internshipId = await generateBusinessId('INT'); });
schema.index({ instituteId: 1, studentId: 1, status: 1 });
export type InternshipRecord = InferSchemaType<typeof schema>;
export const InternshipRecordModel = model('InternshipRecord', schema);
