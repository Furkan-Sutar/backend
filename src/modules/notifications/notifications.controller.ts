import type { Request, Response } from 'express';
import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../../models/notification.model.js';
import { NotificationService } from '../../services/notification.service.js';
import { ApiError } from '../../utils/api-error.js';

const preferencesSchema = z.object({
  inAppEnabled: z.boolean(), emailEnabled: z.boolean(), smsEnabled: z.boolean(), whatsappEnabled: z.boolean(),
  disabledTypes: z.array(z.enum(NOTIFICATION_TYPES)).max(NOTIFICATION_TYPES.length)
}).strict();
const ruleSchema = z.object({ enabled: z.boolean(), frequency: z.enum(['DAILY', 'INSTANT']), configuration: z.record(z.string(), z.unknown()).default({}) }).strict();
function auth(req: Request) { if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'); return req.auth; }

export const notificationsController = {
  async list(req: Request, res: Response) { const unreadOnly = req.query.unreadOnly === 'true'; res.json({ success: true, data: await NotificationService.list(auth(req), unreadOnly) }); },
  async markRead(req: Request, res: Response) { const id = req.params.notificationId; if (typeof id !== 'string' || !/^[0-9a-f]{24}$/i.test(id)) throw new ApiError(400, 'INVALID_NOTIFICATION_ID', 'Notification ID must be a MongoDB object ID'); res.json({ success: true, data: await NotificationService.markRead(auth(req), id) }); },
  async getPreferences(req: Request, res: Response) { res.json({ success: true, data: await NotificationService.getPreferences(auth(req)) }); },
  async setPreferences(req: Request, res: Response) { const parsed = preferencesSchema.safeParse(req.body); if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Notification preferences are invalid', parsed.error.issues); res.json({ success: true, data: await NotificationService.setPreferences(auth(req), parsed.data) }); },
  async listRules(req: Request, res: Response) { res.json({ success: true, data: await NotificationService.listRules(auth(req).instituteId, auth(req).objectId) }); },
  async updateRule(req: Request, res: Response) {
    const key = req.params.key;
    if (typeof key !== 'string') throw new ApiError(404, 'AUTOMATION_RULE_NOT_FOUND', 'Automation rule was not found');
    if (!NOTIFICATION_TYPES.includes(key as typeof NOTIFICATION_TYPES[number])) throw new ApiError(404, 'AUTOMATION_RULE_NOT_FOUND', 'Automation rule was not found');
    const parsed = ruleSchema.safeParse(req.body); if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Automation rule configuration is invalid', parsed.error.issues);
    res.json({ success: true, data: await NotificationService.updateRule(req, auth(req).instituteId, auth(req).objectId, key as typeof NOTIFICATION_TYPES[number], parsed.data) });
  }
};
