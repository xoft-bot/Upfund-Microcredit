import { pool } from '../db.js';
import { normalizeReportingInput, type ReportingQueryInput } from './reporting.js';
import type {
  CollectorOfflineQueueItem,
  CollectorOverdueAccount,
  CollectorPaymentMethodSummary,
  CollectorReportingSnapshot,
  CollectorRouteMetric,
  CollectorSchedule,
  CollectorTargetProgress,
} from '../../../shared/reporting.js';

export interface CollectorReportingQueryInput extends ReportingQueryInput {
  collectorId?: string | null;
}

const toNumber = (value: string | number | null): number => Number(value ?? 0);
const dayString = (value: Date): string => value.toISOString().slice(0, 10);
const isoString = (value: Date): string => value.toISOString();

type NormalizedCollectorInput = ReturnType<typeof normalizeReportingInput> & { collectorId: string | null };

function normalizeCollectorInput(input: CollectorReportingQueryInput = {}): NormalizedCollectorInput {
  return { ...normalizeReportingInput(input), collectorId: input.collectorId ?? null };
}

interface TargetRow {
  target_amount: string;
  actual_amount: string;
  pending_amount: string;
  scheduled_client_count: string;
  overdue_client_count: string;
}

async function readTargetProgress(input: NormalizedCollectorInput): Promise<{ targetProgress: CollectorTargetProgress; routes: CollectorRouteMetric[] }> {
  const result = await pool.query<TargetRow & { route_code: string | null; assigned_client_count: string }>(
    `WITH active_assignments AS (
       SELECT DISTINCT ON (ca.client_id, ca.route_code)
              ca.client_id, ca.branch_id, ca.route_code
       FROM collector_assignments ca
       WHERE ($1::uuid IS NULL OR ca.officer_id = $1)
         AND ($2::uuid IS NULL OR ca.branch_id = $2)
         AND ca.effective_from <= $3::date
         AND (ca.effective_to IS NULL OR ca.effective_to >= $3::date)
       ORDER BY ca.client_id, ca.route_code, ca.effective_from DESC, ca.id DESC
     ),
     assignment_counts AS (
       SELECT route_code, COUNT(DISTINCT client_id) AS assigned_client_count
       FROM active_assignments
       GROUP BY route_code
     ),
     scheduled_by_route AS (
       SELECT a.route_code,
              SUM(s.principal_due + s.penalty_due + s.interest_due) AS target_amount,
              COUNT(DISTINCT a.client_id) AS scheduled_client_count
       FROM active_assignments a
       JOIN loans l ON l.client_id = a.client_id AND l.branch_id = a.branch_id
       JOIN repayment_schedules s ON s.loan_id = l.id
       WHERE s.due_on = $3::date
       GROUP BY a.route_code
     ),
     actuals_by_route AS (
       SELECT a.route_code,
              COALESCE(SUM(CASE WHEN f.status IN ('posted', 'verified') THEN COALESCE(p.amount, f.amount) ELSE 0 END), 0) AS actual_amount,
              COALESCE(SUM(CASE WHEN f.status = 'pending_reconciliation' THEN f.amount ELSE 0 END), 0) AS pending_amount
       FROM active_assignments a
       JOIN field_collection_records f ON f.client_id = a.client_id AND f.branch_id = a.branch_id
       LEFT JOIN payments p ON p.id = f.payment_id
       WHERE f.captured_at::date = $3::date
       GROUP BY a.route_code
     ),
     route_rows AS (
       SELECT a.route_code, a.assigned_client_count,
              COALESCE(s.target_amount, 0) AS target_amount,
              COALESCE(s.scheduled_client_count, 0) AS scheduled_client_count,
              COALESCE(c.actual_amount, 0) AS actual_amount,
              COALESCE(c.pending_amount, 0) AS pending_amount
         FROM assignment_counts a
         LEFT JOIN scheduled_by_route s ON s.route_code = a.route_code
         LEFT JOIN actuals_by_route c ON c.route_code = a.route_code
     )
     SELECT COALESCE(SUM(target_amount), 0) AS target_amount,
            COALESCE(SUM(actual_amount), 0) AS actual_amount,
            COALESCE(SUM(pending_amount), 0) AS pending_amount,
            COALESCE(SUM(scheduled_client_count), 0) AS scheduled_client_count,
            (SELECT COUNT(DISTINCT a.client_id)
               FROM active_assignments a
               JOIN loans l ON l.client_id = a.client_id AND l.branch_id = a.branch_id
               JOIN repayment_schedules s ON s.loan_id = l.id
              WHERE s.due_on < $3::date
                AND s.status = 'open'
                AND s.principal_due + s.penalty_due + s.interest_due
                    > s.principal_paid + s.penalty_paid + s.interest_paid) AS overdue_client_count,
            NULL::text AS route_code,
            0::bigint AS assigned_client_count
       FROM route_rows
     UNION ALL
     SELECT target_amount, actual_amount, pending_amount, scheduled_client_count,
            0::bigint AS overdue_client_count, route_code, assigned_client_count
       FROM route_rows
      ORDER BY route_code NULLS FIRST`,
     [input.collectorId, input.branchId, input.asOf],
  );
  const total = result.rows.find((row) => row.route_code === null);
  const targetAmount = toNumber(total?.target_amount ?? null);
  const actualAmount = toNumber(total?.actual_amount ?? null);
  const progress = targetAmount === 0 ? 0 : Number((actualAmount * 100 / targetAmount).toFixed(2));
  const targetProgress: CollectorTargetProgress = {
    targetAmount,
    actualAmount,
    pendingAmount: toNumber(total?.pending_amount ?? null),
    progressPercent: progress,
    scheduledClientCount: Number(total?.scheduled_client_count ?? 0),
    overdueClientCount: Number(total?.overdue_client_count ?? 0),
  };
  const routes = result.rows.filter((row) => row.route_code !== null).map((row) => {
    const routeTarget = toNumber(row.target_amount);
    return {
      routeCode: row.route_code!,
      assignedClientCount: Number(row.assigned_client_count),
      targetAmount: routeTarget,
      actualAmount: toNumber(row.actual_amount),
      pendingAmount: toNumber(row.pending_amount),
      progressPercent: routeTarget === 0 ? 0 : Number((toNumber(row.actual_amount) * 100 / routeTarget).toFixed(2)),
    };
  });
  return { targetProgress, routes };
}

async function readSchedules(input: NormalizedCollectorInput): Promise<CollectorSchedule[]> {
  const result = await pool.query<{
    schedule_id: string; client_id: string; client_name: string; loan_id: string; due_on: Date;
    amount_due: string; amount_paid: string; remaining_amount: string; status: string; route_code: string;
  }>(
    `WITH active_assignments AS (
       SELECT DISTINCT ON (ca.client_id)
              ca.client_id, ca.branch_id, ca.route_code
       FROM collector_assignments ca
       WHERE ($1::uuid IS NULL OR ca.officer_id = $1)
         AND ($2::uuid IS NULL OR ca.branch_id = $2)
         AND ca.effective_from <= $5::date
         AND (ca.effective_to IS NULL OR ca.effective_to >= $5::date)
       ORDER BY ca.client_id, ca.effective_from DESC, ca.id DESC
     )
     SELECT s.id AS schedule_id, c.id AS client_id, c.display_name AS client_name, l.id AS loan_id,
            s.due_on, s.principal_due + s.penalty_due + s.interest_due AS amount_due,
            s.principal_paid + s.penalty_paid + s.interest_paid AS amount_paid,
            GREATEST(s.principal_due + s.penalty_due + s.interest_due - s.principal_paid - s.penalty_paid - s.interest_paid, 0) AS remaining_amount,
            s.status, a.route_code
       FROM active_assignments a
       JOIN clients c ON c.id = a.client_id
       JOIN loans l ON l.client_id = c.id AND l.branch_id = a.branch_id
       JOIN repayment_schedules s ON s.loan_id = l.id
      WHERE s.due_on BETWEEN $3::date AND $4::date
      ORDER BY s.due_on ASC, c.display_name ASC, s.id ASC`,
    [input.collectorId, input.branchId, input.from, input.to, input.asOf],
  );
  return result.rows.map((row) => ({
    scheduleId: row.schedule_id,
    clientId: row.client_id,
    clientName: row.client_name,
    loanId: row.loan_id,
    dueOn: dayString(row.due_on),
    amountDue: toNumber(row.amount_due),
    amountPaid: toNumber(row.amount_paid),
    remainingAmount: toNumber(row.remaining_amount),
    status: row.status,
    routeCode: row.route_code,
  }));
}

async function readOverdueWatchlist(input: NormalizedCollectorInput): Promise<CollectorOverdueAccount[]> {
  const result = await pool.query<{
    client_id: string; client_name: string; loan_id: string; oldest_due_on: Date; overdue_amount: string; route_code: string;
  }>(
    `WITH active_assignments AS (
       SELECT DISTINCT ON (ca.client_id)
              ca.client_id, ca.branch_id, ca.route_code
       FROM collector_assignments ca
       WHERE ($1::uuid IS NULL OR ca.officer_id = $1)
         AND ($2::uuid IS NULL OR ca.branch_id = $2)
         AND ca.effective_from <= $3::date
         AND (ca.effective_to IS NULL OR ca.effective_to >= $3::date)
       ORDER BY ca.client_id, ca.effective_from DESC, ca.id DESC
     )
     SELECT c.id AS client_id, c.display_name AS client_name, l.id AS loan_id,
            MIN(s.due_on) AS oldest_due_on,
            SUM(GREATEST(s.principal_due + s.penalty_due + s.interest_due - s.principal_paid - s.penalty_paid - s.interest_paid, 0)) AS overdue_amount,
            a.route_code
       FROM active_assignments a
       JOIN clients c ON c.id = a.client_id
       JOIN loans l ON l.client_id = c.id AND l.branch_id = a.branch_id
       JOIN repayment_schedules s ON s.loan_id = l.id
      WHERE s.due_on < $3::date
        AND s.status = 'open'
        AND s.principal_due + s.penalty_due + s.interest_due
            > s.principal_paid + s.penalty_paid + s.interest_paid
      GROUP BY c.id, c.display_name, l.id, a.route_code
      ORDER BY oldest_due_on ASC, c.display_name ASC`,
    [input.collectorId, input.branchId, input.asOf],
  );
  return result.rows.map((row) => {
    const oldestDueOn = dayString(row.oldest_due_on);
    const daysOverdue = Math.max(0, Math.floor((Date.parse(`${input.asOf}T00:00:00.000Z`) - Date.parse(`${oldestDueOn}T00:00:00.000Z`)) / 86_400_000));
    return { clientId: row.client_id, clientName: row.client_name, loanId: row.loan_id, oldestDueOn, daysOverdue, overdueAmount: toNumber(row.overdue_amount), routeCode: row.route_code };
  });
}

async function readPaymentMethods(input: NormalizedCollectorInput): Promise<CollectorPaymentMethodSummary[]> {
  const result = await pool.query<{
    payment_method: string; posted_count: string; posted_amount: string; pending_count: string; pending_amount: string;
  }>(
    `WITH active_assignments AS (
       SELECT DISTINCT ca.client_id, ca.branch_id
       FROM collector_assignments ca
       WHERE ($1::uuid IS NULL OR ca.officer_id = $1)
         AND ($2::uuid IS NULL OR ca.branch_id = $2)
         AND ca.effective_from <= $4::date
         AND (ca.effective_to IS NULL OR ca.effective_to >= $4::date)
     )
      SELECT COALESCE(f.payment_method, 'manual') AS payment_method,
            COUNT(*) FILTER (WHERE f.status IN ('posted', 'verified')) AS posted_count,
            COALESCE(SUM(CASE WHEN f.status IN ('posted', 'verified') THEN COALESCE(p.amount, f.amount) ELSE 0 END), 0) AS posted_amount,
            COUNT(*) FILTER (WHERE f.status = 'pending_reconciliation') AS pending_count,
            COALESCE(SUM(CASE WHEN f.status = 'pending_reconciliation' THEN f.amount ELSE 0 END), 0) AS pending_amount
       FROM field_collection_records f
       JOIN active_assignments a ON a.client_id = f.client_id AND a.branch_id = f.branch_id
       LEFT JOIN payments p ON p.id = f.payment_id
      WHERE f.captured_at::date BETWEEN $3::date AND $4::date
      GROUP BY COALESCE(f.payment_method, 'manual')
      ORDER BY payment_method ASC`,
    [input.collectorId, input.branchId, input.from, input.to],
  );
  return result.rows.map((row) => ({
    paymentMethod: row.payment_method,
    postedCount: Number(row.posted_count),
    postedAmount: toNumber(row.posted_amount),
    pendingCount: Number(row.pending_count),
    pendingAmount: toNumber(row.pending_amount),
  }));
}

async function readOfflineQueue(input: NormalizedCollectorInput): Promise<CollectorOfflineQueueItem[]> {
  const result = await pool.query<{
    id: string; local_id: string; client_id: string; client_name: string; loan_id: string | null; route_code: string;
    amount: string; captured_at: Date; status: string; payment_method: string | null; receipt_reference: string | null;
    synced_at: Date | null;
  }>(
    `WITH active_assignments AS (
       SELECT DISTINCT ON (ca.client_id)
              ca.client_id, ca.branch_id, ca.route_code
       FROM collector_assignments ca
       WHERE ($1::uuid IS NULL OR ca.officer_id = $1)
         AND ($2::uuid IS NULL OR ca.branch_id = $2)
         AND ca.effective_from <= $4::date
         AND (ca.effective_to IS NULL OR ca.effective_to >= $4::date)
       ORDER BY ca.client_id, ca.effective_from DESC, ca.id DESC
     )
      SELECT f.id, f.local_id, f.client_id, c.display_name AS client_name, f.loan_id, a.route_code,
             f.amount, f.captured_at, f.status, COALESCE(f.payment_method, 'manual') AS payment_method,
            p.receipt_reference, f.synced_at
       FROM field_collection_records f
       JOIN active_assignments a ON a.client_id = f.client_id AND a.branch_id = f.branch_id
       JOIN clients c ON c.id = f.client_id
       LEFT JOIN payments p ON p.id = f.payment_id
      WHERE f.captured_at::date BETWEEN $3::date AND $4::date
      ORDER BY f.captured_at DESC, f.id DESC
      LIMIT 100`,
    [input.collectorId, input.branchId, input.from, input.to],
  );
  return result.rows.map((row) => ({
    id: row.id,
    localId: row.local_id,
    clientId: row.client_id,
    clientName: row.client_name,
    loanId: row.loan_id,
    routeCode: row.route_code,
    amount: toNumber(row.amount),
    capturedAt: isoString(row.captured_at),
    status: row.status,
    syncStatus: row.status === 'posted'
      ? 'posted'
      : row.status === 'verified'
        ? 'verified'
        : row.status === 'reversed'
          ? 'reversed'
          : row.status === 'pending_reconciliation'
            ? 'pending_reconciliation'
            : 'queued',
    paymentMethod: row.payment_method ?? 'manual',
    receiptReference: row.receipt_reference,
    syncedAt: row.synced_at ? isoString(row.synced_at) : null,
  }));
}

export async function getCollectorReportingSnapshot(input: CollectorReportingQueryInput = {}): Promise<CollectorReportingSnapshot> {
  const normalized = normalizeCollectorInput(input);
  const [target, assignedClientSchedules, overdueWatchlist, paymentMethods, offlineQueue] = await Promise.all([
    readTargetProgress(normalized),
    readSchedules(normalized),
    readOverdueWatchlist(normalized),
    readPaymentMethods(normalized),
    readOfflineQueue(normalized),
  ]);
  return {
    filters: { asOf: normalized.asOf, from: normalized.from, to: normalized.to, branchId: normalized.branchId, collectorId: normalized.collectorId },
    targetProgress: target.targetProgress,
    routes: target.routes,
    assignedClientSchedules,
    overdueWatchlist,
    paymentMethods,
    offlineQueue,
  };
}