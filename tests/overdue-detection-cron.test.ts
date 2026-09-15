import { describe, expect, it, vi } from 'vitest';
import { runOverdueDetectionCycle } from '../server/src/jobs/overdueDetectionCron.js';

const options = { actorUserId: 'system-cron', asOf: new Date('2026-08-25T23:59:59.000Z') };

describe('overdue detection cron', () => {
  it('transitions each overdue loan to overdue status', async () => {
    const transition = vi.fn(async () => ({ loanId: 'loan-1', status: 'overdue' }));
    const result = await runOverdueDetectionCycle(options, { loadOverdueLoanIds: async () => ['loan-1', 'loan-2'], transition });
    expect(result).toEqual({ processed: 2, transitioned: 2, skipped: false });
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }), 'loan-1', expect.any(String));
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }), 'loan-2', expect.any(String));
  });

  it('skips a cycle when there are no overdue loans to process', async () => {
    const transition = vi.fn();
    const result = await runOverdueDetectionCycle(options, { loadOverdueLoanIds: async () => [], transition });
    expect(result).toEqual({ processed: 0, transitioned: 0, skipped: false });
    expect(transition).not.toHaveBeenCalled();
  });

  it('skips a cycle already being processed by another runner', async () => {
    const result = await runOverdueDetectionCycle(options, { loadOverdueLoanIds: async () => null });
    expect(result.skipped).toBe(true);
    expect(result.processed).toBe(0);
  });

  it('does not execute a cycle when the scheduler lock is unavailable', async () => {
    const loadOverdueLoanIds = vi.fn(async () => ['loan-1']);
    const result = await runOverdueDetectionCycle(options, {
      loadOverdueLoanIds,
      acquireLock: async () => null,
    });
    expect(result).toEqual({ processed: 0, transitioned: 0, skipped: true });
    expect(loadOverdueLoanIds).not.toHaveBeenCalled();
  });
});