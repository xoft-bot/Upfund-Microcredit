# Phase 0 Go-Ahead and Stage 1 Execution Directive

## Status

**Phase 0 is formally approved and frozen.** The latest infrastructure decision is authoritative wherever an earlier planning document conflicts with it. The repository is `xoft-bot/Letsgrow-Microcredit`; the investment-club repository is a separate product and is not a code dependency.

## Non-negotiable invariants

1. Google Cloud SQL for PostgreSQL in `africa-south1` is the authoritative operational and financial database from Stage 1 onward.
2. Firebase is limited to Authentication, Hosting, Storage, messaging, and supporting platform services. Firestore must never become a competing source of truth for balances, loans, repayments, capital pools, or ledger entries.
3. The frontend is a React/Vite TypeScript PWA.
4. The backend API is authoritative for all financial commands. Direct client-side database access is prohibited.
5. Phase 1 payments are manual cash and manual mobile-money recordings with structured reconciliation. Live provider APIs are deferred.
6. The financial engine separates principal capital, contractual charges, collected charges, credit-loss reserves, operating costs, realized net profit, retained profit, and deployable growth capital.
7. The ledger is append-only in principle, double-entry, and balanced: total debits must equal total credits for every posted transaction. Corrections use reversals or adjustments.
8. Payment posting uses a database transaction plus row-level locking or an equivalent optimistic-version guard for affected accounts and aggregates. Duplicate submissions are rejected by idempotency and unique reference controls.
9. Any legacy reference to starting with Firestore and migrating the financial system to PostgreSQL later is invalidated.

## Stage 1: minimal end-to-end skeleton

Proceed with one connected, non-monetary vertical execution path:

```text
Authenticated user
  → authorized API command
  → PostgreSQL migration and write
  → ledger primitive / audit event
  → typed response
```

The skeleton must establish the repository structure, React/Vite PWA, API service, Firebase Auth integration, PostgreSQL connection and migrations, RBAC boundary, validation, error envelope, correlation IDs, audit event, health checks, CI checks, and local development instructions. It must use synthetic data and must not connect live mobile-money providers or real borrower documents.

## Stage 2: synthetic-money simulation

After Stage 1 passes, implement and verify one complete test path:

```text
Client → KYC → loan application → approval → disbursement
  → manual payment → reconciliation → ledger
  → capital-pool read model → PAR read model
```

The simulation must test full compliance, partial payment, late payment, missed payment, overpayment, duplicate payment, reversal, default, write-off, recovery, and renewal. It must return accurate values for outstanding principal, collected amount, realized revenue, realized profit, eligible reinvestment capital, and PAR 1/7/30/60/90.

## Stop conditions

Stop feature expansion and fix the ledger if any scenario produces an incorrect balance, unbalanced journal entry, duplicate posting, untraceable adjustment, unauthorized mutation, incorrect capital-pool allocation, or unexplained reconciliation variance. Do not build dozens of screens while the synthetic-money test remains unresolved.

## Prohibited at this stage

Do not onboard real borrowers, upload real national IDs, connect live mobile-money APIs, deploy a production financial environment, add speculative features, or claim production readiness from a successful build alone.

## Agent completion report

Every implementation handoff must state changed files, applied migrations, API contracts verified, permissions tested, financial invariants validated, environment used, tests run, known limitations, and decisions requiring human approval.
