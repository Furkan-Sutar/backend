import { Router, raw } from 'express';
import { authenticate } from '../../middleware/authentication.js';
import { instituteOwnership } from '../../middleware/institute-ownership.js';
import { requireRole } from '../../middleware/authorization.js';
import { ROLES } from '../../types/rbac.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { filesController as c } from './files.controller.js';

export const filesRouter = Router();
filesRouter.use(authenticate, instituteOwnership(), requireRole(...ROLES));
filesRouter.post('/', raw({ type: '*/*', limit: '20mb' }), asyncHandler(c.upload));
filesRouter.get('/:fileId/download', asyncHandler(c.download));
filesRouter.get('/:fileId', asyncHandler(c.metadata));
filesRouter.delete('/:fileId', asyncHandler(c.archive));
