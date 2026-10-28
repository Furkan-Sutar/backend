import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
import { FOLLOW_UP_STATUSES } from '../modules/crm/lead.constants.js';

const followUpSchema = new Schema({
  followUpId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true, immutable: true },
  leadObjectId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true, immutable: true },
  leadId: { type: String, required: true, index: true, immutable: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scheduledAt: { type: Date, required: true, index: true },
  status: { type: String, enum: FOLLOW_UP_STATUSES, required: true, default: 'SCHEDULED', index: true },
  notes: { type: String, trim: true, maxlength: 1000 },
  completedAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
followUpSchema.pre('validate', async function () {
  if (this.isNew) this.followUpId = await generateBusinessId('FUP');
});
followUpSchema.index({ instituteId: 1, status: 1, scheduledAt: 1, assignedTo: 1 });

export type FollowUp = InferSchemaType<typeof followUpSchema>;
export const FollowUpModel = model('FollowUp', followUpSchema);
