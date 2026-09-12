# Upfund Microcredit Next-Sprint Backlog

**Planning date:** 2026-09-04  
**Basis:** Supabase/Firebase/officer-portal audit and temporary PostgreSQL certification  
**Recommended sprint objective:** Make the officer-to-loan lifecycle operationally complete and observable without weakening financial controls.

## Current baseline

The repository has now been certified against a temporary PostgreSQL 16 database. All migrations `001` through `013` applied successfully, `db:check` verified all 25 required custom tables, and the complete Vitest suite passed with **17 test files and 80 tests passing**. This validates the current schema, payment/reconciliation integration tests, collector reporting, reporting read models, authorization tests, and PWA flow tests in a real PostgreSQL environment. It does not replace a Supabase staging smoke test with Firebase authentication and Render networking.

## Sprint priorities

### Priority 0 — Financial and authorization regression coverage

| Rank | Work item | Why it comes first | Acceptance criteria |
|---:|---|---|---|
| 1 | Add disbursement regression tests | The code now protects idempotency replay and posts a disbursement ledger transaction, but those exact controls are not yet covered by database integration tests. | Tests cover same-branch replay, cross-branch replay denial, key reuse for another loan, balanced disbursement ledger entries, and rollback when ledger posting fails. |
| 2 | Add an authorization matrix test | Route permissions and seeded role permissions can drift silently. | A test asserts the intended allow/deny matrix for admin, manager, officer, collector, accountant, client, and marketing across portal, application, KYC, risk, approval, disbursement, payment, reporting, and telemetry actions. |
| 3 | Add production startup guardrails and telemetry | Render can be healthy while scheduler, Firebase mode, or database settings are wrong. | Startup emits non-secret configuration status for Firebase live mode, database pooler port, database connectivity, and reconciliation scheduler enabled/disabled state; production rejects unsafe combinations. |

### Priority 1 — Controlled underwriting workflow

| Rank | Work item | Why it matters | Acceptance criteria |
|---:|---|---|---|
| 4 | Build dedicated KYC review form | The portal no longer fabricates KYC decisions, but it needs a real operator workflow. | Authorized reviewer can record status, verification method, reason/evidence, reviewer, and timestamp; unauthorized roles see no action. |
| 5 | Build dedicated risk assessment form | Risk score, grade, policy version, and decision should be explicit and auditable. | Authorized assessor enters validated score, grade, policy version, and rationale; submitted application cannot be approved without a recorded risk assessment. |
| 6 | Add application lifecycle timeline | Current users rely on status badges and transient notices. | Timeline shows state, actor, timestamp, reason, and next owner from draft through disbursement. |

### Priority 2 — Officer and collector operational visibility

| Rank | Work item | Why it matters | Acceptance criteria |
|---:|---|---|---|
| 7 | Add loan detail view | The officer repayment book currently shows only status and outstanding principal. | Loan detail includes disbursement reference/date, principal, next due date, schedule balances, payments, receipts, and audit-relevant events. |
| 8 | Replace free-text collection IDs with assigned-loan selection | Free-text client/loan entry creates avoidable capture errors. | Collector selects from currently assigned clients and loans; server still validates branch, client, loan, and assignment scope. |
| 9 | Add collection and reconciliation timeline | Officers do not see what happened after field capture. | The workspace shows captured, synced, pending reconciliation, verified/posted, rejected, or needs-review state with receipt and reconciliation references. |
| 10 | Explain officer/collector handoff | The role split is safe but not self-explanatory. | Officer sees assignment/collection status and clear owner; collector sees assigned route and loan context. |

### Priority 3 — Defense in depth and release operations

| Rank | Work item | Why it matters | Acceptance criteria |
|---:|---|---|---|
| 11 | Add CI PostgreSQL service | Local certification succeeded, but it is not automated in Git. | Pull requests run migrations, `db:check`, the full 80-test suite, typecheck, lint, and production build against PostgreSQL 16 or the supported project version. |
| 12 | Add Render staging smoke test | Local PostgreSQL does not validate Render networking, CORS, Firebase Admin credentials, or Supabase pooler behavior. | Staging smoke test verifies `/health`, Firebase-authenticated `/api/v1/session`, branch denial, officer portal reads, payment idempotency, and manager reporting using synthetic data. |
| 13 | Decide on PostgreSQL Row Level Security | Current branch isolation is enforced in application code. | Document a deliberate server-only database posture, or implement and test RLS policies before any non-API service receives database credentials. |
| 14 | Keep Firebase data products out of scope unless needed | No Firestore, Storage, or Realtime Database path currently exists. | If a Firebase data product is introduced, add explicit rules, emulator tests, deployment checks, and a data classification review before use. |

## Explicitly defer

The following items should not consume the next sprint unless product strategy changes:

- Public SEO expansion for the authenticated workspace. The current `noindex` posture is correct for a financial operations app. Build a separate public marketing surface first.
- Full SSR/prerendering of the authenticated portal. It does not improve private operational workflows.
- PostgreSQL RLS before the database boundary changes. RLS is valuable defense in depth, but the immediate risk is better addressed by tests, route authorization, and keeping credentials server-only.
- New Firebase data products. The current Firebase role is authentication and hosting, which is sufficient for the present architecture.

## Suggested execution sequence

**Week 1:** Add disbursement regression tests, authorization matrix coverage, startup telemetry, and CI PostgreSQL certification.

**Week 2:** Implement KYC and risk forms, enforce lifecycle prerequisites, and add the application timeline.

**Week 3:** Implement loan detail and assigned-loan collection selection, then add collection/reconciliation status tracking.

**Week 4:** Run the Render/Supabase staging smoke test, close defects, update the operational handoff, and perform a role-by-role synthetic UAT review.

## Definition of done

The sprint is complete when every P0/P1 acceptance criterion passes in automated tests, the officer can follow an application from creation through controlled KYC/risk review, the manager can approve and disburse it with a balanced ledger entry, a collector can select an assigned loan and submit a payment, and the officer/manager can see the resulting payment and reconciliation status without relying on transient browser notices.
