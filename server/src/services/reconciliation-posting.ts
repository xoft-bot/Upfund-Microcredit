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
  const isVariance = result.status === 'variance';
  // A variance is handled in two steps by two different people: a submission (no decision)
  // that holds the batch for review, then a decision recorded by someone other than the submitter.
  const isDecision = isVariance && input.decision !== undefined;
  if (isVariance && !['admin', 'manager'].includes(input.actorRole)) throw new Error('RECONCILIATION_VARIANCE_REQUIRES_MANAGER_OVERRIDE');
  if (isDecision && input.decision === 'approve' && !input.managerOverride) throw new Error('RECONCILIATION_VARIANCE_REQUIRES_MANAGER_OVERRIDE');
  if (isDecision && !reason) throw new Error('RECONCILIATION_DECISION_REASON_REQUIRED');

  const existingResult = await client.query<{
    id: string;
    branch_id: string;
    expected_amount: string;
    recorded_amount: string;
    submitted_amount: string;
    variance: string;
    status: 'pending' | 'matched' | 'variance' | 'approved' | 'rejected';
    decision_reason: string | null;
    submitted_by: string;
  }>(
    `SELECT id, branch_id, expected_amount, recorded_amount, submitted_amount, variance, status, decision_reason, submitted_by
       FROM reconciliations
      WHERE batch_reference = $1
      FOR UPDATE`,
    [input.batchReference],
  );
  let reconciliationId: string;
  let isRetryOfNonTerminalBatch = false;
  let existingSubmittedBy: string | null = null;
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
    // Re-submitting a batch that is already held for review changes nothing.
    if (isVariance && !isDecision) {
      return { reconciliationId: existing.id, status: existing.status, variance: Number(existing.variance), created: false };
    }
    reconciliationId = existing.id;
    isRetryOfNonTerminalBatch = true;
    existingSubmittedBy = existing.submitted_by;
  } else {
    // A decision needs a batch somebody else already submitted. Deciding a batch that this
    // very call would create makes the decider its submitter, which is self-approval.
    if (isDecision) throw new Error('RECONCILIATION_SELF_APPROVAL');
    await client.query('SAVEPOINT reconciliation_batch_insert');
    try {
      const reconciliation = await client.query<{ id: string }>(
        `INSERT INTO reconciliations (branch_id, batch_reference, expected_amount, recorded_amount, submitted_amount, variance, status, submitted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::reconciliation_status, $8) RETURNING id`,
        [input.branchId, input.batchReference, result.expectedAmount, result.recordedAmount, result.submittedAmount, result.variance, result.status, input.actorUserId],
      );
      reconciliationId = reconciliation.rows[0].id;
      await client.query('RELEASE SAVEPOINT reconciliation_batch_insert');
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      await client.query('ROLLBACK TO SAVEPOINT reconciliation_batch_insert');
      const concurrentResult = await client.query<typeof existingResult.rows[number]>(
        `SELECT id, branch_id, expected_amount, recorded_amount, submitted_amount, variance, status, decision_reason, submitted_by
           FROM reconciliations
          WHERE batch_reference = $1
          FOR UPDATE`,
        [input.batchReference],
      );
      if (!concurrentResult.rowCount) throw error;
      const concurrent = concurrentResult.rows[0];
      const sameFacts = concurrent.branch_id === input.branchId
        && Number(concurrent.expected_amount) === result.expectedAmount
        && Number(concurrent.recorded_amount) === result.recordedAmount
        && Number(concurrent.submitted_amount) === result.submittedAmount
        && Number(concurrent.variance) === result.variance;
      if (!sameFacts) throw new Error('RECONCILIATION_BATCH_STALE');
      if (['matched', 'approved', 'rejected'].includes(concurrent.status)) {
        return { reconciliationId: concurrent.id, status: concurrent.status, variance: Number(concurrent.variance), created: false, decisionReason: concurrent.decision_reason };
      }
      if (isVariance && !isDecision) {
        return { reconciliationId: concurrent.id, status: concurrent.status, variance: Number(concurrent.variance), created: false };
      }
      reconciliationId = concurrent.id;
      isRetryOfNonTerminalBatch = true;
      existingSubmittedBy = concurrent.submitted_by;
      await client.query('RELEASE SAVEPOINT reconciliation_batch_insert');
    }
  }

  // Segregation of duties: whoever submitted a batch cannot decide it. A decision on a batch that
  // does not exist yet was already rejected above, so here the row is always a pre-existing one.
  if (isDecision && existingSubmittedBy === input.actorUserId) {
    throw new Error('RECONCILIATION_SELF_APPROVAL');
  }

  // Bug #2 fix: validate every paymentId exists, belongs to this branch, and
  // isn't already attached to a different reconciliation batch. Without this,
  // a cross-branch payment silently realizes into the wrong branch's pools,
  // and a payment already reconciled elsewhere silently no-ops (via the
  // ON CONFLICT below) instead of surfacing an error — undercounting totals
  // with no signal to the caller.
  // A repeated id must neither trip the count check below nor be able to inflate a total.
  const paymentIds = [...new Set(input.paymentIds)];

  // A decision call (or any retry) on a batch that already exists must review the exact
  // payment set that was originally submitted. Without this, sameFacts only compares the
  // three amount totals — a caller can approve/reject with a *different* set of payments
  // that happens to add up to the same recordedAmount, and the INSERT below (ON CONFLICT
  // DO NOTHING) only skips exact duplicates, so the new set gets attached ALONGSIDE the
  // original instead of replacing it. The realized-charge computation then sums every
  // payment ever attached to this reconciliation, silently including payments nobody
  // actually reviewed in this decision.
  if (isRetryOfNonTerminalBatch) {
    const attached = await client.query<{ payment_id: string }>(
      `SELECT payment_id FROM reconciliation_payments WHERE reconciliation_id = $1`,
      [reconciliationId],
    );
    const attachedIds = attached.rows.map((row) => row.payment_id);
    const sameSet = attachedIds.length === paymentIds.length
      && new Set(attachedIds).size === new Set(paymentIds).size
      && attachedIds.every((id) => paymentIds.includes(id));
    if (!sameSet) throw new Error('RECONCILIATION_PAYMENT_SET_MISMATCH');
  }

  if (paymentIds.length) {
    const paymentCheck = await client.query<{ id: string; amount: string }>(
      `SELECT id, amount FROM payments WHERE id = ANY($1::uuid[]) AND branch_id = $2`,
      [paymentIds, input.branchId],
    );
    if (paymentCheck.rowCount !== paymentIds.length) throw new Error('RECONCILIATION_PAYMENT_INVALID');

    // recordedAmount is what the ledger transfers from cash.manual to cash.reconciled, so it
    // must equal the stored total of the attached payments, never a caller-supplied figure.
    // (expectedAmount is schedule-derived and submittedAmount is the collector's own count;
    // both legitimately differ from the payment total and are what the variance measures.)
    const attachedTotal = paymentCheck.rows.reduce((sum, row) => sum + Number(row.amount), 0);
    if (attachedTotal !== result.recordedAmount) throw new Error('RECONCILIATION_RECORDED_AMOUNT_MISMATCH');

    const alreadyReconciled = await client.query<{ payment_id: string }>(
      `SELECT payment_id FROM reconciliation_payments WHERE payment_id = ANY($1::uuid[]) AND reconciliation_id != $2`,
      [paymentIds, reconciliationId],
    );
    if (alreadyReconciled.rowCount) throw new Error('RECONCILIATION_PAYMENT_ALREADY_RECONCILED');
  } else if (!(result.status === 'variance' && input.decision === 'reject')) {
    // Minor fix: a matched/approved batch with zero payments would otherwise
    // post a pure cash transfer with no realized allocation and no error.
    // Rejection is the one legitimate zero-payment case (nothing to attach
    // to a batch that's being kicked back).
    throw new Error('RECONCILIATION_NO_PAYMENTS');
  }

  for (const paymentId of paymentIds) {
    await client.query('INSERT INTO reconciliation_payments (reconciliation_id, payment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [reconciliationId, paymentId]);
  }

  if (isVariance && !isDecision) {
    await insertAuditEvent(client, {
      actorUserId: input.actorUserId,
      action: 'reconciliation.batch.submitted_for_review',
      entityType: 'reconciliation',
      entityId: reconciliationId,
      branchId: input.branchId,
      correlationId: input.correlationId,
      metadata: { batchReference: input.batchReference, variance: result.variance },
    });
    return { reconciliationId, status: 'variance', variance: result.variance, created: true };
  }

  if (isVariance && input.decision === 'reject') {
    await client.query(`UPDATE reconciliations SET status = 'rejected', decision_reason = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3`, [reason, input.actorUserId, reconciliationId]);
    await insertAuditEvent(client, {
      actorUserId: input.actorUserId,
      action: 'reconciliation.batch.rejected',
      entityType: 'reconciliation',
      entityId: reconciliationId,
      branchId: input.branchId,
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
    branchId: input.branchId,
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
  if (isRetryOfNonTerminalBatch && !ledger.created) {
    return { reconciliationId, status, variance: result.variance, created: false, ledgerTransactionId: ledger.transactionId, decisionReason: result.status === 'variance' ? reason : null };
  }
  const amounts = new Map<Pool['pool_type'], number>([['credit_loss_reserve', allocation.creditLossReserve], ['operating_reserve', allocation.operatingReserve], ['collection', allocation.collectionCost], ['growth', allocation.growthCapital]]);
  for (const pool of pools.rows) {
    const amount = amounts.get(pool.pool_type) ?? 0;
    if (amount > 0) {
      const allocationInsert = await client.query('INSERT INTO pool_allocations (ledger_transaction_id, capital_pool_id, amount, policy_version) VALUES ($1, $2, $3, $4) ON CONFLICT (ledger_transaction_id, capital_pool_id) DO NOTHING', [ledger.transactionId, pool.id, amount, policy.version]);
      if (allocationInsert.rowCount) {
        await client.query('UPDATE capital_pools SET balance = balance + $1, version = version + 1 WHERE id = $2', [amount, pool.id]);
      }
    }
  }
  await insertAuditEvent(client, {
    actorUserId: input.actorUserId,
    action: 'reconciliation.batch.posted',
    entityType: 'reconciliation',
    entityId: reconciliationId,
    branchId: input.branchId,
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
