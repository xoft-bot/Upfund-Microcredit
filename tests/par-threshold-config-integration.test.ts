import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getParThresholdConfig, updateParThresholdConfig } from '../server/src/services/par-threshold-config.js';
import { getManagerReportingSnapshot } from '../server/src/services/reporting.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;

let userId: string;
let branchId: string;
let today: string;

async function resetToDefaults(): Promise<void> {
  await pool!.query(`UPDATE par_threshold_config SET par30_days = 30, par60_days = 60, par90_days = 90, updated_by = NULL WHERE id = 1`);
}

suite('PAR threshold config', () => {
  beforeAll(async () => {
    today = new Date().toISOString().slice(0, 10);
    const client = await pool!.connect();
    try {
      const role = await client.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'accountant' LIMIT 1`);
      if (!role.rowCount) throw new Error('accountant role is required for this test');
      const branch = await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'PAR Threshold Branch') RETURNING id`, [`PARCFG-${randomUUID().slice(0, 8)}`]);
      branchId = branch.rows[0].id;
      userId = randomUUID();
      const firebaseUid = `par-threshold-${userId}`;
      await client.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'PAR Threshold Accountant', $4, $5)`, [userId, firebaseUid, `${firebaseUid}@example.test`, role.rows[0].id, branchId]);
    } finally {
      client.release();
    }
  });

  afterEach(async () => { await resetToDefaults(); });
  afterAll(async () => { await pool?.end(); });

  it('defaults to 30/60/90, matching what reporting.ts always hardcoded', async () => {
    const config = await getParThresholdConfig();
    expect(config).toMatchObject({ par30Days: 30, par60Days: 60, par90Days: 90, updatedBy: null });
  });

  it('updateParThresholdConfig persists the change and audit-logs it', async () => {
    const updated = await updateParThresholdConfig({ par30Days: 15, par60Days: 45, par90Days: 75, actorUserId: userId, correlationId: randomUUID() });
    expect(updated).toMatchObject({ par30Days: 15, par60Days: 45, par90Days: 75, updatedBy: userId });

    const reread = await getParThresholdConfig();
    expect(reread).toMatchObject({ par30Days: 15, par60Days: 45, par90Days: 75 });

    const audit = await pool!.query(`SELECT action, entity_type, metadata FROM audit_events WHERE actor_user_id = $1 AND action = 'par_threshold_config.updated' ORDER BY created_at DESC LIMIT 1`, [userId]);
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].metadata).toMatchObject({ par30Days: 15, par60Days: 45, par90Days: 75 });
  });

  it('rejects a non-increasing order without touching the stored config', async () => {
    await expect(updateParThresholdConfig({ par30Days: 60, par60Days: 30, par90Days: 90, actorUserId: userId, correlationId: randomUUID() }))
      .rejects.toThrow('PAR_THRESHOLD_ORDER_INVALID');
    const config = await getParThresholdConfig();
    expect(config).toMatchObject({ par30Days: 30, par60Days: 60, par90Days: 90 });
  });

  it('reporting.ts readPortfolio actually uses the configured threshold, not a hardcoded 30/60/90', async () => {
    const client = await pool!.connect();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    const scheduleId = randomUUID();
    // A loan 40 days overdue: under the 30/60/90 default it's PAR30-only (matches the
    // existing reporting.integration.test.ts fixture). If we tighten par30 to 10 days,
    // the SAME loan must now also show up in PAR60 once that window is widened below 40 —
    // proving the query reads from config, not a compiled-in literal.
    const dueOn = new Date(`${today}T00:00:00.000Z`);
    dueOn.setUTCDate(dueOn.getUTCDate() - 40);
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'PAR Threshold Client')`, [clientId, branchId, `par-threshold-client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'PAR Threshold Product')`, [productId, `par-threshold-product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by, status, approved_at) VALUES ($1, $2, $3, $4, 5000, $5, 'approved', now())`, [applicationId, clientId, productId, branchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 5000, 5000, 'active')`, [loanId, applicationId, clientId, branchId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due, penalty_due, interest_due) VALUES ($1, $2, $3, 5000, 150, 50, 100)`, [scheduleId, loanId, dueOn.toISOString().slice(0, 10)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const beforeSnapshot = await getManagerReportingSnapshot({ branchId, asOf: today, from: today, to: today });
    expect(beforeSnapshot.summary.par30.loanCount).toBe(1);
    expect(beforeSnapshot.summary.par60.loanCount).toBe(0);

    await updateParThresholdConfig({ par30Days: 10, par60Days: 20, par90Days: 30, actorUserId: userId, correlationId: randomUUID() });

    const afterSnapshot = await getManagerReportingSnapshot({ branchId, asOf: today, from: today, to: today });
    // Under a 10/20/30 window, a loan 40 days overdue now clears ALL three thresholds.
    expect(afterSnapshot.summary.par30.loanCount).toBe(1);
    expect(afterSnapshot.summary.par60.loanCount).toBe(1);
    expect(afterSnapshot.summary.par90.loanCount).toBe(1);
  });
});
