import mongoose, { type ClientSession } from 'mongoose';
import { AuditLogModel } from '../models/audit-log.model.js';
import { UserModel } from '../models/user.model.js';
import type { AuditFilters } from '../types/audit.js';

export const auditLogRepository = {
  async create(input: Record<string, unknown>, session?: ClientSession) {
    if (session) {
      const [record] = await AuditLogModel.create([input], { session });
      return record!;
    }
    return AuditLogModel.create(input);
  },

  async list(filters: AuditFilters) {
    const query: Record<string, unknown> = { instituteId: filters.instituteId };
    if (filters.date) {
      const start = new Date(`${filters.date}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      query.timestamp = { $gte: start, $lt: end };
    }
    if (filters.action) query.action = filters.action;
    if (filters.entity) query.entityType = filters.entity;
    if (filters.entityId) query.entityId = filters.entityId;

    if (filters.actor) {
      let actorUserId: unknown;
      if (mongoose.isValidObjectId(filters.actor)) {
        actorUserId = new mongoose.Types.ObjectId(filters.actor);
      } else {
        const actor = await UserModel.findOne({ instituteId: filters.instituteId, userId: filters.actor })
          .select('_id').lean();
        if (!actor) return { items: [], total: 0 };
        actorUserId = actor._id;
      }
      query.actorUserId = actorUserId;
    }

    const skip = (filters.page - 1) * filters.limit;
    const [items, total] = await Promise.all([
      AuditLogModel.find(query).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(filters.limit).lean(),
      AuditLogModel.countDocuments(query)
    ]);
    return { items, total };
  }
};

