# Letsgrow-Microcredit Backend Handoff

**System version:** `1.0.01`  
**Backend status:** Production-hardening verification completed against disposable local PostgreSQL; ready for deployment secrets
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
| 5 | `005_field_collection_sources.sql` | Field collection source records for scheduled reconciliation |

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

## Stage 4 Task 2 reconciliation automation

The scheduled runner in `server/src/jobs/reconciliationCron.ts` obtains a PostgreSQL advisory lock, aggregates eligible gateway and field-collection payments by branch, calculates expected obligations from open schedules, and routes only fully matched batches through the existing balance-checked posting service. Non-zero variances are inserted into the `variance` review queue by `varianceAlerting.ts`, linked to their payment records, audited, and emitted as structured telemetry carrying version `1.0.01`, a correlation ID, branch, batch reference, variance, and threshold. No variance batch moves capital pools or posts automatically.

The Stage 4 Task 2 focused suite contains 3 passing tests. The Stage 4 Task 3 integration suite adds 4 passing tests covering webhook idempotency, cron posting and quarantine, protected telemetry routes, correlation propagation, and sensitive-field masking. The full local quality run should be rerun after this update; database-backed certification tests must be rerun with a disposable PostgreSQL instance before production deployment.

## Stage 4 Task 3 production telemetry

The protected telemetry routes are `/api/v1/telemetry/health`, `/api/v1/telemetry/pool`, `/api/v1/telemetry/queues`, and `/api/v1/telemetry/audit-stream`. They require Firebase JWT verification and an `admin`, `manager`, or `accountant` role. Responses carry the global correlation ID and system version `1.0.01`. Health reports database availability; pool reports active, idle, waiting, and configured maximum connections; queue metrics report pending payments, field collections, and variance batches.

Audit streaming is read-only and ordered by `(created_at, id)` with bounded pagination and optional correlation filtering. Sensitive metadata keys and private identity, client, loan, borrower, token, secret, password, and key fields are redacted before response serialization. Financial history remains append-only because the telemetry layer performs no update or delete operation and only reads `audit_events`.

The Stage 3 client verification reported **22/22 Vitest tests passing**, **0 TypeScript errors**, **0 ESLint warnings**, and a certified production build. No production backend code under `server/src/` was modified during Stage 3.

Do not use production credentials, production borrower data, live payment providers, or real identity documents in local or test environments. Any backend change must preserve single-transaction financial actions, append-only history, strict double-entry balancing, idempotency, server-side authorization, and branch scope. The production guarantees are: PostgreSQL remains the authoritative financial source; every ledger transaction is balance-checked; payment and reconciliation commands remain atomic; webhook replay uses the original idempotency key; variance batches cannot auto-post or move capital pools; and telemetry exposes masked read models only.

## Production-hardening verification and live cloud binding

The production-hardening run confirmed that `DATABASE_URL` is not configured in the current shell. `.env.example` remains the non-secret configuration contract. Set `DATABASE_URL` to the TLS connection string supplied by Neon, Supabase, Render, or Cloud SQL, and keep it only in the hosting provider and CI secret store. The deployment database must run migrations `001_stage1_core.sql` through `005_field_collection_sources.sql` in order, followed by `npm run db:check`.

Firebase has explicit modes. Local and CI use `FIREBASE_MODE=mock` and `VITE_FIREBASE_MODE=mock`; mock server tokens are permitted only outside production. Production must set `FIREBASE_MODE=live` and provide `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. The client uses only public `VITE_FIREBASE_*` identifiers. The Admin SDK private key and database URL must never be exposed to the client or committed.

The PII audit confirmed recursive masking for national IDs, borrower/client/loan identifiers, names, phone/mobile numbers, emails, tokens, secrets, passwords, private keys, authorization headers, and cookies in client telemetry and server audit-stream metadata. Top-level audit entity IDs are redacted in streamed output. The reconciliation dry-run processed two mock branch batches: one matched batch was eligible for posting and one `-5,000` UGX variance was quarantined and emitted a versioned alert with a correlation ID; no database writes occurred during dry-run mode.

The current local verification environment does not expose a preconfigured `DATABASE_URL`; the hardening run used a disposable local PostgreSQL 16 database. `npm run db:migrate` completed idempotently with migrations `001` through `005` already applied, and `npm run db:check` verified 23 required tables. The full suite then reported **34/34 tests passing**, including all five database-backed tests, followed by a successful production build. The workflow file is intentionally not tracked in this repository because the GitHub App credential cannot publish `.github/workflows/*`; CI should run the documented commands using repository-hosted PostgreSQL and secrets once workflow permission is provisioned.

## Render-only deployment boundary

The production deployment now uses the standalone Fastify server on Render,
Firebase Authentication and Hosting, and Supabase PostgreSQL. Firebase
Functions are not part of the production path. The server build is emitted
under `dist/server`, and `npm run start` executes the compiled entry point.
Firebase Hosting serves `client/dist`; production client builds set
`VITE_API_BASE_URL` to the real Render HTTPS service URL. See
`docs/DEPLOYMENT-RENDER-FIREBASE.md` for the exact setup and smoke checks.
