import { pool } from '../db.js';

export interface CollectionQueryInput {
  branchId: string;
  collectorId?: string;
  limit?: number;
}

export interface CollectionRecordView {
  id: string;
  localId: string;
  idempotencyKey: string;
  branchId: string;
  paymentId: string | null;
  clientId: string | null;
  clientName: string | null;
  loanId: string | null;
  collectorId: string | null;
  amount: number;
  status: string;
  deviceId: string;
  paymentMethod: string | null;
  receiptReference: string | null;
  principalAmount: number;
  penaltyAmount: number;
  interestAmount: number;
  overpaymentAmount: number;
  capturedAt: string;
  createdAt: string;
  syncedAt: string | null;
}

export interface ReconciliationPaymentView {
  paymentId: string;
  clientId: string | null;
  amount: number;
  receiptReference: string | null;
  status: string;
  principalAmount: number;
  penaltyAmount: number;
  interestAmount: number;
  overpaymentAmount: number;
}

export interface ReconciliationBatchView {
  id: string;
  batchReference: string;
  branchId: string;
  collectionDate: string;
  expectedAmount: number;
  recordedAmount: number;
  submittedAmount: number;
  variance: number;
  status: string;
  submittedBy: string;
  submittedByName: string | null;
  payments: ReconciliationPaymentView[];
}

const toNumber = (value: string | number | null): number => Number(value ?? 0);

export async function listFieldCollections(input: CollectionQueryInput): Promise<CollectionRecordView[]> {
  const result = await pool.query<{
    id: string;
    local_id: string;
    idempotency_key: string;
    branch_id: string;
    payment_id: string | null;
    client_id: string | null;
    client_name: string | null;
    loan_id: string | null;
    collector_id: string | null;
    amount: string;
    status: string;
    device_id: string;
    payment_method: string | null;
    receipt_reference: string | null;
    principal_amount: string | null;
    penalty_amount: string | null;
    interest_amount: string | null;
    overpayment_amount: string | null;
    captured_at: Date;
    created_at: Date;
    synced_at: Date | null;
  }>(
    `SELECT f.id, f.local_id, f.idempotency_key, f.branch_id, f.payment_id,
            f.client_id, c.display_name AS client_name, f.loan_id, f.collector_id,
            f.amount, f.status, f.device_id, f.payment_method,
            p.receipt_reference, p.principal_amount, p.penalty_amount,
            p.interest_amount, p.overpayment_amount, f.captured_at, f.created_at,
            f.synced_at
       FROM field_collection_records f
       LEFT JOIN clients c ON c.id = f.client_id
       LEFT JOIN payments p ON p.id = f.payment_id
      WHERE f.branch_id = $1
        AND ($2::uuid IS NULL OR f.collector_id = $2)
      ORDER BY f.captured_at DESC, f.id DESC
      LIMIT $3`,
    [input.branchId, input.collectorId ?? null, Math.min(input.limit ?? 100, 100)],
  );
  return result.rows.map((row) => ({
    id: row.id,
    localId: row.local_id,
    idempotencyKey: row.idempotency_key,
    branchId: row.branch_id,
    paymentId: row.payment_id,
    clientId: row.client_id,
    clientName: row.client_name,
    loanId: row.loan_id,
    collectorId: row.collector_id,
    amount: toNumber(row.amount),
    status: row.status,
    deviceId: row.device_id,
    paymentMethod: row.payment_method,
    receiptReference: row.receipt_reference,
    principalAmount: toNumber(row.principal_amount),
    penaltyAmount: toNumber(row.penalty_amount),
    interestAmount: toNumber(row.interest_amount),
    overpaymentAmount: toNumber(row.overpayment_amount),
    capturedAt: row.captured_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    syncedAt: row.synced_at?.toISOString() ?? null,
  }));
}

export async function listPendingReconciliations(input: { branchId: string; limit?: number }): Promise<ReconciliationBatchView[]> {
  const result = await pool.query<{
    id: string;
    batch_reference: string;
    branch_id: string;
    collection_date: Date;
    expected_amount: string;
    recorded_amount: string;
    submitted_amount: string;
    variance: string;
    status: string;
    submitted_by: string;
    submitted_by_name: string | null;
    payments: ReconciliationPaymentView[] | null;
  }>(
    `SELECT r.id, r.batch_reference, r.branch_id, r.created_at::date AS collection_date,
            r.expected_amount, r.recorded_amount, r.submitted_amount, r.variance,
            r.status, r.submitted_by, submitter.display_name AS submitted_by_name,
            COALESCE(
              jsonb_agg(jsonb_build_object(
                'paymentId', p.id,
                'clientId', pclient.id,
                'amount', p.amount,
                'receiptReference', p.receipt_reference,
                'status', p.status,
                'principalAmount', p.principal_amount,
                'penaltyAmount', p.penalty_amount,
                'interestAmount', p.interest_amount,
                'overpaymentAmount', p.overpayment_amount
              ) ORDER BY p.created_at) FILTER (WHERE p.id IS NOT NULL),
              '[]'::jsonb
            ) AS payments
       FROM reconciliations r
       JOIN users submitter ON submitter.id = r.submitted_by
       LEFT JOIN reconciliation_payments rp ON rp.reconciliation_id = r.id
       LEFT JOIN payments p ON p.id = rp.payment_id
       LEFT JOIN loans pl ON pl.id = p.loan_id
       LEFT JOIN clients pclient ON pclient.id = pl.client_id
      WHERE r.branch_id = $1 AND r.status IN ('pending', 'variance')
      GROUP BY r.id, submitter.display_name
      ORDER BY r.created_at ASC, r.id ASC
      LIMIT $2`,
    [input.branchId, Math.min(input.limit ?? 100, 100)],
  );
  return result.rows.map((row) => ({
    id: row.id,
    batchReference: row.batch_reference,
    branchId: row.branch_id,
    collectionDate: new Date(row.collection_date).toISOString().slice(0, 10),
    expectedAmount: toNumber(row.expected_amount),
    recordedAmount: toNumber(row.recorded_amount),
    submittedAmount: toNumber(row.submitted_amount),
    variance: toNumber(row.variance),
    status: row.status,
    submittedBy: row.submitted_by,
    submittedByName: row.submitted_by_name,
    payments: row.payments ?? [],
  }));
}