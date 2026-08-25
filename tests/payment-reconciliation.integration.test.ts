import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { postManualPayment } from '../server/src/services/payment-posting.js';
import { postReconciliationBatch } from '../server/src/services/reconciliation-posting.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;
let userId: string;
let branchId: string;

suite('Stage 2 atomic payment and reconciliation', () => {
  beforeAll(async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const role = await client.query<{ id: string }>(`INSERT INTO roles (code, name) VALUES ($1, 'Payment Manager') RETURNING id`, [`payment-manager-${randomUUID()}`]);
      branchId = (await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Payment Test Branch') RETURNING id`, [`PAY-${randomUUID().slice(0, 8)}`])).rows[0].id;
      userId = randomUUID();
      await client.query(`INSERT INTO users (id, firebase_uid, display_name, role_id, branch_id) VALUES ($1, $2, 'Payment Test User', $3, $4)`, [userId, `payment-${userId}`, role.rows[0].id, branchId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  afterAll(async () => { await pool!.end(); });

  it('posts a payment atomically and balances the resulting ledger', async () => {
    const client = await pool!.connect();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    const scheduleId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Payment Client')`, [clientId, branchId, `client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Test Product')`, [productId, `product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, branchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, branchId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE, 100000, 30000)`, [scheduleId, loanId]);
      await client.query('COMMIT');
      const result = await postManualPayment({ actorUserId: userId, loanId, branchId, amount: 5000, idempotencyKey: `payment-${loanId}`, correlationId: randomUUID() });
      expect(result.principalAmount).toBe(5000);
      expect(result.chargeAmount).toBe(0);
      expect(result.outstandingPrincipal).toBe(95000);
      expect(result.receiptReference).toMatch(/^RCT-/);
      const ledger = await pool!.query<{ debit: string; credit: string }>(`SELECT SUM(amount) FILTER (WHERE side = 'debit') AS debit, SUM(amount) FILTER (WHERE side = 'credit') AS credit FROM ledger_entries WHERE transaction_id = $1`, [result.ledgerTransactionId]);
      expect(ledger.rows[0].debit).toBe('5000');
      expect(ledger.rows[0].credit).toBe('5000');
      const stored = await pool!.query<{ receipt_reference: string; status: string }>('SELECT receipt_reference, status FROM payments WHERE id = $1', [result.paymentId]);
      expect(stored.rows[0]).toEqual({ receipt_reference: result.receiptReference, status: 'posted' });
    } finally { client.release(); }
  });

  it('rejects reconciliation variance and rolls back the batch', async () => {
    const batch = `batch-${randomUUID()}`;
    await expect(postReconciliationBatch({ actorUserId: userId, actorRole: 'manager', branchId, batchReference: batch, expectedAmount: 100, recordedAmount: 90, submittedAmount: 80, paymentIds: [], policyVersion: 'v1', managerOverride: false, correlationId: randomUUID() })).rejects.toThrow('RECONCILIATION_VARIANCE_REQUIRES_MANAGER_OVERRIDE');
    const result = await pool!.query('SELECT 1 FROM reconciliations WHERE batch_reference = $1', [batch]);
    expect(result.rowCount).toBe(0);
  });
});
