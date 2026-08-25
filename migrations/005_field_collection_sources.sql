BEGIN;

CREATE TABLE IF NOT EXISTS field_collection_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  payment_id uuid UNIQUE REFERENCES payments(id),
  local_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  amount bigint NOT NULL CHECK (amount > 0),
  status payment_status NOT NULL DEFAULT 'pending_reconciliation',
  device_id text NOT NULL,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_collection_reconciliation_idx
  ON field_collection_records (branch_id, status, captured_at);

COMMIT;
