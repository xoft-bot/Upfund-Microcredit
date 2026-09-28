import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getManagerReportingSnapshot } from '../server/src/services/reporting.js';
import { clearReportingCache } from '../server/src/services/reporting-cache.js';
import { updateParThresholdConfig } from '../server/src/services/par-threshold-config.js';

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

async function createOverdueLoan(daysOverdue: number): Promise<void> {
  const client = await pool!.connect();
  const clientId = randomUUID(); const productId = randomUUID(); const applicationId = randomUUID(); const loanId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Cache Client')`, [clientId, branchId, `cache-client-${clientId}`]);
    await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Cache Product')`, [productId, `cache-product-${productId}`]);
    await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by, status, approved_at) VALUES ($1, $2, $3, $4, 5000, $5, 'approved', now())`, [applicationId, clientId, productId, branchId, userId]);
    await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 5000, 5000, 'active')`, [loanId, applicationId, clientId, branchId]);
    await client.query(`INSERT INTO repayment_schedules (loan_id, due_on, principal_due, charge_due, penalty_due, interest_due) VALUES ($1, $2, 5000, 150, 50, 100)`, [loanId, dateOffset(-daysOverdue)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

suite('Reporting cache against a real database', () => {
  beforeAll(async () => {
    today = new Date().toISOString().slice(0, 10);
    const client = await pool!.connect();
    try {
      const role = await client.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'accountant' LIMIT 1`);
      const branch = await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Cache Branch') RETURNING id`, [`CACHE-${randomUUID().slice(0, 8)}`]);
      branchId = branch.rows[0].id;
      userId = randomUUID();
      const uid = `cache-${userId}`;
      await client.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Cache Accountant', $4, $5)`, [userId, uid, `${uid}@example.test`, role.rows[0].id, branchId]);
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    clearReportingCache();
    await pool!.query(`UPDATE par_threshold_config SET par30_days = 30, par60_days = 60, par90_days = 90, updated_by = NULL WHERE id = 1`);
  });
  afterAll(async () => { await pool?.end(); });

  it('serves a cached snapshot, refreshes on demand, and drops the cache when PAR windows change', async () => {
    vi.stubEnv('REPORTING_CACHE_TTL_MS', '60000');
    const input = { branchId, asOf: today, from: dateOffset(-60), to: today };

    await createOverdueLoan(40);
    const first = await getManagerReportingSnapshot(input);
    expect(first.summary.par30.loanCount).toBe(1);
    expect(first.generatedAt).toBeTruthy();

    await createOverdueLoan(40);
    const cached = await getManagerReportingSnapshot(input);
    expect(cached.summary.par30.loanCount).toBe(1); // still the cached snapshot
    expect(cached.generatedAt).toBe(first.generatedAt);

    const refreshed = await getManagerReportingSnapshot({ ...input, fresh: true });
    expect(refreshed.summary.par30.loanCount).toBe(2); // Refresh button sees the new loan

    // Both loans are 40 days overdue: under 30/60/90 that is PAR30 only.
    expect(refreshed.summary.par60.loanCount).toBe(0);
    await updateParThresholdConfig({ par30Days: 10, par60Days: 20, par90Days: 30, actorUserId: userId, correlationId: randomUUID() });
    const afterPolicyChange = await getManagerReportingSnapshot(input); // NOT fresh: cache must have been dropped
    expect(afterPolicyChange.summary.par60.loanCount).toBe(2);
    expect(afterPolicyChange.summary.par90.loanCount).toBe(2);
  });

  it('is disabled by default under test, so other tests keep reading live data', async () => {
    const input = { branchId, asOf: today, from: dateOffset(-60), to: today };
    const before = await getManagerReportingSnapshot(input);
    await createOverdueLoan(45);
    const after = await getManagerReportingSnapshot(input);
    expect(after.summary.par30.loanCount).toBe(before.summary.par30.loanCount + 1);
  });
});
