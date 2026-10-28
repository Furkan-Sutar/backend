import { model, Schema, type InferSchemaType } from 'mongoose';

const schema = new Schema({
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true },
  requireCourseCompletion: { type: Boolean, required: true, default: true },
  attendanceMinimumPercentage: { type: Number, min: 0, max: 100 },
  requiredAssessmentIds: [{ type: Schema.Types.ObjectId, ref: 'Exam' }],
  requireFeesPaid: { type: Boolean, required: true, default: false },
  requiredDocumentTypes: [{ type: String, trim: true, maxlength: 100 }],
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.index({ instituteId: 1, courseId: 1 }, { unique: true });
export type CertificateRule = InferSchemaType<typeof schema>;
export const CertificateRuleModel = model('CertificateRule', schema);
