-- Close RLS gaps: schema_migrations (never covered) plus tables added after 015.
DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY['schema_migrations', 'payment_installments', 'par_threshold_config'];
  backend_role text;
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF tbl <> 'schema_migrations' THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    END IF;

    FOREACH backend_role IN ARRAY ARRAY['service_role', 'postgres'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = backend_role) THEN
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'backend_full_access_' || backend_role, tbl);
        EXECUTE format(
          'CREATE POLICY %I ON %I FOR ALL TO %I USING (true) WITH CHECK (true)',
          'backend_full_access_' || backend_role, tbl, backend_role
        );
        EXECUTE format('GRANT ALL PRIVILEGES ON TABLE %I TO %I', tbl, backend_role);
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM anon', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM authenticated', tbl);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tbl);
  END LOOP;
END
$$;
