import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/src/app.js';
import { getManagerReportingSnapshot } from '../server/src/services/reporting.js';
import { getAccountantReportingSnapshot } from '../server/src/services/accountant-reporting.js';
import { postManualPayment } from '../server/src/services/payment-posting.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;

let userId: string;
let firebaseUid: string;
let branchId: string;
let today: string;
let from: string;

function dateOffset(days: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createLoan(input: { branchId: string; dueOn: string; principal: number; outstanding: number; label: string }): Promise<{ loanId: string; clientId: string }> {
  const client = await pool!.connect();
  const clientId = randomUUID();
  const productId = randomUUID();
  const applicationId = randomUUID();
  const loanId = randomUUID();
  const scheduleId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, $4)`, [clientId, input.branchId, `report-client-${clientId}`, input.label]);
    await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Reporting Product')`, [productId, `report-product-${productId}`]);
    await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by, status, approved_at) VALUES ($1, $2, $3, $4, $5, $6, 'approved', now())`, [applicationId, clientId, productId, input.branchId, input.principal, userId]);
    await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, $5, $6, 'active')`, [loanId, applicationId, clientId, input.branchId, input.principal, input.outstanding]);
    await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due, penalty_due, interest_due) VALUES ($1, $2, $3, $4, 150, 50, 100)`, [scheduleId, loanId, input.dueOn, input.principal,]);
    await client.query(`INSERT INTO loan_disbursements (loan_id, disbursement_reference, idempotency_key, amount, posted_by) VALUES ($1, $2, $3, $4, $5)`, [loanId, `report-disbursement-${loanId}`, `report-disbursement-key-${loanId}`, input.principal, userId]);
    await client.query('COMMIT');
    return { loanId, clientId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

suite('Manager reporting read models', () => {
  beforeAll(async () => {
    today = new Date().toISOString().slice(0, 10);
    from = dateOffset(-40);
    const client = await pool!.connect();
    try {
      const role = await client.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'manager' LIMIT 1`);
      if (!role.rowCount) throw new Error('manager role is required for reporting tests');
      const branch = await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Reporting Branch') RETURNING id`, [`REPORT-${randomUUID().slice(0, 8)}`]);
      branchId = branch.rows[0].id;
      userId = randomUUID();
      firebaseUid = `reporting-${userId}`;
      await client.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Reporting Manager', $4, $5)`, [userId, firebaseUid, `${firebaseUid}@example.test`, role.rows[0].id, branchId]);
    } finally {
      client.release();
    }
  });

  afterAll(async () => { await pool?.end(); });

  it('calculates PAR, collections, disbursements, allocations, and open reconciliation totals', async () => {
    const paidLoan = await createLoan({ branchId, dueOn: dateOffset(-40), principal: 1_000, outstanding: 1_000, label: 'Paid allocation client' });
    const overdueLoan = await createLoan({ branchId, dueOn: dateOffset(-40), principal: 9_000, outstanding: 9_000, label: 'Overdue portfolio client' });
    const otherBranch = await pool!.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Other Reporting Branch') RETURNING id`, [`OTHER-REPORT-${randomUUID().slice(0, 8)}`]);
    await createLoan({ branchId: otherBranch.rows[0].id, dueOn: dateOffset(-90), principal: 12_000, outstanding: 12_000, label: 'Other branch client' });

    const capturedAt = `${today}T10:00:00.000Z`;
    const firstPayment = await postManualPayment({
      actorUserId: userId, loanId: paidLoan.loanId, branchId, clientId: paidLoan.clientId, amount: 200,
      idempotencyKey: `report-payment-${randomUUID()}`, localId: `report-local-${randomUUID()}`,
      deviceId: 'reporting-device', paymentMethod: 'cash', capturedAt, correlationId: randomUUID(),
    });
    await postManualPayment({
      actorUserId: userId, loanId: paidLoan.loanId, branchId, clientId: paidLoan.clientId, amount: 1_000,
      idempotencyKey: `report-payment-${randomUUID()}`, correlationId: randomUUID(),
    });

    const client = await pool!.connect();
    try {
      await client.query(`UPDATE field_collection_records SET status = 'posted' WHERE payment_id = $1`, [firstPayment.paymentId]);
      await client.query(
        `INSERT INTO field_collection_records
          (branch_id, local_id, idempotency_key, amount, status, device_id, captured_at, client_id, loan_id, collector_id, payment_method, synced_at)
         VALUES ($1, $2, $3, 300, 'pending_reconciliation', 'reporting-device-2', $4, $5, $6, $7, 'mobile_money', now())`,
        [branchId, `report-pending-${randomUUID()}`, `report-pending-key-${randomUUID()}`, capturedAt, overdueLoan.clientId, overdueLoan.loanId, userId],
      );
      await client.query(
        `INSERT INTO reconciliations
          (branch_id, batch_reference, expected_amount, recorded_amount, submitted_amount, variance, status, submitted_by)
         VALUES ($1, $2, 500, 500, 490, -10, 'pending', $3)`,
        [branchId, `report-reconciliation-${randomUUID()}`, userId],
      );
    } finally {
      client.release();
    }

    const snapshot = await getManagerReportingSnapshot({ branchId, asOf: today, from, to: today });
    expect(snapshot.summary).toMatchObject({
      portfolioOutstanding: 9_000,
      activeLoans: 1,
      scheduledAmount: 10_300,
      realizedDueAmount: 1_150,
      collectionEfficiency: 11.17,
      disbursementCount: 2,
      disbursementAmount: 10_000,
    });
    expect(snapshot.summary.par30).toEqual({ amount: 9_000, ratio: 100, loanCount: 1 });
    expect(snapshot.summary.par60).toEqual({ amount: 0, ratio: 0, loanCount: 0 });
    expect(snapshot.summary.par90).toEqual({ amount: 0, ratio: 0, loanCount: 0 });
    expect(snapshot.allocations).toMatchObject({
      postedAmount: 1_200,
      principalRecovery: 1_000,
      realizedPenalty: 50,
      realizedInterest: 100,
      realizedRevenue: 150,
      overpaymentLiability: 50,
      heldOverpaymentBalance: 50,
    });
    expect(snapshot.collectionBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ branchId, paymentMethod: 'cash', reconciledAmount: 200, reconciledCount: 1 }),
      expect.objectContaining({ branchId, paymentMethod: 'mobile_money', pendingAmount: 300, pendingCount: 1 }),
    ]));
    expect(snapshot.openReconciliations).toMatchObject({ count: 1, recordedAmount: 500, variance: -10 });
    expect(snapshot.branchPerformance).toEqual([expect.objectContaining({ branchId, outstandingPrincipal: 9_000, pendingCollections: 300, openReconciliations: 1 })]);

    const accountantSnapshot = await getAccountantReportingSnapshot({ branchId, asOf: today, from, to: today });
    expect(accountantSnapshot.journalEntries.length).toBe(2);
    expect(accountantSnapshot.journalEntries.every((entry) => entry.balanced && entry.totalDebits === entry.totalCredits)).toBe(true);
    expect(accountantSnapshot.trialBalance.reduce((sum, row) => sum + row.debitTotal, 0)).toBe(accountantSnapshot.trialBalance.reduce((sum, row) => sum + row.creditTotal, 0));
    expect(accountantSnapshot.waterfallTotals).toMatchObject({
      postedAmount: 1_200,
      principalRecovery: 1_000,
      realizedInterest: 100,
      realizedPenalty: 50,
      overpaymentLiability: 50,
      allocationDelta: 0,
    });
    expect(accountantSnapshot.waterfallAllocations).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: 200, principalRecovery: 200, realizedInterest: 0, realizedPenalty: 0, overpaymentLiability: 0, allocationDelta: 0 }),
      expect.objectContaining({ amount: 1_000, principalRecovery: 800, realizedInterest: 100, realizedPenalty: 50, overpaymentLiability: 50, allocationDelta: 0 }),
    ]));
  });

  it('enforces the protected manager endpoint and branch scope', async () => {
    const app = buildApp({
      tokenVerifier: async () => ({ uid: firebaseUid } as never),
      userResolver: async () => ({ dbUserId: userId, firebaseUid, role: 'manager', branchId, clientId: null, permissions: [] }),
    });
    const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/reports/manager' });
    expect(unauthorized.statusCode).toBe(401);
    const response = await app.inject({ method: 'GET', url: `/api/v1/reports/manager?branchId=${branchId}&asOf=${today}&from=${from}&to=${today}`, headers: { authorization: 'Bearer reporting-test-token' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.filters.branchId).toBe(branchId);
    const managerDenied = await app.inject({ method: 'GET', url: `/api/v1/reports/accountant?branchId=${branchId}&asOf=${today}&from=${from}&to=${today}`, headers: { authorization: 'Bearer reporting-test-token' } });
    expect(managerDenied.statusCode).toBe(403);
    await app.close();

    const accountantApp = buildApp({
      tokenVerifier: async () => ({ uid: firebaseUid } as never),
      userResolver: async () => ({ dbUserId: userId, firebaseUid, role: 'accountant', branchId, clientId: null, permissions: [] }),
    });
    const accountantResponse = await accountantApp.inject({ method: 'GET', url: `/api/v1/reports/accountant?branchId=${branchId}&asOf=${today}&from=${from}&to=${today}`, headers: { authorization: 'Bearer accountant-test-token' } });
    expect(accountantResponse.statusCode).toBe(200);
    expect(accountantResponse.json().data.filters.branchId).toBe(branchId);
    await accountantApp.close();
  });
});