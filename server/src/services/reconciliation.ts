export interface ReconciliationInput {
  expectedAmount: number;
  recordedAmount: number;
  submittedAmount: number;
}

export interface ReconciliationResult extends ReconciliationInput {
  variance: number;
  status: 'matched' | 'variance';
}

function assertAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_RECONCILIATION_AMOUNT');
}

export function calculateReconciliation(input: ReconciliationInput): ReconciliationResult {
  assertAmount(input.expectedAmount);
  assertAmount(input.recordedAmount);
  assertAmount(input.submittedAmount);
  const variance = input.submittedAmount - input.recordedAmount;
  return { ...input, variance, status: variance === 0 && input.recordedAmount === input.expectedAmount ? 'matched' : 'variance' };
}
