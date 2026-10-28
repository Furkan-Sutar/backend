import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

export const STUDENT_STATUSES = ['ACTIVE', 'COMPLETED', 'DROPPED', 'ON_HOLD', 'TRANSFERRED', 'ALUMNI', 'ARCHIVED'] as const;
const studentSchema = new Schema({
  studentId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  mobile: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  dateOfBirth: { type: Date },
  identityType: { type: String, trim: true, maxlength: 40 },
  identityNumber: { type: String, trim: true, select: false },
  identityFingerprint: { type: String, select: false },
  guardianIds: [{ type: Schema.Types.ObjectId, ref: 'Guardian' }],
  emergencyContact: { name: { type: String, trim: true, maxlength: 160 }, relationship: { type: String, trim: true, maxlength: 80 }, mobile: { type: String, trim: true } },
  status: { type: String, enum: STUDENT_STATUSES, required: true, default: 'ACTIVE', index: true },
  archivedAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false, toJSON: { transform: (_doc, ret) => { delete ret.identityNumber; delete ret.identityFingerprint; return ret; } } });
studentSchema.pre('validate', async function () { if (this.isNew) this.studentId = await generateBusinessId('STU'); });
studentSchema.index({ instituteId: 1, identityFingerprint: 1 }, { unique: true, partialFilterExpression: { identityFingerprint: { $type: 'string' } } });
studentSchema.index({ instituteId: 1, userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });
studentSchema.index({ instituteId: 1, mobile: 1 }, { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } });
studentSchema.index({ instituteId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
studentSchema.index({ instituteId: 1, name: 1 });

export type Student = InferSchemaType<typeof studentSchema>;
export const StudentModel = model('Student', studentSchema);
