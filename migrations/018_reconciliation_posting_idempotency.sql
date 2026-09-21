BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS pool_allocations_transaction_pool_uidx
  ON pool_allocations (ledger_transaction_id, capital_pool_id);

COMMIT;
