BEGIN;

-- Scaffolding for HANDOFF_6 §3 Phase 3: reporting.ts's PAR30/60/90 windows have always
-- been hardcoded and were never accounting-approved (HANDOFF rule 5). This table makes the
-- threshold configurable and auditable, but is seeded with the SAME values already hardcoded
-- in reporting.ts (30/60/90) so this migration alone changes no visible numbers. Only an
-- explicit PATCH /api/v1/reporting/par-thresholds call (accountant/admin only) changes them.
--
-- Singleton pattern (id fixed to 1, CHECK enforces exactly one row) rather than per-branch:
-- PAR windows are a single accounting policy, not a branch-level choice.
CREATE TABLE IF NOT EXISTS par_threshold_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  par30_days integer NOT NULL DEFAULT 30 CHECK (par30_days > 0),
  par60_days integer NOT NULL DEFAULT 60 CHECK (par60_days > par30_days),
  par90_days integer NOT NULL DEFAULT 90 CHECK (par90_days > par60_days),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO par_threshold_config (id, par30_days, par60_days, par90_days)
VALUES (1, 30, 60, 90)
ON CONFLICT (id) DO NOTHING;

-- Same RLS convention as every application table since migration 015: backend connection
-- gets full access, anon/authenticated get none, no PUBLIC policy.
ALTER TABLE par_threshold_config ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  backend_role text;
BEGIN
  FOREACH backend_role IN ARRAY ARRAY['service_role', 'postgres'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = backend_role) THEN
      EXECUTE format(
        'CREATE POLICY %I ON par_threshold_config FOR ALL TO %I USING (true) WITH CHECK (true)',
        'backend_full_access_' || backend_role, backend_role
      );
      EXECUTE format('GRANT ALL PRIVILEGES ON TABLE par_threshold_config TO %I', backend_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE par_threshold_config FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE par_threshold_config FROM authenticated;
  END IF;
END $$;

COMMIT;
