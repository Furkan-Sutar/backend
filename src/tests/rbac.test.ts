import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ROLES, PERMISSIONS, PERMISSION_DEFINITIONS, ROLE_PERMISSIONS, type Role } from '../types/rbac.js';
import { requirePermission, requireRole } from '../middleware/authorization.js';
import { instituteOwnership } from '../middleware/institute-ownership.js';

function middlewareResult(middleware: (req: Request, res: Response, next: NextFunction) => unknown, auth?: { role: Role; instituteId: string; instituteBusinessId: string }, requestValues: Record<string, unknown> = {}) {
  const next = vi.fn();
  const req = {
    ...(auth ? { auth } : {}),
    params: {},
    query: {},
    body: {},
    ...requestValues
  } as unknown as Request;
  middleware(req, {} as Response, next);
  return next;
}

const baseAuth = (role: Role) => ({
  role,
  instituteId: '507f1f77bcf86cd799439011',
  instituteBusinessId: 'SN-INS-2026-00001'
});

describe('RBAC definitions', () => {
  it('defines the requested permission catalog', () => {
    const required = [
      'lead.view', 'lead.create', 'lead.update', 'lead.assign', 'lead.convert', 'lead.archive', 'lead.delete',
      'admission.view', 'admission.create', 'admission.update',
      'student.view', 'student.create', 'student.update', 'student.archive',
      'course.view', 'course.create', 'course.update', 'batch.view', 'batch.create', 'batch.update',
      'attendance.view', 'attendance.create', 'attendance.update', 'progress.view', 'progress.update',
      'assignment.view', 'assignment.create', 'assignment.update', 'exam.view', 'exam.create', 'exam.update',
      'result.view', 'result.update', 'result.publish', 'fee.view', 'fee.create', 'payment.view', 'payment.create',
      'payment.reverse', 'receipt.view', 'expense.view', 'expense.create', 'expense.approve', 'expense.pay',
      'salary.view', 'salary.create', 'salary.approve', 'salary.pay', 'account.view', 'ledger.view', 'period.close',
      'certificate.view', 'certificate.issue', 'certificate.verify', 'report.view', 'user.view', 'user.create',
      'staff.view', 'staff.create', 'staff.update', 'staff.assignment.manage',
      'user.update', 'user.disable', 'role.manage', 'permission.manage', 'settings.manage', 'audit.view'
    ];
    expect(PERMISSIONS).toEqual(expect.arrayContaining(required));
    expect(PERMISSION_DEFINITIONS).toHaveLength(PERMISSIONS.length);
    expect(ROLES).toEqual(['OWNER_ADMIN', 'COUNSELLOR', 'TEACHER', 'ACCOUNTANT', 'STUDENT']);
  });

  it.each(ROLES)('enforces every permission for %s', (role) => {
    for (const permission of PERMISSIONS) {
      const next = middlewareResult(requirePermission(permission), baseAuth(role));
      const allowed = ROLE_PERMISSIONS[role].includes(permission);
      if (allowed) {
        expect(next).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledWith();
      } else {
        expect(next).toHaveBeenCalledOnce();
        expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403, code: 'PERMISSION_FORBIDDEN' });
      }
    }
  });

  it.each(ROLES)('accepts only the authenticated %s role when required', (role) => {
    const allowed = middlewareResult(requireRole(role), baseAuth(role));
    expect(allowed).toHaveBeenCalledWith();
    const denied = middlewareResult(requireRole(role), baseAuth(ROLES.find((other) => other !== role)!));
    expect(denied.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403, code: 'ROLE_FORBIDDEN' });
  });

  it('denies permission and role checks when no user is authenticated', () => {
    expect(middlewareResult(requirePermission('report.view')).mock.calls[0]?.[0])
      .toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
    expect(middlewareResult(requireRole('OWNER_ADMIN')).mock.calls[0]?.[0])
      .toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
  });
});

describe('institute ownership', () => {
  it('allows the authenticated institute ID and business ID', () => {
    const internal = middlewareResult(instituteOwnership(), baseAuth('OWNER_ADMIN'), {
      params: { instituteId: '507f1f77bcf86cd799439011' }
    });
    const business = middlewareResult(instituteOwnership(), baseAuth('OWNER_ADMIN'), {
      query: { instituteId: 'SN-INS-2026-00001' }
    });
    expect(internal).toHaveBeenCalledWith();
    expect(business).toHaveBeenCalledWith();
  });

  it.each(['params', 'query', 'body'] as const)('rejects a foreign institute supplied in %s', (location) => {
    const values = location === 'params'
      ? { params: { instituteId: 'SN-INS-2026-00002' } }
      : location === 'query'
        ? { query: { instituteId: 'SN-INS-2026-00002' } }
        : { body: { instituteId: 'SN-INS-2026-00002' } };
    const next = middlewareResult(instituteOwnership(), baseAuth('COUNSELLOR'), values);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403, code: 'INSTITUTE_ACCESS_DENIED' });
  });

  it('rejects conflicting institute identifiers in one request', () => {
    const next = middlewareResult(instituteOwnership(), baseAuth('OWNER_ADMIN'), {
      params: { instituteId: 'SN-INS-2026-00001' },
      body: { instituteId: 'SN-INS-2026-00002' }
    });
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403, code: 'INSTITUTE_ACCESS_DENIED' });
  });

  it('fails closed if tenant ownership is checked without authentication', () => {
    const next = middlewareResult(instituteOwnership());
    expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
  });
});
