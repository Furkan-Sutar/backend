import type { Request } from 'express';
import type { AuditRequestMetadata } from '../types/audit.js';

function boundedHeader(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export function auditRequestMetadata(req: Request): AuditRequestMetadata {
  const deviceId = boundedHeader(req.header('x-device-id'), 128);
  const deviceName = boundedHeader(req.header('x-device-name'), 128);
  const platform = boundedHeader(req.header('x-device-platform'), 64);
  const userAgent = boundedHeader(req.header('user-agent'), 512);
  const device = deviceId || deviceName || platform
    ? { ...(deviceId ? { id: deviceId } : {}), ...(deviceName ? { name: deviceName } : {}), ...(platform ? { platform } : {}) }
    : undefined;
  return {
    requestId: req.correlationId,
    ...(req.ip ? { ip: req.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(device ? { device } : {})
  };
}
