import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../../shared/contracts.js';
import { assessApplicationRisk, decideApplication, getApplicationTimeline, reviewKyc, submitLoanApplication } from '../../server/src/services/lifecycle.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;
const actor: Actor = { userId: randomUUID(), dbUserId: '', firebaseUid: `underwriting-${randomUUID()}`, role: 'manager', branchId: null, permissions: ['kyc.review', 'risk.assess', 'loans.approve'] };
let branchId: string;
let roleId: string;
let clientId: string;
let productId: string;
let applicationId: string;
const requiredRlsTables = [
  'allocation_policies', 'application_transition_history', 'audit_events', 'branches',
  'businesses', 'capital_pools', 'clients', 'collector_assignments',
  'field_collection_records', 'kyc_records', 'ledger_entries', 'ledger_transactions',
  'loan_applications', 'loan_disbursements', 'loan_products', 'loans',
  'overpayment_holdings', 'payments', 'permissions', 'pool_allocations', 'receipts',
  'reconciliation_payments', 'reconciliations', 'repayment_schedules',
  'risk_assessments', 'role_permissions', 'roles', 'users',
];

suite('controlled underwriting and timeline integration', () => {
  beforeAll(async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      branchId = (await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Underwriting Test Branch') RETURNING id`, [`underwriting-${randomUUID()}`])).rows[0].id;
      roleId = (await client.query<{ id: string }>(`INSERT INTO roles (code, name) VALUES ($1, 'Underwriting Test Manager') RETURNING id`, [`underwriting-manager-${randomUUID()}`])).rows[0].id;
      await client.query(`INSERT INTO users (id, firebase_uid, display_name, role_id, branch_id) VALUES ($1, $2, 'Underwriting Test Manager', $3, $4)`, [actor.userId, actor.firebaseUid, roleId, branchId]);
      actor.dbUserId = actor.userId; actor.branchId = branchId;
      clientId = (await client.query<{ id: string }>(`INSERT INTO clients (branch_id, external_ref, display_name) VALUES ($1, $2, 'Underwriting Test Client') RETURNING id`, [branchId, `underwriting-client-${randomUUID()}`])).rows[0].id;
      productId = (await client.query<{ id: string }>(`INSERT INTO loan_products (code, name) VALUES ($1, 'Underwriting Test Product') RETURNING id`, [`underwriting-product-${randomUUID()}`])).rows[0].id;
      applicationId = (await client.query<{ id: string }>(`INSERT INTO loan_applications (client_id, product_id, branch_id, requested_amount, created_by) VALUES ($1, $2, $3, 100000, $4) RETURNING id`, [clientId, productId, branchId, actor.userId])).rows[0].id;
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  afterAll(async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM application_transition_history WHERE application_id = $1', [applicationId]);
      await client.query('DELETE FROM repayment_schedules WHERE loan_id IN (SELECT id FROM loans WHERE application_id = $1)', [applicationId]);
      await client.query('DELETE FROM loans WHERE application_id = $1', [applicationId]);
      await client.query('UPDATE loan_applications SET risk_assessment_id = NULL WHERE id = $1', [applicationId]);
      await client.query('DELETE FROM risk_assessments WHERE application_id = $1', [applicationId]);
      await client.query('DELETE FROM kyc_records WHERE client_id = $1', [clientId]);
      await client.query('DELETE FROM loan_applications WHERE id = $1', [applicationId]);
      await client.query('DELETE FROM clients WHERE id = $1', [clientId]);
      await client.query('DELETE FROM loan_products WHERE id = $1', [productId]);
      await client.query('DELETE FROM audit_events WHERE actor_user_id = $1', [actor.userId]);
      await client.query('DELETE FROM users WHERE id = $1', [actor.userId]);
      await client.query('DELETE FROM roles WHERE id = $1', [roleId]);
      await client.query('DELETE FROM branches WHERE id = $1', [branchId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool!.end(); }
  });

  it('has the 014 underwriting evidence and timeline schema', async () => {
    const result = await pool!.query<{ table_name: string; column_name: string | null }>(`SELECT 'application_transition_history' AS table_name, NULL::text AS column_name WHERE to_regclass('application_transition_history') IS NOT NULL UNION ALL SELECT 'kyc_records', column_name FROM information_schema.columns WHERE table_name = 'kyc_records' AND column_name = 'evidence_notes' UNION ALL SELECT 'risk_assessments', column_name FROM information_schema.columns WHERE table_name = 'risk_assessments' AND column_name IN ('rationale', 'assessed_at')`);
    expect(result.rows.map((row) => `${row.table_name}:${row.column_name ?? 'table'}`)).toEqual(expect.arrayContaining(['application_transition_history:table', 'kyc_records:evidence_notes', 'risk_assessments:rationale', 'risk_assessments:assessed_at']));
  });

  it('has RLS enabled and forced for every custom application table', async () => {
    const result = await pool!.query<{ tablename: string; rls_enabled: boolean; rls_forced: boolean }>(
      `SELECT c.relname AS tablename, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`,
      [requiredRlsTables],
    );
    expect(result.rows).toHaveLength(requiredRlsTables.length);
    expect(result.rows.every((row) => row.rls_enabled && row.rls_forced)).toBe(true);
  });

  it('blocks approval before an approved risk assessment is recorded', async () => {
    await submitLoanApplication(actor, applicationId);
    await reviewKyc(actor, applicationId, { status: 'verified', verificationMethod: 'national_id_check', evidenceNotes: 'Test evidence recorded before risk gate.' });
    await pool!.query(`INSERT INTO risk_assessments (application_id, score, risk_grade, status, policy_version, assessed_by, rationale, assessed_at) VALUES ($1, 40, 'C', 'pending', 'test-policy-pending', $2, 'Pending assessment for approval gate test.', now())`, [applicationId, actor.userId]);
    await pool!.query(`UPDATE loan_applications SET status = 'risk_assessed' WHERE id = $1`, [applicationId]);
    await expect(decideApplication(actor, applicationId, { decision: 'approve', reason: 'Attempted without risk assessment' })).rejects.toMatchObject({ code: 'RISK_ASSESSMENT_REQUIRED' });
    await pool!.query('DELETE FROM risk_assessments WHERE application_id = $1', [applicationId]);
    await pool!.query(`UPDATE loan_applications SET status = 'kyc_verified', risk_assessment_id = NULL WHERE id = $1`, [applicationId]);
  });

  it('records KYC, risk, approval, and timeline transitions', async () => {
    await assessApplicationRisk(actor, applicationId, { score: 82, riskGrade: 'A', status: 'approved', policyVersion: 'test-policy-1', rationale: 'Test affordability and repayment capacity passed.' });
    await decideApplication(actor, applicationId, { decision: 'approve', reason: 'Approved after controlled KYC and risk review.' });
    const timeline = await getApplicationTimeline(actor, applicationId);
    expect(timeline.map((entry) => entry.toState)).toEqual(expect.arrayContaining(['submitted', 'kyc_verified', 'risk_assessed', 'approved']));
    expect(timeline.every((entry) => entry.actorUserId === actor.userId || entry.actorUserId === null)).toBe(true);
  });
});
