import { pool } from '../db.js';

const required = ['users', 'roles', 'permissions', 'branches', 'clients', 'loan_products', 'loan_applications', 'loans', 'repayment_schedules', 'payments', 'receipts', 'ledger_transactions', 'ledger_entries', 'capital_pools', 'audit_events', 'businesses', 'kyc_records', 'risk_assessments', 'reconciliations', 'reconciliation_payments', 'allocation_policies', 'pool_allocations', 'field_collection_records', 'overpayment_holdings', 'collector_assignments'];
const result = await pool.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`, [required]);
const found = new Set(result.rows.map((row) => row.tablename));
const missing = required.filter((table) => !found.has(table));
await pool.end();
if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);
console.log(`Verified ${required.length} Stage 1/4 tables`);
