import { pool, withTransaction, insertAuditEvent, type DbClient } from '../db.js';
import type { Actor } from '../../../shared/contracts.js';

/**
 * Collector-assignment write path. Previously `collector_assignments` was
 * only ever written by seed scripts direct to Postgres — no product surface
 * let a manager assign a collector to a client, which is why field
 * collection and payment posting (payment-posting.ts's COLLECTOR_NOT_ASSIGNED
 * check) were unreachable without manual SQL. This service is the first
 * write path for that table.
 *
 * Assignments are never hard-deleted: "unassigning" sets effective_to, so
 * the audit trail of who collected for whom, and when, survives — same
 * principle as rule 4 in HANDOFF_5 ("hidden means not rendered; server
 * stays the authority").
 */

export interface AssignmentRow {
  id: string;
  officerId: string;
  officerName: string;
  clientId: string;
  clientName: string;
  branchId: string;
  routeCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface UnassignedClient { clientId: string; clientName: string; branchId: string; }
export interface BranchCollector { officerId: string; officerName: string; role: 'collector' | 'officer'; branchId: string; }

export interface AssignmentWorkspace {
  assignments: AssignmentRow[];
  unassignedClients: UnassignedClient[];
  collectors: BranchCollector[];
}

function assertManagerRole(actorRole: string): void {
  if (actorRole !== 'admin' && actorRole !== 'manager') throw new Error('ASSIGNMENT_ROLE_DENIED');
}

/** Admin acts cross-branch; every other role is pinned to its own branch — mirrors requireBranchScope's logic. */
function assertBranchAccess(actor: Pick<Actor, 'role' | 'branchId'>, branchId: string): void {
  if (actor.role === 'admin') return;
  if (!actor.branchId || actor.branchId !== branchId) throw new Error('ASSIGNMENT_BRANCH_DENIED');
}

export async function getAssignmentWorkspace(input: { branchId: string; actorRole: string; actorBranchId: string | null }): Promise<AssignmentWorkspace> {
  assertManagerRole(input.actorRole);
  assertBranchAccess({ role: input.actorRole as Actor['role'], branchId: input.actorBranchId }, input.branchId);

  const [assignments, unassigned, collectors] = await Promise.all([
    pool.query<{ id: string; officer_id: string; officer_name: string; client_id: string; client_name: string; branch_id: string; route_code: string; effective_from: string; effective_to: string | null }>(
      `SELECT ca.id, ca.officer_id, o.display_name AS officer_name, ca.client_id, c.display_name AS client_name,
              ca.branch_id, ca.route_code, ca.effective_from, ca.effective_to
         FROM collector_assignments ca
         JOIN users o ON o.id = ca.officer_id
         JOIN clients c ON c.id = ca.client_id
        WHERE ca.branch_id = $1
          AND ca.effective_from <= CURRENT_DATE
          AND (ca.effective_to IS NULL OR ca.effective_to >= CURRENT_DATE)
        ORDER BY o.display_name, c.display_name`,
      [input.branchId],
    ),
    // A client with no row in collector_assignments, or only a lapsed one, is
    // "unassigned" for operational purposes — this is exactly the gap the
    // manager needs to see and close.
    pool.query<{ id: string; display_name: string; branch_id: string }>(
      `SELECT c.id, c.display_name, c.branch_id
         FROM clients c
        WHERE c.branch_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM collector_assignments ca
             WHERE ca.client_id = c.id
               AND ca.effective_from <= CURRENT_DATE
               AND (ca.effective_to IS NULL OR ca.effective_to >= CURRENT_DATE)
          )
        ORDER BY c.display_name`,
      [input.branchId],
    ),
    pool.query<{ id: string; display_name: string; role_code: string }>(
      `SELECT u.id, u.display_name, r.code AS role_code
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.branch_id = $1 AND u.status = 'active' AND r.code IN ('collector', 'officer')
        ORDER BY u.display_name`,
      [input.branchId],
    ),
  ]);

  return {
    assignments: assignments.rows.map((row) => ({
      id: row.id,
      officerId: row.officer_id,
      officerName: row.officer_name,
      clientId: row.client_id,
      clientName: row.client_name,
      branchId: row.branch_id,
      routeCode: row.route_code,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    })),
    unassignedClients: unassigned.rows.map((row) => ({ clientId: row.id, clientName: row.display_name, branchId: row.branch_id })),
    collectors: collectors.rows.map((row) => ({ officerId: row.id, officerName: row.display_name, role: row.role_code as 'collector' | 'officer', branchId: input.branchId })),
  };
}

export interface CreateAssignmentInput {
  branchId: string;
  officerId: string;
  clientId: string;
  routeCode: string;
  effectiveFrom?: string;
  actorUserId: string;
  actorRole: string;
  actorBranchId: string | null;
  correlationId: string;
}

export async function createAssignment(input: CreateAssignmentInput): Promise<AssignmentRow> {
  assertManagerRole(input.actorRole);
  assertBranchAccess({ role: input.actorRole as Actor['role'], branchId: input.actorBranchId }, input.branchId);
  const effectiveFrom = input.effectiveFrom ?? new Date().toISOString().slice(0, 10);

  return withTransaction(async (client: DbClient) => {
    const officer = await client.query<{ id: string; display_name: string; branch_id: string; role_code: string }>(
      `SELECT u.id, u.display_name, u.branch_id, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1 AND u.status = 'active'
        FOR UPDATE`,
      [input.officerId],
    );
    if (!officer.rowCount) throw new Error('OFFICER_NOT_FOUND');
    if (!['collector', 'officer'].includes(officer.rows[0].role_code)) throw new Error('OFFICER_ROLE_INVALID');
    if (officer.rows[0].branch_id !== input.branchId) throw new Error('OFFICER_BRANCH_MISMATCH');

    const targetClient = await client.query<{ id: string; display_name: string; branch_id: string }>(
      `SELECT id, display_name, branch_id FROM clients WHERE id = $1 FOR UPDATE`,
      [input.clientId],
    );
    if (!targetClient.rowCount) throw new Error('CLIENT_NOT_FOUND');
    if (targetClient.rows[0].branch_id !== input.branchId) throw new Error('CLIENT_BRANCH_MISMATCH');

    // A client should have exactly one active collector at a time. Rather than
    // rely on the caller to unassign first (easy to forget, and the previous
    // total absence of this endpoint meant nobody had ever had to remember),
    // end-date any currently-active assignment for this client in the same
    // transaction as creating the new one.
    const previous = await client.query<{ id: string }>(
      `SELECT id FROM collector_assignments
        WHERE client_id = $1
          AND effective_from <= CURRENT_DATE
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        FOR UPDATE`,
      [input.clientId],
    );
    for (const row of previous.rows) {
      // effective_to must be >= effective_from (DB CHECK constraint). Normally
      // that's effectiveFrom - 1 day, but a same-day reassignment (old row's
      // own effective_from is also today) would compute effectiveFrom - 1 as
      // being before the old row started — clamp to the old row's own start
      // date instead, so it's recorded as active for that one day rather
      // than violating the constraint.
      await client.query(
        `UPDATE collector_assignments
            SET effective_to = GREATEST(effective_from, ($1::date - INTERVAL '1 day')::date)
          WHERE id = $2`,
        [effectiveFrom, row.id],
      );
    }

    const inserted = await client.query<{ id: string; effective_from: string; effective_to: string | null }>(
      `INSERT INTO collector_assignments (officer_id, client_id, branch_id, route_code, effective_from)
       VALUES ($1, $2, $3, $4, $5::date)
       RETURNING id, effective_from, effective_to`,
      [input.officerId, input.clientId, input.branchId, input.routeCode, effectiveFrom],
    );
    const row = inserted.rows[0];

    await insertAuditEvent(client, {
      actorUserId: input.actorUserId,
      action: previous.rowCount ? 'collector_assignment.reassigned' : 'collector_assignment.created',
      entityType: 'collector_assignment',
      entityId: row.id,
      branchId: input.branchId,
      correlationId: input.correlationId,
      metadata: { officerId: input.officerId, clientId: input.clientId, routeCode: input.routeCode, previousAssignmentIds: previous.rows.map((p) => p.id) },
    });

    return {
      id: row.id,
      officerId: input.officerId,
      officerName: officer.rows[0].display_name,
      clientId: input.clientId,
      clientName: targetClient.rows[0].display_name,
      branchId: input.branchId,
      routeCode: input.routeCode,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    };
  });
}

async function loadAssignmentForWrite(client: DbClient, id: string): Promise<{ id: string; branchId: string; effectiveFrom: string }> {
  const result = await client.query<{ id: string; branch_id: string; effective_from: string }>(
    `SELECT id, branch_id, effective_from FROM collector_assignments WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!result.rowCount) throw new Error('ASSIGNMENT_NOT_FOUND');
  return { id: result.rows[0].id, branchId: result.rows[0].branch_id, effectiveFrom: result.rows[0].effective_from };
}

export interface EndAssignmentInput { id: string; effectiveTo?: string; actorUserId: string; actorRole: string; actorBranchId: string | null; correlationId: string; }

export async function endAssignment(input: EndAssignmentInput): Promise<void> {
  assertManagerRole(input.actorRole);
  await withTransaction(async (client) => {
    const assignment = await loadAssignmentForWrite(client, input.id);
    assertBranchAccess({ role: input.actorRole as Actor['role'], branchId: input.actorBranchId }, assignment.branchId);
    if (input.effectiveTo && input.effectiveTo < assignment.effectiveFrom) throw new Error('ASSIGNMENT_END_DATE_BEFORE_START');
    // Same convention as createAssignment's auto end-dating: default to
    // "no longer active as of today" (yesterday), clamped up to the
    // assignment's own start date so a same-day unassign doesn't violate
    // the effective_to >= effective_from constraint.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const effectiveTo = input.effectiveTo ?? (assignment.effectiveFrom > yesterday ? assignment.effectiveFrom : yesterday);
    const updated = await client.query(
      `UPDATE collector_assignments SET effective_to = $1::date
        WHERE id = $2 AND effective_from <= $1::date`,
      [effectiveTo, assignment.id],
    );
    if (!updated.rowCount) throw new Error('ASSIGNMENT_END_DATE_BEFORE_START');
    await insertAuditEvent(client, {
      actorUserId: input.actorUserId,
      action: 'collector_assignment.ended',
      entityType: 'collector_assignment',
      entityId: assignment.id,
      branchId: assignment.branchId,
      correlationId: input.correlationId,
      metadata: { effectiveTo },
    });
  });
}

export interface UpdateRouteCodeInput { id: string; routeCode: string; actorUserId: string; actorRole: string; actorBranchId: string | null; correlationId: string; }

export async function updateRouteCode(input: UpdateRouteCodeInput): Promise<void> {
  assertManagerRole(input.actorRole);
  await withTransaction(async (client) => {
    const assignment = await loadAssignmentForWrite(client, input.id);
    assertBranchAccess({ role: input.actorRole as Actor['role'], branchId: input.actorBranchId }, assignment.branchId);
    await client.query(`UPDATE collector_assignments SET route_code = $1 WHERE id = $2`, [input.routeCode, assignment.id]);
    await insertAuditEvent(client, {
      actorUserId: input.actorUserId,
      action: 'collector_assignment.route_code_updated',
      entityType: 'collector_assignment',
      entityId: assignment.id,
      branchId: assignment.branchId,
      correlationId: input.correlationId,
      metadata: { routeCode: input.routeCode },
    });
  });
}
