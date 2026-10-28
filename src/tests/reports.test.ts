import { describe, expect, it, vi } from 'vitest';

const queryMocks = vi.hoisted(() => ({ feeAggregate: vi.fn(), paymentAggregate: vi.fn() }));
vi.mock('../models/fee-plan.model.js', () => ({ FeePlanModel: { aggregate: queryMocks.feeAggregate } }));
vi.mock('../models/payment.model.js', () => ({ PaymentModel: { aggregate: queryMocks.paymentAggregate } }));
import { calculateCashFlow, calculateCollectionTotals, estimateCashBasisOperatingSurplus } from '../utils/report-calculations.js';
import { reportsService } from '../services/reports.service.js';
import { calculateCourseProfitability } from '../utils/course-profitability.js';
import type { AuthenticatedUser } from '../types/auth.js';

const accountant: AuthenticatedUser = { objectId: '64b000000000000000000001', userId: 'SN-USR-2026-00001', instituteId: '64b000000000000000000002', instituteBusinessId: 'SN-INS-2026-00001', name: 'Accountant', role: 'ACCOUNTANT', authVersion: 0 };
const student: AuthenticatedUser = { ...accountant, role: 'STUDENT' };

describe('transaction-backed report calculations', () => {
  it('scopes report aggregation pipelines to the authenticated institute', async () => {
    queryMocks.feeAggregate.mockResolvedValue([]);
    queryMocks.paymentAggregate.mockResolvedValue([]);
    await reportsService.revenue(accountant, {});
    const expectedInstituteId = accountant.instituteId;
    expect(queryMocks.feeAggregate).toHaveBeenCalled();
    expect(queryMocks.paymentAggregate).toHaveBeenCalledOnce();
    for (const [pipeline] of queryMocks.feeAggregate.mock.calls) {
      expect(String((pipeline[0] as { $match: { instituteId: unknown } }).$match.instituteId)).toBe(expectedInstituteId);
    }
    for (const [pipeline] of queryMocks.paymentAggregate.mock.calls) {
      expect(String((pipeline[0] as { $match: { instituteId: unknown } }).$match.instituteId)).toBe(expectedInstituteId);
    }
  });
  it('reports billed collections, refunds, and reversals as separate totals', () => {
    expect(calculateCollectionTotals([
      { transactionType: 'PAYMENT', amount: 1000 },
      { transactionType: 'REFUND', amount: 100 },
      { transactionType: 'REVERSAL', amount: 200 }
    ])).toEqual({ collections: 1000, refunds: 100, reversals: 200, netCollections: 700 });
  });

  it('keeps transfers and adjustments outside operational cash flow', () => {
    expect(calculateCashFlow([
      { category: 'COLLECTION', direction: 'INFLOW', amount: 1200 },
      { category: 'EXPENSE', direction: 'OUTFLOW', amount: 250 },
      { category: 'TRANSFER', direction: 'OUTFLOW', amount: 500 },
      { category: 'TRANSFER', direction: 'INFLOW', amount: 500 },
      { category: 'ADJUSTMENT', direction: 'OUTFLOW', amount: 25 },
      { category: 'OPENING_BALANCE', direction: 'INFLOW', amount: 300 }
    ])).toEqual({ operatingInflows: 1200, operatingOutflows: 250, internalTransferIn: 500, internalTransferOut: 500, adjustmentInflows: 0, adjustmentOutflows: 25, netOperatingCashFlow: 950, internalTransferMovement: 1000 });
  });

  it('calculates an explicitly cash-basis estimated operating surplus', () => {
    expect(estimateCashBasisOperatingSurplus(1000, 350, 200)).toBe(450);
  });

  it('calculates contribution, margin, estimated profit, and break-even from course unit economics', () => {
    expect(calculateCourseProfitability({ revenue: 10000, fixedCosts: 3000, variableCosts: 2000, enrollments: 10 })).toMatchObject({
      revenue: 10000, directCost: 5000, contribution: 8000, contributionMargin: 80,
      estimatedProfit: 5000, contributionPerEnrollment: 800, breakEvenEnrollments: 4,
      breakEvenReached: true
    });
  });

  it('does not invent break-even when there are no enrollments or positive contribution', () => {
    expect(calculateCourseProfitability({ revenue: 0, fixedCosts: 1000, variableCosts: 100, enrollments: 0 })).toMatchObject({ contribution: -100, contributionMargin: null, contributionPerEnrollment: null, breakEvenEnrollments: null, breakEvenReached: null, estimatedProfit: -1100 });
    expect(calculateCourseProfitability({ revenue: 100, fixedCosts: 1000, variableCosts: 200, enrollments: 5 }).breakEvenEnrollments).toBeNull();
  });

  it('requires report.view before querying transactional data', async () => {
    await expect(reportsService.revenue(student, {})).rejects.toMatchObject({ statusCode: 403, code: 'PERMISSION_FORBIDDEN' });
  });

  it('blocks counselors from institute financial reports even though they can view CRM reports', async () => {
    const counsellor: AuthenticatedUser = { ...accountant, role: 'COUNSELLOR' };
    await expect(reportsService.revenue(counsellor, {})).rejects.toMatchObject({ statusCode: 403, code: 'PERMISSION_FORBIDDEN' });
    await expect(reportsService.expenses(counsellor, {})).rejects.toMatchObject({ statusCode: 403, code: 'PERMISSION_FORBIDDEN' });
    await expect(reportsService.cashFlow(counsellor, {})).rejects.toMatchObject({ statusCode: 403, code: 'PERMISSION_FORBIDDEN' });
    await expect(reportsService.dashboard(counsellor, {})).rejects.toMatchObject({ statusCode: 403, code: 'PERMISSION_FORBIDDEN' });
  });
});
