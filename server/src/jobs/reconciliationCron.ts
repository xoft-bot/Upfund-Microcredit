import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db.js';
import { postReconciliationBatch } from '../services/reconciliation-posting.js';
import { calculateReconciliation } from '../services/reconciliation.js';
import { createVarianceAlert, quarantineVarianceBatchOnClient, type VarianceAlertSink } from '../services/varianceAlerting.js';

export interface Candidate { branchId: string; paymentId: string; amount: number; }
export interface BatchInput { branchId: string; paymentIds: string[]; expectedAmount: number; recordedAmount: number; submittedAmount: number; }
export interface ReconciliationCronOptions { actorUserId: string; policyVersion: string; asOf?: Date; varianceAlertThreshold?: number; }
export interface ReconciliationCronDependencies { loadCandidates?: (asOf: Date) => Promise<Candidate[] | null>; expectedForBranch?: (branchId: string, asOf: Date) => Promise<number>; postBatch?: typeof postReconciliationBatch; quarantine?: (input: BatchInput & { correlationId: string }) => Promise<void>; alertSink?: VarianceAlertSink; }
export interface ReconciliationCronResult { processed: number; posted: number; quarantined: number; skipped: boolean; }
const toNumber = (value: string | number | null): number => Number(value ?? 0);

async function loadCandidates(asOf: Date): Promise<Candidate[] | null> {
  return withTransaction(async (client) => {
    const lock = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext('letsgrow:reconciliation-cron')) AS locked`);
    if (!lock.rows[0].locked) return null;
    const result = await client.query<{ branch_id: string; payment_id: string; amount: string }>(`SELECT p.branch_id, p.id AS payment_id, p.amount FROM payments p WHERE p.status IN ('posted', 'verified') AND p.created_at <= $1 AND NOT EXISTS (SELECT 1 FROM reconciliation_payments rp WHERE rp.payment_id = p.id) AND NOT EXISTS (SELECT 1 FROM field_collection_records f WHERE f.payment_id = p.id) UNION ALL SELECT f.branch_id, f.payment_id, p.amount FROM field_collection_records f JOIN payments p ON p.id = f.payment_id WHERE f.status IN ('pending_reconciliation', 'recorded') AND f.captured_at <= $1 AND NOT EXISTS (SELECT 1 FROM reconciliation_payments rp WHERE rp.payment_id = p.id)`, [asOf]);
    return result.rows.map((row) => ({ branchId: row.branch_id, paymentId: row.payment_id, amount: toNumber(row.amount) }));
  });
}

async function defaultExpectedForBranch(branchId: string, asOf: Date): Promise<number> {
  return withTransaction(async (client) => { const result = await client.query<{ total: string }>(`SELECT COALESCE(SUM((principal_due - principal_paid) + (charge_due - charge_paid)), 0) AS total FROM repayment_schedules s JOIN loans l ON l.id = s.loan_id WHERE l.branch_id = $1 AND s.due_on <= $2 AND s.status = 'open'`, [branchId, asOf]); return toNumber(result.rows[0].total); });
}

function groupCandidates(candidates: Candidate[]): BatchInput[] { const groups = new Map<string, Candidate[]>(); for (const candidate of candidates) groups.set(candidate.branchId, [...(groups.get(candidate.branchId) ?? []), candidate]); return [...groups.entries()].map(([branchId, rows]) => ({ branchId, paymentIds: rows.map((row) => row.paymentId), expectedAmount: 0, recordedAmount: rows.reduce((sum, row) => sum + row.amount, 0), submittedAmount: rows.reduce((sum, row) => sum + row.amount, 0) })); }

export async function runReconciliationCycle(options: ReconciliationCronOptions, dependencies: ReconciliationCronDependencies = {}): Promise<ReconciliationCronResult> {
  const asOf = options.asOf ?? new Date(); const candidates = await (dependencies.loadCandidates ?? loadCandidates)(asOf); if (!candidates) return { processed: 0, posted: 0, quarantined: 0, skipped: true };
  const batches = groupCandidates(candidates); let posted = 0; let quarantined = 0;
  for (const batch of batches) {
    batch.expectedAmount = await (dependencies.expectedForBranch ?? defaultExpectedForBranch)(batch.branchId, asOf); const result = calculateReconciliation(batch); const correlationId = randomUUID(); const reference = `AUTO-${asOf.toISOString().slice(0, 10)}-${batch.branchId}`;
    if (result.status === 'matched') { await (dependencies.postBatch ?? postReconciliationBatch)({ actorUserId: options.actorUserId, actorRole: 'admin', branchId: batch.branchId, batchReference: reference, expectedAmount: result.expectedAmount, recordedAmount: result.recordedAmount, submittedAmount: result.submittedAmount, paymentIds: batch.paymentIds, policyVersion: options.policyVersion, managerOverride: false, correlationId }); posted += 1; continue; }
    const quarantineInput = { ...batch, batchReference: reference, correlationId, expectedAmount: result.expectedAmount, recordedAmount: result.recordedAmount, submittedAmount: result.submittedAmount, variance: result.variance }; if (dependencies.quarantine) await dependencies.quarantine(quarantineInput); else await withTransaction(async (client) => { await quarantineVarianceBatchOnClient(client, { actorUserId: options.actorUserId, branchId: batch.branchId, batchReference: reference, expectedAmount: result.expectedAmount, recordedAmount: result.recordedAmount, submittedAmount: result.submittedAmount, variance: result.variance, paymentIds: batch.paymentIds, correlationId }); });
    createVarianceAlert({ branchId: batch.branchId, batchReference: reference, variance: result.variance, threshold: options.varianceAlertThreshold ?? 0, correlationId }, dependencies.alertSink); quarantined += 1;
  }
  return { processed: batches.length, posted, quarantined, skipped: false };
}
