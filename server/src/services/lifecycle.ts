import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Actor } from '../../../shared/contracts.js';
import { insertAuditEvent, pool, withTransaction, type DbClient } from '../db.js';
import { assertApplicationTransition, assertKycTransition, assertLoanTransition, type ApplicationStatus, type KycStatus, type LoanStatus } from './state-machines.js';
import { postLedgerTransactionOnClient } from './ledger.js';

export class LifecycleError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) {
    super(message);
    this.name = 'LifecycleError';
  }
}

const fail = (code: string, message: string, statusCode = 400): never => {
  throw new LifecycleError(code, message, statusCode);
};

const toNumber = (value: string | number | null): number => Number(value ?? 0);
const toIso = (value: Date | string): string => new Date(value).toISOString();

export interface PortalApplication {
  id: string;
  clientId: string;
  clientName: string;
  productName: string;
  branchId: string;
  requestedAmount: number;
  status: string;
  createdAt: string;
  submittedAt: string | null;
}
export interface ApplicationTimelineEntry { id: string; fromState: string | null; toState: string; actorUserId: string | null; reason: string | null; createdAt: string; }

export interface PortalLoan {
  id: string;
  clientId: string;
  clientName: string;
  branchId: string;
  principalAmount: number;
  outstandingPrincipal: number;
  status: string;
  createdAt: string;
}

export interface PortalClient {
  id: string;
  externalRef: string;
  displayName: string;
  branchId: string;
  createdAt: string;
}

export interface PortalProduct {
  id: string;
  code: string;
  name: string;
  currency: string;
  active: boolean;
}

export interface LoanSchedule {
  loan: {
    id: string;
    clientId: string;
    branchId: string;
    principalAmount: number;
    outstandingPrincipal: number;
    status: string;
  };
  installments: Array<{
    id: string;
    dueOn: string;
    principalDue: number;
    principalPaid: number;
    penaltyDue: number;
    penaltyPaid: number;
    interestDue: number;
    interestPaid: number;
    chargeDue: number;
    chargePaid: number;
    remainingAmount: number;
    status: 'open' | 'paid';
  }>;
}

export interface PortalOverview {
  role: Actor['role'];
  metrics: {
    clients: number;
    applications: number;
    submittedApplications: number;
    activeLoans: number;
    outstandingPrincipal: number;
    products: number;
  };
  applications: PortalApplication[];
  loans: PortalLoan[];
  clients: PortalClient[];
  products: PortalProduct[];
}

interface Scope {
  text: string;
  values: string[];
}

function scopeFor(actor: Actor, alias: string, clientColumn = 'client_id'): Scope {
  if (actor.role === 'client') {
    if (!actor.clientId) return { text: 'FALSE', values: [] };
    return { text: `${alias}.${clientColumn} = $1`, values: [actor.clientId] };
  }
  if (actor.role === 'admin' || actor.role === 'marketing') return { text: 'TRUE', values: [] };
  if (!actor.branchId) return { text: 'FALSE', values: [] };
  return { text: `${alias}.branch_id = $1`, values: [actor.branchId] };
}

function assertBranchScope(actor: Actor, branchId: string): void {
  if (actor.role !== 'admin' && actor.role !== 'client' && actor.branchId !== branchId) fail('BRANCH_SCOPE_DENIED', 'Branch scope denied', 403);
}

function assertClientScope(actor: Actor, clientId: string): void {
  if (actor.role === 'client' && actor.clientId !== clientId) fail('CLIENT_SCOPE_DENIED', 'Client scope denied', 403);
}

async function findApplication(client: DbClient | Pool, applicationId: string, forUpdate = false) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const result = await client.query<{
    id: string;
    client_id: string;
    client_name: string;
    branch_id: string;
    requested_amount: string;
    status: ApplicationStatus;
  }>(
    `SELECT la.id, la.client_id, c.display_name AS client_name, la.branch_id,
            la.requested_amount, la.status
       FROM loan_applications la
       JOIN clients c ON c.id = la.client_id
      WHERE la.id = $1${suffix}`,
    [applicationId],
  );
  if (!result.rowCount) fail('APPLICATION_NOT_FOUND', 'Loan application not found', 404);
  return result.rows[0];
}

async function findLoan(client: DbClient, loanId: string, forUpdate = false) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const result = await client.query<{
    id: string;
    application_id: string;
    client_id: string;
    branch_id: string;
    principal_amount: string;
    outstanding_principal: string;
    status: LoanStatus;
  }>(
    `SELECT id, application_id, client_id, branch_id, principal_amount,
            outstanding_principal, status
       FROM loans
      WHERE id = $1${suffix}`,
    [loanId],
  );
  if (!result.rowCount) fail('LOAN_NOT_FOUND', 'Loan not found', 404);
  return result.rows[0];
}
async function recordApplicationTransition(client: DbClient, applicationId: string, fromState: string | null, toState: string, actorUserId: string, reason?: string): Promise<void> {
  await client.query(
    `INSERT INTO application_transition_history (application_id, from_state, to_state, actor_user_id, reason) VALUES ($1, $2, $3, $4, $5)`,
    [applicationId, fromState, toState, actorUserId, reason?.trim() || null],
  );
}

export async function getPortalOverview(actor: Actor): Promise<PortalOverview> {
  const applicationScope = scopeFor(actor, 'la');
  const loanScope = scopeFor(actor, 'l');
  const clientScope = scopeFor(actor, 'c');
  const isMarketing = actor.role === 'marketing';

  const [metricsResult, applicationsResult, loansResult, clientsResult, productsResult] = await Promise.all([
    pool.query<{ clients: string; applications: string; submitted_applications: string; active_loans: string; outstanding_principal: string; products: string }>(
      `SELECT
        (SELECT COUNT(*) FROM clients c WHERE ${clientScope.text}) AS clients,
        (SELECT COUNT(*) FROM loan_applications la WHERE ${applicationScope.text}) AS applications,
        (SELECT COUNT(*) FROM loan_applications la WHERE ${applicationScope.text} AND la.status IN ('submitted', 'kyc_verified', 'risk_assessed')) AS submitted_applications,
        (SELECT COUNT(*) FROM loans l WHERE ${loanScope.text} AND l.status IN ('active', 'overdue', 'disbursed')) AS active_loans,
        (SELECT COALESCE(SUM(l.outstanding_principal), 0) FROM loans l WHERE ${loanScope.text}) AS outstanding_principal,
        (SELECT COUNT(*) FROM loan_products lp WHERE lp.active = true) AS products`,
      clientScope.values,
    ),
    isMarketing ? Promise.resolve({ rows: [] as never[] }) : pool.query<{
      id: string; client_id: string; client_name: string; product_name: string; branch_id: string;
      requested_amount: string; status: string; created_at: Date; submitted_at: Date | null;
    }>(
      `SELECT la.id, la.client_id, c.display_name AS client_name, lp.name AS product_name,
              la.branch_id, la.requested_amount, la.status, la.created_at, la.submitted_at
         FROM loan_applications la
         JOIN clients c ON c.id = la.client_id
         JOIN loan_products lp ON lp.id = la.product_id
        WHERE ${applicationScope.text}
        ORDER BY la.created_at DESC LIMIT 50`,
      applicationScope.values,
    ),
    isMarketing ? Promise.resolve({ rows: [] as never[] }) : pool.query<{
      id: string; client_id: string; client_name: string; branch_id: string; principal_amount: string;
      outstanding_principal: string; status: string; created_at: Date;
    }>(
      `SELECT l.id, l.client_id, c.display_name AS client_name, l.branch_id, l.principal_amount,
              l.outstanding_principal, l.status, l.created_at
         FROM loans l
         JOIN clients c ON c.id = l.client_id
        WHERE ${loanScope.text}
        ORDER BY l.created_at DESC LIMIT 50`,
      loanScope.values,
    ),
    isMarketing ? Promise.resolve({ rows: [] as never[] }) : pool.query<{
      id: string; external_ref: string; display_name: string; branch_id: string; created_at: Date;
    }>(
      `SELECT c.id, c.external_ref, c.display_name, c.branch_id, c.created_at
         FROM clients c
        WHERE ${clientScope.text}
        ORDER BY c.created_at DESC LIMIT 50`,
      clientScope.values,
    ),
    pool.query<{ id: string; code: string; name: string; currency: string; active: boolean }>(
      `SELECT id, code, name, currency, active FROM loan_products WHERE active = true ORDER BY name`,
    ),
  ]);

  const metric = metricsResult.rows[0];
  return {
    role: actor.role,
    metrics: {
      clients: toNumber(metric?.clients),
      applications: toNumber(metric?.applications),
      submittedApplications: toNumber(metric?.submitted_applications),
      activeLoans: toNumber(metric?.active_loans),
      outstandingPrincipal: toNumber(metric?.outstanding_principal),
      products: toNumber(metric?.products),
    },
    applications: applicationsResult.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name,
      productName: row.product_name,
      branchId: row.branch_id,
      requestedAmount: toNumber(row.requested_amount),
      status: row.status,
      createdAt: toIso(row.created_at),
      submittedAt: row.submitted_at ? toIso(row.submitted_at) : null,
    })),
    loans: loansResult.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name,
      branchId: row.branch_id,
      principalAmount: toNumber(row.principal_amount),
      outstandingPrincipal: toNumber(row.outstanding_principal),
      status: row.status,
      createdAt: toIso(row.created_at),
    })),
    clients: clientsResult.rows.map((row) => ({
      id: row.id,
      externalRef: row.external_ref,
      displayName: row.display_name,
      branchId: row.branch_id,
      createdAt: toIso(row.created_at),
    })),
    products: productsResult.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, currency: row.currency, active: row.active })),
  };
}

export async function createClient(actor: Actor, input: { branchId: string; externalRef: string; displayName: string }): Promise<PortalClient> {
  assertBranchScope(actor, input.branchId);
  if (!input.externalRef.trim() || !input.displayName.trim()) fail('CLIENT_FIELDS_REQUIRED', 'Client reference and name are required');
  const result = await pool.query<{ id: string; external_ref: string; display_name: string; branch_id: string; created_at: Date }>(
    `INSERT INTO clients (branch_id, external_ref, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, external_ref, display_name, branch_id, created_at`,
    [input.branchId, input.externalRef.trim(), input.displayName.trim()],
  );
  const row = result.rows[0];
  return { id: row.id, externalRef: row.external_ref, displayName: row.display_name, branchId: row.branch_id, createdAt: toIso(row.created_at) };
}

export async function createLoanApplication(actor: Actor, input: { clientId: string; productId: string; branchId?: string; requestedAmount: number }): Promise<PortalApplication> {
  assertClientScope(actor, input.clientId);
  if (!Number.isSafeInteger(input.requestedAmount) || input.requestedAmount <= 0) fail('INVALID_REQUESTED_AMOUNT', 'Requested amount must be a positive whole number');
  return withTransaction(async (client) => {
    const clientResult = await client.query<{ id: string; branch_id: string; display_name: string }>(
      `SELECT id, branch_id, display_name FROM clients WHERE id = $1`,
      [input.clientId],
    );
    if (!clientResult.rowCount) fail('CLIENT_NOT_FOUND', 'Client not found', 404);
    const clientRow = clientResult.rows[0];
    const branchId = input.branchId ?? clientRow.branch_id;
    assertBranchScope(actor, branchId);
    if (branchId !== clientRow.branch_id) fail('CLIENT_BRANCH_MISMATCH', 'Client does not belong to this branch');
    const product = await client.query<{ id: string; name: string }>('SELECT id, name FROM loan_products WHERE id = $1 AND active = true', [input.productId]);
    if (!product.rowCount) fail('LOAN_PRODUCT_NOT_FOUND', 'Active loan product not found', 404);
    const result = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO loan_applications (client_id, product_id, branch_id, status, requested_amount, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5)
       RETURNING id, created_at`,
      [input.clientId, input.productId, branchId, input.requestedAmount, actor.userId],
    );
    await recordApplicationTransition(client, result.rows[0].id, null, 'draft', actor.userId);
    await insertAuditEvent(client, { actorUserId: actor.userId, action: 'loan.application.created', entityType: 'loan_application', entityId: result.rows[0].id, correlationId: randomUUID(), metadata: { branchId, clientId: input.clientId } });
    return {
      id: result.rows[0].id,
      clientId: input.clientId,
      clientName: clientRow.display_name,
      productName: product.rows[0].name,
      branchId,
      requestedAmount: input.requestedAmount,
      status: 'draft',
      createdAt: toIso(result.rows[0].created_at),
      submittedAt: null,
    };
  });
}

export async function getLoanSchedule(actor: Actor, loanId: string): Promise<LoanSchedule> {
  const loanResult = await pool.query<{
    id: string;
    application_id: string;
    client_id: string;
    branch_id: string;
    principal_amount: string;
    outstanding_principal: string;
    status: LoanStatus;
  }>(
    `SELECT id, application_id, client_id, branch_id, principal_amount,
            outstanding_principal, status
       FROM loans
      WHERE id = $1`,
    [loanId],
  );
  if (!loanResult.rowCount) fail('LOAN_NOT_FOUND', 'Loan not found', 404);
  const loan = loanResult.rows[0];
  assertClientScope(actor, loan.client_id);
  assertBranchScope(actor, loan.branch_id);
  const schedules = await pool.query<{
    id: string;
    due_on: Date | string;
    principal_due: string;
    principal_paid: string;
    penalty_due: string;
    penalty_paid: string;
    interest_due: string;
    interest_paid: string;
    charge_due: string;
    charge_paid: string;
    status: 'open' | 'paid';
  }>(
    `SELECT id, due_on, principal_due, principal_paid, penalty_due, penalty_paid,
            interest_due, interest_paid, charge_due, charge_paid, status
       FROM repayment_schedules
      WHERE loan_id = $1
      ORDER BY due_on, id`,
    [loanId],
  );
  return {
    loan: {
      id: loan.id,
      clientId: loan.client_id,
      branchId: loan.branch_id,
      principalAmount: toNumber(loan.principal_amount),
      outstandingPrincipal: toNumber(loan.outstanding_principal),
      status: loan.status,
    },
    installments: schedules.rows.map((row) => {
      const principalDue = toNumber(row.principal_due);
      const principalPaid = toNumber(row.principal_paid);
      const penaltyDue = toNumber(row.penalty_due);
      const penaltyPaid = toNumber(row.penalty_paid);
      const interestDue = toNumber(row.interest_due);
      const interestPaid = toNumber(row.interest_paid);
      return {
        id: row.id,
        dueOn: typeof row.due_on === 'string' ? row.due_on : row.due_on.toISOString().slice(0, 10),
        principalDue,
        principalPaid,
        penaltyDue,
        penaltyPaid,
        interestDue,
        interestPaid,
        chargeDue: toNumber(row.charge_due),
        chargePaid: toNumber(row.charge_paid),
        remainingAmount: Math.max(principalDue - principalPaid, 0)
          + Math.max(penaltyDue - penaltyPaid, 0)
          + Math.max(interestDue - interestPaid, 0),
        status: row.status,
      };
    }),
  };
}

export async function submitLoanApplication(actor: Actor, applicationId: string): Promise<{ id: string; status: string }> {
  return withTransaction(async (client) => {
    const application = await findApplication(client, applicationId, true);
    assertClientScope(actor, application.client_id);
    assertBranchScope(actor, application.branch_id);
    assertApplicationTransition(application.status, 'submitted');
    await client.query(`UPDATE loan_applications SET status = 'submitted', submitted_at = now() WHERE id = $1`, [applicationId]);
    await recordApplicationTransition(client, applicationId, application.status, 'submitted', actor.userId);
    await insertAuditEvent(client, { actorUserId: actor.userId, action: 'loan.application.submitted', entityType: 'loan_application', entityId: applicationId, correlationId: randomUUID() });
    return { id: applicationId, status: 'submitted' };
  });
}

export async function reviewKyc(actor: Actor, applicationId: string, input: { status: Exclude<KycStatus, 'pending'>; verificationMethod: string; evidenceNotes: string }): Promise<{ id: string; applicationStatus: string; kycStatus: string }> {
  if (!input.verificationMethod.trim() || !input.evidenceNotes.trim()) fail('KYC_EVIDENCE_REQUIRED', 'Verification method and evidence notes are required');
  return withTransaction(async (client) => {
    const application = await findApplication(client, applicationId, true);
    assertBranchScope(actor, application.branch_id);
    const existing = await client.query<{ id: string; status: KycStatus }>('SELECT id, status FROM kyc_records WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [application.client_id]);
    const current = existing.rows[0]?.status ?? 'pending';
    assertKycTransition(current, input.status);
    const nextApplicationStatus: ApplicationStatus = input.status === 'verified' ? 'kyc_verified' : 'rejected';
    assertApplicationTransition(application.status, nextApplicationStatus);
    if (existing.rowCount) {
      await client.query(`UPDATE kyc_records SET status = $1, verification_method = $2, reviewed_by = $3, reviewed_at = now(), reason = $4, evidence_notes = $5 WHERE id = $6`, [input.status, input.verificationMethod.trim(), actor.userId, input.evidenceNotes.trim(), input.evidenceNotes.trim(), existing.rows[0].id]);
    } else {
      await client.query(`INSERT INTO kyc_records (client_id, status, verification_method, reviewed_by, reviewed_at, reason, evidence_notes) VALUES ($1, $2, $3, $4, now(), $5, $6)`, [application.client_id, input.status, input.verificationMethod.trim(), actor.userId, input.evidenceNotes.trim(), input.evidenceNotes.trim()]);
    }
    await client.query(`UPDATE loan_applications SET status = $1 WHERE id = $2`, [nextApplicationStatus, applicationId]);
    await recordApplicationTransition(client, applicationId, application.status, nextApplicationStatus, actor.userId, input.evidenceNotes);
    await insertAuditEvent(client, { actorUserId: actor.userId, action: `client.kyc.${input.status}`, entityType: 'loan_application', entityId: applicationId, correlationId: randomUUID(), metadata: { verificationMethod: input.verificationMethod.trim(), evidenceNotes: input.evidenceNotes.trim() } });
    return { id: applicationId, applicationStatus: nextApplicationStatus, kycStatus: input.status };
  });
}

export async function assessApplicationRisk(actor: Actor, applicationId: string, input: { score: number; riskGrade: string; status: 'approved' | 'declined'; policyVersion: string; rationale: string }): Promise<{ id: string; applicationStatus: string; riskStatus: string }> {
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 100) fail('INVALID_RISK_SCORE', 'Risk score must be between 0 and 100');
  if (!input.policyVersion.trim() || !input.riskGrade.trim() || !input.rationale.trim()) fail('RISK_FIELDS_REQUIRED', 'Risk grade, policy version, and rationale are required');
  return withTransaction(async (client) => {
    const application = await findApplication(client, applicationId, true);
    assertBranchScope(actor, application.branch_id);
    const nextApplicationStatus: ApplicationStatus = input.status === 'approved' ? 'risk_assessed' : 'rejected';
    assertApplicationTransition(application.status, nextApplicationStatus);
    await client.query(
      `INSERT INTO risk_assessments (application_id, score, risk_grade, status, policy_version, assessed_by, rationale, assessed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [applicationId, input.score, input.riskGrade.trim(), input.status, input.policyVersion.trim(), actor.userId, input.rationale.trim()],
    );
    await client.query(`UPDATE loan_applications SET status = $1, risk_assessment_id = (SELECT id FROM risk_assessments WHERE application_id = $2) WHERE id = $2`, [nextApplicationStatus, applicationId]);
    await recordApplicationTransition(client, applicationId, application.status, nextApplicationStatus, actor.userId, input.rationale);
    await insertAuditEvent(client, { actorUserId: actor.userId, action: `loan.application.risk.${input.status}`, entityType: 'loan_application', entityId: applicationId, correlationId: randomUUID(), metadata: { score: input.score, riskGrade: input.riskGrade, policyVersion: input.policyVersion, rationale: input.rationale.trim() } });
    return { id: applicationId, applicationStatus: nextApplicationStatus, riskStatus: input.status };
  });
}

export async function decideApplication(actor: Actor, applicationId: string, input: { decision: 'approve' | 'reject'; reason: string }): Promise<{ id: string; status: string; loanId?: string }> {
  if (!input.reason.trim()) fail('DECISION_REASON_REQUIRED', 'A decision reason is required');
  return withTransaction(async (client) => {
    const application = await findApplication(client, applicationId, true);
    assertBranchScope(actor, application.branch_id);
    const nextStatus: ApplicationStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    assertApplicationTransition(application.status, nextStatus);
    if (input.decision === 'approve') {
      const assessment = await client.query(`SELECT id FROM risk_assessments WHERE application_id = $1 AND status = 'approved' AND rationale IS NOT NULL`, [applicationId]);
      if (!assessment.rowCount) fail('RISK_ASSESSMENT_REQUIRED', 'An approved risk assessment is required before approval');
    }
    await client.query(`UPDATE loan_applications SET status = $1, approved_by = $2, approved_at = now() WHERE id = $3`, [nextStatus, actor.userId, applicationId]);
    let loanId: string | undefined;
    if (input.decision === 'approve') {
      const loan = await client.query<{ id: string }>(
        `INSERT INTO loans (application_id, client_id, branch_id, principal_amount, outstanding_principal, status)
         VALUES ($1, $2, $3, $4, $4, 'approved') RETURNING id`,
        [applicationId, application.client_id, application.branch_id, application.requested_amount],
      );
      loanId = loan.rows[0].id;
      await client.query(`INSERT INTO repayment_schedules (loan_id, due_on, principal_due, charge_due) VALUES ($1, current_date + 30, $2, 0)`, [loanId, application.requested_amount]);
    }
    await recordApplicationTransition(client, applicationId, application.status, nextStatus, actor.userId, input.reason);
    await insertAuditEvent(client, { actorUserId: actor.userId, action: `loan.application.${input.decision === 'approve' ? 'approved' : 'rejected'}`, entityType: 'loan_application', entityId: applicationId, correlationId: randomUUID(), metadata: { reason: input.reason.trim(), loanId } });
    return { id: applicationId, status: nextStatus, loanId };
  });
}

export async function getApplicationTimeline(actor: Actor, applicationId: string): Promise<ApplicationTimelineEntry[]> {
  const application = await findApplication(pool, applicationId);
  assertClientScope(actor, application.client_id);
  assertBranchScope(actor, application.branch_id);
  const result = await pool.query<{ id: string; from_state: string | null; to_state: string; actor_user_id: string | null; reason: string | null; created_at: Date }>(
    `SELECT id, from_state, to_state, actor_user_id, reason, created_at FROM application_transition_history WHERE application_id = $1 ORDER BY created_at ASC, id ASC`,
    [applicationId],
  );
  return result.rows.map((row) => ({ id: row.id, fromState: row.from_state, toState: row.to_state, actorUserId: row.actor_user_id, reason: row.reason, createdAt: toIso(row.created_at) }));
}

export async function disburseLoan(actor: Actor, loanId: string, input: { disbursementReference: string; idempotencyKey: string }): Promise<{ loanId: string; status: string; disbursementReference: string; amount: number; created: boolean }> {
  if (!input.disbursementReference.trim() || input.idempotencyKey.trim().length < 8) fail('DISBURSEMENT_FIELDS_REQUIRED', 'Disbursement reference and idempotency key are required');
  return withTransaction(async (client) => {
    const loan = await findLoan(client, loanId, true);
    assertBranchScope(actor, loan.branch_id);
    const existing = await client.query<{ loan_id: string; disbursement_reference: string; amount: string }>('SELECT loan_id, disbursement_reference, amount FROM loan_disbursements WHERE idempotency_key = $1', [input.idempotencyKey]);
    if (existing.rowCount) {
      if (existing.rows[0].loan_id !== loanId) fail('IDEMPOTENCY_KEY_REUSED', 'The disbursement idempotency key is already assigned to another loan', 409);
      return { loanId: existing.rows[0].loan_id, status: 'disbursed', disbursementReference: existing.rows[0].disbursement_reference, amount: toNumber(existing.rows[0].amount), created: false };
    }
    assertLoanTransition(loan.status, 'disbursed');
    await client.query(`UPDATE loans SET status = 'disbursed', version = version + 1 WHERE id = $1`, [loanId]);
    await client.query(`INSERT INTO loan_disbursements (loan_id, disbursement_reference, idempotency_key, amount, posted_by) VALUES ($1, $2, $3, $4, $5)`, [loanId, input.disbursementReference.trim(), input.idempotencyKey.trim(), loan.principal_amount, actor.userId]);
    const ledger = await postLedgerTransactionOnClient(client, {
      actorUserId: actor.userId,
      sourceType: 'loan_disbursement',
      sourceId: loanId,
      idempotencyKey: `disbursement-ledger:${input.idempotencyKey.trim()}`,
      correlationId: randomUUID(),
      description: 'Loan disbursement',
      lines: [
        { accountCode: 'loan.receivable', side: 'debit', amount: toNumber(loan.principal_amount) },
        { accountCode: 'cash.disbursement', side: 'credit', amount: toNumber(loan.principal_amount) },
      ],
    });
    await recordApplicationTransition(client, loan.application_id, 'approved', 'disbursed', actor.userId, input.disbursementReference.trim());
    await insertAuditEvent(client, { actorUserId: actor.userId, action: 'loan.disbursed', entityType: 'loan', entityId: loanId, correlationId: randomUUID(), metadata: { disbursementReference: input.disbursementReference.trim(), ledgerTransactionId: ledger.transactionId } });
    return { loanId, status: 'disbursed', disbursementReference: input.disbursementReference.trim(), amount: toNumber(loan.principal_amount), created: true };
  });
}

export async function transitionLoan(actor: Actor, loanId: string, status: Exclude<LoanStatus, 'approved'>, reason: string): Promise<{ loanId: string; status: string }> {
  if (!reason.trim()) fail('TRANSITION_REASON_REQUIRED', 'A transition reason is required');
  return withTransaction(async (client) => {
    const loan = await findLoan(client, loanId, true);
    assertBranchScope(actor, loan.branch_id);
    assertLoanTransition(loan.status, status);
    await client.query(`UPDATE loans SET status = $1, version = version + 1 WHERE id = $2`, [status, loanId]);
    await insertAuditEvent(client, { actorUserId: actor.userId, action: `loan.status.${status}`, entityType: 'loan', entityId: loanId, correlationId: randomUUID(), metadata: { reason: reason.trim() } });
    return { loanId, status };
  });
}
