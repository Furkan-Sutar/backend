import type { Request, Response } from 'express';
import { AuditService } from '../../services/audit.service.js';
import { ApiError } from '../../utils/api-error.js';
import { auditListSchema } from './audit.validators.js';

export const auditController = {
  async list(req: Request, res: Response): Promise<void> {
    if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
    const parsed = auditListSchema.safeParse(req.query);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Audit filters are invalid');
    const filters = {
      instituteId: req.auth.instituteId,
      page: parsed.data.page,
      limit: parsed.data.limit,
      ...(parsed.data.date ? { date: parsed.data.date } : {}),
      ...(parsed.data.actor ? { actor: parsed.data.actor } : {}),
      ...(parsed.data.action ? { action: parsed.data.action } : {}),
      ...(parsed.data.entity ? { entity: parsed.data.entity } : {}),
      ...(parsed.data.entityId ? { entityId: parsed.data.entityId } : {})
    };
    const result = await AuditService.list(filters);
    res.status(200).json({
      success: true,
      data: result.items,
      message: 'Audit records retrieved',
      meta: {
        correlationId: req.correlationId,
        page: parsed.data.page,
        limit: parsed.data.limit,
        total: result.total,
        pages: Math.ceil(result.total / parsed.data.limit)
      }
    });
  }
};

