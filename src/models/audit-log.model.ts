import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

const auditLogSchema = new Schema({
  auditId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true },
  actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  action: { type: String, required: true, immutable: true },
  entityType: { type: String, required: true, immutable: true },
  entityId: { type: String, immutable: true },
  timestamp: { type: Date, required: true, default: Date.now, immutable: true },
  before: { type: Schema.Types.Mixed, immutable: true },
  after: { type: Schema.Types.Mixed, immutable: true },
  reason: { type: String, maxlength: 1000, immutable: true },
  requestId: { type: String, required: true, maxlength: 128, immutable: true },
  ip: { type: String, maxlength: 64, immutable: true },
  userAgent: { type: String, maxlength: 512, immutable: true },
  device: {
    id: { type: String, maxlength: 128 },
    name: { type: String, maxlength: 128 },
    platform: { type: String, maxlength: 64 }
  }
}, { versionKey: false });

auditLogSchema.pre('validate', async function () {
  if (this.isNew) this.auditId = await generateBusinessId('AUD');
});

auditLogSchema.index({ instituteId: 1, timestamp: -1, _id: -1 });
auditLogSchema.index({ instituteId: 1, actorUserId: 1, timestamp: -1 });
auditLogSchema.index({ instituteId: 1, action: 1, timestamp: -1 });
auditLogSchema.index({ instituteId: 1, entityType: 1, entityId: 1, timestamp: -1 });

const immutableError = (): never => { throw new Error('Audit logs are append-only and cannot be changed or deleted'); };
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditLogSchema.pre(operation, immutableError);
}
auditLogSchema.pre('deleteOne', { document: true, query: false }, immutableError);
auditLogSchema.pre('save', function () {
  if (!this.isNew) immutableError();
});

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model('AuditLog', auditLogSchema);


