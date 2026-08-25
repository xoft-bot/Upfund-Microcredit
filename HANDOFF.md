# Letsgrow-Microcredit Backend Handoff

**System version:** `1.0.01`  
**Backend status:** Frozen for independent audit and review  
**Repository:** [xoft-bot/Letsgrow-Microcredit](https://github.com/xoft-bot/Letsgrow-Microcredit)

## Version and commits

The previous approved backend baseline is commit `7d2989f`. The handoff package was introduced in `5be529f`, and the current repository HEAD is `d773565`. Documentation-only changes in this handoff do not alter backend behavior.

Version `1.0.01` is defined in the package manifest and shared version contract. API telemetry headers, success and error envelopes, and the PWA footer must continue to expose `1.0.01`.

## Core endpoint contracts

### `POST /api/v1/payments`

This protected command accepts `loanId`, `branchId`, `amount`, `idempotencyKey`, and an optional `receiptReference`. The server verifies the Firebase JWT, RBAC role, and branch scope. The handler locks the loan and open schedule row, allocates principal before charge, creates a receipt, updates the operational balances, posts a balanced append-only ledger transaction, and writes the audit event in one PostgreSQL transaction. Repeated idempotent requests resolve to the existing payment.

### `POST /api/v1/reconciliations/post-batch`

This protected manager/admin command accepts branch identity, batch reference, expected/recorded/submitted totals, payment IDs, allocation policy version, and an optional manager override. A variance fails closed unless explicitly overridden by an authorized manager or admin. Approved processing locks the persisted policy and four capital pools, records pool allocations from realized charges only, posts the balanced ledger transaction, and writes the audit event atomically.

## Migration order

Migrations must be applied in order and recorded in `schema_migrations`:

| Order | File | Purpose |
|---:|---|---|
| 1 | `001_stage1_core.sql` | Identity, branches, clients, loans, schedules, payments, ledger, pools, audit history |
| 2 | `002_stage2_credit_reconciliation.sql` | KYC, risk, reconciliation, allocation policy, and pool-allocation models |
| 3 | `003_stage2_payment_posting.sql` | Schedule payment allocation fields and payment posting constraints |
| 4 | `004_collection_pool.sql` | Explicit collection capital-pool type |

## Local certification

Install dependencies with `npm install`. Start a local PostgreSQL instance and create a database named `microcredit`; then set a local-only connection string:

```bash
export DATABASE_URL='postgresql://postgres:<local-password>@127.0.0.1:5432/microcredit'
```

Apply and verify migrations:

```bash
npm run db:migrate
npm run db:check
```

Run the quality and integration checks:

```bash
npm run typecheck
npm run lint
npm test -- --reporter=verbose
npm run build
```

Do not use production credentials, production borrower data, live payment providers, or real identity documents in local or test environments. Any backend change must preserve single-transaction financial actions, append-only history, strict double-entry balancing, idempotency, server-side authorization, and branch scope.
