-- Enable RLS for every custom application table.
-- The application uses the server-side PostgreSQL connection for data access.
-- No PUBLIC or anon policies are created, so direct client access is denied by default.

DO $$
DECLARE
  table_name text;
  table_names text[] := ARRAY[
    'allocation_policies', 'application_transition_history', 'audit_events', 'branches',
    'businesses', 'capital_pools', 'clients', 'collector_assignments',
    'field_collection_records', 'kyc_records', 'ledger_entries', 'ledger_transactions',
    'loan_applications', 'loan_disbursements', 'loan_products', 'loans',
    'overpayment_holdings', 'payments', 'permissions', 'pool_allocations', 'receipts',
    'reconciliation_payments', 'reconciliations', 'repayment_schedules',
    'risk_assessments', 'role_permissions', 'roles', 'users'
  ];
  backend_role text;
BEGIN
  FOREACH table_name IN ARRAY table_names LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);

    FOREACH backend_role IN ARRAY ARRAY['service_role', 'postgres'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = backend_role) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I FOR ALL TO %I USING (true) WITH CHECK (true)',
          'backend_full_access_' || backend_role, table_name, backend_role
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Force even table owners to obey RLS when using the application connection.
-- PostgreSQL superusers such as postgres still bypass RLS by design.
ALTER TABLE allocation_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE application_transition_history FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
ALTER TABLE capital_pools FORCE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
ALTER TABLE collector_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE field_collection_records FORCE ROW LEVEL SECURITY;
ALTER TABLE kyc_records FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE loan_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE loan_disbursements FORCE ROW LEVEL SECURITY;
ALTER TABLE loan_products FORCE ROW LEVEL SECURITY;
ALTER TABLE loans FORCE ROW LEVEL SECURITY;
ALTER TABLE overpayment_holdings FORCE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE pool_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE reconciliations FORCE ROW LEVEL SECURITY;
ALTER TABLE repayment_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE risk_assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Explicitly document the intended deny-by-default behavior for browser roles.
REVOKE ALL ON allocation_policies, application_transition_history, audit_events, branches,
  businesses, capital_pools, clients, collector_assignments, field_collection_records,
  kyc_records, ledger_entries, ledger_transactions, loan_applications, loan_disbursements,
  loan_products, loans, overpayment_holdings, payments, permissions, pool_allocations,
  receipts, reconciliation_payments, reconciliations, repayment_schedules, risk_assessments,
  role_permissions, roles, users FROM PUBLIC;
