import type { Request, Response } from 'express';
import { z } from 'zod';
import { SearchService } from './search.service.js';
import { ApiError } from '../../utils/api-error.js';

const querySchema = z.object({ q: z.string().trim().min(2).max(100), page: z.coerce.number().int().min(1).max(50).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();

export const searchController = {
  async search(req: Request, res: Response) {
    if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Search query must include q (2–100 characters) and valid pagination', parsed.error.issues);
    res.json({ success: true, data: await SearchService.search(req.auth, parsed.data.q, parsed.data.page, parsed.data.limit) });
  }
};
