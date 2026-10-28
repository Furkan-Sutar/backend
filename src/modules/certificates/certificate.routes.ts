import { Router, raw } from 'express';
import { authenticate } from '../../middleware/authentication.js';
import { instituteOwnership } from '../../middleware/institute-ownership.js';
import { requirePermission, requireRole } from '../../middleware/authorization.js';
import { ROLES } from '../../types/rbac.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { certificateController } from './certificate.controller.js';

export const certificateRouter = Router();
certificateRouter.use(authenticate, instituteOwnership(), requireRole(...ROLES));
certificateRouter.get('/eligibility', requirePermission('certificate.view'), asyncHandler(certificateController.eligibility));
certificateRouter.get('/rules/:courseId', requirePermission('certificate.view'), asyncHandler(certificateController.getRules));
certificateRouter.put('/rules/:courseId', requirePermission('settings.manage'), asyncHandler(certificateController.putRules));
certificateRouter.post('/issue', requirePermission('certificate.issue'), asyncHandler(certificateController.issue));
certificateRouter.get('/verify/:certificateId', requirePermission('certificate.verify'), asyncHandler(certificateController.verify));
certificateRouter.get('/:id', requirePermission('certificate.view'), asyncHandler(certificateController.get));
certificateRouter.post('/evidence', requirePermission('evidence.create'), raw({ type: '*/*', limit: '10mb' }), asyncHandler(certificateController.uploadEvidence));
certificateRouter.get('/evidence/:evidenceId/content', requirePermission('evidence.view'), asyncHandler(certificateController.readEvidence));
