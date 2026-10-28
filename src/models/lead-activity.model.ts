import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
import { LEAD_ACTIVITY_TYPES } from '../modules/crm/lead.constants.js';

const leadActivitySchema = new Schema({
  activityId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true, immutable: true },
  leadObjectId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true, immutable: true },
  leadId: { type: String, required: true, index: true, immutable: true },
  type: { type: String, enum: LEAD_ACTIVITY_TYPES, required: true },
  summary: { type: String, required: true, trim: true, maxlength: 1000 },
  outcome: { type: String, trim: true, maxlength: 1000 },
  occurredAt: { type: Date, required: true, default: Date.now },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
leadActivitySchema.pre('validate', async function () {
  if (this.isNew) this.activityId = await generateBusinessId('ACT');
});
leadActivitySchema.index({ instituteId: 1, leadObjectId: 1, occurredAt: -1 });

export type LeadActivity = InferSchemaType<typeof leadActivitySchema>;
export const LeadActivityModel = model('LeadActivity', leadActivitySchema);
