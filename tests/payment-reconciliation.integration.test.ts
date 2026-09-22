import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { postManualPayment } from '../server/src/services/payment-posting.js';
import { postReconciliationBatch } from '../server/src/services/reconciliation-posting.js';
import type { TokenVerifier, UserResolver } from '../server/src/middleware/auth.js';
import { registerPaymentRoutes } from '../server/src/routes/payments.js';

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

  it('applies the waterfall, holds overpayment, and links the offline source', async () => {
    const client = await pool!.connect();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    const scheduleId = randomUUID();
    const localId = `local-${randomUUID()}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Waterfall Client')`, [clientId, branchId, `client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Waterfall Product')`, [productId, `product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, branchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, branchId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due, penalty_due, interest_due) VALUES ($1, $2, CURRENT_DATE, 100000, 25000, 5000, 20000)`, [scheduleId, loanId]);
      await client.query('COMMIT');

      const result = await postManualPayment({
        actorUserId: userId,
        loanId,
        branchId,
        clientId,
        amount: 135000,
        idempotencyKey: `payment-${loanId}`,
        localId,
        deviceId: 'device-waterfall',
        paymentMethod: 'cash',
        capturedAt: '2026-08-25T00:00:00.000Z',
        correlationId: randomUUID(),
      });

      expect(result).toMatchObject({ principalAmount: 100000, penaltyAmount: 5000, interestAmount: 20000, chargeAmount: 25000, overpaymentAmount: 10000 });
      const ledger = await pool!.query<{ account_code: string; side: string; amount: string }>(
        `SELECT account_code, side, amount FROM ledger_entries WHERE transaction_id = $1 ORDER BY account_code`,
        [result.ledgerTransactionId],
      );
      expect(ledger.rows).toEqual(expect.arrayContaining([
        { account_code: 'cash.manual', side: 'debit', amount: '135000' },
        { account_code: 'loan.principal', side: 'credit', amount: '100000' },
        { account_code: 'realized.penalty', side: 'credit', amount: '5000' },
        { account_code: 'realized.interest', side: 'credit', amount: '20000' },
        { account_code: 'overpayment.holding', side: 'credit', amount: '10000' },
      ]));
      const source = await pool!.query<{ payment_id: string; status: string; client_id: string; loan_id: string }>(
        `SELECT payment_id, status, client_id, loan_id FROM field_collection_records WHERE local_id = $1`,
        [localId],
      );
      expect(source.rows[0]).toEqual({ payment_id: result.paymentId, status: 'pending_reconciliation', client_id: clientId, loan_id: loanId });
      await expect(postManualPayment({
        actorUserId: userId,
        loanId,
        branchId,
        clientId,
        amount: 136000,
        idempotencyKey: `payment-${loanId}`,
        localId,
        deviceId: 'device-waterfall',
        paymentMethod: 'cash',
        capturedAt: '2026-08-25T00:00:00.000Z',
        correlationId: randomUUID(),
      })).rejects.toThrow('FIELD_COLLECTION_CONFLICT');
      const holding = await pool!.query<{ amount: string; status: string }>(
        `SELECT amount, status FROM overpayment_holdings WHERE payment_id = $1`,
        [result.paymentId],
      );
      expect(holding.rows[0]).toEqual({ amount: '10000', status: 'held' });
    } finally { client.release(); }
  });

  it('a payment covering two overdue installments clears both instead of stranding the second', async () => {
    const client = await pool!.connect();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Catch-up Client')`, [clientId, branchId, `client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Catch-up Product')`, [productId, `product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, branchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, branchId]);
      // Two overdue installments, both already due: 50,000 principal each, no penalty/interest.
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE - INTERVAL '60 days', 50000, 0)`, [randomUUID(), loanId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE - INTERVAL '30 days', 50000, 0)`, [randomUUID(), loanId]);
      await client.query('COMMIT');

      const result = await postManualPayment({ actorUserId: userId, loanId, branchId, clientId, amount: 100000, idempotencyKey: `catchup-${loanId}`, correlationId: randomUUID() });
      expect(result).toMatchObject({ principalAmount: 100000, overpaymentAmount: 0, outstandingPrincipal: 0, loanStatus: 'completed' });
      const schedules = await pool!.query<{ due_on: string; principal_paid: string; status: string }>(`SELECT due_on, principal_paid, status FROM repayment_schedules WHERE loan_id = $1 ORDER BY due_on`, [loanId]);
      expect(schedules.rows.map((row) => ({ principalPaid: Number(row.principal_paid), status: row.status }))).toEqual([
        { principalPaid: 50000, status: 'paid' },
        { principalPaid: 50000, status: 'paid' },
      ]);
      const holding = await pool!.query('SELECT 1 FROM overpayment_holdings WHERE loan_id = $1', [loanId]);
      expect(holding.rowCount).toBe(0);
    } finally { client.release(); }
  });

  it('a payment covering one full installment plus a partial second leaves the second correctly partial', async () => {
    const client = await pool!.connect();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Partial Client')`, [clientId, branchId, `client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Partial Product')`, [productId, `product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, branchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, branchId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE - INTERVAL '60 days', 50000, 0)`, [randomUUID(), loanId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE - INTERVAL '30 days', 50000, 0)`, [randomUUID(), loanId]);
      await client.query('COMMIT');

      // Pays the first installment fully (50,000) plus 20,000 toward the second — nothing left as overpayment.
      const result = await postManualPayment({ actorUserId: userId, loanId, branchId, clientId, amount: 70000, idempotencyKey: `partial-${loanId}`, correlationId: randomUUID() });
      expect(result).toMatchObject({ principalAmount: 70000, overpaymentAmount: 0, outstandingPrincipal: 30000 });
      const schedules = await pool!.query<{ due_on: string; principal_paid: string; status: string }>(`SELECT due_on, principal_paid, status FROM repayment_schedules WHERE loan_id = $1 ORDER BY due_on`, [loanId]);
      expect(schedules.rows.map((row) => ({ principalPaid: Number(row.principal_paid), status: row.status }))).toEqual([
        { principalPaid: 50000, status: 'paid' },
        { principalPaid: 20000, status: 'open' },
      ]);
    } finally { client.release(); }
  });

  it('rejects a variance submission that has no payments and rolls back the batch', async () => {
    const batch = `batch-${randomUUID()}`;
    await expect(postReconciliationBatch({ actorUserId: userId, actorRole: 'manager', branchId, batchReference: batch, expectedAmount: 100, recordedAmount: 90, submittedAmount: 80, paymentIds: [], policyVersion: 'v1', managerOverride: false, correlationId: randomUUID() })).rejects.toThrow('RECONCILIATION_NO_PAYMENTS');
    const result = await pool!.query('SELECT 1 FROM reconciliations WHERE batch_reference = $1', [batch]);
    expect(result.rowCount).toBe(0);
  });

  it('concurrent posts with a new batchReference resolve to a single reconciliation row', async () => {
    const client = await pool!.connect();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    const scheduleId = randomUUID();
    const policyVersion = `policy-${randomUUID()}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Allocation Client')`, [clientId, branchId, `client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Allocation Product')`, [productId, `product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, branchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, branchId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due, penalty_due, interest_due) VALUES ($1, $2, CURRENT_DATE, 100000, 25000, 5000, 20000)`, [scheduleId, loanId]);
      for (const poolType of ['credit_loss_reserve', 'operating_reserve', 'collection', 'growth']) {
        await client.query(`INSERT INTO capital_pools (branch_id, pool_type, balance) VALUES ($1, $2::pool_type, 0)`, [branchId, poolType]);
      }
      await client.query(`INSERT INTO allocation_policies (version, credit_loss_bps, operating_bps, collection_bps, growth_bps, effective_from) VALUES ($1, 2500, 2500, 2500, 2500, now())`, [policyVersion]);
      await client.query('COMMIT');

      const payment = await postManualPayment({
        actorUserId: userId,
        loanId,
        branchId,
        clientId,
        amount: 135_000,
        idempotencyKey: `payment-${loanId}`,
        localId: `local-${randomUUID()}`,
        deviceId: 'device-allocation',
        paymentMethod: 'cash',
        correlationId: randomUUID(),
      });
      const reconciliationInput = {
        actorUserId: userId,
        actorRole: 'manager' as const,
        branchId,
        batchReference: `matched-${randomUUID()}`,
        expectedAmount: 135_000,
        recordedAmount: 135_000,
        submittedAmount: 135_000,
        paymentIds: [payment.paymentId],
        policyVersion,
        managerOverride: false,
        correlationId: randomUUID(),
      };
      const [reconciliation, concurrentRetry] = await Promise.all([
        postReconciliationBatch(reconciliationInput),
        postReconciliationBatch(reconciliationInput),
      ]);
      const reconciliationRows = await pool!.query<{ id: string; status: string }>('SELECT id, status FROM reconciliations WHERE batch_reference = $1', [reconciliationInput.batchReference]);
      expect(reconciliationRows.rowCount).toBe(1);
      expect(reconciliation.allocation?.realizedCharge).toBe(25_000);
      expect(concurrentRetry.reconciliationId).toBe(reconciliation.reconciliationId);
      expect(concurrentRetry.status).toBe(reconciliation.status);
      const sequentialRetry = await postReconciliationBatch({ ...reconciliationInput, correlationId: randomUUID() });
      expect(sequentialRetry).toMatchObject({ reconciliationId: reconciliation.reconciliationId, status: 'matched', created: false });
      const allocated = await pool!.query<{ total: string }>('SELECT COALESCE(SUM(amount), 0) AS total FROM pool_allocations WHERE ledger_transaction_id = $1', [reconciliation.ledgerTransactionId]);
      expect(allocated.rows[0].total).toBe('25000');
      expect(allocated.rows[0].total).not.toBe('135000');
      const allocationRows = await pool!.query<{ count: string }>('SELECT COUNT(*) AS count FROM pool_allocations WHERE ledger_transaction_id = $1', [reconciliation.ledgerTransactionId]);
      expect(allocationRows.rows[0].count).toBe('4');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('persists a manager rejection reason and makes the terminal result idempotent', async () => {
    const fixture = await seedPaidBranch(9_000);
    const reviewerId = await seedManager(fixture.branchId);
    const batchReference = `variance-${randomUUID()}`;
    const facts = {
      actorRole: 'manager' as const,
      branchId: fixture.branchId,
      batchReference,
      expectedAmount: 10_000,
      recordedAmount: 9_000,
      submittedAmount: 9_000,
      paymentIds: [fixture.paymentId],
      policyVersion: fixture.policyVersion,
      managerOverride: false,
    };
    const held = await postReconciliationBatch({ ...facts, actorUserId: userId, correlationId: randomUUID() });
    expect(held).toMatchObject({ status: 'variance', variance: -1_000, created: true });
    const decision = { ...facts, actorUserId: reviewerId, decision: 'reject' as const, decisionReason: 'Cash count requires correction before posting.' };
    const rejected = await postReconciliationBatch({ ...decision, correlationId: randomUUID() });
    expect(rejected).toMatchObject({ status: 'rejected', variance: -1_000, created: true, decisionReason: decision.decisionReason });
    const stored = await pool!.query<{ status: string; decision_reason: string; reviewed_by: string; submitted_by: string }>('SELECT status, decision_reason, reviewed_by, submitted_by FROM reconciliations WHERE batch_reference = $1', [batchReference]);
    expect(stored.rows[0]).toEqual({ status: 'rejected', decision_reason: decision.decisionReason, reviewed_by: reviewerId, submitted_by: userId });
    const retry = await postReconciliationBatch({ ...decision, correlationId: randomUUID() });
    expect(retry).toMatchObject({ status: 'rejected', created: false, decisionReason: decision.decisionReason });
  });

  it('retrying a pending batch does not double-credit capital pools', async () => {
    const client = await pool!.connect();
    const retryBranchId = randomUUID();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    const scheduleId = randomUUID();
    const policyVersion = `policy-${randomUUID()}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO branches (id, code, name) VALUES ($1, $2, 'Retry Test Branch')`, [retryBranchId, `RETRY-${randomUUID().slice(0, 8)}`]);
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Retry Client')`, [clientId, retryBranchId, `client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Retry Product')`, [productId, `product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, retryBranchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, retryBranchId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due, penalty_due, interest_due) VALUES ($1, $2, CURRENT_DATE, 100000, 25000, 5000, 20000)`, [scheduleId, loanId]);
      for (const poolType of ['credit_loss_reserve', 'operating_reserve', 'collection', 'growth']) {
        await client.query(`INSERT INTO capital_pools (branch_id, pool_type, balance) VALUES ($1, $2::pool_type, 0)`, [retryBranchId, poolType]);
      }
      await client.query(`INSERT INTO allocation_policies (version, credit_loss_bps, operating_bps, collection_bps, growth_bps, effective_from) VALUES ($1, 2500, 2500, 2500, 2500, now())`, [policyVersion]);
      await client.query('COMMIT');

      const payment = await postManualPayment({ actorUserId: userId, loanId, branchId: retryBranchId, clientId, amount: 135_000, idempotencyKey: `payment-${loanId}`, localId: `local-${randomUUID()}`, deviceId: 'device-retry', paymentMethod: 'cash', correlationId: randomUUID() });
      const input = { actorUserId: userId, actorRole: 'manager' as const, branchId: retryBranchId, batchReference: `pending-${randomUUID()}`, expectedAmount: 135_000, recordedAmount: 135_000, submittedAmount: 135_000, paymentIds: [payment.paymentId], policyVersion, managerOverride: false, correlationId: randomUUID() };
      const firstPost = await postReconciliationBatch(input);
      expect(firstPost.status).toBe('matched');
      await pool!.query(`UPDATE reconciliations SET status = 'pending' WHERE batch_reference = $1`, [input.batchReference]);
      const poolRow = await pool!.query<{ id: string; balance: string }>(`SELECT id, balance FROM capital_pools WHERE branch_id = $1 AND pool_type = 'credit_loss_reserve'`, [retryBranchId]);
      const allocationBefore = await pool!.query<{ count: string }>('SELECT COUNT(*) AS count FROM pool_allocations WHERE ledger_transaction_id = $1 AND capital_pool_id = $2', [firstPost.ledgerTransactionId, poolRow.rows[0].id]);
      expect(Number(allocationBefore.rows[0].count)).toBe(1);

      const retry = await postReconciliationBatch(input);
      const retryAgain = await postReconciliationBatch({ ...input, correlationId: randomUUID() });
      expect(retry.ledgerTransactionId).toBe(firstPost.ledgerTransactionId);
      expect(retryAgain.ledgerTransactionId).toBe(firstPost.ledgerTransactionId);
      const poolAfter = await pool!.query<{ balance: string }>('SELECT balance FROM capital_pools WHERE id = $1', [poolRow.rows[0].id]);
      const allocationAfter = await pool!.query<{ count: string }>('SELECT COUNT(*) AS count FROM pool_allocations WHERE ledger_transaction_id = $1 AND capital_pool_id = $2', [firstPost.ledgerTransactionId, poolRow.rows[0].id]);
      expect(Number(poolAfter.rows[0].balance)).toBe(Number(poolRow.rows[0].balance));
      expect(Number(allocationAfter.rows[0].count)).toBe(1);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('rejects a payment that belongs to a different branch', async () => {
    const client = await pool!.connect();
    const otherBranchId = randomUUID();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    const scheduleId = randomUUID();
    const policyVersion = `policy-${randomUUID()}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO branches (id, code, name) VALUES ($1, $2, 'Other Branch')`, [otherBranchId, `OTHER-${randomUUID().slice(0, 8)}`]);
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Other Branch Client')`, [clientId, otherBranchId, `client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Other Branch Product')`, [productId, `product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, otherBranchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, otherBranchId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE, 100000, 0)`, [scheduleId, loanId]);
      await client.query(`INSERT INTO allocation_policies (version, credit_loss_bps, operating_bps, collection_bps, growth_bps, effective_from) VALUES ($1, 2500, 2500, 2500, 2500, now())`, [policyVersion]);
      await client.query('COMMIT');

      // Payment genuinely belongs to otherBranchId, but we try to reconcile it
      // into the suite's own `branchId` — this must be rejected, not silently
      // aggregated into the wrong branch's pools.
      const payment = await postManualPayment({ actorUserId: userId, loanId, branchId: otherBranchId, clientId, amount: 5000, idempotencyKey: `payment-${loanId}`, correlationId: randomUUID() });

      await expect(postReconciliationBatch({
        actorUserId: userId,
        actorRole: 'manager' as const,
        branchId, // the suite's own branch, NOT otherBranchId
        batchReference: `cross-branch-${randomUUID()}`,
        expectedAmount: 5000,
        recordedAmount: 5000,
        submittedAmount: 5000,
        paymentIds: [payment.paymentId],
        policyVersion,
        managerOverride: false,
        correlationId: randomUUID(),
      })).rejects.toThrow('RECONCILIATION_PAYMENT_INVALID');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('rejects a payment already attached to a different reconciliation batch', async () => {
    const client = await pool!.connect();
    const dupBranchId = randomUUID();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    const scheduleId = randomUUID();
    const policyVersion = `policy-${randomUUID()}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO branches (id, code, name) VALUES ($1, $2, 'Dup Branch')`, [dupBranchId, `DUP-${randomUUID().slice(0, 8)}`]);
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Dup Client')`, [clientId, dupBranchId, `client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Dup Product')`, [productId, `product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, dupBranchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, dupBranchId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE, 100000, 0)`, [scheduleId, loanId]);
      for (const poolType of ['credit_loss_reserve', 'operating_reserve', 'collection', 'growth']) {
        await client.query(`INSERT INTO capital_pools (branch_id, pool_type, balance) VALUES ($1, $2::pool_type, 0)`, [dupBranchId, poolType]);
      }
      await client.query(`INSERT INTO allocation_policies (version, credit_loss_bps, operating_bps, collection_bps, growth_bps, effective_from) VALUES ($1, 2500, 2500, 2500, 2500, now())`, [policyVersion]);
      await client.query('COMMIT');

      const payment = await postManualPayment({ actorUserId: userId, loanId, branchId: dupBranchId, clientId, amount: 5000, idempotencyKey: `payment-${loanId}`, correlationId: randomUUID() });

      const firstBatch = {
        actorUserId: userId,
        actorRole: 'manager' as const,
        branchId: dupBranchId,
        batchReference: `dup-first-${randomUUID()}`,
        expectedAmount: 5000,
        recordedAmount: 5000,
        submittedAmount: 5000,
        paymentIds: [payment.paymentId],
        policyVersion,
        managerOverride: false,
        correlationId: randomUUID(),
      };
      const first = await postReconciliationBatch(firstBatch);
      expect(first.status).toBe('matched');

      // Same payment, a brand-new batchReference — must not silently
      // no-op the attach and proceed; it should reject outright.
      await expect(postReconciliationBatch({
        ...firstBatch,
        batchReference: `dup-second-${randomUUID()}`,
        correlationId: randomUUID(),
      })).rejects.toThrow('RECONCILIATION_PAYMENT_ALREADY_RECONCILED');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('rejects a matched/approved batch submitted with zero payments', async () => {
    const policyVersion = `policy-${randomUUID()}`;
    await pool!.query(`INSERT INTO allocation_policies (version, credit_loss_bps, operating_bps, collection_bps, growth_bps, effective_from) VALUES ($1, 2500, 2500, 2500, 2500, now())`, [policyVersion]);
    await expect(postReconciliationBatch({
      actorUserId: userId,
      actorRole: 'manager' as const,
      branchId,
      batchReference: `no-payments-${randomUUID()}`,
      expectedAmount: 5000,
      recordedAmount: 5000,
      submittedAmount: 5000,
      paymentIds: [],
      policyVersion,
      managerOverride: false,
      correlationId: randomUUID(),
    })).rejects.toThrow('RECONCILIATION_NO_PAYMENTS');
  });

  it('rejects a self-approval when a different call later decides a non-terminal batch the same user submitted', async () => {
    const client = await pool!.connect();
    const selfApprovalBranchId = randomUUID();
    const clientId = randomUUID();
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    const scheduleId = randomUUID();
    const policyVersion = `policy-${randomUUID()}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO branches (id, code, name) VALUES ($1, $2, 'Self Approval Branch')`, [selfApprovalBranchId, `SELF-${randomUUID().slice(0, 8)}`]);
      await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Self Approval Client')`, [clientId, selfApprovalBranchId, `client-${clientId}`]);
      await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Self Approval Product')`, [productId, `product-${productId}`]);
      await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, selfApprovalBranchId, userId]);
      await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, selfApprovalBranchId]);
      await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE, 100000, 0)`, [scheduleId, loanId]);
      for (const poolType of ['credit_loss_reserve', 'operating_reserve', 'collection', 'growth']) {
        await client.query(`INSERT INTO capital_pools (branch_id, pool_type, balance) VALUES ($1, $2::pool_type, 0)`, [selfApprovalBranchId, poolType]);
      }
      await client.query(`INSERT INTO allocation_policies (version, credit_loss_bps, operating_bps, collection_bps, growth_bps, effective_from) VALUES ($1, 2500, 2500, 2500, 2500, now())`, [policyVersion]);
      await client.query('COMMIT');

      const payment = await postManualPayment({ actorUserId: userId, loanId, branchId: selfApprovalBranchId, clientId, amount: 5000, idempotencyKey: `payment-${loanId}`, correlationId: randomUUID() });

      const batchReference = `self-approval-${randomUUID()}`;
      // Land the batch in a non-terminal state directly (simulating a crash
      // recovery / migration path that leaves a row pending, per the batch
      // status the audit itself flagged as the only route to non-terminal —
      // insert directly rather than going through the service, since
      // calculateReconciliation never itself returns 'pending').
      await pool!.query(
        `INSERT INTO reconciliations (branch_id, batch_reference, expected_amount, recorded_amount, submitted_amount, variance, status, submitted_by)
         VALUES ($1, $2, 5000, 4000, 4000, -1000, 'pending', $3)`,
        [selfApprovalBranchId, batchReference, userId],
      );

      // Same user who "submitted_by" now tries to record the decision on
      // this pre-existing non-terminal batch — must be rejected.
      await expect(postReconciliationBatch({
        actorUserId: userId,
        actorRole: 'manager' as const,
        branchId: selfApprovalBranchId,
        batchReference,
        expectedAmount: 5000,
        recordedAmount: 4000,
        submittedAmount: 4000,
        paymentIds: [payment.paymentId],
        policyVersion,
        managerOverride: true,
        decision: 'reject',
        decisionReason: 'Cash count requires correction.',
        correlationId: randomUUID(),
      })).rejects.toThrow('RECONCILIATION_SELF_APPROVAL');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('rejects a batch whose recordedAmount differs from the attached payments total', async () => {
    const fixture = await seedPaidBranch(5_000);
    for (const claimed of [900_000_000, 4_000]) {
      const batchReference = `recorded-mismatch-${randomUUID()}`;
      await expect(postReconciliationBatch({
        actorUserId: userId,
        actorRole: 'manager' as const,
        branchId: fixture.branchId,
        batchReference,
        expectedAmount: claimed,
        recordedAmount: claimed,
        submittedAmount: claimed,
        paymentIds: [fixture.paymentId],
        policyVersion: fixture.policyVersion,
        managerOverride: false,
        correlationId: randomUUID(),
      })).rejects.toThrow('RECONCILIATION_RECORDED_AMOUNT_MISMATCH');
      const persisted = await pool!.query('SELECT 1 FROM reconciliations WHERE batch_reference = $1', [batchReference]);
      expect(persisted.rowCount).toBe(0);
      const ledger = await pool!.query('SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1', [`reconciliation-ledger:${batchReference}`]);
      expect(ledger.rowCount).toBe(0);
    }
  });

  it('treats a repeated paymentId as one payment instead of failing or inflating the total', async () => {
    const fixture = await seedPaidBranch(5_000);
    const batchReference = `dup-ids-${randomUUID()}`;
    const result = await postReconciliationBatch({
      actorUserId: userId,
      actorRole: 'manager' as const,
      branchId: fixture.branchId,
      batchReference,
      expectedAmount: 5_000,
      recordedAmount: 5_000,
      submittedAmount: 5_000,
      paymentIds: [fixture.paymentId, fixture.paymentId],
      policyVersion: fixture.policyVersion,
      managerOverride: false,
      correlationId: randomUUID(),
    });
    expect(result).toMatchObject({ status: 'matched', created: true });
    const attached = await pool!.query('SELECT 1 FROM reconciliation_payments WHERE reconciliation_id = $1', [result.reconciliationId]);
    expect(attached.rowCount).toBe(1);
  });

  describe('segregation of duties on variance batches', () => {
    const varianceFacts = (fixture: { branchId: string; paymentId: string; policyVersion: string }) => ({
      actorRole: 'manager' as const,
      branchId: fixture.branchId,
      batchReference: `sod-${randomUUID()}`,
      expectedAmount: 6_000,
      recordedAmount: 5_000,
      submittedAmount: 5_000,
      paymentIds: [fixture.paymentId],
      policyVersion: fixture.policyVersion,
    });

    it('holds a variance submitted without a decision for review and posts nothing', async () => {
      const fixture = await seedPaidBranch(5_000);
      const facts = varianceFacts(fixture);
      const held = await postReconciliationBatch({ ...facts, actorUserId: userId, managerOverride: false, correlationId: randomUUID() });
      expect(held).toMatchObject({ status: 'variance', variance: -1_000, created: true });
      expect(held.ledgerTransactionId).toBeUndefined();
      const ledger = await pool!.query('SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1', [`reconciliation-ledger:${facts.batchReference}`]);
      expect(ledger.rowCount).toBe(0);
      const again = await postReconciliationBatch({ ...facts, actorUserId: userId, managerOverride: false, correlationId: randomUUID() });
      expect(again).toMatchObject({ reconciliationId: held.reconciliationId, status: 'variance', created: false });
    });

    it('rejects submit-and-approve by the same user in a single call', async () => {
      const fixture = await seedPaidBranch(5_000);
      const facts = varianceFacts(fixture);
      await expect(postReconciliationBatch({ ...facts, actorUserId: userId, managerOverride: true, decision: 'approve', decisionReason: 'Approving my own submission.', correlationId: randomUUID() })).rejects.toThrow('RECONCILIATION_SELF_APPROVAL');
      const persisted = await pool!.query('SELECT 1 FROM reconciliations WHERE batch_reference = $1', [facts.batchReference]);
      expect(persisted.rowCount).toBe(0);
    });

    it('stops the submitter from approving or rejecting a batch they submitted', async () => {
      const fixture = await seedPaidBranch(5_000);
      const facts = varianceFacts(fixture);
      await postReconciliationBatch({ ...facts, actorUserId: userId, managerOverride: false, correlationId: randomUUID() });
      for (const decision of ['approve', 'reject'] as const) {
        await expect(postReconciliationBatch({ ...facts, actorUserId: userId, managerOverride: true, decision, decisionReason: 'Deciding my own submission.', correlationId: randomUUID() })).rejects.toThrow('RECONCILIATION_SELF_APPROVAL');
      }
      const row = await pool!.query<{ status: string }>('SELECT status FROM reconciliations WHERE batch_reference = $1', [facts.batchReference]);
      expect(row.rows[0].status).toBe('variance');
    });

    it('lets a different manager approve a held batch, which then posts the ledger once', async () => {
      const fixture = await seedPaidBranch(5_000);
      const reviewerId = await seedManager(fixture.branchId);
      const facts = varianceFacts(fixture);
      await postReconciliationBatch({ ...facts, actorUserId: userId, managerOverride: false, correlationId: randomUUID() });
      const approved = await postReconciliationBatch({ ...facts, actorUserId: reviewerId, managerOverride: true, decision: 'approve', decisionReason: 'Short count explained by collector.', correlationId: randomUUID() });
      expect(approved).toMatchObject({ status: 'approved', created: true });
      expect(approved.ledgerTransactionId).toBeDefined();
      const row = await pool!.query<{ status: string; submitted_by: string; reviewed_by: string }>('SELECT status, submitted_by, reviewed_by FROM reconciliations WHERE batch_reference = $1', [facts.batchReference]);
      expect(row.rows[0]).toEqual({ status: 'approved', submitted_by: userId, reviewed_by: reviewerId });
      const replay = await postReconciliationBatch({ ...facts, actorUserId: reviewerId, managerOverride: true, decision: 'approve', decisionReason: 'Short count explained by collector.', correlationId: randomUUID() });
      expect(replay).toMatchObject({ status: 'approved', created: false });
    });
  });

  describe('loan-state, assignment, and error-mapping guards on payment posting', () => {
    async function seedLoanWithStatus(status: string): Promise<{ loanId: string; clientId: string }> {
      const clientId = randomUUID();
      const productId = randomUUID();
      const applicationId = randomUUID();
      const loanId = randomUUID();
      await pool!.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Guard Client')`, [clientId, branchId, `client-${clientId}`]);
      await pool!.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Guard Product')`, [productId, `product-${productId}`]);
      await pool!.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 50000, $5)`, [applicationId, clientId, productId, branchId, userId]);
      await pool!.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 50000, 50000, $5::loan_status)`, [loanId, applicationId, clientId, branchId, status]);
      await pool!.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE, 50000, 0)`, [randomUUID(), loanId]);
      return { loanId, clientId };
    }

    it('rejects a payment against a loan that is not yet disbursed', async () => {
      const { loanId } = await seedLoanWithStatus('approved');
      await expect(postManualPayment({ actorUserId: userId, loanId, branchId, amount: 10000, idempotencyKey: `np-${loanId}`, correlationId: randomUUID() })).rejects.toThrow('LOAN_NOT_PAYABLE');
    });

    it('rejects a payment against a written-off loan', async () => {
      const { loanId } = await seedLoanWithStatus('written_off');
      await expect(postManualPayment({ actorUserId: userId, loanId, branchId, amount: 10000, idempotencyKey: `wo-${loanId}`, correlationId: randomUUID() })).rejects.toThrow('LOAN_NOT_PAYABLE');
    });

    it('allows a recovery payment against a defaulted loan', async () => {
      const { loanId } = await seedLoanWithStatus('defaulted');
      const result = await postManualPayment({ actorUserId: userId, loanId, branchId, amount: 10000, idempotencyKey: `def-${loanId}`, correlationId: randomUUID() });
      expect(result.principalAmount).toBe(10000);
    });

    it('an idempotent retry succeeds even though the payment itself already completed the loan', async () => {
      const { loanId } = await seedLoanWithStatus('active');
      const key = `complete-${loanId}`;
      const first = await postManualPayment({ actorUserId: userId, loanId, branchId, amount: 50000, idempotencyKey: key, correlationId: randomUUID() });
      expect(first).toMatchObject({ loanStatus: 'completed', created: true });
      // Same idempotency key, loan is now 'completed' — must still return the original result,
      // not fail LOAN_NOT_PAYABLE because of a state change the payment itself caused.
      const retry = await postManualPayment({ actorUserId: userId, loanId, branchId, amount: 50000, idempotencyKey: key, correlationId: randomUUID() });
      expect(retry).toMatchObject({ paymentId: first.paymentId, created: false, loanStatus: 'completed' });
    });

    it('rejects a collector with no active assignment to the client', async () => {
      const { loanId } = await seedLoanWithStatus('active');
      await expect(postManualPayment({ actorUserId: randomUUID(), actorRole: 'collector', loanId, branchId, amount: 10000, idempotencyKey: `unassigned-${loanId}`, correlationId: randomUUID() })).rejects.toThrow('COLLECTOR_NOT_ASSIGNED');
    });

    it('allows a collector with an active assignment, and an admin/manager bypasses the check entirely', async () => {
      const { loanId, clientId } = await seedLoanWithStatus('active');
      const collectorId = randomUUID();
      const roleId = (await pool!.query<{ id: string }>(`INSERT INTO roles (code, name) VALUES ($1, 'Collector') RETURNING id`, [`collector-${randomUUID()}`])).rows[0].id;
      await pool!.query(`INSERT INTO users (id, firebase_uid, display_name, role_id, branch_id) VALUES ($1, $2, 'Assigned Collector', $3, $4)`, [collectorId, `collector-${collectorId}`, roleId, branchId]);
      await pool!.query(`INSERT INTO collector_assignments (officer_id, client_id, branch_id, route_code) VALUES ($1, $2, $3, 'ROUTE-1')`, [collectorId, clientId, branchId]);
      const result = await postManualPayment({ actorUserId: collectorId, actorRole: 'collector', loanId, branchId, amount: 10000, idempotencyKey: `assigned-${loanId}`, correlationId: randomUUID() });
      expect(result.principalAmount).toBe(10000);
    });

    it('an idempotent retry succeeds for a collector even after their assignment window has since lapsed', async () => {
      const { loanId, clientId } = await seedLoanWithStatus('active');
      const collectorId = randomUUID();
      const roleId = (await pool!.query<{ id: string }>(`INSERT INTO roles (code, name) VALUES ($1, 'Collector') RETURNING id`, [`collector-${randomUUID()}`])).rows[0].id;
      await pool!.query(`INSERT INTO users (id, firebase_uid, display_name, role_id, branch_id) VALUES ($1, $2, 'Lapsing Collector', $3, $4)`, [collectorId, `collector-${collectorId}`, roleId, branchId]);
      const assignment = await pool!.query<{ id: string }>(`INSERT INTO collector_assignments (officer_id, client_id, branch_id, route_code, effective_from) VALUES ($1, $2, $3, 'ROUTE-2', CURRENT_DATE - INTERVAL '30 days') RETURNING id`, [collectorId, clientId, branchId]);
      const key = `lapsed-${loanId}`;
      // First call: assignment is valid, payment succeeds normally.
      const first = await postManualPayment({ actorUserId: collectorId, actorRole: 'collector', loanId, branchId, amount: 10000, idempotencyKey: key, correlationId: randomUUID() });
      expect(first.created).toBe(true);
      // Assignment lapses (route reassigned, collector reassigned elsewhere, etc.) sometime after.
      await pool!.query(`UPDATE collector_assignments SET effective_to = CURRENT_DATE - INTERVAL '1 day' WHERE id = $1`, [assignment.rows[0].id]);
      // Same idempotency key, same collector — must still return the original result, not fail
      // COLLECTOR_NOT_ASSIGNED because of a lapse that happened after the original payment posted.
      const retry = await postManualPayment({ actorUserId: collectorId, actorRole: 'collector', loanId, branchId, amount: 10000, idempotencyKey: key, correlationId: randomUUID() });
      expect(retry).toMatchObject({ paymentId: first.paymentId, created: false });
    });

    it('maps a known business-rule error to its HTTP status instead of a generic 500', async () => {
      const { loanId } = await seedLoanWithStatus('approved');
      const app = Fastify();
      const verifier: TokenVerifier = async () => ({ uid: `http-guard-${userId}` }) as never;
      const resolveUser: UserResolver = async () => ({ dbUserId: userId, db_user_id: userId, firebaseUid: `http-guard-${userId}`, firebase_uid: `http-guard-${userId}`, role: 'manager', branchId, branch_id: branchId, clientId: null, client_id: null, permissions: [] });
      registerPaymentRoutes(app, verifier, resolveUser);
      await app.ready();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: 'Bearer valid' },
        payload: { loanId, branchId, amount: 10000, idempotencyKey: `http-${loanId}` },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ ok: false, error: { code: 'LOAN_NOT_PAYABLE' } });
      await app.close();
    });
  });

  describe('payment set is locked once a batch exists', () => {
    it('rejects a decision that swaps in a different, equal-sum payment set', async () => {
      const branchId = randomUUID();
      const fixtureA = await seedPaidBranch(50_000);
      const fixtureB = await seedPaidBranchInBranch(branchId, 20_000, fixtureA.policyVersion);
      const fixtureC = await seedPaidBranchInBranch(branchId, 30_000, fixtureA.policyVersion);
      const reviewerId = await seedManager(fixtureA.branchId);
      const batchReference = `swap-${randomUUID()}`;
      const shared = { actorRole: 'manager' as const, branchId: fixtureA.branchId, batchReference, expectedAmount: 60_000, recordedAmount: 50_000, submittedAmount: 50_000, policyVersion: fixtureA.policyVersion };
      const submitted = await postReconciliationBatch({ ...shared, actorUserId: userId, paymentIds: [fixtureA.paymentId], managerOverride: false, correlationId: randomUUID() });
      expect(submitted).toMatchObject({ status: 'variance', created: true });
      await expect(postReconciliationBatch({ ...shared, actorUserId: reviewerId, paymentIds: [fixtureB.paymentId, fixtureC.paymentId], managerOverride: true, decision: 'approve', decisionReason: 'swap attempt', correlationId: randomUUID() })).rejects.toThrow('RECONCILIATION_PAYMENT_SET_MISMATCH');
      const attached = await pool!.query('SELECT payment_id FROM reconciliation_payments WHERE reconciliation_id = $1', [submitted.reconciliationId]);
      expect(attached.rows.map((row: { payment_id: string }) => row.payment_id)).toEqual([fixtureA.paymentId]);
      const row = await pool!.query<{ status: string }>('SELECT status FROM reconciliations WHERE batch_reference = $1', [batchReference]);
      expect(row.rows[0].status).toBe('variance');
    });

    it('still allows a decision that resubmits the exact same payment set, in a different order', async () => {
      const branchId = randomUUID();
      const fixtureA = await seedPaidBranchInBranch(branchId, 20_000, undefined);
      const fixtureB = await seedPaidBranchInBranch(branchId, 30_000, fixtureA.policyVersion);
      const reviewerId = await seedManager(branchId);
      const batchReference = `same-set-${randomUUID()}`;
      const shared = { actorRole: 'manager' as const, branchId, batchReference, expectedAmount: 60_000, recordedAmount: 50_000, submittedAmount: 50_000, policyVersion: fixtureA.policyVersion };
      await postReconciliationBatch({ ...shared, actorUserId: userId, paymentIds: [fixtureA.paymentId, fixtureB.paymentId], managerOverride: false, correlationId: randomUUID() });
      const approved = await postReconciliationBatch({ ...shared, actorUserId: reviewerId, paymentIds: [fixtureB.paymentId, fixtureA.paymentId], managerOverride: true, decision: 'approve', decisionReason: 'same set, different order', correlationId: randomUUID() });
      expect(approved).toMatchObject({ status: 'approved', created: true });
    });
  });
});

// --- shared fixtures -------------------------------------------------------

async function seedPaidBranch(amount: number): Promise<{ branchId: string; paymentId: string; policyVersion: string; loanId: string }> {
  const branchId = randomUUID();
  const clientId = randomUUID();
  const productId = randomUUID();
  const applicationId = randomUUID();
  const loanId = randomUUID();
  const policyVersion = `policy-${randomUUID()}`;
  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO branches (id, code, name) VALUES ($1, $2, 'Fixture Branch')`, [branchId, `FIX-${randomUUID().slice(0, 8)}`]);
    await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Fixture Client')`, [clientId, branchId, `client-${clientId}`]);
    await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Fixture Product')`, [productId, `product-${productId}`]);
    await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, branchId, userId]);
    await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, branchId]);
    await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE, 100000, 0)`, [randomUUID(), loanId]);
    for (const poolType of ['credit_loss_reserve', 'operating_reserve', 'collection', 'growth']) {
      await client.query(`INSERT INTO capital_pools (branch_id, pool_type, balance) VALUES ($1, $2::pool_type, 0)`, [branchId, poolType]);
    }
    await client.query(`INSERT INTO allocation_policies (version, credit_loss_bps, operating_bps, collection_bps, growth_bps, effective_from) VALUES ($1, 2500, 2500, 2500, 2500, now())`, [policyVersion]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const payment = await postManualPayment({ actorUserId: userId, loanId, branchId, clientId, amount, idempotencyKey: `payment-${loanId}`, correlationId: randomUUID() });
  return { branchId, paymentId: payment.paymentId, policyVersion, loanId };
}

async function seedPaidBranchInBranch(branchId: string, amount: number, policyVersion: string | undefined): Promise<{ branchId: string; paymentId: string; policyVersion: string; loanId: string }> {
  const clientId = randomUUID();
  const productId = randomUUID();
  const applicationId = randomUUID();
  const loanId = randomUUID();
  const resolvedPolicyVersion = policyVersion ?? `policy-${randomUUID()}`;
  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    const branchExists = await client.query('SELECT 1 FROM branches WHERE id = $1', [branchId]);
    if (!branchExists.rowCount) await client.query(`INSERT INTO branches (id, code, name) VALUES ($1, $2, 'Fixture Branch')`, [branchId, `FIX-${randomUUID().slice(0, 8)}`]);
    await client.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Fixture Client')`, [clientId, branchId, `client-${clientId}`]);
    await client.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Fixture Product')`, [productId, `product-${productId}`]);
    await client.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, $4, 100000, $5)`, [applicationId, clientId, productId, branchId, userId]);
    await client.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 100000, 100000, 'active')`, [loanId, applicationId, clientId, branchId]);
    await client.query(`INSERT INTO repayment_schedules (id, loan_id, due_on, principal_due, charge_due) VALUES ($1, $2, CURRENT_DATE, 100000, 0)`, [randomUUID(), loanId]);
    const poolsExist = await client.query('SELECT 1 FROM capital_pools WHERE branch_id = $1', [branchId]);
    if (!poolsExist.rowCount) {
      for (const poolType of ['credit_loss_reserve', 'operating_reserve', 'collection', 'growth']) {
        await client.query(`INSERT INTO capital_pools (branch_id, pool_type, balance) VALUES ($1, $2::pool_type, 0)`, [branchId, poolType]);
      }
    }
    if (!policyVersion) {
      await client.query(`INSERT INTO allocation_policies (version, credit_loss_bps, operating_bps, collection_bps, growth_bps, effective_from) VALUES ($1, 2500, 2500, 2500, 2500, now())`, [resolvedPolicyVersion]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const payment = await postManualPayment({ actorUserId: userId, loanId, branchId, clientId, amount, idempotencyKey: `payment-${loanId}`, correlationId: randomUUID() });
  return { branchId, paymentId: payment.paymentId, policyVersion: resolvedPolicyVersion, loanId };
}

async function seedManager(branchId: string): Promise<string> {
  const roleId = (await pool!.query<{ id: string }>(`INSERT INTO roles (code, name) VALUES ($1, 'Reviewer') RETURNING id`, [`reviewer-${randomUUID()}`])).rows[0].id;
  const reviewerId = randomUUID();
  await pool!.query(`INSERT INTO users (id, firebase_uid, display_name, role_id, branch_id) VALUES ($1, $2, 'Reviewer', $3, $4)`, [reviewerId, `reviewer-${reviewerId}`, roleId, branchId]);
  return reviewerId;
}
