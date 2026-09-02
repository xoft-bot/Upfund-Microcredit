import { describe, expect, it } from 'vitest';
import { calculateReconciliation } from '../server/src/services/reconciliation.js';
import { assessAndApprove, disburseLoan, submitApplication, verifyClientKyc } from '../server/src/services/workflow.js';

const initial = { kyc: 'pending' as const, application: 'draft' as const, loan: 'approved' as const };

describe('Stage 2 client and loan workflow', () => {
  it('moves through the approved onboarding path', () => {
    const submitted = submitApplication(initial);
    const verified = verifyClientKyc(submitted);
    const approved = assessAndApprove({ ...verified });
    const disbursed = disburseLoan(approved);
    expect(disbursed).toMatchObject({ kyc: 'verified', application: 'approved', loan: 'disbursed' });
  });

  it('fails closed when a workflow step is skipped', () => {
    expect(() => verifyClientKyc(initial)).toThrow('INVALID_STATE_TRANSITION');
  });
});

describe('Stage 2 physical logbook reconciliation', () => {
  it('matches when expected, recorded, and submitted cash agree', () => {
    expect(calculateReconciliation({ expectedAmount: 100_000, recordedAmount: 100_000, submittedAmount: 100_000 })).toEqual({ expectedAmount: 100_000, recordedAmount: 100_000, submittedAmount: 100_000, variance: 0, status: 'matched' });
  });

  it('flags a variance instead of silently posting a mismatch', () => {
    const result = calculateReconciliation({ expectedAmount: 100_000, recordedAmount: 95_000, submittedAmount: 90_000 });
    expect(result.variance).toBe(-5_000);
    expect(result.status).toBe('variance');
  });
});
