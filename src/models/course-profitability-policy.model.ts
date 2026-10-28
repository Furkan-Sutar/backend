import { model, Schema } from 'mongoose';

const schema = new Schema({
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, unique: true, immutable: true },
  revenueBasis: { type: String, enum: ['BILLED_FEES', 'NET_POSTED_PAYMENTS'], required: true, default: 'BILLED_FEES' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
export const CourseProfitabilityPolicyModel = model('CourseProfitabilityPolicy', schema);
