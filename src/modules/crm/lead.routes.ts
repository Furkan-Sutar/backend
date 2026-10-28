import { Router } from 'express';
import { authenticate } from '../../middleware/authentication.js';
import { instituteOwnership } from '../../middleware/institute-ownership.js';
import { requirePermission, requireRole } from '../../middleware/authorization.js';
import { ROLES } from '../../types/rbac.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { leadController } from './lead.controller.js';

export const leadRouter = Router();
leadRouter.use(authenticate, instituteOwnership(), requireRole(...ROLES));
leadRouter.get('/funnel', requirePermission('report.view'), asyncHandler(leadController.funnel));
leadRouter.get('/', requirePermission('lead.view'), asyncHandler(leadController.list));
leadRouter.post('/', requirePermission('lead.create'), asyncHandler(leadController.create));
leadRouter.get('/:id', requirePermission('lead.view'), asyncHandler(leadController.get));
leadRouter.patch('/:id', requirePermission('lead.update'), asyncHandler(leadController.update));
leadRouter.post('/:id/activities', requirePermission('lead.update'), asyncHandler(leadController.activity));
leadRouter.post('/:id/follow-ups', requirePermission('lead.update'), asyncHandler(leadController.followUp));
