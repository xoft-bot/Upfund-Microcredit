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

  it('rejects reconciliation variance and rolls back the batch', async () => {
    const batch = `batch-${randomUUID()}`;
    await expect(postReconciliationBatch({ actorUserId: userId, actorRole: 'manager', branchId, batchReference: batch, expectedAmount: 100, recordedAmount: 90, submittedAmount: 80, paymentIds: [], policyVersion: 'v1', managerOverride: false, correlationId: randomUUID() })).rejects.toThrow('RECONCILIATION_VARIANCE_REQUIRES_MANAGER_OVERRIDE');
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
    const batchReference = `variance-${randomUUID()}`;
    const input = {
      actorUserId: userId,
      actorRole: 'manager' as const,
      branchId,
      batchReference,
      expectedAmount: 10_000,
      recordedAmount: 9_000,
      submittedAmount: 9_000,
      paymentIds: [] as string[],
      policyVersion: 'unused-for-rejection',
      managerOverride: false,
      decision: 'reject' as const,
      decisionReason: 'Cash count requires correction before posting.',
      correlationId: randomUUID(),
    };
    const rejected = await postReconciliationBatch(input);
    expect(rejected).toMatchObject({ status: 'rejected', variance: -1_000, created: true, decisionReason: input.decisionReason });
    const stored = await pool!.query<{ status: string; decision_reason: string; reviewed_by: string }>('SELECT status, decision_reason, reviewed_by FROM reconciliations WHERE batch_reference = $1', [batchReference]);
    expect(stored.rows[0]).toEqual({ status: 'rejected', decision_reason: input.decisionReason, reviewed_by: userId });
    const retry = await postReconciliationBatch({ ...input, correlationId: randomUUID() });
    expect(retry).toMatchObject({ status: 'rejected', created: false, decisionReason: input.decisionReason });
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
});
