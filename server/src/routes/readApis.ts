import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import type { Actor, UserRole } from '../../../shared/contracts.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';

type Query = Record<string, string | undefined>;
type PageQuery = Query & { page?: string; pageSize?: string; q?: string; branchId?: string; queue?: string; status?: string; product?: string; from?: string; to?: string };
type Page = { page: number; pageSize: number; offset: number };

const staffRoles: UserRole[] = ['admin', 'manager', 'officer'];
const applicationRoles: UserRole[] = ['admin', 'manager', 'officer', 'client'];
const loanRoles: UserRole[] = ['admin', 'manager', 'officer', 'collector', 'client'];
const clientRoles: UserRole[] = ['admin', 'manager', 'officer'];
const paymentRoles: UserRole[] = ['admin', 'manager', 'officer', 'accountant'];
const auditRoles: UserRole[] = ['admin', 'manager', 'officer', 'accountant'];
const searchRoles: UserRole[] = ['admin', 'manager', 'officer', 'accountant', 'client'];
const appQueues = new Set(['draft', 'in_review', 'approved', 'rejected']);
const loanQueues = new Set(['approved', 'active', 'overdue', 'defaulted', 'written_off', 'completed', 'due_today']);
const paymentStatuses = new Set(['recorded', 'pending_reconciliation', 'verified', 'posted', 'reversed']);

function pageOf(query: PageQuery): Page {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 25);
  if (!Number.isInteger(page) || page < 1) throw Object.assign(new Error('page must be a positive integer'), { statusCode: 400, code: 'INVALID_PAGE' });
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Object.assign(new Error('pageSize must be between 1 and 100'), { statusCode: 400, code: 'INVALID_PAGE_SIZE' });
  return { page, pageSize, offset: (page - 1) * pageSize };
}
function querySchema(properties: Record<string, unknown> = {}) {
  return { querystring: { type: 'object', additionalProperties: false, properties: { page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 }, q: { type: 'string', maxLength: 100 }, branchId: { type: 'string', minLength: 1 }, queue: { type: 'string' }, status: { type: 'string' }, product: { type: 'string', minLength: 1 }, from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, ...properties } } };
}
function correlation(request: FastifyRequest): string { return String(request.headers['x-correlation-id']); }
function envelope(request: FastifyRequest, data: unknown) { return { ok: true, data, correlationId: correlation(request), version: SYSTEM_VERSION }; }
function requestedBranch(request: FastifyRequest): string | undefined {
  const query = request.query as Query;
  return query.branchId ?? request.actor?.branchId ?? undefined;
}
function branchFilter(actor: Actor, alias: string, requested?: string, start = 1): { sql: string; values: string[]; next: number } {
  if (actor.role === 'client') return actor.clientId ? { sql: `${alias}.client_id = $${start}`, values: [actor.clientId], next: start + 1 } : { sql: 'FALSE', values: [], next: start };
  if (actor.role === 'admin' && !requested) return { sql: 'TRUE', values: [], next: start };
  const branch = requested ?? actor.branchId;
  if (!branch || (actor.role !== 'admin' && branch !== actor.branchId)) return { sql: 'FALSE', values: [], next: start };
  return { sql: `${alias}.branch_id = $${start}`, values: [branch], next: start + 1 };
}
function validateQueue(queue: string | undefined, values: Set<string>, code: string): void {
  if (queue && !values.has(queue)) throw Object.assign(new Error(`Invalid ${code} queue`), { statusCode: 400, code: `INVALID_${code.toUpperCase()}_QUEUE` });
}
function applicationQueueSql(queue: string | undefined, alias = 'la'): string {
  if (!queue) return 'TRUE';
  if (queue === 'in_review') return `${alias}.status IN ('submitted', 'kyc_verified', 'risk_assessed')`;
  return `${alias}.status = '${queue}'`;
}
function paginationData(items: unknown[], total: number, page: Page) { return { items, total, page: page.page, pageSize: page.pageSize }; }

async function pagedApplications(actor: Actor, query: PageQuery) {
  const page = pageOf(query); validateQueue(query.queue, appQueues, 'application');
  const scope = branchFilter(actor, 'la', query.branchId);
  const values = [...scope.values]; let n = scope.next; const where = [scope.sql, applicationQueueSql(query.queue)];
  if (query.q) { where.push(`(c.display_name ILIKE $${n} OR c.external_ref ILIKE $${n} OR la.id::text ILIKE $${n})`); values.push(`%${query.q}%`); n++; }
  if (query.product) { where.push(`la.product_id = $${n}`); values.push(query.product); n++; }
  if (query.from) { where.push(`la.created_at >= $${n}::date`); values.push(query.from); n++; }
  if (query.to) { where.push(`la.created_at < ($${n}::date + INTERVAL '1 day')`); values.push(query.to); n++; }
  const predicate = where.join(' AND ');
  const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM loan_applications la JOIN clients c ON c.id = la.client_id WHERE ${predicate}`, values);
  const rows = await pool.query(`SELECT la.id, la.client_id AS "clientId", c.display_name AS "clientName", c.external_ref AS "clientExternalRef", la.product_id AS "productId", lp.name AS "productName", la.branch_id AS "branchId", la.requested_amount AS "requestedAmount", la.status, la.created_by AS "createdBy", la.created_at AS "createdAt", la.submitted_at AS "submittedAt", la.approved_by AS "approvedBy", la.approved_at AS "approvedAt" FROM loan_applications la JOIN clients c ON c.id = la.client_id JOIN loan_products lp ON lp.id = la.product_id WHERE ${predicate} ORDER BY la.created_at DESC, la.id DESC LIMIT $${n} OFFSET $${n + 1}`, [...values, page.pageSize, page.offset]);
  return paginationData(rows.rows.map((r) => ({ ...r, requestedAmount: Number(r.requestedAmount) })), Number(count.rows[0]?.count ?? 0), page);
}

async function pagedLoans(actor: Actor, query: PageQuery) {
  const page = pageOf(query); validateQueue(query.queue, loanQueues, 'loan');
  const scope = branchFilter(actor, 'l', query.branchId); const values = [...scope.values]; let n = scope.next; const where = [scope.sql];
  if (query.queue === 'active') where.push("l.status IN ('disbursed', 'active')"); else if (query.queue === 'due_today') where.push("EXISTS (SELECT 1 FROM repayment_schedules rs WHERE rs.loan_id = l.id AND rs.status = 'open' AND rs.due_on = CURRENT_DATE)"); else if (query.queue) where.push(`l.status = '${query.queue}'`);
  if (actor.role === 'collector') where.push('EXISTS (SELECT 1 FROM collector_assignments ca WHERE ca.client_id = l.client_id AND ca.officer_id = $' + n + " AND ca.effective_from <= CURRENT_DATE AND (ca.effective_to IS NULL OR ca.effective_to >= CURRENT_DATE))");
  if (actor.role === 'collector') { values.push(actor.userId); n++; }
  if (query.q) { where.push(`(c.display_name ILIKE $${n} OR c.external_ref ILIKE $${n} OR l.id::text ILIKE $${n})`); values.push(`%${query.q}%`); n++; }
  const predicate = where.join(' AND ');
  const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM loans l JOIN clients c ON c.id = l.client_id WHERE ${predicate}`, values);
  const rows = await pool.query(`SELECT l.id, l.application_id AS "applicationId", l.client_id AS "clientId", c.display_name AS "clientName", c.external_ref AS "clientExternalRef", l.branch_id AS "branchId", l.principal_amount AS "principalAmount", l.outstanding_principal AS "outstandingPrincipal", l.status, l.created_at AS "createdAt" FROM loans l JOIN clients c ON c.id = l.client_id WHERE ${predicate} ORDER BY l.created_at DESC, l.id DESC LIMIT $${n} OFFSET $${n + 1}`, [...values, page.pageSize, page.offset]);
  return paginationData(rows.rows.map((r) => ({ ...r, principalAmount: Number(r.principalAmount), outstandingPrincipal: Number(r.outstandingPrincipal) })), Number(count.rows[0]?.count ?? 0), page);
}

async function pagedClients(actor: Actor, query: PageQuery) {
  const page = pageOf(query); const scope = branchFilter(actor, 'c', query.branchId); const values = [...scope.values]; let n = scope.next; const where = [scope.sql];
  if (query.q) { where.push(`(c.display_name ILIKE $${n} OR c.external_ref ILIKE $${n})`); values.push(`%${query.q}%`); n++; }
  const predicate = where.join(' AND '); const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM clients c WHERE ${predicate}`, values);
  const rows = await pool.query(`SELECT c.id, c.external_ref AS "externalRef", c.display_name AS "displayName", c.branch_id AS "branchId", c.created_at AS "createdAt" FROM clients c WHERE ${predicate} ORDER BY c.created_at DESC, c.id DESC LIMIT $${n} OFFSET $${n + 1}`, [...values, page.pageSize, page.offset]);
  return paginationData(rows.rows, Number(count.rows[0]?.count ?? 0), page);
}

async function pagedPayments(actor: Actor, query: PageQuery) {
  const page = pageOf(query); const status = query.status ?? query.queue; if (status && !paymentStatuses.has(status)) throw Object.assign(new Error('Invalid payment status'), { statusCode: 400, code: 'INVALID_PAYMENT_STATUS' });
  const scope = branchFilter(actor, 'p', query.branchId); const values = [...scope.values]; let n = scope.next; const where = [scope.sql];
  if (status) { where.push(`p.status = $${n}`); values.push(status); n++; }
  if (query.q) { where.push(`(p.receipt_reference ILIKE $${n} OR p.id::text ILIKE $${n} OR c.display_name ILIKE $${n})`); values.push(`%${query.q}%`); n++; }
  const predicate = where.join(' AND '); const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM payments p JOIN loans l ON l.id = p.loan_id JOIN clients c ON c.id = l.client_id WHERE ${predicate}`, values);
  const rows = await pool.query(`SELECT p.id, p.loan_id AS "loanId", l.client_id AS "clientId", c.display_name AS "clientName", p.branch_id AS "branchId", p.amount, p.status, p.method AS "paymentMethod", p.receipt_reference AS "receiptReference", p.recorded_by AS "recordedBy", p.created_at AS "createdAt", p.principal_amount AS "principalAmount", p.penalty_amount AS "penaltyAmount", p.interest_amount AS "interestAmount", p.charge_amount AS "chargeAmount", p.overpayment_amount AS "overpaymentAmount" FROM payments p JOIN loans l ON l.id = p.loan_id JOIN clients c ON c.id = l.client_id WHERE ${predicate} ORDER BY p.created_at DESC, p.id DESC LIMIT $${n} OFFSET $${n + 1}`, [...values, page.pageSize, page.offset]);
  return paginationData(rows.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /Amount$/.test(k) || k === 'amount' ? Number(v) : v]))), Number(count.rows[0]?.count ?? 0), page);
}

async function singleApplication(actor: Actor, id: string) {
  const scope = branchFilter(actor, 'la', undefined, 2); const result = await pool.query(`SELECT la.id, la.client_id AS "clientId", c.display_name AS "clientName", c.external_ref AS "clientExternalRef", la.product_id AS "productId", lp.name AS "productName", la.branch_id AS "branchId", la.requested_amount AS "requestedAmount", la.status, la.created_by AS "createdBy", la.created_at AS "createdAt", la.submitted_at AS "submittedAt", k.id AS "kycId", k.status AS "kycStatus", k.verification_method AS "verificationMethod", k.evidence_notes AS "kycEvidenceNotes", r.id AS "riskId", r.score AS "riskScore", r.risk_grade AS "riskGrade", r.status AS "riskStatus", r.policy_version AS "riskPolicyVersion", r.rationale AS "riskRationale" FROM loan_applications la JOIN clients c ON c.id = la.client_id JOIN loan_products lp ON lp.id = la.product_id LEFT JOIN LATERAL (SELECT * FROM kyc_records WHERE client_id = la.client_id ORDER BY created_at DESC LIMIT 1) k ON true LEFT JOIN risk_assessments r ON r.application_id = la.id WHERE la.id = $1 AND ${scope.sql}`, [id, ...scope.values]);
  if (!result.rowCount) throw Object.assign(new Error('Loan application not found'), { statusCode: 404, code: 'APPLICATION_NOT_FOUND' });
  return { ...result.rows[0], requestedAmount: Number(result.rows[0].requestedAmount) };
}
async function singleLoan(actor: Actor, id: string) {
  const scope = branchFilter(actor, 'l', undefined, 2); const result = await pool.query(`SELECT l.id, l.application_id AS "applicationId", l.client_id AS "clientId", c.display_name AS "clientName", c.external_ref AS "clientExternalRef", l.branch_id AS "branchId", l.principal_amount AS "principalAmount", l.outstanding_principal AS "outstandingPrincipal", l.status, l.created_at AS "createdAt" FROM loans l JOIN clients c ON c.id = l.client_id WHERE l.id = $1 AND ${scope.sql}`, [id, ...scope.values]);
  if (!result.rowCount) throw Object.assign(new Error('Loan not found'), { statusCode: 404, code: 'LOAN_NOT_FOUND' });
  const row = result.rows[0];
  const [schedule, payments] = await Promise.all([pool.query(`SELECT id, due_on AS "dueOn", principal_due AS "principalDue", principal_paid AS "principalPaid", penalty_due AS "penaltyDue", penalty_paid AS "penaltyPaid", interest_due AS "interestDue", interest_paid AS "interestPaid", charge_due AS "chargeDue", charge_paid AS "chargePaid", status FROM repayment_schedules WHERE loan_id = $1 ORDER BY due_on, id`, [id]), pool.query(`SELECT p.id, p.amount, p.status, p.receipt_reference AS "receiptReference", p.created_at AS "createdAt" FROM payments p WHERE p.loan_id = $1 ORDER BY p.created_at DESC, p.id DESC`, [id])]);
  return { ...row, principalAmount: Number(row.principalAmount), outstandingPrincipal: Number(row.outstandingPrincipal), schedule: schedule.rows, payments: payments.rows.map((p) => ({ ...p, amount: Number(p.amount) })) };
}
async function singleClient(actor: Actor, id: string) {
  const scope = branchFilter(actor, 'c', undefined, 2); const result = await pool.query(`SELECT c.id, c.external_ref AS "externalRef", c.display_name AS "displayName", c.branch_id AS "branchId", c.created_at AS "createdAt" FROM clients c WHERE c.id = $1 AND ${scope.sql}`, [id, ...scope.values]);
  if (!result.rowCount) throw Object.assign(new Error('Client not found'), { statusCode: 404, code: 'CLIENT_NOT_FOUND' });
  return result.rows[0];
}

function registerList<T extends PageQuery>(app: FastifyInstance, auth: ReturnType<typeof authMiddleware>, path: string, roles: UserRole[], handler: (actor: Actor, query: T) => Promise<unknown>, properties: Record<string, unknown> = {}) {
  app.get(path, { preHandler: [auth, requireRoles(roles), requireBranchScope(requestedBranch)], schema: querySchema(properties) }, async (request) => envelope(request, await handler(request.actor!, request.query as T)));
}

export function registerReadApiRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolver?: UserResolver): void {
  const auth = authMiddleware(verifier, resolver);
  app.get('/api/v1/queues/counts', { preHandler: [auth, requireRoles([...new Set([...staffRoles, 'collector', 'accountant', 'client'])] as UserRole[]), requireBranchScope(requestedBranch)], schema: querySchema() }, async (request) => {
    const actor = request.actor!; const query = request.query as PageQuery; const requested = query.branchId;
    const appScope = branchFilter(actor, 'la', requested); const loanScope = branchFilter(actor, 'l', requested); const paymentScope = branchFilter(actor, 'p', requested); const recScope = branchFilter(actor, 'r', requested);
    const [applications, loans, payments, reconciliations, dueToday] = await Promise.all([
      pool.query(`SELECT status, count(*)::int AS count FROM loan_applications la WHERE ${appScope.sql} GROUP BY status`, appScope.values),
      pool.query(`SELECT status, count(*)::int AS count FROM loans l WHERE ${loanScope.sql} GROUP BY status`, loanScope.values),
      pool.query(`SELECT status, count(*)::int AS count FROM payments p WHERE ${paymentScope.sql} GROUP BY status`, paymentScope.values),
      pool.query(`SELECT status, count(*)::int AS count FROM reconciliations r WHERE ${recScope.sql} GROUP BY status`, recScope.values),
      pool.query(`SELECT count(DISTINCT l.id)::int AS count FROM loans l JOIN repayment_schedules rs ON rs.loan_id = l.id WHERE ${loanScope.sql} AND rs.status = 'open' AND rs.due_on = CURRENT_DATE`, loanScope.values),
    ]);
    const group = (rows: Array<{ status: string; count: number }>) => Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
    return envelope(request, { applications: group(applications.rows), loans: { ...group(loans.rows), due_today: Number(dueToday.rows[0]?.count ?? 0) }, payments: group(payments.rows), reconciliations: group(reconciliations.rows) });
  });
  registerList(app, auth, '/api/v1/loan-applications', applicationRoles, pagedApplications, { queue: { type: 'string', enum: [...appQueues] } });
  registerList(app, auth, '/api/v1/loans', loanRoles, pagedLoans, { queue: { type: 'string', enum: [...loanQueues] } });
  registerList(app, auth, '/api/v1/clients', clientRoles, pagedClients);
  registerList(app, auth, '/api/v1/payments', paymentRoles, pagedPayments, { queue: { type: 'string', enum: [...paymentStatuses] } });
  app.get('/api/v1/loan-applications/:id', { preHandler: [auth, requireRoles(applicationRoles), requireBranchScope((request) => request.actor?.branchId ?? undefined)], schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } } } }, async (request) => envelope(request, await singleApplication(request.actor!, (request.params as { id: string }).id)));
  app.get('/api/v1/loans/:id', { preHandler: [auth, requireRoles(loanRoles), requireBranchScope((request) => request.actor?.branchId ?? undefined)], schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } } } }, async (request) => envelope(request, await singleLoan(request.actor!, (request.params as { id: string }).id)));
  app.get('/api/v1/clients/:id', { preHandler: [auth, requireRoles(clientRoles), requireBranchScope((request) => request.actor?.branchId ?? undefined)], schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } } } }, async (request) => envelope(request, await singleClient(request.actor!, (request.params as { id: string }).id)));
  app.get('/api/v1/search', { preHandler: [auth, requireRoles(searchRoles), requireBranchScope(requestedBranch)], schema: querySchema() }, async (request) => {
    const query = request.query as PageQuery; if (!query.q || query.q.trim().length < 2) throw Object.assign(new Error('q must contain at least 2 characters'), { statusCode: 400, code: 'SEARCH_QUERY_TOO_SHORT' });
    const actor = request.actor!; const scope = branchFilter(actor, 'x', query.branchId); const like = `%${query.q.trim()}%`; const values = [...scope.values, like]; const n = scope.next;
    const [clients, loans, applications, receipts] = await Promise.all([
      pool.query(`SELECT c.id, c.external_ref AS "externalRef", c.display_name AS "displayName", c.branch_id AS "branchId" FROM clients c WHERE ${scope.sql.replaceAll('x.', 'c.')} AND (c.display_name ILIKE $${n} OR c.external_ref ILIKE $${n}) ORDER BY c.display_name, c.id LIMIT 20`, values),
      pool.query(`SELECT l.id, l.client_id AS "clientId", c.display_name AS "clientName", l.branch_id AS "branchId", l.status FROM loans l JOIN clients c ON c.id = l.client_id WHERE ${scope.sql.replaceAll('x.', 'l.')} AND (l.id::text ILIKE $${n} OR c.display_name ILIKE $${n} OR c.external_ref ILIKE $${n}) ORDER BY l.created_at DESC, l.id DESC LIMIT 20`, values),
      pool.query(`SELECT la.id, la.client_id AS "clientId", c.display_name AS "clientName", la.branch_id AS "branchId", la.status FROM loan_applications la JOIN clients c ON c.id = la.client_id WHERE ${scope.sql.replaceAll('x.', 'la.')} AND (la.id::text ILIKE $${n} OR c.display_name ILIKE $${n} OR c.external_ref ILIKE $${n}) ORDER BY la.created_at DESC, la.id DESC LIMIT 20`, values),
      pool.query(`SELECT p.id, p.receipt_reference AS "receiptReference", p.loan_id AS "loanId", p.branch_id AS "branchId", p.status FROM payments p WHERE ${scope.sql.replaceAll('x.', 'p.')} AND p.receipt_reference ILIKE $${n} ORDER BY p.created_at DESC, p.id DESC LIMIT 20`, values),
    ]);
    return envelope(request, { clients: clients.rows, loans: loans.rows, applications: applications.rows, receipts: receipts.rows });
  });
  app.get('/api/v1/audit', { preHandler: [auth, requireRoles(auditRoles), requireBranchScope(requestedBranch)], schema: querySchema({ entityType: { type: 'string', minLength: 1, maxLength: 100 }, entityId: { type: 'string', minLength: 1 }, q: { type: 'string', maxLength: 100 } }) }, async (request) => {
    const query = request.query as PageQuery & { entityType?: string; entityId?: string }; const page = pageOf(query); const scope = branchFilter(request.actor!, 'ae', query.branchId); const values = [...scope.values]; let n = scope.next; const where = [scope.sql]; if (request.actor!.role !== 'admin') where.push('ae.branch_id IS NOT NULL');
    if (query.entityType) { where.push(`ae.entity_type = $${n}`); values.push(query.entityType); n++; } if (query.entityId) { where.push(`ae.entity_id = $${n}`); values.push(query.entityId); n++; }
    const predicate = where.join(' AND '); const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM audit_events ae WHERE ${predicate}`, values); const rows = await pool.query(`SELECT ae.id, ae.actor_user_id AS "actorUserId", u.display_name AS "actorName", ae.action, ae.entity_type AS "entityType", ae.entity_id AS "entityId", ae.branch_id AS "branchId", ae.correlation_id AS "correlationId", ae.metadata, ae.created_at AS "createdAt" FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_user_id WHERE ${predicate} ORDER BY ae.created_at DESC, ae.id DESC LIMIT $${n} OFFSET $${n + 1}`, [...values, page.pageSize, page.offset]);
    return envelope(request, paginationData(rows.rows, Number(count.rows[0]?.count ?? 0), page));
  });
}
