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

type Policy = { version: string; credit_loss_bps: number; operating_bps: number; collection_bps: number; growth_bps: number };
type Pool = { id: string; pool_type: 'credit_loss_reserve' | 'operating_reserve' | 'collection' | 'growth'; balance: number };

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
  const policyRow = await client.query<Policy>('SELECT version, credit_loss_bps, operating_bps, collection_bps, growth_bps FROM allocation_policies WHERE version = $1 FOR UPDATE', [input.policyVersion]);
  if (!policyRow.rowCount) throw new Error('ALLOCATION_POLICY_NOT_FOUND');
  const policy = policyRow.rows[0];
  const allocation = allocateRealizedSurplus(result.recordedAmount, { version: policy.version, creditLossBps: Number(policy.credit_loss_bps), operatingBps: Number(policy.operating_bps), collectionBps: Number(policy.collection_bps), growthBps: Number(policy.growth_bps) });
  const pools = await client.query<Pool>(`SELECT id, pool_type, balance FROM capital_pools WHERE branch_id = $1 AND pool_type IN ('credit_loss_reserve', 'operating_reserve', 'collection', 'growth') ORDER BY pool_type FOR UPDATE`, [input.branchId]);
  if (pools.rowCount !== 4) throw new Error('CAPITAL_POOLS_NOT_INITIALIZED');
  const ledger = await postLedgerTransactionOnClient(client, { actorUserId: input.actorUserId, sourceType: 'reconciliation_batch', sourceId: reconciliationId, idempotencyKey: `reconciliation-ledger:${input.batchReference}`, correlationId: input.correlationId, description: 'Realized surplus allocation', lines: [{ accountCode: 'cash.reconciled', side: 'debit', amount: result.recordedAmount }, { accountCode: 'pool.credit_loss_reserve', side: 'credit', amount: allocation.creditLossReserve }, { accountCode: 'pool.operating_reserve', side: 'credit', amount: allocation.operatingReserve }, { accountCode: 'pool.collection', side: 'credit', amount: allocation.collectionCost }, { accountCode: 'pool.growth_capital', side: 'credit', amount: allocation.growthCapital }, ...(allocation.retainedProfit ? [{ accountCode: 'retained.profit', side: 'credit' as const, amount: allocation.retainedProfit }] : [])] });
  const amounts = new Map<Pool['pool_type'], number>([['credit_loss_reserve', allocation.creditLossReserve], ['operating_reserve', allocation.operatingReserve], ['collection', allocation.collectionCost], ['growth', allocation.growthCapital]]);
  for (const pool of pools.rows) {
    const amount = amounts.get(pool.pool_type) ?? 0;
    if (amount > 0) {
      await client.query('UPDATE capital_pools SET balance = balance + $1, version = version + 1 WHERE id = $2', [amount, pool.id]);
      await client.query('INSERT INTO pool_allocations (ledger_transaction_id, capital_pool_id, amount, policy_version) VALUES ($1, $2, $3, $4)', [ledger.transactionId, pool.id, amount, policy.version]);
    }
  }
  await insertAuditEvent(client, { actorUserId: input.actorUserId, action: 'reconciliation.batch.posted', entityType: 'reconciliation', entityId: reconciliationId, correlationId: input.correlationId, metadata: { variance: result.variance, ledgerTransactionId: ledger.transactionId, policyVersion: policy.version } });
  return { reconciliationId, status, variance: result.variance, allocation, ledgerTransactionId: ledger.transactionId };
}
