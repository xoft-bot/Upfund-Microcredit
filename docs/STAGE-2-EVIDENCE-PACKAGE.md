# Stage 2 Evidence Package

**System version:** `1.0.01`  
**Repository:** `xoft-bot/Letsgrow-Microcredit`

## Stage 1 certification

A local PostgreSQL 16 certification instance was provisioned and used with `DATABASE_URL` set to a local-only database. The migration runner applied the Stage 1 and Stage 2 migrations idempotently, and schema verification confirmed **22 Stage 1/2 tables**.

The certification tests passed for database-enforced rejection of an unbalanced ledger transaction at commit, append-only rejection of `UPDATE` and `DELETE` on ledger history, and concurrent duplicate idempotency submissions resolving to one transaction without an unhandled unique-constraint error.

The migration runner was hardened to track ordered migration filenames in `schema_migrations`; an already-existing Stage 1 database is bootstrapped safely rather than rerunning enum creation.

## Version and clean-code controls

The root `package.json` version and lockfile are `1.0.01`. API telemetry includes the `x-system-version: 1.0.01` header, success and error envelopes include `version: 1.0.01`, and the PWA footer displays `System version 1.0.01`. TypeScript type-checking, ESLint, tests, and the production build pass. Source files remain under 200 lines, and the unused Stage 1 runtime dependencies were removed.

## Stage 2 implementation

Stage 2 adds PostgreSQL models for businesses, KYC records, risk assessments, reconciliation batches, reconciliation-to-payment links, allocation policies, and pool allocations. It adds controlled status types and typed transition guards for KYC, loan applications, loans, payments, and reconciliation.

The manual logbook reconciliation calculation compares expected, recorded, and submitted amounts and emits a `matched` or `variance` result. It does not silently approve mismatches. The allocation engine accepts only realized charges, applies versioned basis-point policy allocations to credit-loss reserve, operating reserve, collection cost, and growth capital, and exposes deployable growth capital separately from gross charges and retained profit.

## Atomic payment and reconciliation slice

The API now exposes `POST /api/v1/payments` and `POST /api/v1/reconciliations/post-batch`. Manual payment posting locks the target loan and open schedule rows, allocates principal before charge, creates a unique receipt, updates operational loan and schedule balances, posts a balanced append-only ledger transaction, and writes the command audit event in the same PostgreSQL transaction. Any failure rolls back the payment, receipt, schedule update, loan update, ledger transaction, and audit event together.

Batch reconciliation compares expected, recorded, and submitted logbook totals. A variance raises a fail-closed manager-override error and leaves no reconciliation row behind. A matched batch or explicitly manager-approved variance can proceed to realized-surplus allocation. The allocation engine never treats gross charges as deployable capital.

The database-backed payment and reconciliation tests verify payment principal updates, receipt generation, balanced ledger totals, and variance rollback.

## Verification

The complete suite passes:

```text
npm run db:migrate
npm run db:check
npm run typecheck
npm run lint
npm test -- --reporter=verbose
npm run build
```

Current result: **17 tests passed across 5 test files**, 22 database tables verified, and the production PWA build completed successfully.

## Scope boundary

This remains synthetic Stage 2 logic. Live mobile-money APIs, real KYC providers, production borrower data, field-officer screens, and production deployment remain excluded until their own threat model, integration tests, and operational evidence are approved.
