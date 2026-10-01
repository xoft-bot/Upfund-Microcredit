import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/src/app.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;

let branchId: string;
let productId: string;
let managerAId: string; // creates + attempts to decide its own application (should be blocked)
let managerBId: string; // a different manager in the same branch (should be allowed to decide)
let collectorAId: string; // assigned to the test client
let collectorBId: string; // not assigned to the test client
let clientId: string;

function tokenFor(uid: string): string {
  return `Bearer ${uid}`;
}

async function createApprovedKycRiskApplication(app: ReturnType<typeof buildApp>, creatorAuth: string, requestedAmount = 150_000): Promise<string> {
  // A fresh client per application avoids reusing another application's already-'verified' KYC
  // record for the same client (kyc_records has no valid 'verified' -> 'verified' transition).
  const applicationClientId = randomUUID();
  await pool!.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Auth Patch Decision Client')`, [applicationClientId, branchId, `authpatch-decision-client-${applicationClientId}`]);
  const headers = { authorization: creatorAuth };
  const created = await app.inject({ method: 'POST', url: '/api/v1/loan-applications', headers, payload: { clientId: applicationClientId, productId, requestedAmount } });
  expect(created.statusCode).toBe(200);
  const applicationId = created.json().data.id as string;
  expect((await app.inject({ method: 'POST', url: `/api/v1/loan-applications/${applicationId}/submit`, headers })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/api/v1/loan-applications/${applicationId}/kyc`, headers, payload: { status: 'verified', verificationMethod: 'National ID', evidenceNotes: 'Verified for authorization-patch test' } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/api/v1/loan-applications/${applicationId}/risk`, headers, payload: { score: 70, riskGrade: 'B', status: 'approved', policyVersion: 'auth-patch-test-v1', rationale: 'Acceptable for authorization-patch test' } })).statusCode).toBe(200);
  return applicationId;
}

suite('Authorization patch: self-approval guard + collector client-read scope', () => {
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
    const roles = await pool!.query<{ code: string; id: string }>(`SELECT code, id FROM roles WHERE code IN ('manager', 'collector')`);
    const roleId = (code: string) => roles.rows.find((r) => r.code === code)!.id;

    const branch = await pool!.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Auth Patch Branch') RETURNING id`, [`AUTHPATCH-${randomUUID().slice(0, 8)}`]);
    branchId = branch.rows[0].id;

    managerAId = randomUUID();
    await pool!.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Auth Patch Manager A', $4, $5)`, [managerAId, `authpatch-mgr-a-${managerAId}`, `authpatch-mgr-a-${managerAId}@example.test`, roleId('manager'), branchId]);
    managerBId = randomUUID();
    await pool!.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Auth Patch Manager B', $4, $5)`, [managerBId, `authpatch-mgr-b-${managerBId}`, `authpatch-mgr-b-${managerBId}@example.test`, roleId('manager'), branchId]);
    collectorAId = randomUUID();
    await pool!.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Auth Patch Collector A', $4, $5)`, [collectorAId, `authpatch-col-a-${collectorAId}`, `authpatch-col-a-${collectorAId}@example.test`, roleId('collector'), branchId]);
    collectorBId = randomUUID();
    await pool!.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Auth Patch Collector B', $4, $5)`, [collectorBId, `authpatch-col-b-${collectorBId}`, `authpatch-col-b-${collectorBId}@example.test`, roleId('collector'), branchId]);

    clientId = randomUUID();
    await pool!.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Auth Patch Client')`, [clientId, branchId, `authpatch-client-${clientId}`]);
    productId = randomUUID();
    await pool!.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Auth Patch Product')`, [productId, `authpatch-product-${productId}`]);

    // Collector A gets a live assignment to the client; Collector B does not.
    await pool!.query(
      `INSERT INTO collector_assignments (officer_id, client_id, branch_id, route_code, effective_from) VALUES ($1, $2, $3, 'AUTHPATCH-ROUTE', CURRENT_DATE)`,
      [collectorAId, clientId, branchId],
    );
  });

  afterAll(async () => {
    await app.close();
    await pool?.end();
  });

  it('blocks the creating manager from deciding their own application (403 FORBIDDEN_SELF_APPROVAL)', async () => {
    const managerAAuth = tokenFor(`authpatch-mgr-a-${managerAId}`);
    const applicationId = await createApprovedKycRiskApplication(app, managerAAuth);

    const decision = await app.inject({
      method: 'POST',
      url: `/api/v1/loan-applications/${applicationId}/decision`,
      headers: { authorization: managerAAuth },
      payload: { decision: 'approve', reason: 'Attempting to approve my own application' },
    });

    expect(decision.statusCode).toBe(403);
    expect(decision.json().error.code).toBe('FORBIDDEN_SELF_APPROVAL');

    // The application must not have moved to 'approved' — the guard has to fire before any mutation.
    const row = await pool!.query<{ status: string }>('SELECT status FROM loan_applications WHERE id = $1', [applicationId]);
    expect(row.rows[0].status).toBe('risk_assessed');
  });

  it('lets a different manager in the same branch decide the application (200 OK)', async () => {
    const managerAAuth = tokenFor(`authpatch-mgr-a-${managerAId}`);
    const managerBAuth = tokenFor(`authpatch-mgr-b-${managerBId}`);
    const applicationId = await createApprovedKycRiskApplication(app, managerAAuth);

    const decision = await app.inject({
      method: 'POST',
      url: `/api/v1/loan-applications/${applicationId}/decision`,
      headers: { authorization: managerBAuth },
      payload: { decision: 'approve', reason: 'A different manager approving' },
    });

    expect(decision.statusCode).toBe(200);
    expect(decision.json().data.status).toBe('approved');
  });

  it('blocks self-approval on rejection too, not just approval', async () => {
    const managerAAuth = tokenFor(`authpatch-mgr-a-${managerAId}`);
    const applicationId = await createApprovedKycRiskApplication(app, managerAAuth);

    const decision = await app.inject({
      method: 'POST',
      url: `/api/v1/loan-applications/${applicationId}/decision`,
      headers: { authorization: managerAAuth },
      payload: { decision: 'reject', reason: 'Attempting to reject my own application' },
    });

    expect(decision.statusCode).toBe(403);
    expect(decision.json().error.code).toBe('FORBIDDEN_SELF_APPROVAL');
  });

  it('lets an assigned collector fetch the client they are actively assigned to (200 OK)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientId}`,
      headers: { authorization: tokenFor(`authpatch-col-a-${collectorAId}`) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.id).toBe(clientId);
  });

  it('denies an unassigned collector reading the same client (403/empty, not found)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientId}`,
      headers: { authorization: tokenFor(`authpatch-col-b-${collectorBId}`) },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('CLIENT_NOT_FOUND');
  });

  it('does not extend the paginated /clients list to collectors (still 403 by role)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/clients',
      headers: { authorization: tokenFor(`authpatch-col-a-${collectorAId}`) },
    });

    expect(response.statusCode).toBe(403);
  });
});
