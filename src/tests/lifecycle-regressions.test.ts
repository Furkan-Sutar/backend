import { beforeEach, describe, expect, it, vi } from 'vitest';

const periodMocks = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock('../models/financial-period.model.js', () => ({ FinancialPeriodModel: { findOne: periodMocks.findOne } }));
const certificateMocks = vi.hoisted(() => ({ student: vi.fn(), course: vi.fn(), batch: vi.fn(), enrollment: vi.fn(), rule: vi.fn(), modules: vi.fn(), progress: vi.fn() }));
vi.mock('../models/student.model.js', () => ({ StudentModel: { findOne: certificateMocks.student } }));
vi.mock('../models/course.model.js', () => ({ CourseModel: { findOne: certificateMocks.course } }));
vi.mock('../models/batch.model.js', () => ({ BatchModel: { findOne: certificateMocks.batch } }));
vi.mock('../models/batch-enrollment.model.js', () => ({ BatchEnrollmentModel: { findOne: certificateMocks.enrollment } }));
vi.mock('../models/certificate-rule.model.js', () => ({ CertificateRuleModel: { findOne: certificateMocks.rule } }));
vi.mock('../models/course-module.model.js', () => ({ CourseModuleModel: { find: certificateMocks.modules } }));
vi.mock('../models/course-progress.model.js', () => ({ CourseProgressModel: { find: certificateMocks.progress } }));

process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/skill_nova_test';
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-longer-than-32-characters';
const { assertPeriodOpen } = await import('../services/financial-ledger.service.js');
const { validatePrivateFile } = await import('../services/file-storage.service.js');
const { CertificateService } = await import('../services/certificate.service.js');

async function expectFailure(work: () => unknown, expected: Record<string, unknown>) {
  let caught: unknown;
  try { work(); } catch (error) { caught = error; }
  expect(caught).toMatchObject(expected);
}

describe('lifecycle security regressions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns missing requirements and blocks an ineligible certificate', async () => {
    const lean = (value: unknown) => ({ lean: vi.fn().mockResolvedValue(value) });
    certificateMocks.student.mockReturnValue(lean({ studentId: 'SN-STU-2026-00001' }));
    certificateMocks.course.mockReturnValue(lean({ _id: 'course-a' }));
    certificateMocks.batch.mockReturnValue(lean({ _id: 'batch-a' }));
    certificateMocks.enrollment.mockReturnValue(lean({ _id: 'enrollment-a' }));
    certificateMocks.rule.mockReturnValue(lean(null));
    certificateMocks.modules.mockReturnValue(lean([{ _id: 'module-a' }]));
    certificateMocks.progress.mockReturnValue(lean([]));

    const result = await CertificateService.eligibility({ instituteId: 'institute-a', studentId: 'student-a', courseId: 'course-a', batchId: 'batch-a' });
    expect(result.eligible).toBe(false);
    expect(result.missingRequirements).toEqual([expect.objectContaining({ code: 'COURSE_INCOMPLETE' })]);
  });

  it('blocks posting into a closed financial period', async () => {
    periodMocks.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue({ status: 'CLOSED' }) });
    await expect(assertPeriodOpen('institute-a', new Date('2026-06-01')))
      .rejects.toMatchObject({ statusCode: 409, code: 'FINANCIAL_PERIOD_CLOSED' });
    expect(periodMocks.findOne).toHaveBeenCalledWith({
      instituteId: 'institute-a', startDate: { $lte: expect.any(Date) }, endDate: { $gt: expect.any(Date) }
    });
  });

  it('rejects an upload whose bytes do not match its declared file type', () => {
    return expectFailure(() => validatePrivateFile(Buffer.from('not a PDF'), 'evidence.pdf', 'application/pdf'), { statusCode: 415, code: 'FILE_TYPE_INVALID' });
  });

  it('rejects oversized and path-like upload names before storage', () => {
    return expectFailure(() => validatePrivateFile(Buffer.alloc(20 * 1024 * 1024 + 1), 'large.txt', 'text/plain'), { statusCode: 413, code: 'FILE_SIZE_INVALID' })
      .then(() => expectFailure(() => validatePrivateFile(Buffer.from('safe text'), '../private.txt', 'text/plain'), { statusCode: 400, code: 'INVALID_FILE_NAME' }));
  });
});
