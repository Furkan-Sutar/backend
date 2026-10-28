export interface CollectionTransaction { transactionType: 'PAYMENT' | 'REFUND' | 'REVERSAL'; amount: number }
export function calculateCollectionTotals(rows: CollectionTransaction[]) {
  const totals = { collections: 0, refunds: 0, reversals: 0 };
  for (const row of rows) {
    if (!Number.isFinite(row.amount) || row.amount < 0) throw new RangeError('Report transaction amounts must be non-negative finite numbers');
    if (row.transactionType === 'PAYMENT') totals.collections += row.amount;
    else if (row.transactionType === 'REFUND') totals.refunds += row.amount;
    else totals.reversals += row.amount;
  }
  return { ...totals, netCollections: totals.collections - totals.refunds - totals.reversals };
}

export interface AccountFlowTransaction { category: string; direction: 'INFLOW' | 'OUTFLOW'; amount: number }
export function calculateCashFlow(rows: AccountFlowTransaction[]) {
  const totals = { operatingInflows: 0, operatingOutflows: 0, internalTransferIn: 0, internalTransferOut: 0, adjustmentInflows: 0, adjustmentOutflows: 0 };
  for (const row of rows) {
    if (!Number.isFinite(row.amount) || row.amount < 0) throw new RangeError('Report transaction amounts must be non-negative finite numbers');
    if (row.category === 'TRANSFER') totals[row.direction === 'INFLOW' ? 'internalTransferIn' : 'internalTransferOut'] += row.amount;
    else if (row.category === 'ADJUSTMENT') totals[row.direction === 'INFLOW' ? 'adjustmentInflows' : 'adjustmentOutflows'] += row.amount;
    else if (row.category !== 'OPENING_BALANCE') totals[row.direction === 'INFLOW' ? 'operatingInflows' : 'operatingOutflows'] += row.amount;
  }
  return { ...totals, netOperatingCashFlow: totals.operatingInflows - totals.operatingOutflows, internalTransferMovement: totals.internalTransferIn + totals.internalTransferOut };
}

export function estimateCashBasisOperatingSurplus(netCollections: number, paidExpenses: number, paidSalaries: number) {
  for (const amount of [netCollections, paidExpenses, paidSalaries]) if (!Number.isFinite(amount)) throw new RangeError('Report totals must be finite numbers');
  return netCollections - paidExpenses - paidSalaries;
}
