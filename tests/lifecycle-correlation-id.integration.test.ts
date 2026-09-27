import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/src/app.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;

let branchId: string;
let clientId: string;
let productId: string;
let managerId: string;
let officerId: string;

const CORRELATION_ID = randomUUID();

function tokenFor(uid: string) { return `Bearer ${uid}`; }

suite('Lifecycle correlation-ID propagation', () => {
  const app = buildApp({
    tokenVerifier: async (token: string) => ({ uid: token.replace('Bearer ', '') } as never),
    userResolver: async (firebaseUid: string) => {
      const result = await pool!.query<{ db_user_id: string; role: string; branch_id: string | null; permissions: string[] }>(
        `SELECT u.id AS db_user_id, r.code AS role, u.branch_id,
                COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
           FROM users u
           JOIN roles r ON r.id = u.role_id
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
           LEFT JOIN permissions p ON p.id = rp.permission_id
          WHERE u.firebase_uid = $1
          GROUP BY u.id, r.code, u.branch_id`,
        [firebaseUid],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0];
      return { dbUserId: row.db_user_id, firebaseUid, role: row.role as never, branchId: row.branch_id, permissions: row.permissions };
    },
  });

  beforeAll(async () => {
    const roles = await pool!.query<{ code: string; id: string }>(`SELECT code, id FROM roles WHERE code IN ('manager', 'officer')`);
    const roleId = (code: string) => roles.rows.find((r) => r.code === code)!.id;
    const branch = await pool!.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Correlation Branch') RETURNING id`, [`CORR-${randomUUID().slice(0, 8)}`]);
    branchId = branch.rows[0].id;

    managerId = randomUUID();
    await pool!.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Correlation Manager', $4, $5)`, [managerId, `corr-mgr-${managerId}`, `corr-mgr-${managerId}@example.test`, roleId('manager'), branchId]);
    officerId = randomUUID();
    await pool!.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Correlation Officer', $4, $5)`, [officerId, `corr-off-${officerId}`, `corr-off-${officerId}@example.test`, roleId('officer'), branchId]);

    clientId = randomUUID();
    await pool!.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Correlation Client')`, [clientId, branchId, `corr-client-${clientId}`]);
    productId = randomUUID();
    await pool!.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Correlation Product')`, [productId, `corr-product-${productId}`]);
  });

  afterAll(async () => { await app.close(); await pool?.end(); });

  it('threads one request correlation ID through the whole application-to-disbursement flow, into the ledger transaction too', async () => {
    const officerAuth = tokenFor(`corr-off-${officerId}`);
    const managerAuth = tokenFor(`corr-mgr-${managerId}`);
    const headers = { authorization: officerAuth, 'x-correlation-id': CORRELATION_ID };

    const created = await app.inject({ method: 'POST', url: '/api/v1/loan-applications', headers, payload: { clientId, productId, requestedAmount: 250_000 } });
    expect(created.statusCode).toBe(200);
    const applicationId = created.json().data.id as string;

    expect((await app.inject({ method: 'POST', url: `/api/v1/loan-applications/${applicationId}/submit`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/loan-applications/${applicationId}/kyc`, headers, payload: { status: 'verified', verificationMethod: 'National ID', evidenceNotes: 'Verified for correlation-id test' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/loan-applications/${applicationId}/risk`, headers: { ...headers, authorization: managerAuth }, payload: { score: 70, riskGrade: 'B', status: 'approved', policyVersion: 'corr-test-v1', rationale: 'Acceptable for correlation-id test' } })).statusCode).toBe(200);
    const decision = await app.inject({ method: 'POST', url: `/api/v1/loan-applications/${applicationId}/decision`, headers: { ...headers, authorization: managerAuth }, payload: { decision: 'approve', reason: 'Approved for correlation-id test' } });
    expect(decision.statusCode).toBe(200);
    const loanId = decision.json().data.loanId as string;

    const disbursement = await app.inject({ method: 'POST', url: `/api/v1/loans/${loanId}/disburse`, headers: { ...headers, authorization: managerAuth }, payload: { disbursementReference: `CORR-DISB-${applicationId}`, idempotencyKey: `corr-idem-${applicationId}` } });
    expect(disbursement.statusCode).toBe(200);

    const auditRows = await pool!.query<{ action: string; correlation_id: string }>(
      `SELECT action, correlation_id FROM audit_events WHERE entity_id IN ($1, $2) ORDER BY created_at`,
      [applicationId, loanId],
    );
    expect(auditRows.rows.length).toBeGreaterThanOrEqual(5);
    for (const row of auditRows.rows) expect(row.correlation_id).toBe(CORRELATION_ID);

    // The ledger transaction posted during disbursement should carry the same
    // ID too — this is the second, previously-independent randomUUID() call
    // inside disburseLoan that the fix also had to close.
    const ledgerRows = await pool!.query<{ correlation_id: string }>(
      `SELECT correlation_id FROM ledger_transactions WHERE source_type = 'loan_disbursement' AND source_id = $1`,
      [loanId],
    );
    expect(ledgerRows.rows).toHaveLength(1);
    expect(ledgerRows.rows[0].correlation_id).toBe(CORRELATION_ID);
  });
});
