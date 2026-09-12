-- migration: concurrent
CREATE INDEX CONCURRENTLY IF NOT EXISTS ledger_transactions_reporting_posted_source_idx
  ON ledger_transactions (posted_at DESC, source_type, source_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ledger_entries_reporting_account_transaction_idx
  ON ledger_entries (account_code, transaction_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_events_reconciliation_action_created_idx
  ON audit_events (entity_type, entity_id, action, created_at DESC);