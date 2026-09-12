import { randomUUID } from 'node:crypto';
import type { DbClient } from '../db.js';
import { insertAuditEvent, withTransaction } from '../db.js';
import { postLedgerTransactionOnClient } from './ledger.js';
import { allocatePaymentWaterfall } from './payment-allocation.js';

type PaymentMethod = 'cash' | 'mobile_money';

export interface ManualPaymentInput {
  actorUserId: string;
  loanId: string;
  branchId: string;
  amount: number;
  idempotencyKey: string;
  receiptReference?: string;
  correlationId: string;
  localId?: string;
  clientId?: string;
  deviceId?: string;
  paymentMethod?: PaymentMethod;
  capturedAt?: string;
}

export interface ManualPaymentResult {
  paymentId: string;
  receiptReference: string;
  principalAmount: number;
  penaltyAmount?: number;
  interestAmount?: number;
  chargeAmount: number;
  overpaymentAmount?: number;
  outstandingPrincipal: number;
  loanStatus: string;
  ledgerTransactionId: string;
  created: boolean;
}

function validAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID_PAYMENT_AMOUNT');
}

function validPaymentMethod(method: PaymentMethod | undefined): void {
  if (method !== undefined && method !== 'cash' && method !== 'mobile_money') throw new Error('INVALID_PAYMENT_METHOD');
}

function normalizedCapturedAt(capturedAt: string | undefined): string {
  if (!capturedAt) return new Date().toISOString();
  const parsed = new Date(capturedAt);
  if (Number.isNaN(parsed.getTime())) throw new Error('INVALID_CAPTURED_AT');
  return parsed.toISOString();
}

async function persistFieldCollectionSource(
  client: DbClient,
  input: ManualPaymentInput,
  paymentId: string,
): Promise<void> {
  if (!input.localId) return;
  const paymentMethod = input.paymentMethod ?? 'manual';
  const existing = await client.query<{
    id: string;
    payment_id: string | null;
    branch_id: string;
    idempotency_key: string;
    amount: number;
    device_id: string;
    captured_at: Date;
    client_id: string | null;
    loan_id: string | null;
    collector_id: string | null;
    payment_method: string | null;
  }>(
    `SELECT id, payment_id, branch_id, idempotency_key, amount, device_id, captured_at,
            client_id, loan_id, collector_id, payment_method
       FROM field_collection_records
      WHERE local_id = $1 OR idempotency_key = $2
      FOR UPDATE`,
    [input.localId, input.idempotencyKey],
  );
  if (existing.rowCount) {
    const source = existing.rows[0];
    const capturedAt = input.capturedAt ? normalizedCapturedAt(input.capturedAt) : null;
    const sameCapture = source.payment_id === paymentId
      && source.branch_id === input.branchId
      && source.idempotency_key === input.idempotencyKey
      && Number(source.amount) === input.amount
      && source.device_id === (input.deviceId ?? 'unknown')
      && (!capturedAt || source.captured_at.toISOString() === capturedAt)
      && source.client_id === (input.clientId ?? null)
      && source.loan_id === input.loanId
      && source.collector_id === input.actorUserId
      && source.payment_method === paymentMethod;
    if (!sameCapture) throw new Error('FIELD_COLLECTION_CONFLICT');
    await client.query(
      `UPDATE field_collection_records
          SET synced_at = COALESCE(synced_at, now())
        WHERE id = $1`,
      [source.id],
    );
    return;
  }
  await client.query(
    `INSERT INTO field_collection_records
      (branch_id, payment_id, local_id, idempotency_key, amount, status, device_id,
       captured_at, client_id, loan_id, collector_id, payment_method, correlation_id, synced_at)
     VALUES ($1, $2, $3, $4, $5, 'pending_reconciliation', $6, $7, $8, $9, $10, $11, $12, now())
      `,
    [
      input.branchId,
      paymentId,
      input.localId,
      input.idempotencyKey,
      input.amount,
      input.deviceId ?? 'unknown',
      normalizedCapturedAt(input.capturedAt),
      input.clientId ?? null,
      input.loanId,
      input.actorUserId,
      paymentMethod,
      input.correlationId,
    ],
  );
}

export async function postManualPayment(input: ManualPaymentInput): Promise<ManualPaymentResult> {
  validAmount(input.amount);
  validPaymentMethod(input.paymentMethod);
  return withTransaction(async (client) => postManualPaymentOnClient(client, input));
}

export async function postManualPaymentOnClient(client: DbClient, input: ManualPaymentInput): Promise<ManualPaymentResult> {
  validAmount(input.amount);
  validPaymentMethod(input.paymentMethod);
  const loan = await client.query<{ id: string; branch_id: string; client_id: string; outstanding_principal: number; status: string }>(
    `SELECT id, branch_id, client_id, outstanding_principal, status FROM loans WHERE id = $1 FOR UPDATE`, [input.loanId],
  );
  if (!loan.rowCount || loan.rows[0].branch_id !== input.branchId) throw new Error('LOAN_NOT_FOUND_OR_BRANCH_DENIED');
  if (input.clientId && loan.rows[0].client_id !== input.clientId) throw new Error('LOAN_CLIENT_MISMATCH');
  const existing = await client.query<{ id: string; receipt_reference: string; principal_amount: number; penalty_amount: number; interest_amount: number; charge_amount: number; overpayment_amount: number; outstanding_principal: number; status: string; ledger_transaction_id: string }>(
    `SELECT p.id, p.receipt_reference, p.principal_amount, p.penalty_amount, p.interest_amount,
            p.charge_amount, p.overpayment_amount, l.outstanding_principal, l.status,
            lt.id AS ledger_transaction_id
     FROM payments p JOIN loans l ON l.id = p.loan_id JOIN ledger_transactions lt ON lt.source_id = p.id AND lt.source_type = 'manual_payment'
     WHERE p.idempotency_key = $1 FOR UPDATE`, [input.idempotencyKey],
  );
  if (existing.rowCount) {
    await persistFieldCollectionSource(client, input, existing.rows[0].id);
    return {
      paymentId: existing.rows[0].id,
      receiptReference: existing.rows[0].receipt_reference,
      principalAmount: Number(existing.rows[0].principal_amount),
      penaltyAmount: Number(existing.rows[0].penalty_amount),
      interestAmount: Number(existing.rows[0].interest_amount),
      chargeAmount: Number(existing.rows[0].charge_amount),
      overpaymentAmount: Number(existing.rows[0].overpayment_amount),
      outstandingPrincipal: Number(existing.rows[0].outstanding_principal),
      loanStatus: existing.rows[0].status,
      ledgerTransactionId: existing.rows[0].ledger_transaction_id,
      created: false,
    };
  }

  const schedule = await client.query<{
    id: string;
    principal_due: number;
    principal_paid: number;
    penalty_due: number;
    penalty_paid: number;
    interest_due: number;
    interest_paid: number;
    charge_due: number;
    charge_paid: number;
  }>(
    `SELECT id, principal_due, principal_paid, penalty_due, penalty_paid, interest_due, interest_paid, charge_due, charge_paid
       FROM repayment_schedules
     WHERE loan_id = $1 AND status = 'open' ORDER BY due_on, id LIMIT 1 FOR UPDATE`, [input.loanId],
  );
  if (!schedule.rowCount) throw new Error('NO_OPEN_REPAYMENT_SCHEDULE');
  const installment = schedule.rows[0];
  const principalRemaining = Math.max(Number(installment.principal_due) - Number(installment.principal_paid), 0);
  const penaltyRemaining = Math.max(Number(installment.penalty_due) - Number(installment.penalty_paid), 0);
  const hasExplicitComponents = Number(installment.penalty_due) > 0 || Number(installment.interest_due) > 0;
  const interestDue = hasExplicitComponents ? Number(installment.interest_due) : Number(installment.charge_due);
  const interestPaid = hasExplicitComponents ? Number(installment.interest_paid) : Number(installment.charge_paid);
  const interestRemaining = Math.max(interestDue - interestPaid, 0);
  const allocation = allocatePaymentWaterfall({ amount: input.amount, principalRemaining, penaltyRemaining, interestRemaining });
  const receiptReference = input.receiptReference ?? `RCT-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const payment = await client.query<{ id: string }>(
    `INSERT INTO payments
      (loan_id, branch_id, amount, idempotency_key, receipt_reference, recorded_by, status, method,
       principal_amount, penalty_amount, interest_amount, charge_amount, overpayment_amount, schedule_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'posted', $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      input.loanId,
      input.branchId,
      input.amount,
      input.idempotencyKey,
      receiptReference,
      input.actorUserId,
      input.paymentMethod ?? 'manual',
      allocation.principalAmount,
      allocation.penaltyAmount,
      allocation.interestAmount,
      allocation.chargeAmount,
      allocation.overpaymentAmount,
      installment.id,
    ],
  );
  const paymentId = payment.rows[0].id;
  await client.query(`INSERT INTO receipts (payment_id, receipt_reference) VALUES ($1, $2)`, [paymentId, receiptReference]);
  const updated = await client.query<{ outstanding_principal: number; status: string }>(
    `UPDATE loans SET outstanding_principal = outstanding_principal - $1, status = CASE WHEN outstanding_principal - $1 = 0 THEN 'completed'::loan_status ELSE 'active'::loan_status END, version = version + 1
      WHERE id = $2 AND outstanding_principal >= $1 RETURNING outstanding_principal, status`, [allocation.principalAmount, input.loanId],
  );
  if (!updated.rowCount) throw new Error('LOAN_BALANCE_GUARD_FAILED');
  const scheduleUpdate = await client.query<{ principal_paid: number; penalty_paid: number; interest_paid: number; charge_paid: number }>(
    `UPDATE repayment_schedules
        SET principal_paid = principal_paid + $1,
            penalty_paid = penalty_paid + $2,
            interest_paid = interest_paid + $3,
            charge_paid = charge_paid + $4,
            status = $5
      WHERE id = $6
      RETURNING principal_paid, penalty_paid, interest_paid, charge_paid`,
    [
      allocation.principalAmount,
      allocation.penaltyAmount,
      allocation.interestAmount,
      allocation.chargeAmount,
      allocation.principalAmount >= principalRemaining
        && allocation.penaltyAmount >= penaltyRemaining
        && allocation.interestAmount >= interestRemaining ? 'paid' : 'open',
      installment.id,
    ],
  );
  if (!scheduleUpdate.rowCount) throw new Error('SCHEDULE_UPDATE_FAILED');
  const creditLines = [
    { accountCode: 'loan.principal', side: 'credit' as const, amount: allocation.principalAmount },
    { accountCode: 'realized.penalty', side: 'credit' as const, amount: allocation.penaltyAmount },
    { accountCode: 'realized.interest', side: 'credit' as const, amount: allocation.interestAmount },
    { accountCode: 'overpayment.holding', side: 'credit' as const, amount: allocation.overpaymentAmount },
  ].filter((line) => line.amount > 0);
  const ledger = await postLedgerTransactionOnClient(client, { actorUserId: input.actorUserId, sourceType: 'manual_payment', sourceId: paymentId, idempotencyKey: `payment-ledger:${input.idempotencyKey}`, correlationId: input.correlationId, description: 'Manual payment posting', lines: [{ accountCode: 'cash.manual', side: 'debit', amount: input.amount }, ...creditLines] });
  if (allocation.overpaymentAmount > 0) {
    await client.query(
      `INSERT INTO overpayment_holdings (payment_id, loan_id, branch_id, amount)
       VALUES ($1, $2, $3, $4)`,
      [paymentId, input.loanId, input.branchId, allocation.overpaymentAmount],
    );
  }
  await persistFieldCollectionSource(client, input, paymentId);
  await client.query(`UPDATE payments SET status = 'posted' WHERE id = $1`, [paymentId]);
  await insertAuditEvent(client, {
    actorUserId: input.actorUserId,
    action: 'payment.posted',
    entityType: 'payment',
    entityId: paymentId,
    correlationId: input.correlationId,
    metadata: {
      loanId: input.loanId,
      principalAmount: allocation.principalAmount,
      penaltyAmount: allocation.penaltyAmount,
      interestAmount: allocation.interestAmount,
      chargeAmount: allocation.chargeAmount,
      overpaymentAmount: allocation.overpaymentAmount,
      receiptReference,
    },
  });
  return {
    paymentId,
    receiptReference,
    principalAmount: allocation.principalAmount,
    penaltyAmount: allocation.penaltyAmount,
    interestAmount: allocation.interestAmount,
    chargeAmount: allocation.chargeAmount,
    overpaymentAmount: allocation.overpaymentAmount,
    outstandingPrincipal: Number(updated.rows[0].outstanding_principal),
    loanStatus: updated.rows[0].status,
    ledgerTransactionId: ledger.transactionId,
    created: true,
  };
}
