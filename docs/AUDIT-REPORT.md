# Stage 1 Backend Financial and Security Audit Report

**Audit date:** 2026-08-25  
**Repository:** `xoft-bot/Letsgrow-Microcredit`  
**Scope:** Stage 1 implementation only.

## Executive conclusion

The repository now contains a minimal React/Vite PWA shell, Fastify API shell, PostgreSQL migration, Firebase Admin JWT verification boundary, RBAC and branch-scope guards, an append-only double-entry ledger primitive, and four automated tests.

The static and application-level checks pass. The database integration gate is **blocked in this sandbox** because no `DATABASE_URL` is configured and no local PostgreSQL server is listening on port 5432. Consequently, the PostgreSQL migration, database-enforced balance trigger, append-only triggers, idempotency uniqueness, and real concurrent transaction behavior are not yet empirically verified.

This is not a production certification. Stage 1 code is implemented, but the Stage 1 evidence package remains conditional on running the database-backed integration suite against Cloud SQL or an equivalent PostgreSQL instance.

## Verification results

| Check | Result | Notes |
|---|---:|---|
| TypeScript type-check | PASS | `npm run typecheck` |
| ESLint | PASS | `npm run lint` |
| Unit/security tests | PASS | 4 tests passed |
| Frontend production build | PASS | `npm run build` |
| PostgreSQL schema check | BLOCKED | `DATABASE_URL` absent; localhost:5432 refused |
| Migration execution | NOT RUN | Requires reachable PostgreSQL |
| Database constraint tests | NOT RUN | Requires reachable PostgreSQL |
| Concurrent payment/ledger tests | NOT RUN | Requires reachable PostgreSQL |

## Findings and remediation status

### Ledger invariants — partially verified

The application validates positive integer amounts, requires at least two lines, and rejects unbalanced debit/credit totals before opening the database transaction. The SQL migration adds deferred balance validation and triggers that reject updates or deletes on `ledger_transactions` and `ledger_entries`. Ledger entries and their audit event are inserted inside one transaction through `postLedgerTransactionOnClient`.

The database trigger and append-only behavior still require execution against PostgreSQL. The migration must be tested before this control is considered effective.

### Concurrency and idempotency — implemented, database verification pending

The ledger service checks the idempotency key under `FOR UPDATE`, and the database has a unique constraint on `ledger_transactions.idempotency_key`. The Stage 1 API locks the requested branch row with `FOR UPDATE` and uses a single transaction for the branch check, ledger posting, and command audit event. Payment-specific concurrency is not yet implemented because Stage 1 deliberately contains only a non-monetary command primitive; it must be added and tested in the later synthetic-money slice.

A database-backed test is still required to submit the same idempotency key concurrently and confirm that exactly one transaction is created and all callers receive the same result.

### Authorization boundaries — application-level tests pass

The API requires a Bearer token, verifies Firebase ID tokens server-side with revocation checking, validates an allowed role, and derives the actor from verified claims. The Stage 1 command allows only `admin` and `manager` roles and denies non-admin users whose verified `branchId` differs from the requested branch. The tests confirm missing authentication fails with 401 and cross-branch access fails with 403.

Production verification still requires Firebase emulator or test-project coverage for invalid, revoked, roleless, disabled-user, and forged-claim cases. The current role and branch claims are a boundary contract; production user records and authoritative branch membership must be checked server-side before real financial commands are enabled.

### Capital-pool mathematics — not in Stage 1 command

The Stage 1 command is intentionally non-monetary and does not calculate capital pools. No claim is made that capital-pool mathematics is implemented in this stage. The planning and ledger specifications remain authoritative: gross or contractual charges cannot become deployable lending capital until realized surplus allocations have been posted and all required reserves/costs have been applied.

## Static source audit

No financial-history `UPDATE`, `DELETE`, or `TRUNCATE` query exists in the application source. The only `UPDATE`/`DELETE` strings in the migration are the append-only trigger declarations and the deferred balance trigger syntax. This must be confirmed by PostgreSQL integration tests because static inspection cannot prove runtime enforcement.

## Remaining blockers before Stage 1 certification

1. Provision a development PostgreSQL database using the approved Cloud SQL environment or a local PostgreSQL container.
2. Set `DATABASE_URL` in a non-committed environment.
3. Run `npm run db:migrate` and `npm run db:check`.
4. Add database-backed tests for migration success, balanced/unbalanced journal transactions, append-only rejection, idempotency under concurrent requests, and rollback of ledger plus audit writes.
5. Add Firebase emulator/test-project tests for invalid and revoked tokens and server-side user/branch membership lookup.

Until those checks pass, the repository should be treated as a Stage 1 implementation candidate, not a production-ready financial backend.
