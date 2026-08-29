BEGIN;

ALTER TABLE repayment_schedules
  ADD COLUMN IF NOT EXISTS penalty_due bigint NOT NULL DEFAULT 0 CHECK (penalty_due >= 0),
  ADD COLUMN IF NOT EXISTS penalty_paid bigint NOT NULL DEFAULT 0 CHECK (penalty_paid >= 0),
  ADD COLUMN IF NOT EXISTS interest_due bigint NOT NULL DEFAULT 0 CHECK (interest_due >= 0),
  ADD COLUMN IF NOT EXISTS interest_paid bigint NOT NULL DEFAULT 0 CHECK (interest_paid >= 0);

UPDATE repayment_schedules
SET interest_due = charge_due,
    interest_paid = charge_paid
WHERE interest_due = 0
  AND interest_paid = 0
  AND charge_due > 0;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS penalty_amount bigint NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
  ADD COLUMN IF NOT EXISTS interest_amount bigint NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  ADD COLUMN IF NOT EXISTS overpayment_amount bigint NOT NULL DEFAULT 0 CHECK (overpayment_amount >= 0);

UPDATE payments
SET interest_amount = charge_amount
WHERE interest_amount = 0
  AND penalty_amount = 0
  AND charge_amount > 0;

ALTER TABLE field_collection_records
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id),
  ADD COLUMN IF NOT EXISTS loan_id uuid REFERENCES loans(id),
  ADD COLUMN IF NOT EXISTS collector_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IN ('cash', 'mobile_money', 'manual')),
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE TABLE IF NOT EXISTS overpayment_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  loan_id uuid NOT NULL REFERENCES loans(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  amount bigint NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'applied', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS overpayment_holdings_branch_status_idx
  ON overpayment_holdings (branch_id, status, created_at DESC);

COMMIT;