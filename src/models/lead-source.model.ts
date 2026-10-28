import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

const leadSourceSchema = new Schema({
  sourceId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 500 },
  isActive: { type: Boolean, required: true, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
leadSourceSchema.pre('validate', async function () {
  if (this.isNew) this.sourceId = await generateBusinessId('SRC');
});
leadSourceSchema.index({ instituteId: 1, name: 1 }, { unique: true });

export type LeadSource = InferSchemaType<typeof leadSourceSchema>;
export const LeadSourceModel = model('LeadSource', leadSourceSchema);
