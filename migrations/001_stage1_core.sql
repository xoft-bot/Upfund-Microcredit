BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('active', 'disabled');
CREATE TYPE application_status AS ENUM ('draft', 'submitted');
CREATE TYPE ledger_side AS ENUM ('debit', 'credit');
CREATE TYPE pool_type AS ENUM ('principal', 'credit_loss_reserve', 'operating_reserve', 'growth');

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  firebase_uid text NOT NULL UNIQUE,
  email text UNIQUE,
  display_name text NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  role_id uuid NOT NULL REFERENCES roles(id),
  branch_id uuid REFERENCES branches(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id),
  permission_id uuid NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  external_ref text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loan_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'UGX',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loan_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  product_id uuid NOT NULL REFERENCES loan_products(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  status application_status NOT NULL DEFAULT 'draft',
  requested_amount bigint NOT NULL CHECK (requested_amount > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES loan_applications(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  principal_amount bigint NOT NULL CHECK (principal_amount > 0),
  outstanding_principal bigint NOT NULL CHECK (outstanding_principal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 0
);

CREATE TABLE repayment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id),
  due_on date NOT NULL,
  principal_due bigint NOT NULL CHECK (principal_due >= 0),
  charge_due bigint NOT NULL CHECK (charge_due >= 0),
  UNIQUE (loan_id, due_on)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  amount bigint NOT NULL CHECK (amount > 0),
  idempotency_key text NOT NULL UNIQUE,
  receipt_reference text NOT NULL UNIQUE,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  receipt_reference text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  correlation_id uuid NOT NULL,
  posted_by uuid NOT NULL REFERENCES users(id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL
);

CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  account_code text NOT NULL,
  side ledger_side NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'UGX',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE capital_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  pool_type pool_type NOT NULL,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  version integer NOT NULL DEFAULT 0,
  UNIQUE (branch_id, pool_type)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_ledger_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger history is append-only';
END;
$$;

CREATE TRIGGER ledger_transactions_no_update BEFORE UPDATE OR DELETE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION reject_ledger_history_mutation();

CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_ledger_history_mutation();

CREATE OR REPLACE FUNCTION validate_ledger_transaction_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  debit_total bigint;
  credit_total bigint;
BEGIN
  SELECT COALESCE(SUM(amount) FILTER (WHERE side = 'debit'), 0),
         COALESCE(SUM(amount) FILTER (WHERE side = 'credit'), 0)
    INTO debit_total, credit_total
    FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced: debits %, credits %', NEW.transaction_id, debit_total, credit_total;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
AFTER INSERT OR UPDATE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_ledger_transaction_balance();

CREATE INDEX loans_branch_idx ON loans(branch_id);
CREATE INDEX clients_branch_idx ON clients(branch_id);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_type, entity_id, created_at DESC);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries(transaction_id);

COMMIT;
