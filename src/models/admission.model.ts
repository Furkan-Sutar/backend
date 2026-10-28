import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const admissionSchema = new Schema({
  admissionId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  leadObjectId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, immutable: true, index: true },
  leadId: { type: String, required: true, immutable: true, index: true },
  sourceId: { type: Schema.Types.ObjectId, ref: 'LeadSource', immutable: true },
  contributedByStaffId: { type: Schema.Types.ObjectId, ref: 'Staff', index: true, immutable: true },
  studentObjectId: { type: Schema.Types.ObjectId, ref: 'Student', index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },
  feePlanId: { type: Schema.Types.ObjectId, ref: 'FeePlan', required: true },
  status: { type: String, enum: ['PENDING', 'CONVERTED', 'CANCELLED'], required: true, default: 'PENDING', index: true },
  studentDetails: { name: { type: String, required: true, trim: true, maxlength: 160 }, mobile: { type: String, required: true, trim: true }, email: { type: String, trim: true, lowercase: true }, dateOfBirth: { type: Date }, identityType: { type: String }, identityNumber: { type: String, select: false }, guardians: [{ name: { type: String, required: true }, relationship: { type: String, required: true }, mobile: { type: String, required: true }, email: { type: String }, isPrimary: { type: Boolean, default: false }, isEmergencyContact: { type: Boolean, default: false } }], emergencyContact: { name: String, relationship: String, mobile: String } },
  notes: { type: String, trim: true, maxlength: 3000 },
  convertedAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false, toJSON: { transform: (_doc, ret) => { if (ret.studentDetails && typeof ret.studentDetails === 'object') delete ret.studentDetails.identityNumber; return ret; } } });
admissionSchema.pre('validate', async function () { if (this.isNew) this.admissionId = await generateBusinessId('ADM'); });
admissionSchema.index({ instituteId: 1, leadObjectId: 1 }, { unique: true });
admissionSchema.index({ instituteId: 1, 'studentDetails.name': 1 });
export type Admission = InferSchemaType<typeof admissionSchema>;
export const AdmissionModel = model('Admission', admissionSchema);
