import { describe, expect, it } from 'vitest';
import { allocateRealizedSurplus } from '../server/src/services/allocation.js';
import { allocatePaymentWaterfall, realizedChargeFromComponents } from '../server/src/services/payment-allocation.js';
import { assertApplicationTransition, assertKycTransition, assertLoanTransition, assertPaymentTransition, assertReconciliationTransition } from '../server/src/services/state-machines.js';

describe('Stage 2 state machines', () => {
  it('accepts the approved lifecycle transitions', () => {
    expect(() => assertKycTransition('pending', 'verified')).not.toThrow();
    expect(() => assertApplicationTransition('submitted', 'kyc_verified')).not.toThrow();
    expect(() => assertLoanTransition('approved', 'disbursed')).not.toThrow();
    expect(() => assertPaymentTransition('verified', 'posted')).not.toThrow();
    expect(() => assertReconciliationTransition('variance', 'approved')).not.toThrow();
  });

  it('rejects lifecycle skips and regressions', () => {
    expect(() => assertKycTransition('pending', 'rejected')).not.toThrow();
    expect(() => assertApplicationTransition('draft', 'approved')).toThrow('INVALID_STATE_TRANSITION');
    expect(() => assertLoanTransition('completed', 'active')).toThrow('INVALID_STATE_TRANSITION');
    expect(() => assertPaymentTransition('posted', 'verified')).toThrow('INVALID_STATE_TRANSITION');
  });
});

describe('Stage 2 four-pool allocation', () => {
  it('does not make gross realized charges fully deployable', () => {
    const result = allocateRealizedSurplus(30_000, { version: 'v1', creditLossBps: 1_000, operatingBps: 2_000, collectionBps: 1_500, growthBps: 2_500 });
    expect(result.realizedCharge).toBe(30_000);
    expect(result.creditLossReserve).toBe(3_000);
    expect(result.operatingReserve).toBe(6_000);
    expect(result.collectionCost).toBe(4_500);
    expect(result.growthCapital).toBe(7_500);
    expect(result.retainedProfit).toBe(9_000);
    expect(result.deployableGrowthCapital).toBe(7_500);
  });

  it('adds growth only from realized surplus and preserves existing growth', () => {
    const result = allocateRealizedSurplus(0, { version: 'v1', creditLossBps: 1_000, operatingBps: 2_000, collectionBps: 1_500, growthBps: 2_500 }, 100_000);
    expect(result.deployableGrowthCapital).toBe(100_000);
  });
});

describe('Task 3 payment waterfall', () => {
  it('allocates principal, then penalty, then interest', () => {
    expect(allocatePaymentWaterfall({
      amount: 120_000,
      principalRemaining: 100_000,
      penaltyRemaining: 5_000,
      interestRemaining: 20_000,
    })).toEqual({
      principalAmount: 100_000,
      penaltyAmount: 5_000,
      interestAmount: 15_000,
      overpaymentAmount: 0,
      chargeAmount: 20_000,
    });
  });

  it('places cash beyond the open schedule into overpayment holding', () => {
    expect(allocatePaymentWaterfall({
      amount: 135_000,
      principalRemaining: 100_000,
      penaltyRemaining: 5_000,
      interestRemaining: 20_000,
    })).toMatchObject({
      principalAmount: 100_000,
      penaltyAmount: 5_000,
      interestAmount: 20_000,
      overpaymentAmount: 10_000,
      chargeAmount: 25_000,
    });
  });

  it('keeps principal and overpayment out of realized charge allocation', () => {
    expect(realizedChargeFromComponents({ principalAmount: 100_000, penaltyAmount: 5_000, interestAmount: 20_000, overpaymentAmount: 10_000 })).toBe(25_000);
  });
});
