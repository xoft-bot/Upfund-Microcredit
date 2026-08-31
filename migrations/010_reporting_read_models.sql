-- migration: concurrent
CREATE INDEX CONCURRENTLY IF NOT EXISTS repayment_schedules_due_on_loan_idx
  ON repayment_schedules (due_on, loan_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS repayment_schedules_loan_due_on_idx
  ON repayment_schedules (loan_id, due_on);
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_reporting_branch_status_created_idx
  ON payments (branch_id, status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_reporting_loan_status_created_idx
  ON payments (loan_id, status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS loan_disbursements_reporting_created_loan_idx
  ON loan_disbursements (created_at DESC, loan_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS field_collections_reporting_branch_status_captured_idx
  ON field_collection_records (branch_id, status, captured_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS reconciliations_reporting_branch_status_created_idx
  ON reconciliations (branch_id, status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS loans_reporting_branch_status_idx
  ON loans (branch_id, status);