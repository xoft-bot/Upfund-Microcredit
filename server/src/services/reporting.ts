import { pool } from '../db.js';
import type {
  BranchPerformance,
  CollectionBreakdown,
  DailyCollectionSummary,
  ManagerReportingSnapshot,
  OpenReconciliation,
  ReportingAllocationSummary,
  ReportingFilters,
} from '../../../shared/reporting.js';

export interface ReportingQueryInput {
  branchId?: string | null;
  asOf?: string;
  from?: string;
  to?: string;
}

interface NormalizedReportingInput extends ReportingFilters {}

const toNumber = (value: string | number | null): number => Number(value ?? 0);
const toDate = (value: Date): string => value.toISOString().slice(0, 10);

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDate(date);
}

export function normalizeReportingInput(input: ReportingQueryInput = {}): NormalizedReportingInput {
  const asOf = input.asOf ?? toDate(new Date());
  if (!isIsoDate(asOf)) throw new Error('REPORTING_AS_OF_INVALID');
  const from = input.from ?? shiftDate(asOf, -29);
  const to = input.to ?? asOf;
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error('REPORTING_DATE_RANGE_INVALID');
  return { asOf, from, to, branchId: input.branchId ?? null };
}

interface PortfolioRow {
  portfolio_outstanding: string;
  active_loans: string;
  scheduled_amount: string;
  realized_due_amount: string;
  collection_efficiency: string;
  par30_amount: string;
  par30_loans: string;
  par60_amount: string;
  par60_loans: string;
  par90_amount: string;
  par90_loans: string;
  disbursement_count: string;
  disbursement_amount: string;
}

async function readPortfolio(input: NormalizedReportingInput): Promise<ManagerReportingSnapshot['summary']> {
  const result = await pool.query<PortfolioRow>(
    `WITH params AS (
       SELECT $1::uuid AS branch_id, $2::date AS from_date, $3::date AS to_date, $4::date AS as_of
     ),
     eligible_loans AS (
       SELECT l.id, l.branch_id, l.outstanding_principal
       FROM loans l, params p
       WHERE (p.branch_id IS NULL OR l.branch_id = p.branch_id)
         AND l.status IN ('disbursed', 'active', 'overdue', 'defaulted')
     ),
     posted_by_schedule AS (
       SELECT p.schedule_id, SUM(p.principal_amount) AS principal_paid
       FROM payments p, params x
       WHERE p.status = 'posted'
         AND p.schedule_id IS NOT NULL
         AND p.created_at::date <= x.as_of
       GROUP BY p.schedule_id
     ),
     overdue_loans AS (
       SELECT s.loan_id,
              BOOL_OR(s.due_on <= x.as_of - 30 AND s.principal_due > GREATEST(s.principal_paid, COALESCE(ps.principal_paid, 0))) AS par30,
              BOOL_OR(s.due_on <= x.as_of - 60 AND s.principal_due > GREATEST(s.principal_paid, COALESCE(ps.principal_paid, 0))) AS par60,
              BOOL_OR(s.due_on <= x.as_of - 90 AND s.principal_due > GREATEST(s.principal_paid, COALESCE(ps.principal_paid, 0))) AS par90
       FROM repayment_schedules s
       JOIN eligible_loans l ON l.id = s.loan_id
       CROSS JOIN params x
       LEFT JOIN posted_by_schedule ps ON ps.schedule_id = s.id
       GROUP BY s.loan_id
     ),
     due_window AS (
       SELECT COALESCE(SUM(s.principal_due + s.penalty_due + s.interest_due), 0) AS scheduled_amount
       FROM repayment_schedules s
       JOIN loans l ON l.id = s.loan_id
       CROSS JOIN params x
       WHERE (x.branch_id IS NULL OR l.branch_id = x.branch_id)
         AND s.due_on BETWEEN x.from_date AND x.to_date
     ),
     realized_window AS (
       SELECT COALESCE(SUM(p.principal_amount + p.penalty_amount + p.interest_amount), 0) AS realized_due_amount
       FROM payments p
       JOIN repayment_schedules s ON s.id = p.schedule_id
       JOIN loans l ON l.id = p.loan_id
       CROSS JOIN params x
       WHERE (x.branch_id IS NULL OR l.branch_id = x.branch_id)
         AND p.status = 'posted'
         AND p.created_at::date BETWEEN x.from_date AND x.to_date
         AND s.due_on BETWEEN x.from_date AND x.to_date
     ),
     disbursements AS (
       SELECT COUNT(*) AS disbursement_count, COALESCE(SUM(d.amount), 0) AS disbursement_amount
       FROM loan_disbursements d
       JOIN loans l ON l.id = d.loan_id
       CROSS JOIN params x
       WHERE (x.branch_id IS NULL OR l.branch_id = x.branch_id)
         AND d.created_at::date BETWEEN x.from_date AND x.to_date
     )
     SELECT
       COALESCE(SUM(l.outstanding_principal), 0) AS portfolio_outstanding,
       COUNT(l.id) AS active_loans,
       (SELECT scheduled_amount FROM due_window) AS scheduled_amount,
       (SELECT realized_due_amount FROM realized_window) AS realized_due_amount,
       CASE WHEN (SELECT scheduled_amount FROM due_window) = 0 THEN 0
            ELSE ROUND((SELECT realized_due_amount FROM realized_window)::numeric * 100 / (SELECT scheduled_amount FROM due_window), 2)
       END AS collection_efficiency,
       COALESCE(SUM(l.outstanding_principal) FILTER (WHERE o.par30), 0) AS par30_amount,
       COUNT(l.id) FILTER (WHERE o.par30) AS par30_loans,
       COALESCE(SUM(l.outstanding_principal) FILTER (WHERE o.par60), 0) AS par60_amount,
       COUNT(l.id) FILTER (WHERE o.par60) AS par60_loans,
       COALESCE(SUM(l.outstanding_principal) FILTER (WHERE o.par90), 0) AS par90_amount,
       COUNT(l.id) FILTER (WHERE o.par90) AS par90_loans,
       (SELECT disbursement_count FROM disbursements) AS disbursement_count,
       (SELECT disbursement_amount FROM disbursements) AS disbursement_amount
     FROM eligible_loans l
     LEFT JOIN overdue_loans o ON o.loan_id = l.id`,
    [input.branchId, input.from, input.to, input.asOf],
  );
  const row = result.rows[0];
  const portfolioOutstanding = toNumber(row.portfolio_outstanding);
  const ratio = (amount: string): number => portfolioOutstanding === 0 ? 0 : Number((toNumber(amount) * 100 / portfolioOutstanding).toFixed(2));
  return {
    portfolioOutstanding,
    activeLoans: Number(row.active_loans),
    scheduledAmount: toNumber(row.scheduled_amount),
    realizedDueAmount: toNumber(row.realized_due_amount),
    collectionEfficiency: toNumber(row.collection_efficiency),
    par30: { amount: toNumber(row.par30_amount), ratio: ratio(row.par30_amount), loanCount: Number(row.par30_loans) },
    par60: { amount: toNumber(row.par60_amount), ratio: ratio(row.par60_amount), loanCount: Number(row.par60_loans) },
    par90: { amount: toNumber(row.par90_amount), ratio: ratio(row.par90_amount), loanCount: Number(row.par90_loans) },
    disbursementCount: Number(row.disbursement_count),
    disbursementAmount: toNumber(row.disbursement_amount),
  };
}

interface CollectionRow {
  collection_date: Date;
  branch_id: string;
  branch_name: string;
  collector_id: string | null;
  collector_name: string | null;
  payment_method: string;
  reconciled_count: string;
  reconciled_amount: string;
  pending_count: string;
  pending_amount: string;
}

async function readCollections(input: NormalizedReportingInput): Promise<{
  dailyCollections: DailyCollectionSummary[];
  collectionBreakdown: CollectionBreakdown[];
}> {
  const result = await pool.query<CollectionRow>(
    `SELECT f.captured_at::date AS collection_date,
            f.branch_id,
            b.name AS branch_name,
            f.collector_id,
            u.display_name AS collector_name,
            COALESCE(f.payment_method, p.method, 'manual') AS payment_method,
            COUNT(*) FILTER (WHERE f.status IN ('verified', 'posted')) AS reconciled_count,
            COALESCE(SUM(CASE WHEN f.status IN ('verified', 'posted') THEN COALESCE(p.amount, f.amount) ELSE 0 END), 0) AS reconciled_amount,
            COUNT(*) FILTER (WHERE f.status = 'pending_reconciliation') AS pending_count,
            COALESCE(SUM(CASE WHEN f.status = 'pending_reconciliation' THEN f.amount ELSE 0 END), 0) AS pending_amount
       FROM field_collection_records f
       JOIN branches b ON b.id = f.branch_id
       LEFT JOIN users u ON u.id = f.collector_id
       LEFT JOIN payments p ON p.id = f.payment_id
      WHERE ($1::uuid IS NULL OR f.branch_id = $1)
        AND f.captured_at::date BETWEEN $2::date AND $3::date
      GROUP BY f.captured_at::date, f.branch_id, b.name, f.collector_id, u.display_name,
               COALESCE(f.payment_method, p.method, 'manual')
      ORDER BY f.captured_at::date ASC, b.name ASC, collector_name ASC NULLS LAST, payment_method ASC`,
    [input.branchId, input.from, input.to],
  );
  const daily = new Map<string, DailyCollectionSummary>();
  const breakdown = result.rows.map((row) => {
    const date = toDate(new Date(row.collection_date));
    const reconciledCount = Number(row.reconciled_count);
    const reconciledAmount = toNumber(row.reconciled_amount);
    const pendingCount = Number(row.pending_count);
    const pendingAmount = toNumber(row.pending_amount);
    const current = daily.get(date) ?? { date, reconciledCount: 0, reconciledAmount: 0, pendingCount: 0, pendingAmount: 0 };
    current.reconciledCount += reconciledCount;
    current.reconciledAmount += reconciledAmount;
    current.pendingCount += pendingCount;
    current.pendingAmount += pendingAmount;
    daily.set(date, current);
    return {
      date,
      branchId: row.branch_id,
      branchName: row.branch_name,
      collectorId: row.collector_id,
      collectorName: row.collector_name ?? 'Unassigned collector',
      paymentMethod: row.payment_method,
      reconciledCount,
      reconciledAmount,
      pendingCount,
      pendingAmount,
    };
  });
  return { dailyCollections: [...daily.values()], collectionBreakdown: breakdown };
}

async function readBranchPerformance(input: NormalizedReportingInput): Promise<BranchPerformance[]> {
  const result = await pool.query<{
    branch_id: string;
    branch_name: string;
    outstanding_principal: string;
    disbursement_count: string;
    disbursement_amount: string;
    reconciled_collections: string;
    pending_collections: string;
    open_reconciliations: string;
    scheduled_amount: string;
    realized_due_amount: string;
  }>(
    `WITH scoped_branches AS (
       SELECT b.id, b.name FROM branches b WHERE ($1::uuid IS NULL OR b.id = $1)
     ),
     loan_rollup AS (
       SELECT l.branch_id, COALESCE(SUM(l.outstanding_principal), 0) AS outstanding_principal
       FROM loans l
       WHERE l.status IN ('disbursed', 'active', 'overdue', 'defaulted')
       GROUP BY l.branch_id
     ),
     disbursement_rollup AS (
       SELECT l.branch_id, COUNT(*) AS disbursement_count, COALESCE(SUM(d.amount), 0) AS disbursement_amount
       FROM loan_disbursements d JOIN loans l ON l.id = d.loan_id
       WHERE d.created_at::date BETWEEN $2::date AND $3::date
       GROUP BY l.branch_id
     ),
     collection_rollup AS (
       SELECT f.branch_id,
              COALESCE(SUM(f.amount) FILTER (WHERE f.status IN ('verified', 'posted')), 0) AS reconciled_collections,
              COALESCE(SUM(f.amount) FILTER (WHERE f.status = 'pending_reconciliation'), 0) AS pending_collections
       FROM field_collection_records f
       WHERE f.captured_at::date BETWEEN $2::date AND $3::date
       GROUP BY f.branch_id
     ),
     reconciliation_rollup AS (
       SELECT r.branch_id, COUNT(*) AS open_reconciliations
       FROM reconciliations r
       WHERE r.status IN ('pending', 'variance')
       GROUP BY r.branch_id
     ),
     schedule_rollup AS (
       SELECT l.branch_id,
              COALESCE(SUM(s.principal_due + s.penalty_due + s.interest_due), 0) AS scheduled_amount,
              COALESCE(SUM(p.principal_amount + p.penalty_amount + p.interest_amount), 0) AS realized_due_amount
       FROM repayment_schedules s
       JOIN loans l ON l.id = s.loan_id
       LEFT JOIN payments p ON p.schedule_id = s.id AND p.status = 'posted' AND p.created_at::date BETWEEN $2::date AND $3::date
       WHERE s.due_on BETWEEN $2::date AND $3::date
       GROUP BY l.branch_id
     )
     SELECT b.id AS branch_id, b.name AS branch_name,
            COALESCE(l.outstanding_principal, 0) AS outstanding_principal,
            COALESCE(d.disbursement_count, 0) AS disbursement_count,
            COALESCE(d.disbursement_amount, 0) AS disbursement_amount,
            COALESCE(c.reconciled_collections, 0) AS reconciled_collections,
            COALESCE(c.pending_collections, 0) AS pending_collections,
            COALESCE(r.open_reconciliations, 0) AS open_reconciliations,
            COALESCE(s.scheduled_amount, 0) AS scheduled_amount,
            COALESCE(s.realized_due_amount, 0) AS realized_due_amount
       FROM scoped_branches b
       LEFT JOIN loan_rollup l ON l.branch_id = b.id
       LEFT JOIN disbursement_rollup d ON d.branch_id = b.id
       LEFT JOIN collection_rollup c ON c.branch_id = b.id
       LEFT JOIN reconciliation_rollup r ON r.branch_id = b.id
       LEFT JOIN schedule_rollup s ON s.branch_id = b.id
      ORDER BY b.name ASC`,
    [input.branchId, input.from, input.to],
  );
  return result.rows.map((row) => ({
    branchId: row.branch_id,
    branchName: row.branch_name,
    outstandingPrincipal: toNumber(row.outstanding_principal),
    disbursementCount: Number(row.disbursement_count),
    disbursementAmount: toNumber(row.disbursement_amount),
    reconciledCollections: toNumber(row.reconciled_collections),
    pendingCollections: toNumber(row.pending_collections),
    openReconciliations: Number(row.open_reconciliations),
    collectionEfficiency: toNumber(row.scheduled_amount) === 0 ? 0 : Number((toNumber(row.realized_due_amount) * 100 / toNumber(row.scheduled_amount)).toFixed(2)),
  }));
}

async function readAllocations(input: NormalizedReportingInput): Promise<ReportingAllocationSummary> {
  const result = await pool.query<{
    posted_amount: string;
    principal_recovery: string;
    realized_interest: string;
    realized_penalty: string;
    overpayment_liability: string;
    held_overpayment_balance: string;
  }>(
    `WITH posted AS (
       SELECT p.id, p.amount, p.principal_amount, p.interest_amount, p.penalty_amount, p.overpayment_amount
       FROM payments p
       WHERE ($1::uuid IS NULL OR p.branch_id = $1)
         AND p.status = 'posted'
         AND p.created_at::date BETWEEN $2::date AND $3::date
     )
     SELECT
       COALESCE(SUM(amount), 0) AS posted_amount,
       COALESCE(SUM(principal_amount), 0) AS principal_recovery,
       COALESCE(SUM(interest_amount), 0) AS realized_interest,
       COALESCE(SUM(penalty_amount), 0) AS realized_penalty,
       COALESCE(SUM(overpayment_amount), 0) AS overpayment_liability,
       (SELECT COALESCE(SUM(oh.amount), 0)
          FROM overpayment_holdings oh
          JOIN posted p ON p.id = oh.payment_id
         WHERE oh.status = 'held') AS held_overpayment_balance
     FROM posted`,
    [input.branchId, input.from, input.to],
  );
  const row = result.rows[0];
  const realizedInterest = toNumber(row.realized_interest);
  const realizedPenalty = toNumber(row.realized_penalty);
  return {
    postedAmount: toNumber(row.posted_amount),
    principalRecovery: toNumber(row.principal_recovery),
    realizedInterest,
    realizedPenalty,
    realizedRevenue: realizedInterest + realizedPenalty,
    overpaymentLiability: toNumber(row.overpayment_liability),
    heldOverpaymentBalance: toNumber(row.held_overpayment_balance),
  };
}

async function readOpenReconciliations(input: NormalizedReportingInput): Promise<ManagerReportingSnapshot['openReconciliations']> {
  const result = await pool.query<{
    id: string;
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
  }>(
    `SELECT r.id, r.batch_reference, r.branch_id, b.name AS branch_name, r.created_at::date AS collection_date,
            r.expected_amount, r.recorded_amount, r.submitted_amount, r.variance, r.status,
            r.submitted_by, u.display_name AS submitted_by_name
       FROM reconciliations r
       JOIN branches b ON b.id = r.branch_id
       JOIN users u ON u.id = r.submitted_by
      WHERE ($1::uuid IS NULL OR r.branch_id = $1)
        AND r.status IN ('pending', 'variance')
        AND r.created_at::date <= $2::date
      ORDER BY r.created_at ASC, r.id ASC`,
    [input.branchId, input.asOf],
  );
  const batches: OpenReconciliation[] = result.rows.map((row) => ({
    id: row.id,
    batchReference: row.batch_reference,
    branchId: row.branch_id,
    branchName: row.branch_name,
    collectionDate: toDate(new Date(row.collection_date)),
    expectedAmount: toNumber(row.expected_amount),
    recordedAmount: toNumber(row.recorded_amount),
    submittedAmount: toNumber(row.submitted_amount),
    variance: toNumber(row.variance),
    status: row.status,
    submittedBy: row.submitted_by,
    submittedByName: row.submitted_by_name,
  }));
  return {
    count: batches.length,
    recordedAmount: batches.reduce((sum, batch) => sum + batch.recordedAmount, 0),
    variance: batches.reduce((sum, batch) => sum + batch.variance, 0),
    batches,
  };
}

export async function getManagerReportingSnapshot(input: ReportingQueryInput = {}): Promise<ManagerReportingSnapshot> {
  const normalized = normalizeReportingInput(input);
  const [summary, collections, branchPerformance, allocations, openReconciliations] = await Promise.all([
    readPortfolio(normalized),
    readCollections(normalized),
    readBranchPerformance(normalized),
    readAllocations(normalized),
    readOpenReconciliations(normalized),
  ]);
  return { filters: normalized, summary, ...collections, branchPerformance, allocations, openReconciliations };
}