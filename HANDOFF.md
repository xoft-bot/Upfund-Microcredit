# Letsgrow-Microcredit Backend Handoff

**System version:** `1.0.01`  
**Backend status:** Frozen for independent audit and review  
**Repository:** [xoft-bot/Letsgrow-Microcredit](https://github.com/xoft-bot/Letsgrow-Microcredit)

## Version and commits

The previous approved backend baseline is commit `7d2989f`. The handoff package was introduced in `5be529f`, and the current repository HEAD before this sign-off update is `0c08da6`. The final Stage 3 sign-off commit is recorded after this documentation update. Documentation-only changes in this handoff do not alter backend behavior.

Version `1.0.01` is defined in the package manifest and shared version contract. API telemetry headers, success and error envelopes, PWA receipts, telemetry payloads, and the PWA footer expose or preserve `1.0.01`. Independent Stage 3 verification reported 22/22 Vitest tests passing, zero type errors, zero lint warnings, and a certified production build.

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

## Stage 3 PWA deliverables

The Stage 3 client includes the offline field-collection queue and typed field-operation records, collector route and collection form, pending-aware receipt preview and print renderer, manager variance review and approval workflow, masked telemetry with correlation IDs and sync latency, and a graceful offline-recovery error boundary. The PWA never marks a payment as posted before server confirmation, performs no ledger or capital-pool calculations locally, and requires a decision reason for variance actions.

The Stage 3 client verification reported **22/22 Vitest tests passing**, **0 TypeScript errors**, **0 ESLint warnings**, and a certified production build. No production backend code under `server/src/` was modified during Stage 3.

Do not use production credentials, production borrower data, live payment providers, or real identity documents in local or test environments. Any backend change must preserve single-transaction financial actions, append-only history, strict double-entry balancing, idempotency, server-side authorization, and branch scope.
