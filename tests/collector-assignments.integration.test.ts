import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '../server/src/db.js';
import { createAssignment, endAssignment, updateRouteCode, getAssignmentWorkspace } from '../server/src/services/collector-assignments.js';
import { listAssignedLoans } from '../server/src/services/collector-reporting.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

let branchId: string;
let otherBranchId: string;
let managerUserId: string;
let collectorAId: string;
let collectorBId: string;
let clientId: string;
let today: string;

function dateOffset(days: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createClientRow(branch: string, displayName: string): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, $4)`, [id, branch, `assignment-client-${id}`, displayName]);
  return id;
}

suite('Collector assignment write path', () => {
  beforeAll(async () => {
    today = new Date().toISOString().slice(0, 10);
    const roles = await pool.query<{ code: string; id: string }>(`SELECT code, id FROM roles WHERE code IN ('manager', 'collector')`);
    const roleId = (code: string) => roles.rows.find((r) => r.code === code)!.id;

    const branch = await pool.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Assignment Branch') RETURNING id`, [`ASSIGN-${randomUUID().slice(0, 8)}`]);
    const otherBranch = await pool.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, 'Other Assignment Branch') RETURNING id`, [`ASSIGN-OTHER-${randomUUID().slice(0, 8)}`]);
    branchId = branch.rows[0].id;
    otherBranchId = otherBranch.rows[0].id;

    managerUserId = randomUUID();
    await pool.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Assignment Manager', $4, $5)`, [managerUserId, `assign-mgr-${managerUserId}`, `assign-mgr-${managerUserId}@example.test`, roleId('manager'), branchId]);

    collectorAId = randomUUID();
    await pool.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Collector A', $4, $5)`, [collectorAId, `assign-col-a-${collectorAId}`, `assign-col-a-${collectorAId}@example.test`, roleId('collector'), branchId]);
    collectorBId = randomUUID();
    await pool.query(`INSERT INTO users (id, firebase_uid, email, display_name, role_id, branch_id) VALUES ($1, $2, $3, 'Collector B', $4, $5)`, [collectorBId, `assign-col-b-${collectorBId}`, `assign-col-b-${collectorBId}@example.test`, roleId('collector'), branchId]);

    clientId = await createClientRow(branchId, 'Assignment Client');
  });

  afterAll(async () => { await pool.end(); });

  it('rejects a non-manager actor', async () => {
    await expect(createAssignment({
      branchId, officerId: collectorAId, clientId, routeCode: 'ROUTE-1',
      actorUserId: managerUserId, actorRole: 'officer', actorBranchId: branchId, correlationId: randomUUID(),
    })).rejects.toThrow('ASSIGNMENT_ROLE_DENIED');
  });

  it('rejects a manager acting outside their own branch', async () => {
    await expect(createAssignment({
      branchId: otherBranchId, officerId: collectorAId, clientId, routeCode: 'ROUTE-1',
      actorUserId: managerUserId, actorRole: 'manager', actorBranchId: branchId, correlationId: randomUUID(),
    })).rejects.toThrow('ASSIGNMENT_BRANCH_DENIED');
  });

  it('rejects assigning a client from a different branch', async () => {
    const foreignClient = await createClientRow(otherBranchId, 'Foreign Client');
    await expect(createAssignment({
      branchId, officerId: collectorAId, clientId: foreignClient, routeCode: 'ROUTE-1',
      actorUserId: managerUserId, actorRole: 'manager', actorBranchId: branchId, correlationId: randomUUID(),
    })).rejects.toThrow('CLIENT_BRANCH_MISMATCH');
  });

  it('creates an assignment, writes an audit event, and end-dates a prior assignment on reassignment', async () => {
    const correlationId = randomUUID();
    const first = await createAssignment({
      branchId, officerId: collectorAId, clientId, routeCode: 'ROUTE-1',
      actorUserId: managerUserId, actorRole: 'manager', actorBranchId: branchId, correlationId,
    });
    expect(first.officerId).toBe(collectorAId);
    expect(first.effectiveTo).toBeNull();

    const auditAfterCreate = await pool.query(`SELECT action FROM audit_events WHERE entity_id = $1 ORDER BY created_at`, [first.id]);
    expect(auditAfterCreate.rows.map((r) => r.action)).toContain('collector_assignment.created');

    // Reassign the same client to a different collector — the first row
    // must be end-dated, not deleted, and exactly one active row should remain.
    const second = await createAssignment({
      branchId, officerId: collectorBId, clientId, routeCode: 'ROUTE-2',
      actorUserId: managerUserId, actorRole: 'manager', actorBranchId: branchId, correlationId: randomUUID(),
    });
    expect(second.officerId).toBe(collectorBId);

    const rows = await pool.query<{ id: string; officer_id: string; effective_to: string | null }>(
      `SELECT id, officer_id, effective_to FROM collector_assignments WHERE client_id = $1 ORDER BY effective_from`,
      [clientId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].officer_id).toBe(collectorAId);
    expect(rows.rows[0].effective_to).not.toBeNull(); // end-dated, still present for audit
    expect(rows.rows[1].officer_id).toBe(collectorBId);
    expect(rows.rows[1].effective_to).toBeNull();
  });

  it('lists the active assignment and excludes an already-assigned client from the unassigned list', async () => {
    const workspace = await getAssignmentWorkspace({ branchId, actorRole: 'manager', actorBranchId: branchId });
    expect(workspace.assignments.some((a) => a.clientId === clientId && a.officerId === collectorBId)).toBe(true);
    expect(workspace.unassignedClients.some((c) => c.clientId === clientId)).toBe(false);
    expect(workspace.collectors.map((c) => c.officerId)).toEqual(expect.arrayContaining([collectorAId, collectorBId]));
  });

  it('surfaces a client with no active assignment as unassigned', async () => {
    const freshClient = await createClientRow(branchId, 'Fresh Unassigned Client');
    const workspace = await getAssignmentWorkspace({ branchId, actorRole: 'manager', actorBranchId: branchId });
    expect(workspace.unassignedClients.some((c) => c.clientId === freshClient)).toBe(true);
  });

  it('updates a route code without changing the officer', async () => {
    const row = await pool.query<{ id: string }>(`SELECT id FROM collector_assignments WHERE client_id = $1 AND effective_to IS NULL`, [clientId]);
    const id = row.rows[0].id;
    await updateRouteCode({ id, routeCode: 'ROUTE-2-CORRECTED', actorUserId: managerUserId, actorRole: 'manager', actorBranchId: branchId, correlationId: randomUUID() });
    const updated = await pool.query<{ route_code: string }>(`SELECT route_code FROM collector_assignments WHERE id = $1`, [id]);
    expect(updated.rows[0].route_code).toBe('ROUTE-2-CORRECTED');
  });

  it('unassigns by end-dating rather than deleting the row, freeing the client up as unassigned', async () => {
    // Use a client with an assignment that started in the past — a same-day
    // assignment can only be end-dated down to its own start date (the
    // effective_to >= effective_from constraint), so it would still read as
    // "active today" regardless of the unassign call. Backdating the start
    // date isolates the behavior this test is actually checking.
    const pastClient = await createClientRow(branchId, 'Past Assignment Client');
    const past = await pool.query<{ id: string }>(
      `INSERT INTO collector_assignments (officer_id, client_id, branch_id, route_code, effective_from) VALUES ($1, $2, $3, 'ROUTE-PAST', $4) RETURNING id`,
      [collectorAId, pastClient, branchId, dateOffset(-30)],
    );
    const id = past.rows[0].id;
    await endAssignment({ id, actorUserId: managerUserId, actorRole: 'manager', actorBranchId: branchId, correlationId: randomUUID() });
    const after = await pool.query<{ effective_to: string | null }>(`SELECT effective_to FROM collector_assignments WHERE id = $1`, [id]);
    expect(after.rows[0].effective_to).not.toBeNull();
    const workspace = await getAssignmentWorkspace({ branchId, actorRole: 'manager', actorBranchId: branchId });
    expect(workspace.unassignedClients.some((c) => c.clientId === pastClient)).toBe(true);
  });

  it('regression: a duplicate active assignment row for one client no longer duplicates loan options (DISTINCT fix)', async () => {
    // Simulate the pre-existing data-quality gap flagged in prior review:
    // two active collector_assignments rows for the same officer/client
    // (e.g. a route correction inserted before the old row was end-dated).
    const dupClient = await createClientRow(branchId, 'Duplicate Assignment Client');
    const productId = randomUUID();
    const applicationId = randomUUID();
    const loanId = randomUUID();
    await pool.query(`INSERT INTO loan_products (id, code, name) VALUES ($1, $2, 'Assignment Test Product')`, [productId, `assign-product-${productId}`]);
    await pool.query(`INSERT INTO loan_applications (id, client_id, product_id, branch_id, requested_amount, created_by, status, approved_at) VALUES ($1, $2, $3, $4, $5, $6, 'approved', now())`, [applicationId, dupClient, productId, branchId, 1000, managerUserId]);
    await pool.query(`INSERT INTO loans (id, application_id, client_id, branch_id, principal_amount, outstanding_principal, status) VALUES ($1, $2, $3, $4, 1000, 1000, 'active')`, [loanId, applicationId, dupClient, branchId]);
    await pool.query(
      `INSERT INTO collector_assignments (officer_id, client_id, branch_id, route_code, effective_from)
       VALUES ($1, $2, $3, 'ROUTE-DUP-1', $4), ($1, $2, $3, 'ROUTE-DUP-2', $4)`,
      [collectorAId, dupClient, branchId, today],
    );

    const options = await listAssignedLoans({ branchId, officerId: collectorAId });
    const matches = options.filter((option) => option.loanId === loanId);
    expect(matches).toHaveLength(1);
  });
});
