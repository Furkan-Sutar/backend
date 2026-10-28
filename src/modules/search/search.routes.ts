import { Router } from 'express';
import { authenticate } from '../../middleware/authentication.js';
import { instituteOwnership } from '../../middleware/institute-ownership.js';
import { requireRole } from '../../middleware/authorization.js';
import { ROLES } from '../../types/rbac.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { searchController } from './search.controller.js';

export const searchRouter = Router();
searchRouter.use(authenticate, instituteOwnership(), requireRole(...ROLES));
searchRouter.get('/', asyncHandler(searchController.search));
