import { describe, expect, it, vi } from 'vitest';
import { runReconciliationCycle, type Candidate } from '../server/src/jobs/reconciliationCron.js';
import type { VarianceAlert } from '../server/src/services/varianceAlerting.js';

const options = { actorUserId: 'system-cron', policyVersion: 'v1', asOf: new Date('2026-08-25T23:59:59.000Z'), varianceAlertThreshold: 100 };
const candidates: Candidate[] = [{ branchId: 'branch-1', paymentId: 'payment-1', amount: 100000 }];

describe('reconciliation cron', () => {
  it('auto-posts a balanced branch batch through the posting service', async () => {
    const postBatch = vi.fn(async () => ({ reconciliationId: 'recon-1', status: 'matched', variance: 0, allocation: { policyVersion: 'v1', realizedCharge: 0, creditLossReserve: 0, operatingReserve: 0, collectionCost: 0, growthCapital: 0, retainedProfit: 0, deployableGrowthCapital: 0 }, ledgerTransactionId: 'ledger-1' }));
    const result = await runReconciliationCycle(options, { loadCandidates: async () => candidates, expectedForBranch: async () => 100000, postBatch });
    expect(result).toEqual({ processed: 1, posted: 1, quarantined: 0, skipped: false });
    expect(postBatch).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'branch-1', paymentIds: ['payment-1'], managerOverride: false }));
  });

  it('quarantines a variance batch and never calls auto-posting', async () => {
    const postBatch = vi.fn(); const quarantine = vi.fn(async () => undefined); const alertSink = vi.fn<(alert: VarianceAlert) => void>();
    const result = await runReconciliationCycle(options, { loadCandidates: async () => candidates, expectedForBranch: async () => 120000, postBatch, quarantine, alertSink });
    expect(result).toEqual({ processed: 1, posted: 0, quarantined: 1, skipped: false });
    expect(postBatch).not.toHaveBeenCalled(); expect(quarantine).toHaveBeenCalledWith(expect.objectContaining({ variance: -20000, paymentIds: ['payment-1'] }));
    expect(alertSink).toHaveBeenCalledWith(expect.objectContaining({ event: 'reconciliation.variance', version: '1.0.01', branchId: 'branch-1', variance: -20000, threshold: 100 }));
  });

  it('skips a cycle already being processed by another runner', async () => {
    const result = await runReconciliationCycle(options, { loadCandidates: async () => null });
    expect(result.skipped).toBe(true); expect(result.processed).toBe(0);
  });

  it('does not execute a cycle when the scheduler lock is unavailable', async () => {
    const loadCandidates = vi.fn(async () => candidates);
    const result = await runReconciliationCycle(options, {
      loadCandidates,
      acquireLock: async () => null,
    });
    expect(result).toEqual({ processed: 0, posted: 0, quarantined: 0, skipped: true });
    expect(loadCandidates).not.toHaveBeenCalled();
  });
});
