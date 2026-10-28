import { AuthSessionModel } from '../models/auth-session.model.js';

export const authSessionRepository = {
  create(input: { userId: string; instituteId: string; tokenHash: string; expiresAt: Date }) {
    return AuthSessionModel.create(input);
  },
  findActiveByHash(tokenHash: string) {
    return AuthSessionModel.findOne({ tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } }).select('+tokenHash');
  },
  async consume(id: string, at: Date): Promise<boolean> {
    const result = await AuthSessionModel.updateOne(
      { _id: id, revokedAt: null, expiresAt: { $gt: at } },
      { $set: { revokedAt: at } }
    );
    return result.modifiedCount === 1;
  },
  async revokeOwned(tokenHash: string, userId: string, at: Date): Promise<void> {
    await AuthSessionModel.updateOne({ tokenHash, userId, revokedAt: null }, { $set: { revokedAt: at } });
  }
};
