import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
const schema = new Schema({
  moduleId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, immutable: true, index: true },
  moduleCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  sequence: { type: Number, required: true, min: 1 },
  hours: { type: Number, required: true, min: 0 },
  objectives: { type: [String], default: [] },
  assessmentMapping: { type: Schema.Types.Mixed, default: {} },
  isActive: { type: Boolean, required: true, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.moduleId = await generateBusinessId('CMD'); });
schema.index({ instituteId: 1, courseId: 1, moduleCode: 1 }, { unique: true });
schema.index({ instituteId: 1, courseId: 1, sequence: 1 }, { unique: true });
export type CourseModule = InferSchemaType<typeof schema>;
export const CourseModuleModel = model('CourseModule', schema);
