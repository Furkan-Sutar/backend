import { UserModel } from '../models/user.model.js';

export const userRepository = {
  findByCredentials(instituteObjectId: string, identifier: string) {
    const normalized = identifier.trim();
    const isEmail = normalized.includes('@');
    return UserModel.findOne({
      instituteId: instituteObjectId,
      [isEmail ? 'email' : 'mobile']: isEmail ? normalized.toLowerCase() : normalized
    }).select('+passwordHash +failedLoginAttempts +lockedUntil +authVersion');
  },
  findById(id: string) {
    return UserModel.findById(id).select('+authVersion');
  },
  async recordFailedLogin(id: string, maxAttempts: number, lockDurationMs: number): Promise<void> {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + lockDurationMs);
    await UserModel.findByIdAndUpdate(id, [
      { $set: {
        failedLoginAttempts: { $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1] },
        lockedUntil: {
          $cond: [
            { $gte: [{ $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1] }, maxAttempts] },
            lockedUntil,
            '$lockedUntil'
          ]
        }
      } }
    ]);
  },
  async clearFailedLogins(id: string): Promise<void> {
    await UserModel.findByIdAndUpdate(id, { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } });
  },
  async setLastLogin(id: string, at: Date): Promise<void> {
    await UserModel.findByIdAndUpdate(id, { $set: { lastLoginAt: at } });
  }
};
