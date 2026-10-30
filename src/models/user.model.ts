import bcrypt from 'bcryptjs';
import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

const userSchema = new Schema({
  userId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  email: { type: String, trim: true, lowercase: true, sparse: true },
  googleSubjectId: { type: String, trim: true, select: false },
  mobile: { type: String, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['OWNER_ADMIN', 'COUNSELLOR', 'TEACHER', 'ACCOUNTANT', 'STUDENT'], required: true },
  status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active', required: true },
  lastLoginAt: { type: Date },
  failedLoginAttempts: { type: Number, default: 0, select: false },
  lockedUntil: { type: Date, select: false },
  authVersion: { type: Number, default: 0, select: false }
}, { timestamps: true, versionKey: false });

userSchema.pre('validate', async function () {
  if (this.isNew) this.userId = await generateBusinessId('USR');
  if (!this.email && !this.mobile) this.invalidate('email', 'At least an email or mobile number is required');
});

userSchema.pre('save', async function () {
  if (this.isModified('passwordHash') && !/^\$2[aby]\$\d{2}\$/.test(this.passwordHash)) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  }
});

userSchema.index({ instituteId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ instituteId: 1, mobile: 1 }, { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } });
userSchema.index({ googleSubjectId: 1 }, { unique: true, partialFilterExpression: { googleSubjectId: { $type: 'string' } } });

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = model('User', userSchema);


