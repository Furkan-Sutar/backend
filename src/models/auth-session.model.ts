import { model, Schema, type InferSchemaType } from 'mongoose';

const authSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date }
}, { timestamps: true, versionKey: false });

authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthSession = InferSchemaType<typeof authSessionSchema>;
export const AuthSessionModel = model('AuthSession', authSessionSchema);

