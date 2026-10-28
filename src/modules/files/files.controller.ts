import type { Request, Response } from 'express';
import { FILE_ENTITY_TYPES } from '../../models/private-file.model.js';
import { privateFileStorage, type FileEntityType } from '../../services/file-storage.service.js';
import { auditRequestMetadata } from '../../utils/audit-request.js';
import { ApiError } from '../../utils/api-error.js';

function auth(req: Request) { if (!req.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'); return req.auth; }
function stringHeader(req: Request, name: string) { const value = req.header(name)?.trim(); return value || undefined; }
function validFileId(value: string | string[] | undefined) { if (typeof value !== 'string' || !/^SN-FILE-\d{4}-\d{5}$/.test(value)) throw new ApiError(400, 'INVALID_FILE_ID', 'File ID is invalid'); return value; }
function sendFile(res: Response, value: { metadata?: { originalName: string; mimeType: string; size: number }; originalName?: string; mimeType?: string; size?: number; bytes: Buffer }) {
  const originalName = value.metadata?.originalName ?? value.originalName ?? 'document';
  const mimeType = value.metadata?.mimeType ?? value.mimeType ?? 'application/octet-stream';
  const size = value.metadata?.size ?? value.size ?? value.bytes.length;
  const asciiName = originalName.replace(/["\\]/g, '_').replace(/[^\x20-\x7E]/g, '_');
  const encodedName = encodeURIComponent(originalName).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({ 'Content-Type': mimeType, 'Content-Length': String(size), 'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.send(value.bytes);
}

export const filesController = {
  async upload(req: Request, res: Response) {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const entityType = stringHeader(req, 'x-related-entity-type');
    const entityId = stringHeader(req, 'x-related-entity-id');
    const documentType = stringHeader(req, 'x-document-type');
    const originalName = stringHeader(req, 'x-file-name');
    const mimeType = req.header('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!entityType || !FILE_ENTITY_TYPES.includes(entityType as FileEntityType) || !entityId || !documentType || !originalName) throw new ApiError(400, 'FILE_METADATA_INVALID', 'Related entity type and ID, document type, and original file name headers are required');
    if (entityId.length > 200 || documentType.length > 100 || originalName.length > 255) throw new ApiError(400, 'FILE_METADATA_INVALID', 'File metadata exceeds allowed length');
    const result = await privateFileStorage.upload(auth(req), { bytes, originalName, mimeType, entityType: entityType as FileEntityType, entityId, documentType, ...(stringHeader(req, 'x-file-description') ? { description: stringHeader(req, 'x-file-description') } : {}) }, auditRequestMetadata(req));
    res.status(201).json({ success: true, data: result.file, ...(result.evidenceId ? { evidenceId: result.evidenceId } : {}) });
  },
  async metadata(req: Request, res: Response) { res.json({ success: true, data: await privateFileStorage.metadata(auth(req), validFileId(req.params.fileId)) }); },
  async download(req: Request, res: Response) { sendFile(res, await privateFileStorage.download(auth(req), validFileId(req.params.fileId), auditRequestMetadata(req))); },
  async archive(req: Request, res: Response) { res.json({ success: true, data: await privateFileStorage.archive(auth(req), validFileId(req.params.fileId), auditRequestMetadata(req)) }); }
};
