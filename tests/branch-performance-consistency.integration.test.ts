import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getManagerReportingSnapshot } from '../server/src/services/reporting.js';
import { postManualPayment } from '../server/src/services/payment-posting.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;

let userId: string;
let branchId: string;
let today: string;

function dateOffset(days: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

suite('Branch performance vs portfolio summary consistency', () => {
  beforeAll(async () => {
    today = new Date().toISOString().slice(0, 10);
    const client = await pool!.connect();
    try {
      const role = await client.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'manager' LIMIT 1`);
      if (!role.rowCount) throw new Error('manager role is required');
      const branch = await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Consistency Branch') RETURNING id`, [`CONS-${randomUUID().slice(0, 8)}`]);
      branchId = branch.rows[0].id;
      userId = randomUUID();
      const uid = `consistency-${userId}`;
      await client.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Consistency Manager', $4, $5)`, [userId, uid, `${uid}@example.test`, role.rows[0].id, branchId]);
    } finally {
      client.release();
    }
  });

  afterAll(async () => { await pool?.end(); });

  it('does not multiply an installment by its number of payments, and agrees with the summary efficiency', async () => {
    const client = await pool!.connect();
    const clientId = randomUUID(); const productId = randomUUID(); const applicationId = randomUUID(); const loanId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Consistency Client')`, [clientId, branchId, `cons-client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Consistency Product')`, [productId, `cons-product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by, status, approved_at) VALUES ($1, $2, $3, $4, 5000, $5, 'approved', now())`, [applicationId, clientId, productId, branchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 5000, 5000, 'active')`, [loanId, applicationId, clientId, branchId]);
      // One installment inside the reporting window.
      await client.query(`INSERT INTO repayment_schedules (loan_id, due_on, principal_due, charge_due, penalty_due, interest_due) VALUES ($1, $2, 5000, 150, 50, 100)`, [loanId, dateOffset(-10)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Two separate payments landing on the SAME installment.
    for (const amount of [1_000, 1_000]) {
      await postManualPayment({ actorUserId: userId, loanId, branchId, clientId, amount, idempotencyKey: `cons-${randomUUID()}`, correlationId: randomUUID() });
    }

    const snapshot = await getManagerReportingSnapshot({ branchId, asOf: today, from: dateOffset(-30), to: today });
    const branch = snapshot.branchPerformance.find((row) => row.branchId === branchId);
    expect(branch).toBeDefined();
    expect(snapshot.summary.scheduledAmount).toBe(5_150);
    expect(snapshot.summary.realizedDueAmount).toBeGreaterThan(0);
    // Same branch, same window: the two views of collection efficiency must be the same number.
    expect(branch!.collectionEfficiency).toBe(snapshot.summary.collectionEfficiency);
  });
});
