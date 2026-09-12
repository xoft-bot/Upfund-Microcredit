# Stage 1 Evidence Package

**Status:** Implemented with database certification pending  
**Commit target:** Stage 1 implementation and audit hardening

## Scope delivered

The repository now contains the minimum connected application foundation: a React/Vite TypeScript PWA shell, a Fastify TypeScript API, PostgreSQL migration tooling, Firebase Admin token verification, server-side RBAC, branch-scope authorization, a transactional append-only double-entry ledger primitive, audit-event persistence, rate limiting, security headers, and a single non-monetary vertical command.

The command path is:

```text
Bearer token → Firebase ID-token verification → role guard → branch guard
  → PostgreSQL transaction → branch lock → idempotent balanced ledger transaction
  → ledger audit event → command audit event → typed response
```

## Changed areas

| Area | Files |
|---|---|
| Root tooling | `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `.env.example` |
| Database | `migrations/001_stage1_core.sql`, `server/src/db.ts`, `server/src/db/migrate.ts`, `server/src/db/check-schema.ts` |
| Backend | `server/src/index.ts`, `server/src/app.ts` |
| Security | `server/src/middleware/auth.ts`, `server/src/middleware/authorization.ts` |
| Ledger | `server/src/services/ledger.ts` |
| Frontend | `client/index.html`, `client/vite.config.ts`, `client/src/main.tsx`, `client/src/styles.css` |
| Tests | `tests/stage1.test.ts` |
| Evidence | `docs/AUDIT-REPORT.md` |

## Controls implemented

The migration creates all Stage 1 core tables and unique constraints for Firebase UIDs, client references, idempotency keys, payment receipt references, repayment schedule dates, and capital-pool identity. Ledger transaction and entry tables have database triggers that reject updates and deletes. A deferred constraint trigger verifies that each ledger transaction is balanced at commit.

The ledger service rejects non-positive or unsafe integer amounts, requires at least two lines, checks debit/credit equality, uses `INSERT ... ON CONFLICT DO NOTHING` followed by a locked lookup to resolve concurrent idempotency races, inserts all journal lines and the ledger audit event in one transaction, and returns the existing transaction for a repeated idempotency key. The Stage 1 endpoint uses the same database transaction for branch locking, ledger posting, and command audit persistence.

The authentication middleware fails closed when the Bearer token is absent or invalid, uses Firebase Admin token verification with revocation checking, and accepts only known roles. The endpoint requires `admin` or `manager` and denies a non-admin request outside the verified branch claim. Frontend visibility is not used as a security boundary.

## Automated verification

The following commands pass in the sandbox:

```text
npm run typecheck
npm run lint
npm test
npm run build
```

Current test result: **4 tests passed**. The tests cover absent authentication, cross-branch denial, unbalanced journal rejection, and balanced journal acceptance. Type-checking, linting, and the production build also pass.

## Database verification status

Database-backed commands are blocked in the sandbox because `DATABASE_URL` is not configured and no PostgreSQL server is listening on port 5432. The following must be run against the approved development Cloud SQL database or a local PostgreSQL instance before Stage 1 is certified:

```text
npm run db:migrate
npm run db:check
```

A final certification run must also include PostgreSQL integration tests for trigger enforcement, transaction rollback, idempotency under concurrent submissions, and the database-level double-entry invariant.

## Deliberate exclusions

Stage 1 does not implement loan simulations, payment posting, reconciliation workflows, capital-pool calculations, multi-screen product features, live mobile-money APIs, real borrower data, national-ID uploads, or production deployment. Those are Stage 2 or later and must not be inferred from this evidence package.

## Certification gate

Stage 1 is complete only after the database-backed migration and concurrency tests pass and their output is committed. Until then, this evidence package records a verified implementation candidate with an explicit infrastructure blocker, not a production financial certification.
