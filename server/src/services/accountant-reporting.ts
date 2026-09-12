import { pool } from '../db.js';
import { normalizeReportingInput, type ReportingQueryInput } from './reporting.js';
import type {
  AccountantJournalEntry,
  AccountantReconciliationAudit,
  AccountantReportingSnapshot,
  AccountantTrialBalanceLine,
  AccountantWaterfallAllocation,
  AccountantWaterfallTotals,
} from '../../../shared/reporting.js';

const toNumber = (value: string | number | null): number => Number(value ?? 0);
const dateString = (value: Date): string => value.toISOString();
const dayString = (value: Date): string => value.toISOString().slice(0, 10);

interface ScopedTransactionCte {
  id: string;
  source_type: string;
  source_id: string;
  branch_id: string | null;
  branch_name: string | null;
  posted_at: Date;
  posted_by: string;
  posted_by_name: string | null;
  description: string;
}

async function readJournalEntries(input: ReturnType<typeof normalizeReportingInput>): Promise<AccountantJournalEntry[]> {
  const result = await pool.query<ScopedTransactionCte & {
    entry_id: string;
    account_code: string;
    side: 'debit' | 'credit';
    amount: string;
    currency: string;
    total_debits: string;
    total_credits: string;
  }>(
    `WITH scoped_transactions AS (
       SELECT lt.id, lt.source_type, lt.source_id,
              COALESCE(p.branch_id, r.branch_id, l.branch_id) AS branch_id,
              b.name AS branch_name, lt.posted_at, lt.posted_by,
              u.display_name AS posted_by_name, lt.description
       FROM ledger_transactions lt
       JOIN users u ON u.id = lt.posted_by
       LEFT JOIN payments p ON lt.source_type = 'manual_payment' AND p.id = lt.source_id
       LEFT JOIN reconciliations r ON lt.source_type = 'reconciliation_batch' AND r.id = lt.source_id
       LEFT JOIN loan_disbursements d ON lt.source_type = 'loan_disbursement' AND (d.id = lt.source_id OR d.loan_id = lt.source_id)
       LEFT JOIN loans l ON l.id = COALESCE(p.loan_id, d.loan_id)
       LEFT JOIN branches b ON b.id = COALESCE(p.branch_id, r.branch_id, l.branch_id)
       WHERE lt.posted_at::date BETWEEN $2::date AND $3::date
         AND ($1::uuid IS NULL OR COALESCE(p.branch_id, r.branch_id, l.branch_id) = $1)
     )
     SELECT st.*, le.id AS entry_id, le.account_code, le.side, le.amount, le.currency,
            SUM(le.amount) FILTER (WHERE le.side = 'debit') OVER (PARTITION BY st.id) AS total_debits,
            SUM(le.amount) FILTER (WHERE le.side = 'credit') OVER (PARTITION BY st.id) AS total_credits
       FROM scoped_transactions st
       JOIN ledger_entries le ON le.transaction_id = st.id
      ORDER BY st.posted_at ASC, st.id ASC, le.created_at ASC, le.id ASC`,
    [input.branchId, input.from, input.to],
  );
  const entries = new Map<string, AccountantJournalEntry>();
  for (const row of result.rows) {
    const existing = entries.get(row.id);
    const entry = existing ?? {
      transactionId: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      branchId: row.branch_id,
      branchName: row.branch_name,
      postedAt: dateString(row.posted_at),
      postedBy: row.posted_by,
      postedByName: row.posted_by_name,
      description: row.description,
      totalDebits: toNumber(row.total_debits),
      totalCredits: toNumber(row.total_credits),
      balanced: toNumber(row.total_debits) === toNumber(row.total_credits),
      lines: [],
    };
    entry.lines.push({ id: row.entry_id, accountCode: row.account_code, side: row.side, amount: toNumber(row.amount), currency: row.currency });
    entries.set(row.id, entry);
  }
  return [...entries.values()];
}

async function readBranches(input: ReturnType<typeof normalizeReportingInput>): Promise<Array<{ branchId: string; branchName: string }>> {
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM branches
      WHERE ($1::uuid IS NULL OR id = $1)
      ORDER BY name ASC`,
    [input.branchId],
  );
  return result.rows.map((row) => ({ branchId: row.id, branchName: row.name }));
}

async function readTrialBalance(input: ReturnType<typeof normalizeReportingInput>): Promise<AccountantTrialBalanceLine[]> {
  const result = await pool.query<{ account_code: string; debit_total: string; credit_total: string }>(
    `WITH scoped_transactions AS (
       SELECT lt.id
       FROM ledger_transactions lt
       LEFT JOIN payments p ON lt.source_type = 'manual_payment' AND p.id = lt.source_id
       LEFT JOIN reconciliations r ON lt.source_type = 'reconciliation_batch' AND r.id = lt.source_id
       LEFT JOIN loan_disbursements d ON lt.source_type = 'loan_disbursement' AND (d.id = lt.source_id OR d.loan_id = lt.source_id)
       LEFT JOIN loans l ON l.id = COALESCE(p.loan_id, d.loan_id)
       WHERE lt.posted_at::date BETWEEN $2::date AND $3::date
         AND ($1::uuid IS NULL OR COALESCE(p.branch_id, r.branch_id, l.branch_id) = $1)
     )
     SELECT le.account_code,
            COALESCE(SUM(le.amount) FILTER (WHERE le.side = 'debit'), 0) AS debit_total,
            COALESCE(SUM(le.amount) FILTER (WHERE le.side = 'credit'), 0) AS credit_total
       FROM ledger_entries le
       JOIN scoped_transactions st ON st.id = le.transaction_id
      GROUP BY le.account_code
      ORDER BY le.account_code ASC`,
    [input.branchId, input.from, input.to],
  );
  return result.rows.map((row) => {
    const debitTotal = toNumber(row.debit_total);
    const creditTotal = toNumber(row.credit_total);
    return { accountCode: row.account_code, debitTotal, creditTotal, netBalance: debitTotal - creditTotal };
  });
}

async function readWaterfallAllocations(input: ReturnType<typeof normalizeReportingInput>): Promise<{ allocations: AccountantWaterfallAllocation[]; totals: AccountantWaterfallTotals }> {
  const result = await pool.query<{
    payment_id: string;
    loan_id: string;
    branch_id: string;
    branch_name: string;
    posted_at: Date;
    amount: string;
    principal_amount: string;
    interest_amount: string;
    penalty_amount: string;
    overpayment_amount: string;
  }>(
    `SELECT p.id AS payment_id, p.loan_id, p.branch_id, b.name AS branch_name, p.created_at AS posted_at,
            p.amount, p.principal_amount, p.interest_amount, p.penalty_amount, p.overpayment_amount
       FROM payments p
       JOIN branches b ON b.id = p.branch_id
      WHERE p.status = 'posted'
        AND ($1::uuid IS NULL OR p.branch_id = $1)
        AND p.created_at::date BETWEEN $2::date AND $3::date
      ORDER BY p.created_at ASC, p.id ASC`,
    [input.branchId, input.from, input.to],
  );
  const allocations = result.rows.map((row) => {
    const amount = toNumber(row.amount);
    const principalRecovery = toNumber(row.principal_amount);
    const realizedInterest = toNumber(row.interest_amount);
    const realizedPenalty = toNumber(row.penalty_amount);
    const overpaymentLiability = toNumber(row.overpayment_amount);
    return {
      paymentId: row.payment_id,
      loanId: row.loan_id,
      branchId: row.branch_id,
      branchName: row.branch_name,
      postedAt: dateString(row.posted_at),
      amount,
      principalRecovery,
      realizedInterest,
      realizedPenalty,
      overpaymentLiability,
      allocationDelta: amount - principalRecovery - realizedInterest - realizedPenalty - overpaymentLiability,
    };
  });
  const totals = allocations.reduce<AccountantWaterfallTotals>((summary, row) => ({
    postedAmount: summary.postedAmount + row.amount,
    principalRecovery: summary.principalRecovery + row.principalRecovery,
    realizedInterest: summary.realizedInterest + row.realizedInterest,
    realizedPenalty: summary.realizedPenalty + row.realizedPenalty,
    overpaymentLiability: summary.overpaymentLiability + row.overpaymentLiability,
    allocationDelta: summary.allocationDelta + row.allocationDelta,
  }), { postedAmount: 0, principalRecovery: 0, realizedInterest: 0, realizedPenalty: 0, overpaymentLiability: 0, allocationDelta: 0 });
  return { allocations, totals };
}

async function readReconciliationAudit(input: ReturnType<typeof normalizeReportingInput>): Promise<{ overrides: AccountantReconciliationAudit[]; varianceLogs: AccountantReconciliationAudit[] }> {
  const result = await pool.query<{
    reconciliation_id: string;
    batch_reference: string;
    branch_id: string;
    branch_name: string;
    collection_date: Date;
    expected_amount: string;
    recorded_amount: string;
    submitted_amount: string;
    variance: string;
    status: string;
    submitted_by: string;
    submitted_by_name: string | null;
    reviewed_by: string | null;
    reviewed_by_name: string | null;
    reviewed_at: Date | null;
    decision_reason: string | null;
    audit_action: string | null;
    audit_at: Date | null;
  }>(
    `SELECT r.id AS reconciliation_id, r.batch_reference, r.branch_id, b.name AS branch_name,
            r.created_at::date AS collection_date, r.expected_amount, r.recorded_amount,
            r.submitted_amount, r.variance, r.status, r.submitted_by,
            submitter.display_name AS submitted_by_name, r.reviewed_by,
            reviewer.display_name AS reviewed_by_name, r.reviewed_at, r.decision_reason,
            audit.action AS audit_action, audit.created_at AS audit_at
       FROM reconciliations r
       JOIN branches b ON b.id = r.branch_id
       JOIN users submitter ON submitter.id = r.submitted_by
       LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
       LEFT JOIN LATERAL (
         SELECT ae.action, ae.created_at
           FROM audit_events ae
          WHERE ae.entity_type = 'reconciliation'
            AND ae.entity_id = r.id
            AND ae.action IN ('reconciliation.batch.posted', 'reconciliation.batch.rejected')
          ORDER BY ae.created_at DESC, ae.id DESC
          LIMIT 1
       ) audit ON true
      WHERE ($1::uuid IS NULL OR r.branch_id = $1)
        AND r.created_at::date BETWEEN $2::date AND $3::date
        AND r.variance <> 0
      ORDER BY r.created_at ASC, r.id ASC`,
    [input.branchId, input.from, input.to],
  );
  const logs = result.rows.map((row) => ({
    reconciliationId: row.reconciliation_id,
    batchReference: row.batch_reference,
    branchId: row.branch_id,
    branchName: row.branch_name,
    collectionDate: dayString(row.collection_date),
    expectedAmount: toNumber(row.expected_amount),
    recordedAmount: toNumber(row.recorded_amount),
    submittedAmount: toNumber(row.submitted_amount),
    variance: toNumber(row.variance),
    status: row.status,
    submittedBy: row.submitted_by,
    submittedByName: row.submitted_by_name,
    reviewedBy: row.reviewed_by,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at ? dateString(row.reviewed_at) : null,
    decisionReason: row.decision_reason,
    auditAction: row.audit_action,
    auditAt: row.audit_at ? dateString(row.audit_at) : null,
  }));
  return {
    varianceLogs: logs,
    overrides: logs.filter((log) => Boolean(log.reviewedBy) && ['approved', 'rejected'].includes(log.status)),
  };
}

export async function getAccountantReportingSnapshot(input: ReportingQueryInput = {}): Promise<AccountantReportingSnapshot> {
  const normalized = normalizeReportingInput(input);
  const [branches, journalEntries, trialBalance, waterfall, reconciliationAudit] = await Promise.all([
    readBranches(normalized),
    readJournalEntries(normalized),
    readTrialBalance(normalized),
    readWaterfallAllocations(normalized),
    readReconciliationAudit(normalized),
  ]);
  return {
    filters: normalized,
    branches,
    journalEntries,
    waterfallAllocations: waterfall.allocations,
    waterfallTotals: waterfall.totals,
    trialBalance,
    reconciliationOverrides: reconciliationAudit.overrides,
    varianceLogs: reconciliationAudit.varianceLogs,
  };
}