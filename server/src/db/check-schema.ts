import { pool } from '../db.js';

const required = [
  'allocation_policies', 'application_transition_history', 'audit_events', 'branches',
  'businesses', 'capital_pools', 'clients', 'collector_assignments',
  'field_collection_records', 'kyc_records', 'ledger_entries', 'ledger_transactions',
  'loan_applications', 'loan_disbursements', 'loan_products', 'loans',
  'overpayment_holdings', 'payments', 'permissions', 'pool_allocations', 'receipts',
  'reconciliation_payments', 'reconciliations', 'repayment_schedules',
  'risk_assessments', 'role_permissions', 'roles', 'users',
];
const result = await pool.query<{ tablename: string; rls_enabled: boolean; rls_forced: boolean }>(
  `SELECT c.relname AS tablename, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`,
  [required],
);
const found = new Set(result.rows.map((row) => row.tablename));
const missing = required.filter((table) => !found.has(table));
const withoutRls = required.filter((table) => {
  const row = result.rows.find((candidate) => candidate.tablename === table);
  return !row?.rls_enabled || !row.rls_forced;
});
await pool.end();
if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);
if (withoutRls.length) throw new Error(`RLS is not enabled and forced for: ${withoutRls.join(', ')}`);
console.log(`Verified all ${required.length} required custom tables with RLS enabled and forced`);
