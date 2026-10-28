import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const guardianSchema = new Schema({
  guardianId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, immutable: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  relationship: { type: String, required: true, trim: true, maxlength: 80 },
  mobile: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  isPrimary: { type: Boolean, required: true, default: false },
  isEmergencyContact: { type: Boolean, required: true, default: false }
}, { timestamps: true, versionKey: false });
guardianSchema.pre('validate', async function () { if (this.isNew) this.guardianId = await generateBusinessId('GUA'); });
guardianSchema.index({ instituteId:  1, studentId: 1, mobile: 1 }, { unique: true });
export type Guardian = InferSchemaType<typeof guardianSchema>;
export const GuardianModel = model('Guardian', guardianSchema);
