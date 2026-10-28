import { Router } from 'express';
import { authenticate } from '../../middleware/authentication.js';
import { instituteOwnership } from '../../middleware/institute-ownership.js';
import { requirePermission, requireRole } from '../../middleware/authorization.js';
import { ROLES } from '../../types/rbac.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { notificationsController as c } from './notifications.controller.js';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate, instituteOwnership(), requireRole(...ROLES));
notificationsRouter.get('/me', asyncHandler(c.list));
notificationsRouter.patch('/:notificationId/read', asyncHandler(c.markRead));
notificationsRouter.get('/preferences', asyncHandler(c.getPreferences));
notificationsRouter.put('/preferences', asyncHandler(c.setPreferences));
notificationsRouter.get('/automation-rules', requirePermission('settings.manage'), asyncHandler(c.listRules));
notificationsRouter.put('/automation-rules/:key', requirePermission('settings.manage'), asyncHandler(c.updateRule));
