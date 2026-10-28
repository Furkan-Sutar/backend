import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

export const NOTIFICATION_TYPES = ['PENDING_FOLLOW_UP', 'MISSED_FOLLOW_UP', 'PENDING_FEE', 'UPCOMING_INSTALLMENT', 'ATTENDANCE_RISK', 'COURSE_COMPLETION', 'CERTIFICATE_ELIGIBILITY', 'PENDING_EXPENSE_APPROVAL', 'PENDING_SALARY_APPROVAL', 'OWNER_DAILY_SUMMARY'] as const;
const schema = new Schema({
  notificationId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true, immutable: true },
  recipientUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true, index: true, immutable: true },
  requiredPermission: { type: String, required: true, immutable: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  entityType: { type: String, maxlength: 80 }, entityId: { type: String, maxlength: 100 },
  dedupeKey: { type: String, required: true, maxlength: 300, immutable: true },
  data: { type: Schema.Types.Mixed },
  readAt: { type: Date, default: null, index: true },
  expiresAt: { type: Date, index: true }
}, { timestamps: true, versionKey: false });
schema.pre('validate', async function () { if (this.isNew) this.notificationId = await generateBusinessId('NTF'); });
schema.index({ instituteId: 1, recipientUserId: 1, dedupeKey: 1 }, { unique: true });
schema.index({ instituteId: 1, recipientUserId: 1, readAt: 1, createdAt: -1 });
export type Notification = InferSchemaType<typeof schema>;
export const NotificationModel = model('Notification', schema);
