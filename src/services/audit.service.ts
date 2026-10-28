import { auditLogRepository } from '../repositories/audit-log.repository.js';
import type { ClientSession } from 'mongoose';
import type { AuditFilters, AuditRequestMetadata } from '../types/audit.js';

const sensitiveField = /password|secret|token|authorization|cookie|credential|passwordhash|refresh|identitynumber|identityfingerprint|securestoragereference|correctanswer|answerkey/i;

function sanitizeSnapshot(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return typeof value === 'string' ? value.slice(0, 4000) : value;
  }
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toHexString' in value && typeof value.toHexString === 'function') {
    return value.toHexString();
  }
  if (depth >= 6) return '[MAX_DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeSnapshot(entry, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 200)
      .filter(([key]) => !sensitiveField.test(key))
      .map(([key, entry]) => [key.slice(0, 128), sanitizeSnapshot(entry, depth + 1)]));
  }
  return undefined;
}

export interface RecordAuditInput {
  instituteId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  request: AuditRequestMetadata;
  session?: ClientSession;
}

export class AuditService {
  static async record(input: RecordAuditInput) {
    const record = {
      instituteId: input.instituteId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      ...(input.entityId ? { entityId: input.entityId.slice(0, 200) } : {}),
      ...(input.before !== undefined ? { before: sanitizeSnapshot(input.before) } : {}),
      ...(input.after !== undefined ? { after: sanitizeSnapshot(input.after) } : {}),
      ...(input.reason ? { reason: input.reason.slice(0, 1000) } : {}),
      requestId: input.request.requestId.slice(0, 128),
      ...(input.request.ip ? { ip: input.request.ip.slice(0, 64) } : {}),
      ...(input.request.userAgent ? { userAgent: input.request.userAgent.slice(0, 512) } : {}),
      ...(input.request.device ? { device: sanitizeSnapshot(input.request.device) } : {})
    };
    return input.session ? auditLogRepository.create(record, input.session) : auditLogRepository.create(record);
  }

  static list(filters: AuditFilters) {
    return auditLogRepository.list(filters);
  }
}

