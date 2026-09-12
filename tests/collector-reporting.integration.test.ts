import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/src/app.js';
import { getCollectorReportingSnapshot } from '../server/src/services/collector-reporting.js';
import { postManualPayment } from '../server/src/services/payment-posting.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;

let collectorId: string;
let firebaseUid: string;
let branchId: string;
let otherBranchId: string;
let today: string;

function dateOffset(days: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createLoan(input: { branchId: string; dueOn: string; principal: number; label: string }): Promise<{ loanId: string; clientId: string }> {
  const client = await pool!.connect();
  const clientId = randomUUID();
  const productId = randomUUID();
  const applicationId = randomUUID();
  const loanId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, $4)`, [clientId, input.branchId, `collector-client-${clientId}`, input.label]);
    await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Collector Product')`, [productId, `collector-product-${productId}`]);
    await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by, status, approved_at) VALUES ($1, $2, $3, $4, $5, $6, 'approved', now())`, [applicationId, clientId, productId, input.branchId, input.principal, collectorId]);
    await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, $5, $5, 'active')`, [loanId, applicationId, clientId, input.branchId, input.principal]);
    await client.query(`INSERT INTO repayment_schedules (loan_id, due_on, principal_due, charge_due, penalty_due, interest_due) VALUES ($1, $2, $3, 150, 50, 100)`, [loanId, input.dueOn, input.principal]);
    await client.query('COMMIT');
    return { loanId, clientId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

suite('Collector reporting read models', () => {
  beforeAll(async () => {
    today = new Date().toISOString().slice(0, 10);
    const client = await pool!.connect();
    try {
      const role = await client.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'collector' LIMIT 1`);
      if (!role.rowCount) throw new Error('collector role is required for collector reporting tests');
      const branch = await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Collector Reporting Branch') RETURNING id`, [`COLLECTOR-${randomUUID().slice(0, 8)}`]);
      const otherBranch = await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Other Collector Branch') RETURNING id`, [`OTHER-COLLECTOR-${randomUUID().slice(0, 8)}`]);
      branchId = branch.rows[0].id;
      otherBranchId = otherBranch.rows[0].id;
      collectorId = randomUUID();
      firebaseUid = `collector-reporting-${collectorId}`;
      await client.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Reporting Collector', $4, $5)`, [collectorId, firebaseUid, `${firebaseUid}@example.test`, role.rows[0].id, branchId]);
    } finally {
      client.release();
    }
  });

  afterAll(async () => { await pool?.end(); });

  it('isolates assigned clients and calculates target progress, route metrics, and sync status', async () => {
    const assignedToday = await createLoan({ branchId, dueOn: today, principal: 1_000, label: 'Assigned today client' });
    const assignedOverdue = await createLoan({ branchId, dueOn: dateOffset(-10), principal: 2_000, label: 'Assigned overdue client' });
    const unassigned = await createLoan({ branchId, dueOn: today, principal: 4_000, label: 'Unassigned client' });
    const otherBranch = await createLoan({ branchId: otherBranchId, dueOn: today, principal: 5_000, label: 'Other branch client' });
    const client = await pool!.connect();
    try {
      await client.query(
        `INSERT INTO collector_assignments (officer_id, client_id, branch_id, route_code, effective_from)
         VALUES ($1, $2, $3, 'ROUTE-A', $4), ($1, $5, $3, 'ROUTE-A', $4), ($1, $6, $7, 'ROUTE-B', $4)`,
        [collectorId, assignedToday.clientId, branchId, dateOffset(-30), assignedOverdue.clientId, otherBranch.clientId, otherBranchId],
      );
    } finally {
      client.release();
    }

    const capturedAt = `${today}T10:00:00.000Z`;
    const posted = await postManualPayment({
      actorUserId: collectorId, loanId: assignedToday.loanId, branchId, clientId: assignedToday.clientId, amount: 300,
      idempotencyKey: `collector-payment-${randomUUID()}`, localId: `collector-local-${randomUUID()}`,
      deviceId: 'collector-device', paymentMethod: 'cash', capturedAt, correlationId: randomUUID(),
    });
    await postManualPayment({
      actorUserId: collectorId, loanId: unassigned.loanId, branchId, clientId: unassigned.clientId, amount: 900,
      idempotencyKey: `collector-payment-${randomUUID()}`, correlationId: randomUUID(),
    });
    const queueClient = await pool!.connect();
    try {
      await queueClient.query(`UPDATE field_collection_records SET status = 'posted', synced_at = now() WHERE payment_id = $1`, [posted.paymentId]);
      await queueClient.query(
        `INSERT INTO field_collection_records
          (branch_id, local_id, idempotency_key, amount, status, device_id, captured_at, client_id, loan_id, collector_id, payment_method)
         VALUES ($1, $2, $3, 100, 'pending_reconciliation', 'collector-device-2', $4, $5, $6, $7, 'mobile_money')`,
        [branchId, `collector-pending-${randomUUID()}`, `collector-pending-key-${randomUUID()}`, capturedAt, assignedToday.clientId, assignedToday.loanId, collectorId],
      );
    } finally {
      queueClient.release();
    }

    const snapshot = await getCollectorReportingSnapshot({ branchId, collectorId, asOf: today, from: today, to: today });
    expect(snapshot.targetProgress).toMatchObject({
      targetAmount: 1_150,
      actualAmount: 300,
      pendingAmount: 100,
      progressPercent: 26.09,
      scheduledClientCount: 1,
      overdueClientCount: 1,
    });
    expect(snapshot.routes).toEqual([expect.objectContaining({ routeCode: 'ROUTE-A', assignedClientCount: 2, targetAmount: 1_150, actualAmount: 300, pendingAmount: 100, progressPercent: 26.09 })]);
    expect(snapshot.assignedClientSchedules).toEqual([expect.objectContaining({ clientId: assignedToday.clientId, amountDue: 1_150 })]);
    expect(snapshot.overdueWatchlist).toEqual([expect.objectContaining({ clientId: assignedOverdue.clientId, overdueAmount: 2_150, daysOverdue: 10 })]);
    expect(snapshot.assignedClientSchedules.some((row) => row.clientId === unassigned.clientId)).toBe(false);
    expect(snapshot.overdueWatchlist.some((row) => row.clientId === unassigned.clientId || row.clientId === otherBranch.clientId)).toBe(false);
    expect(snapshot.paymentMethods).toEqual(expect.arrayContaining([
      expect.objectContaining({ paymentMethod: 'cash', postedCount: 1, postedAmount: 300 }),
      expect.objectContaining({ paymentMethod: 'mobile_money', pendingCount: 1, pendingAmount: 100 }),
    ]));
    expect(snapshot.offlineQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: assignedToday.clientId, syncStatus: 'posted', receiptReference: posted.receiptReference }),
      expect.objectContaining({ clientId: assignedToday.clientId, syncStatus: 'pending_reconciliation' }),
    ]));
    expect(snapshot.offlineQueue.some((item) => item.clientId === unassigned.clientId || item.clientId === otherBranch.clientId)).toBe(false);
  });

  it('protects the endpoint with auth and branch scope', async () => {
    const app = buildApp({
      tokenVerifier: async () => ({ uid: firebaseUid } as never),
      userResolver: async () => ({ dbUserId: collectorId, firebaseUid, role: 'collector', branchId, clientId: null, permissions: [] }),
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/reports/collector' })).statusCode).toBe(401);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/collector?branchId=${branchId}&asOf=${today}&from=${today}&to=${today}`,
      headers: { authorization: 'Bearer collector-test-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.filters.collectorId).toBe(collectorId);
    const branchOverride = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/collector?branchId=${otherBranchId}&asOf=${today}&from=${today}&to=${today}`,
      headers: { authorization: 'Bearer collector-test-token' },
    });
    expect(branchOverride.statusCode).toBe(200);
    expect(branchOverride.json().data.filters.branchId).toBe(branchId);
    expect(branchOverride.json().data.routes.some((route: { routeCode: string }) => route.routeCode === 'ROUTE-B')).toBe(false);
    await app.close();
  });
});