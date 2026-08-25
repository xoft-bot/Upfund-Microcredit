import type { DbClient } from '../db.js';
import { insertAuditEvent, withTransaction } from '../db.js';
import { postLedgerTransactionOnClient } from './ledger.js';
import { allocateRealizedSurplus } from './allocation.js';
import { calculateReconciliation } from './reconciliation.js';

export interface ReconciliationPostInput {
  actorUserId: string;
  actorRole: 'admin' | 'manager';
  branchId: string;
  batchReference: string;
  expectedAmount: number;
  recordedAmount: number;
  submittedAmount: number;
  paymentIds: string[];
  policyVersion: string;
  managerOverride: boolean;
  correlationId: string;
}

export async function postReconciliationBatch(input: ReconciliationPostInput) {
  return withTransaction(async (client) => postReconciliationBatchOnClient(client, input));
}

async function postReconciliationBatchOnClient(client: DbClient, input: ReconciliationPostInput) {
  const result = calculateReconciliation(input);
  if (result.status === 'variance' && (!input.managerOverride || !['admin', 'manager'].includes(input.actorRole))) throw new Error('RECONCILIATION_VARIANCE_REQUIRES_MANAGER_OVERRIDE');
  const status = result.status === 'variance' ? 'approved' : 'matched';
  const reconciliation = await client.query<{ id: string }>(
    `INSERT INTO reconciliations (branch_id, batch_reference, expected_amount, recorded_amount, submitted_amount, variance, status, submitted_by, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::reconciliation_status, $8, $9, CASE WHEN $7 = 'approved' THEN now() ELSE NULL END) RETURNING id`,
    [input.branchId, input.batchReference, result.expectedAmount, result.recordedAmount, result.submittedAmount, result.variance, status, input.actorUserId, status === 'approved' ? input.actorUserId : null],
  );
  const reconciliationId = reconciliation.rows[0].id;
  for (const paymentId of input.paymentIds) await client.query('INSERT INTO reconciliation_payments (reconciliation_id, payment_id) VALUES ($1, $2)', [reconciliationId, paymentId]);
  const allocation = allocateRealizedSurplus(result.recordedAmount, { version: input.policyVersion, creditLossBps: 1_000, operatingBps: 2_000, collectionBps: 1_500, growthBps: 2_500 });
  const ledger = await postLedgerTransactionOnClient(client, { actorUserId: input.actorUserId, sourceType: 'reconciliation_batch', sourceId: reconciliationId, idempotencyKey: `reconciliation-ledger:${input.batchReference}`, correlationId: input.correlationId, description: 'Realized surplus allocation', lines: [{ accountCode: 'cash.reconciled', side: 'debit', amount: result.recordedAmount }, { accountCode: 'pool.credit_loss_reserve', side: 'credit', amount: allocation.creditLossReserve }, { accountCode: 'pool.operating_reserve', side: 'credit', amount: allocation.operatingReserve }, { accountCode: 'pool.collection_cost', side: 'credit', amount: allocation.collectionCost }, { accountCode: 'pool.growth_capital', side: 'credit', amount: allocation.growthCapital }, ...(allocation.retainedProfit ? [{ accountCode: 'retained.profit', side: 'credit' as const, amount: allocation.retainedProfit }] : [])] });
  await insertAuditEvent(client, { actorUserId: input.actorUserId, action: 'reconciliation.batch.posted', entityType: 'reconciliation', entityId: reconciliationId, correlationId: input.correlationId, metadata: { variance: result.variance, ledgerTransactionId: ledger.transactionId, policyVersion: input.policyVersion } });
  return { reconciliationId, status, variance: result.variance, allocation, ledgerTransactionId: ledger.transactionId };
}
