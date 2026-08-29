export interface PaymentWaterfallInput {
  amount: number;
  principalRemaining: number;
  penaltyRemaining: number;
  interestRemaining: number;
}

export interface PaymentWaterfallResult {
  principalAmount: number;
  penaltyAmount: number;
  interestAmount: number;
  overpaymentAmount: number;
  chargeAmount: number;
}

function assertNonNegativeInteger(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

export function allocatePaymentWaterfall(input: PaymentWaterfallInput): PaymentWaterfallResult {
  assertNonNegativeInteger(input.amount, 'INVALID_PAYMENT_AMOUNT');
  assertNonNegativeInteger(input.principalRemaining, 'INVALID_PRINCIPAL_REMAINING');
  assertNonNegativeInteger(input.penaltyRemaining, 'INVALID_PENALTY_REMAINING');
  assertNonNegativeInteger(input.interestRemaining, 'INVALID_INTEREST_REMAINING');
  if (input.amount === 0) throw new Error('INVALID_PAYMENT_AMOUNT');

  const principalAmount = Math.min(input.amount, input.principalRemaining);
  const afterPrincipal = input.amount - principalAmount;
  const penaltyAmount = Math.min(afterPrincipal, input.penaltyRemaining);
  const afterPenalty = afterPrincipal - penaltyAmount;
  const interestAmount = Math.min(afterPenalty, input.interestRemaining);
  const overpaymentAmount = afterPenalty - interestAmount;

  return {
    principalAmount,
    penaltyAmount,
    interestAmount,
    overpaymentAmount,
    chargeAmount: penaltyAmount + interestAmount,
  };
}