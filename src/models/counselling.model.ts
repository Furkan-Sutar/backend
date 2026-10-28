import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
import { COUNSELLING_STATUSES } from '../modules/crm/lead.constants.js';

const counsellingSchema = new Schema({
  counsellingId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true, immutable: true },
  leadObjectId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true, immutable: true },
  leadId: { type: String, required: true, index: true, immutable: true },
  counsellorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scheduledAt: { type: Date, required: true, index: true },
  status: { type: String, enum: COUNSELLING_STATUSES, required: true, default: 'SCHEDULED' },
  notes: { type: String, trim: true, maxlength: 3000 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
counsellingSchema.pre('validate', async function () {
  if (this.isNew) this.counsellingId = await generateBusinessId('CNSL');
});
counsellingSchema.index({ instituteId: 1, counsellorId: 1, scheduledAt: 1, status: 1 });

export type Counselling = InferSchemaType<typeof counsellingSchema>;
export const CounsellingModel = model('Counselling', counsellingSchema);
