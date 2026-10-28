import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../types/auth.js';
import { ROLE_PERMISSIONS, type Permission } from '../types/rbac.js';
import { NotificationModel, NOTIFICATION_TYPES, type Notification } from '../models/notification.model.js';
import { NotificationPreferenceModel } from '../models/notification-preference.model.js';
import { AutomationRuleModel } from '../models/automation-rule.model.js';
import { UserModel } from '../models/user.model.js';
import { ApiError } from '../utils/api-error.js';
import type { Request } from 'express';
import { AuditService } from './audit.service.js';
import { auditRequestMetadata } from '../utils/audit-request.js';
import { inTransaction } from '../utils/transaction.js';

export type NotificationType = typeof NOTIFICATION_TYPES[number];
export const NOTIFICATION_PERMISSION: Record<NotificationType, Permission> = {
  PENDING_FOLLOW_UP: 'lead.view', MISSED_FOLLOW_UP: 'lead.view', PENDING_FEE: 'fee.view', UPCOMING_INSTALLMENT: 'fee.view',
  ATTENDANCE_RISK: 'attendance.view', COURSE_COMPLETION: 'progress.view', CERTIFICATE_ELIGIBILITY: 'certificate.view',
  PENDING_EXPENSE_APPROVAL: 'expense.approve', PENDING_SALARY_APPROVAL: 'salary.approve', OWNER_DAILY_SUMMARY: 'report.view'
};
export function roleCanReceiveNotification(role: string, type: NotificationType) {
  return role in ROLE_PERMISSIONS && ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS].includes(NOTIFICATION_PERMISSION[type]);
}
export function notificationIsAllowed(role: string, type: NotificationType, preference?: { inAppEnabled?: boolean; disabledTypes?: readonly string[] } | null) {
  return roleCanReceiveNotification(role, type) && preference?.inAppEnabled !== false && !preference?.disabledTypes?.includes(type);
}
export function dailyNotificationDedupeKey(type: NotificationType, entityId: string, day: string) { return `${type}:${entityId}:${day}`; }

const DEFAULT_RULES: NotificationType[] = [...NOTIFICATION_TYPES];
export class NotificationService {
  static async ensureDefaultRules(instituteId: string, updatedBy: string) {
    await Promise.all(DEFAULT_RULES.map((key) => AutomationRuleModel.updateOne(
      { instituteId: new Types.ObjectId(instituteId), key },
      { $setOnInsert: { instituteId: new Types.ObjectId(instituteId), key, enabled: true, frequency: key === 'OWNER_DAILY_SUMMARY' ? 'DAILY' : 'DAILY', configuration: {}, updatedBy: new Types.ObjectId(updatedBy) } },
      { upsert: true }
    )));
  }

  static async create(input: { instituteId: string; recipientUserId: string; type: NotificationType; title: string; message: string; dedupeKey: string; entityType?: string; entityId?: string; data?: unknown; expiresAt?: Date }) {
    const user = await UserModel.findOne({ _id: input.recipientUserId, instituteId: input.instituteId, status: 'active' }).select('role').lean() as { role: string } | null;
    if (!user || !roleCanReceiveNotification(user.role, input.type)) return { created: false, reason: !user ? 'RECIPIENT_INACTIVE_OR_OUTSIDE_INSTITUTE' : 'PERMISSION_NOT_GRANTED' };
    const preference = await NotificationPreferenceModel.findOne({ instituteId: input.instituteId, userId: input.recipientUserId }).lean() as { inAppEnabled?: boolean; disabledTypes?: string[] } | null;
    if (!notificationIsAllowed(user.role, input.type, preference)) return { created: false, reason: 'PREFERENCE_DISABLED' };
    try {
      const [notification] = await NotificationModel.create([{
        instituteId: new Types.ObjectId(input.instituteId), recipientUserId: new Types.ObjectId(input.recipientUserId),
        type: input.type, requiredPermission: NOTIFICATION_PERMISSION[input.type], title: input.title, message: input.message,
        dedupeKey: input.dedupeKey, ...(input.entityType ? { entityType: input.entityType } : {}), ...(input.entityId ? { entityId: input.entityId } : {}),
        ...(input.data !== undefined ? { data: input.data } : {}), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {})
      }]);
      return { created: true, notification };
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return { created: false, reason: 'DUPLICATE' };
      throw error;
    }
  }

  static async list(auth: AuthenticatedUser, unreadOnly = false) {
    return NotificationModel.find({ instituteId: new Types.ObjectId(auth.instituteId), recipientUserId: new Types.ObjectId(auth.objectId), ...(unreadOnly ? { readAt: null } : {}), $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).sort({ createdAt: -1 }).limit(100).lean();
  }

  static async markRead(auth: AuthenticatedUser, notificationId: string) {
    const notification = await NotificationModel.findOneAndUpdate({ _id: notificationId, instituteId: auth.instituteId, recipientUserId: auth.objectId }, { $set: { readAt: new Date() } }, { new: true }).lean();
    if (!notification) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification was not found');
    return notification;
  }

  static async getPreferences(auth: AuthenticatedUser) {
    return await NotificationPreferenceModel.findOne({ instituteId: auth.instituteId, userId: auth.objectId }).lean() ?? { instituteId: auth.instituteId, userId: auth.objectId, inAppEnabled: true, emailEnabled: false, smsEnabled: false, whatsappEnabled: false, disabledTypes: [] };
  }

  static async setPreferences(auth: AuthenticatedUser, input: { inAppEnabled: boolean; emailEnabled: boolean; smsEnabled: boolean; whatsappEnabled: boolean; disabledTypes: NotificationType[] }) {
    return NotificationPreferenceModel.findOneAndUpdate({ instituteId: auth.instituteId, userId: auth.objectId }, { $set: input, $setOnInsert: { instituteId: new Types.ObjectId(auth.instituteId), userId: new Types.ObjectId(auth.objectId) } }, { upsert: true, new: true, runValidators: true }).lean();
  }

  static async listRules(instituteId: string, updatedBy: string) { await this.ensureDefaultRules(instituteId, updatedBy); return AutomationRuleModel.find({ instituteId }).sort({ key: 1 }).lean(); }
  static async updateRule(req: Request, instituteId: string, actorUserId: string, key: NotificationType, input: { enabled: boolean; frequency: 'DAILY' | 'INSTANT'; configuration: Record<string, unknown> }) {
    return inTransaction(async (session) => {
      const before = await AutomationRuleModel.findOne({ instituteId, key }).session(session).lean();
      const rule = await AutomationRuleModel.findOneAndUpdate({ instituteId, key }, { $set: { ...input, updatedBy: actorUserId }, $setOnInsert: { instituteId, key } }, { upsert: true, new: true, runValidators: true, session }).lean();
      await AuditService.record({ instituteId, actorUserId, action: 'automation_rule.update', entityType: 'AutomationRule', entityId: key, ...(before ? { before } : {}), after: rule, request: auditRequestMetadata(req), session });
      return rule;
    });
  }
}
