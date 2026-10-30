import { model, Schema } from 'mongoose';

const authenticationEventSchema = new Schema({
  eventType: { type: String, enum: ['google.login', 'google.link'], required: true, immutable: true },
  outcome: { type: String, enum: ['success', 'failure'], required: true, immutable: true },
  reasonCode: { type: String, maxlength: 80, immutable: true },
  subjectHash: { type: String, maxlength: 64, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', immutable: true },
  actorUserId: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },
  requestId: { type: String, required: true, maxlength: 128, immutable: true },
  ip: { type: String, maxlength: 64, immutable: true },
  userAgent: { type: String, maxlength: 512, immutable: true },
  timestamp: { type: Date, required: true, default: Date.now, immutable: true }
}, { versionKey: false });

authenticationEventSchema.index({ eventType: 1, outcome: 1, timestamp: -1 });
authenticationEventSchema.index({ instituteId: 1, actorUserId: 1, timestamp: -1 });
const immutableError = (): never => { throw new Error('Authentication events are append-only'); };
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  authenticationEventSchema.pre(operation, immutableError);
}

export const AuthenticationEventModel = model('AuthenticationEvent', authenticationEventSchema);
