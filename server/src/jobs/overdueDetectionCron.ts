import { withAdvisoryLock, pool } from '../db.js';
import { transitionLoan } from '../services/lifecycle.js';
import type { Actor } from '../../../shared/contracts.js';

export interface OverdueDetectionCronOptions {
  actorUserId: string;
  asOf?: Date;
}
export interface OverdueDetectionCronDependencies {
  loadOverdueLoanIds?: (asOf: Date) => Promise<string[] | null>;
  transition?: (actor: Actor, loanId: string, reason: string) => Promise<unknown>;
  acquireLock?: <T>(work: () => Promise<T>) => Promise<T | null>;
}
export interface OverdueDetectionCronResult { processed: number; transitioned: number; skipped: boolean; }

async function loadOverdueLoanIds(asOf: Date): Promise<string[] | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT DISTINCT l.id
       FROM loans l
       JOIN repayment_schedules s ON s.loan_id = l.id
      WHERE l.status = 'active'
        AND s.status = 'open'
        AND s.due_on < $1`,
    [asOf],
  );
  return result.rows.map((row) => row.id);
}

function systemActor(actorUserId: string): Actor {
  return { userId: actorUserId, dbUserId: actorUserId, firebaseUid: 'system-cron', role: 'admin', branchId: null, clientId: null, permissions: [] };
}

export async function runOverdueDetectionCycle(options: OverdueDetectionCronOptions, dependencies: OverdueDetectionCronDependencies = {}): Promise<OverdueDetectionCronResult> {
  const run = async (): Promise<OverdueDetectionCronResult> => {
    const asOf = options.asOf ?? new Date();
    const loanIds = await (dependencies.loadOverdueLoanIds ?? loadOverdueLoanIds)(asOf);
    if (!loanIds) return { processed: 0, transitioned: 0, skipped: true };
    const actor = systemActor(options.actorUserId);
    const transition = dependencies.transition ?? ((a: Actor, loanId: string, reason: string) => transitionLoan(a, loanId, 'overdue', reason));
    let transitioned = 0;
    for (const loanId of loanIds) {
      await transition(actor, loanId, 'Installment past due — detected by automated job');
      transitioned += 1;
    }
    return { processed: loanIds.length, transitioned, skipped: false };
  };

  const acquireLock = dependencies.acquireLock ?? (dependencies.loadOverdueLoanIds
    ? ((work: () => Promise<OverdueDetectionCronResult>) => work())
    : ((work: () => Promise<OverdueDetectionCronResult>) => withAdvisoryLock('letsgrow:overdue-detection-cron', work)));
  const result = await acquireLock(run);
  return result ?? { processed: 0, transitioned: 0, skipped: true };
}