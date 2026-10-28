import { model, Schema, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_TYPES } from './notification.model.js';

const schema = new Schema({
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  key: { type: String, required: true, enum: NOTIFICATION_TYPES, immutable: true },
  enabled: { type: Boolean, required: true, default: true },
  frequency: { type: String, enum: ['INSTANT', 'DAILY'], required: true, default: 'DAILY' },
  configuration: { type: Schema.Types.Mixed, default: {} },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });
schema.index({ instituteId: 1, key: 1 }, { unique: true });
export type AutomationRule = InferSchemaType<typeof schema>;
export const AutomationRuleModel = model('AutomationRule', schema);
