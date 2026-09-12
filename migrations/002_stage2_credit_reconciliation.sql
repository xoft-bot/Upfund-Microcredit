BEGIN;

CREATE TYPE kyc_status AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE risk_status AS ENUM ('pending', 'approved', 'declined');
CREATE TYPE loan_status AS ENUM ('approved', 'disbursed', 'active', 'overdue', 'defaulted', 'written_off', 'completed');
CREATE TYPE payment_status AS ENUM ('recorded', 'pending_reconciliation', 'verified', 'posted', 'reversed');
CREATE TYPE reconciliation_status AS ENUM ('pending', 'matched', 'variance', 'approved');

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES clients(id),
  business_name text NOT NULL,
  business_type text NOT NULL,
  verification_status kyc_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kyc_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  status kyc_status NOT NULL DEFAULT 'pending',
  verification_method text NOT NULL,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES loan_applications(id),
  score integer CHECK (score BETWEEN 0 AND 100),
  risk_grade text,
  status risk_status NOT NULL DEFAULT 'pending',
  policy_version text NOT NULL,
  assessed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS risk_assessment_id uuid REFERENCES risk_assessments(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS status loan_status NOT NULL DEFAULT 'approved';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status payment_status NOT NULL DEFAULT 'recorded';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'manual';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_reference text;
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_uidx ON payments(provider_reference) WHERE provider_reference IS NOT NULL;

CREATE TABLE reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  batch_reference text NOT NULL UNIQUE,
  expected_amount bigint NOT NULL CHECK (expected_amount >= 0),
  recorded_amount bigint NOT NULL CHECK (recorded_amount >= 0),
  submitted_amount bigint NOT NULL CHECK (submitted_amount >= 0),
  variance bigint NOT NULL,
  status reconciliation_status NOT NULL DEFAULT 'pending',
  submitted_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_payments (
  reconciliation_id uuid NOT NULL REFERENCES reconciliations(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  PRIMARY KEY (reconciliation_id, payment_id)
);

CREATE TABLE allocation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  credit_loss_bps integer NOT NULL CHECK (credit_loss_bps BETWEEN 0 AND 10000),
  operating_bps integer NOT NULL CHECK (operating_bps BETWEEN 0 AND 10000),
  collection_bps integer NOT NULL CHECK (collection_bps BETWEEN 0 AND 10000),
  growth_bps integer NOT NULL CHECK (growth_bps BETWEEN 0 AND 10000),
  effective_from timestamptz NOT NULL,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  CHECK (credit_loss_bps + operating_bps + collection_bps + growth_bps <= 10000)
);

CREATE TABLE pool_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  capital_pool_id uuid NOT NULL REFERENCES capital_pools(id),
  amount bigint NOT NULL CHECK (amount > 0),
  policy_version text NOT NULL REFERENCES allocation_policies(version),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX kyc_client_idx ON kyc_records(client_id, created_at DESC);
CREATE INDEX risk_status_idx ON risk_assessments(status, created_at DESC);
CREATE INDEX payments_branch_status_idx ON payments(branch_id, status, created_at DESC);
CREATE INDEX reconciliations_branch_status_idx ON reconciliations(branch_id, status, created_at DESC);
CREATE INDEX pool_allocations_transaction_idx ON pool_allocations(ledger_transaction_id);

COMMIT;
