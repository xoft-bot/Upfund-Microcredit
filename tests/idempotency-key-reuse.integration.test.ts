import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { postManualPayment } from '../server/src/services/payment-posting.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;
let userId: string;
let branchId: string;

async function createLoan(clientLabel: string) {
  const client = await pool!.connect();
  const clientId = randomUUID();
  const productId = randomUUID();
  const applicationId = randomUUID();
  const loanId = randomUUID();
  const scheduleId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, $4)`, [clientId, branchId, `client-${clientId}`, clientLabel]);
    await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Idempotency Test Product')`, [productId, `product-${productId}`]);
    await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, branchId, userId]);
    await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, branchId]);
    await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE, 100000, 30000)`, [scheduleId, loanId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  return { clientId, loanId };
}

suite('Idempotency key reuse validation', () => {
  beforeAll(async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const role = await client.query<{ id: string }>(`INSERT INTO roles (code, name) VALUES ($1, 'Idempotency Test Manager') RETURNING id`, [`idempotency-manager-${randomUUID()}`]);
      branchId = (await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Idempotency Test Branch') RETURNING id`, [`IDEM-${randomUUID().slice(0, 8)}`])).rows[0].id;
      userId = randomUUID();
      await client.query(`INSERT INTO users (id, firebase_uid, display_name, role_id, branch_id) VALUES ($1, $2, 'Idempotency Test User', $3, $4)`, [userId, `idempotency-${userId}`, role.rows[0].id, branchId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  afterAll(async () => { await pool!.end(); });

  it('a genuine retry with the same key, loan, and amount returns the earlier payment', async () => {
    const { loanId } = await createLoan('Retry Client');
    const idempotencyKey = `payment-${loanId}`;
    const first = await postManualPayment({ actorUserId: userId, loanId, branchId, amount: 5000, idempotencyKey, correlationId: randomUUID() });
    const second = await postManualPayment({ actorUserId: userId, loanId, branchId, amount: 5000, idempotencyKey, correlationId: randomUUID() });
    expect(second.created).toBe(false);
    expect(second.paymentId).toBe(first.paymentId);
  });

  it('rejects a reused key with a different amount', async () => {
    const { loanId } = await createLoan('Amount Mismatch Client');
    const idempotencyKey = `payment-${loanId}`;
    await postManualPayment({ actorUserId: userId, loanId, branchId, amount: 5000, idempotencyKey, correlationId: randomUUID() });
    await expect(postManualPayment({ actorUserId: userId, loanId, branchId, amount: 7000, idempotencyKey, correlationId: randomUUID() })).rejects.toThrow('IDEMPOTENCY_KEY_REUSE_MISMATCH');
  });

  it('rejects a reused key against a different loan', async () => {
    const { loanId: loanA } = await createLoan('Loan A Client');
    const { loanId: loanB } = await createLoan('Loan B Client');
    const idempotencyKey = `payment-shared-${randomUUID()}`;
    await postManualPayment({ actorUserId: userId, loanId: loanA, branchId, amount: 5000, idempotencyKey, correlationId: randomUUID() });
    await expect(postManualPayment({ actorUserId: userId, loanId: loanB, branchId, amount: 5000, idempotencyKey, correlationId: randomUUID() })).rejects.toThrow('IDEMPOTENCY_KEY_REUSE_MISMATCH');
  });
});
