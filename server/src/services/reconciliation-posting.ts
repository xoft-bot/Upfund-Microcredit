import type { DbClient } from '../db.js';
import { insertAuditEvent, withTransaction } from '../db.js';
import { postLedgerTransactionOnClient } from './ledger.js';
import { allocateRealizedSurplus } from './allocation.js';
import { calculateReconciliation } from './reconciliation.js';
import { realizedChargeFromComponents } from './payment-allocation.js';

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
  decision?: 'approve' | 'reject';
  decisionReason?: string;
  correlationId: string;
}

type Policy = { version: string; credit_loss_bps: number; operating_bps: number; collection_bps: number; growth_bps: number };
type Pool = { id: string; pool_type: 'credit_loss_reserve' | 'operating_reserve' | 'collection' | 'growth'; balance: number };
export interface ReconciliationPostResult {
  reconciliationId: string;
  status: string;
  variance: number;
  allocation?: ReturnType<typeof allocateRealizedSurplus>;
  ledgerTransactionId?: string;
  created?: boolean;
  decisionReason?: string | null;
}

export async function postReconciliationBatch(input: ReconciliationPostInput): Promise<ReconciliationPostResult> {
  return withTransaction(async (client) => postReconciliationBatchOnClient(client, input));
}

async function postReconciliationBatchOnClient(client: DbClient, input: ReconciliationPostInput): Promise<ReconciliationPostResult> {
  const result = calculateReconciliation(input);
  const reason = input.decisionReason?.trim() ?? '';
  if (result.status === 'variance' && input.decision !== 'reject' && (!input.managerOverride || !['admin', 'manager'].includes(input.actorRole))) throw new Error('RECONCILIATION_VARIANCE_REQUIRES_MANAGER_OVERRIDE');
  if (result.status === 'variance' && !['admin', 'manager'].includes(input.actorRole)) throw new Error('RECONCILIATION_VARIANCE_REQUIRES_MANAGER_OVERRIDE');
  if (result.status === 'variance' && !input.decision) throw new Error('RECONCILIATION_DECISION_REQUIRED');
  if (result.status === 'variance' && !reason) throw new Error('RECONCILIATION_DECISION_REASON_REQUIRED');

  const existingResult = await client.query<{
    id: string;
    branch_id: string;
    expected_amount: string;
    recorded_amount: string;
    submitted_amount: string;
    variance: string;
    status: 'pending' | 'matched' | 'variance' | 'approved' | 'rejected';
    decision_reason: string | null;
  }>(
    `SELECT id, branch_id, expected_amount, recorded_amount, submitted_amount, variance, status, decision_reason
       FROM reconciliations
      WHERE batch_reference = $1
      FOR UPDATE`,
    [input.batchReference],
  );
  let reconciliationId: string;
  if (existingResult.rowCount) {
    const existing = existingResult.rows[0];
    const sameFacts = existing.branch_id === input.branchId
      && Number(existing.expected_amount) === result.expectedAmount
      && Number(existing.recorded_amount) === result.recordedAmount
      && Number(existing.submitted_amount) === result.submittedAmount
      && Number(existing.variance) === result.variance;
    if (!sameFacts) throw new Error('RECONCILIATION_BATCH_STALE');
    if (['matched', 'approved', 'rejected'].includes(existing.status)) {
      return { reconciliationId: existing.id, status: existing.status, variance: Number(existing.variance), created: false, decisionReason: existing.decision_reason };
    }
    reconciliationId = existing.id;
  } else {
    const reconciliation = await client.query<{ id: string }>(
      `INSERT INTO reconciliations (branch_id, batch_reference, expected_amount, recorded_amount, submitted_amount, variance, status, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::reconciliation_status, $8) RETURNING id`,
      [input.branchId, input.batchReference, result.expectedAmount, result.recordedAmount, result.submittedAmount, result.variance, result.status, input.actorUserId],
    );
    reconciliationId = reconciliation.rows[0].id;
  }
  for (const paymentId of input.paymentIds) {
    await client.query('INSERT INTO reconciliation_payments (reconciliation_id, payment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [reconciliationId, paymentId]);
  }

  if (result.status === 'variance' && input.decision === 'reject') {
    await client.query(`UPDATE reconciliations SET status = 'rejected', decision_reason = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3`, [reason, input.actorUserId, reconciliationId]);
    await insertAuditEvent(client, {
      actorUserId: input.actorUserId,
      action: 'reconciliation.batch.rejected',
      entityType: 'reconciliation',
      entityId: reconciliationId,
      correlationId: input.correlationId,
      metadata: { variance: result.variance, reason },
    });
    return { reconciliationId, status: 'rejected', variance: result.variance, created: true, decisionReason: reason };
  }

  const status = result.status === 'variance' ? 'approved' : 'matched';
  if (result.status === 'variance') {
    await client.query(`UPDATE reconciliations SET status = 'approved', decision_reason = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3`, [reason, input.actorUserId, reconciliationId]);
  }
  const policyRow = await client.query<Policy>('SELECT version, credit_loss_bps, operating_bps, collection_bps, growth_bps FROM allocation_policies WHERE version = $1 FOR UPDATE', [input.policyVersion]);
  if (!policyRow.rowCount) throw new Error('ALLOCATION_POLICY_NOT_FOUND');
  const policy = policyRow.rows[0];
  const paymentTotals = await client.query<{
    principal_amount: string;
    penalty_amount: string;
    interest_amount: string;
    overpayment_amount: string;
  }>(
    `SELECT
       COALESCE(SUM(p.principal_amount), 0) AS principal_amount,
       COALESCE(SUM(p.penalty_amount), 0) AS penalty_amount,
       COALESCE(SUM(p.interest_amount), 0) AS interest_amount,
       COALESCE(SUM(p.overpayment_amount), 0) AS overpayment_amount
     FROM reconciliation_payments rp
     JOIN payments p ON p.id = rp.payment_id
     WHERE rp.reconciliation_id = $1`,
    [reconciliationId],
  );
  const totals = paymentTotals.rows[0];
   const realizedCharge = realizedChargeFromComponents({
     principalAmount: Number(totals.principal_amount),
     penaltyAmount: Number(totals.penalty_amount),
     interestAmount: Number(totals.interest_amount),
     overpaymentAmount: Number(totals.overpayment_amount),
   });
  const allocation = allocateRealizedSurplus(realizedCharge, { version: policy.version, creditLossBps: Number(policy.credit_loss_bps), operatingBps: Number(policy.operating_bps), collectionBps: Number(policy.collection_bps), growthBps: Number(policy.growth_bps) });
  const pools = await client.query<Pool>(`SELECT id, pool_type, balance FROM capital_pools WHERE branch_id = $1 AND pool_type IN ('credit_loss_reserve', 'operating_reserve', 'collection', 'growth') ORDER BY pool_type FOR UPDATE`, [input.branchId]);
  if (pools.rowCount !== 4) throw new Error('CAPITAL_POOLS_NOT_INITIALIZED');
  const ledger = await postLedgerTransactionOnClient(client, {
    actorUserId: input.actorUserId,
    sourceType: 'reconciliation_batch',
    sourceId: reconciliationId,
    idempotencyKey: `reconciliation-ledger:${input.batchReference}`,
    correlationId: input.correlationId,
    description: 'Reconciliation cash transfer and realized surplus allocation',
    lines: [
      { accountCode: 'cash.reconciled', side: 'debit', amount: result.recordedAmount },
      { accountCode: 'cash.manual', side: 'credit', amount: result.recordedAmount },
      ...(Number(totals.penalty_amount) > 0 ? [{ accountCode: 'realized.penalty', side: 'debit' as const, amount: Number(totals.penalty_amount) }] : []),
      ...(Number(totals.interest_amount) > 0 ? [{ accountCode: 'realized.interest', side: 'debit' as const, amount: Number(totals.interest_amount) }] : []),
      ...(allocation.creditLossReserve > 0 ? [{ accountCode: 'pool.credit_loss_reserve', side: 'credit' as const, amount: allocation.creditLossReserve }] : []),
      ...(allocation.operatingReserve > 0 ? [{ accountCode: 'pool.operating_reserve', side: 'credit' as const, amount: allocation.operatingReserve }] : []),
      ...(allocation.collectionCost > 0 ? [{ accountCode: 'pool.collection', side: 'credit' as const, amount: allocation.collectionCost }] : []),
      ...(allocation.growthCapital > 0 ? [{ accountCode: 'pool.growth_capital', side: 'credit' as const, amount: allocation.growthCapital }] : []),
      ...(allocation.retainedProfit > 0 ? [{ accountCode: 'retained.profit', side: 'credit' as const, amount: allocation.retainedProfit }] : []),
    ],
  });
  const amounts = new Map<Pool['pool_type'], number>([['credit_loss_reserve', allocation.creditLossReserve], ['operating_reserve', allocation.operatingReserve], ['collection', allocation.collectionCost], ['growth', allocation.growthCapital]]);
  for (const pool of pools.rows) {
    const amount = amounts.get(pool.pool_type) ?? 0;
    if (amount > 0) {
      await client.query('UPDATE capital_pools SET balance = balance + $1, version = version + 1 WHERE id = $2', [amount, pool.id]);
      await client.query('INSERT INTO pool_allocations (ledger_transaction_id, capital_pool_id, amount, policy_version) VALUES ($1, $2, $3, $4)', [ledger.transactionId, pool.id, amount, policy.version]);
    }
  }
  await insertAuditEvent(client, {
    actorUserId: input.actorUserId,
    action: 'reconciliation.batch.posted',
    entityType: 'reconciliation',
    entityId: reconciliationId,
    correlationId: input.correlationId,
    metadata: {
      variance: result.variance,
      ledgerTransactionId: ledger.transactionId,
      policyVersion: policy.version,
      principalCollected: Number(totals.principal_amount),
      realizedCharge,
      overpaymentHeld: Number(totals.overpayment_amount),
    },
  });
  return { reconciliationId, status, variance: result.variance, allocation, ledgerTransactionId: ledger.transactionId, created: true, decisionReason: result.status === 'variance' ? reason : null };
}
