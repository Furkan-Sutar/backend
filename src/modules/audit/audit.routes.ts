import { Router } from 'express';
import { authenticate } from '../../middleware/authentication.js';
import { instituteOwnership } from '../../middleware/institute-ownership.js';
import { requirePermission, requireRole } from '../../middleware/authorization.js';
import { ROLES } from '../../types/rbac.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { auditController } from './audit.controller.js';

export const auditRouter = Router();
auditRouter.get(
  '/',
  authenticate,
  instituteOwnership(),
  requireRole(...ROLES),
  requirePermission('audit.view'),
  asyncHandler(auditController.list)
);
