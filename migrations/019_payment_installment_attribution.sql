BEGIN;

-- payments.schedule_id only ever pointed at ONE installment, even after the waterfall was
-- fixed to walk every open installment for a payment that catches up more than one at once.
-- Reporting (reporting.ts's realized_window CTE) attributes a payment's ENTIRE amount to that
-- single schedule_id's due_on when computing collections within a date window — so a payment
-- that actually paid off two installments has its whole amount attributed to whichever one
-- happens to be schedule_id, and silently drops out of the window (or wrongly counts inside it)
-- for every other installment it touched. This table records the real per-installment split so
-- reporting can attribute correctly instead of guessing from a single foreign key.
CREATE TABLE IF NOT EXISTS payment_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  schedule_id UUID NOT NULL REFERENCES repayment_schedules(id),
  principal_amount BIGINT NOT NULL CHECK (principal_amount >= 0),
  penalty_amount BIGINT NOT NULL CHECK (penalty_amount >= 0),
  interest_amount BIGINT NOT NULL CHECK (interest_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_id, schedule_id)
);

CREATE INDEX IF NOT EXISTS payment_installments_schedule_idx ON payment_installments (schedule_id);
CREATE INDEX IF NOT EXISTS payment_installments_payment_idx ON payment_installments (payment_id);

-- Same RLS convention as every other application table (migration 015): backend connection
-- gets full access, anon/authenticated get none, no PUBLIC policy.
ALTER TABLE payment_installments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  backend_role text;
BEGIN
  FOREACH backend_role IN ARRAY ARRAY['service_role', 'postgres'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = backend_role) THEN
      EXECUTE format(
        'CREATE POLICY %I ON payment_installments FOR ALL TO %I USING (true) WITH CHECK (true)',
        'backend_full_access_' || backend_role, backend_role
      );
      EXECUTE format('GRANT ALL PRIVILEGES ON TABLE payment_installments TO %I', backend_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE payment_installments FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE payment_installments FROM authenticated;
  END IF;
END $$;

COMMIT;
