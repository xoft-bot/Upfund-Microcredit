import { randomUUID } from 'node:crypto';
import type { DbClient } from '../db.js';
import { insertAuditEvent, withTransaction } from '../db.js';
import { postLedgerTransactionOnClient } from './ledger.js';

export interface ManualPaymentInput {
  actorUserId: string;
  loanId: string;
  branchId: string;
  amount: number;
  idempotencyKey: string;
  receiptReference?: string;
  correlationId: string;
}

export interface ManualPaymentResult {
  paymentId: string;
  receiptReference: string;
  principalAmount: number;
  chargeAmount: number;
  outstandingPrincipal: number;
  loanStatus: string;
  ledgerTransactionId: string;
  created: boolean;
}

function validAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID_PAYMENT_AMOUNT');
}

export async function postManualPayment(input: ManualPaymentInput): Promise<ManualPaymentResult> {
  validAmount(input.amount);
  return withTransaction(async (client) => postManualPaymentOnClient(client, input));
}

export async function postManualPaymentOnClient(client: DbClient, input: ManualPaymentInput): Promise<ManualPaymentResult> {
  validAmount(input.amount);
  const loan = await client.query<{ id: string; branch_id: string; outstanding_principal: number; status: string }>(
    `SELECT id, branch_id, outstanding_principal, status FROM loans WHERE id = $1 FOR UPDATE`, [input.loanId],
  );
  if (!loan.rowCount || loan.rows[0].branch_id !== input.branchId) throw new Error('LOAN_NOT_FOUND_OR_BRANCH_DENIED');
  const existing = await client.query<{ id: string; receipt_reference: string; principal_amount: number; charge_amount: number; outstanding_principal: number; status: string; ledger_transaction_id: string }>(
    `SELECT p.id, p.receipt_reference, p.principal_amount, p.charge_amount, l.outstanding_principal, l.status, lt.id AS ledger_transaction_id
     FROM payments p JOIN loans l ON l.id = p.loan_id JOIN ledger_transactions lt ON lt.source_id = p.id AND lt.source_type = 'manual_payment'
     WHERE p.idempotency_key = $1 FOR UPDATE`, [input.idempotencyKey],
  );
  if (existing.rowCount) return { paymentId: existing.rows[0].id, receiptReference: existing.rows[0].receipt_reference, principalAmount: existing.rows[0].principal_amount, chargeAmount: existing.rows[0].charge_amount, outstandingPrincipal: existing.rows[0].outstanding_principal, loanStatus: existing.rows[0].status, ledgerTransactionId: existing.rows[0].ledger_transaction_id, created: false };

  const schedule = await client.query<{ id: string; principal_due: number; principal_paid: number; charge_due: number; charge_paid: number }>(
    `SELECT id, principal_due, principal_paid, charge_due, charge_paid FROM repayment_schedules
     WHERE loan_id = $1 AND status = 'open' ORDER BY due_on, id LIMIT 1 FOR UPDATE`, [input.loanId],
  );
  if (!schedule.rowCount) throw new Error('NO_OPEN_REPAYMENT_SCHEDULE');
  const installment = schedule.rows[0];
  const chargeRemaining = Math.max(installment.charge_due - installment.charge_paid, 0);
  const principalRemaining = Math.max(installment.principal_due - installment.principal_paid, 0);
  const principalAmount = Math.min(input.amount, principalRemaining);
  const chargeAmount = Math.min(input.amount - principalAmount, chargeRemaining);
  if (chargeAmount + principalAmount !== input.amount) throw new Error('PAYMENT_EXCEEDS_SCHEDULE_BALANCE');
  const receiptReference = input.receiptReference ?? `RCT-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const payment = await client.query<{ id: string }>(
    `INSERT INTO payments (loan_id, branch_id, amount, idempotency_key, receipt_reference, recorded_by, status, method, principal_amount, charge_amount, schedule_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'posted', 'manual', $7, $8, $9) RETURNING id`,
    [input.loanId, input.branchId, input.amount, input.idempotencyKey, receiptReference, input.actorUserId, principalAmount, chargeAmount, installment.id],
  );
  const paymentId = payment.rows[0].id;
  await client.query(`INSERT INTO receipts (payment_id, receipt_reference) VALUES ($1, $2)`, [paymentId, receiptReference]);
  const updated = await client.query<{ outstanding_principal: number; status: string }>(
    `UPDATE loans SET outstanding_principal = outstanding_principal - $1, status = CASE WHEN outstanding_principal - $1 = 0 THEN 'completed'::loan_status ELSE 'active'::loan_status END, version = version + 1
     WHERE id = $2 AND outstanding_principal >= $1 RETURNING outstanding_principal, status`, [principalAmount, input.loanId],
  );
  if (!updated.rowCount) throw new Error('LOAN_BALANCE_GUARD_FAILED');
  const scheduleUpdate = await client.query<{ principal_paid: number; charge_paid: number }>(
    `UPDATE repayment_schedules SET principal_paid = principal_paid + $1, charge_paid = charge_paid + $2, status = CASE WHEN principal_paid + $1 >= principal_due AND charge_paid + $2 >= charge_due THEN 'paid' ELSE 'open' END WHERE id = $3 RETURNING principal_paid, charge_paid`,
    [principalAmount, chargeAmount, installment.id],
  );
  if (!scheduleUpdate.rowCount) throw new Error('SCHEDULE_UPDATE_FAILED');
  const creditLines = [{ accountCode: 'loan.principal', side: 'credit' as const, amount: principalAmount }, ...(chargeAmount > 0 ? [{ accountCode: 'realized.charge', side: 'credit' as const, amount: chargeAmount }] : [])].filter((line) => line.amount > 0);
  const ledger = await postLedgerTransactionOnClient(client, { actorUserId: input.actorUserId, sourceType: 'manual_payment', sourceId: paymentId, idempotencyKey: `payment-ledger:${input.idempotencyKey}`, correlationId: input.correlationId, description: 'Manual payment posting', lines: [{ accountCode: 'cash.manual', side: 'debit', amount: input.amount }, ...creditLines] });
  await client.query(`UPDATE payments SET status = 'posted' WHERE id = $1`, [paymentId]);
  await insertAuditEvent(client, { actorUserId: input.actorUserId, action: 'payment.posted', entityType: 'payment', entityId: paymentId, correlationId: input.correlationId, metadata: { loanId: input.loanId, principalAmount, chargeAmount, receiptReference } });
  return { paymentId, receiptReference, principalAmount, chargeAmount, outstandingPrincipal: Number(updated.rows[0].outstanding_principal), loanStatus: updated.rows[0].status, ledgerTransactionId: ledger.transactionId, created: true };
}
