import { model, Schema, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_TYPES } from './notification.model.js';

const schema = new Schema({
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  inAppEnabled: { type: Boolean, default: true, required: true },
  emailEnabled: { type: Boolean, default: false, required: true },
  smsEnabled: { type: Boolean, default: false, required: true },
  whatsappEnabled: { type: Boolean, default: false, required: true },
  disabledTypes: { type: [{ type: String, enum: NOTIFICATION_TYPES }], default: [] },
  quietHours: { start: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, end: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, timezone: { type: String, maxlength: 80 } }
}, { timestamps: true, versionKey: false });
schema.index({ instituteId: 1, userId: 1 }, { unique: true });
export type NotificationPreference = InferSchemaType<typeof schema>;
export const NotificationPreferenceModel = model('NotificationPreference', schema);
