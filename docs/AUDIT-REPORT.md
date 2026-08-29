# Letsgrow Microcredit Full-System Capability Audit

**Audit date:** 2026-08-29
**Repository:** `xoft-bot/Letsgrow-Microcredit`  
**Scope:** The attached full-system capability brief, including identity, RBAC, portals, lending, collections, accounting, capital, reporting, integrations, offline operation, auditability, and security.

## Executive conclusion

The repository is **not yet the full microcredit platform described in the brief**. It contains a useful financial foundation and a small field-collection slice:

- Fastify authentication and coarse role/branch guards.
- PostgreSQL migrations for identity, clients, loans, schedules, payments, reconciliation, ledger, capital pools, audit events, KYC, and risk records.
- Atomic manual payment posting with idempotency, receipt creation, schedule updates, balanced ledger entries, and audit events.
- A reconciliation posting service, allocation policy primitive, webhook normalizer, telemetry endpoints, and a callable reconciliation job.
- A React field-collection screen with a local IndexedDB/localStorage queue and a manager variance component.

The current application does **not** expose the brief's eight role portals, real client/loan data screens, loan-management API, reporting layer, capital-management workflow, complete offline sync, or production-wired scheduler. The frontend is a demo shell with hardcoded identities and a synthetic variance batch.

The most important current blocker is not visual polish: the field queue cannot authenticate its sync requests, and the manager review screen is constructed from local demo data. A user can save a collection locally, but the current main app cannot reliably send it through the protected server workflow.

This audit is a capability assessment, not a production certification.

## Evidence and reproducibility

| Check | Result | Evidence |
|---|---|---|
| TypeScript type-check | PASS | `npm run typecheck` |
| Production build | PASS | `npm run build` |
| Automated tests | FAIL | 29 passed, 5 skipped; 2 database suites failed because `roles` does not exist |
| Database schema check | FAIL | `npm run db:check` reports all 23 required tables missing |
| Dependency audit | HIGH | 2 high-severity advisories for transitive `uuid@9.0.1` |
| SAST | PASS | 0 findings |
| Privacy/dataflow scan | PASS | 0 findings |
| Main application preview | NOT VERIFIED | Only the isolated mockup-sandbox workflow is configured/running |
| Working-tree sync state | CLEAN | No uncommitted changes at audit time |

The older `HANDOFF.md` claims a disposable PostgreSQL certification and 34/34 passing tests. That evidence is not reproducible in the current environment: the active database has no migrated schema, and the current test run fails at `roles`. The handoff should be treated as historical documentation until rerun against the current database.

## Capability matrix

### 1. Authentication and identity — **PARTIAL**

**Working**

- `server/src/middleware/auth.ts` requires a Bearer token and calls Firebase Admin token verification with revocation checking.
- The server recognizes five roles: `admin`, `manager`, `officer`, `collector`, and `accountant`.
- A verified `branchId` claim is used for non-admin branch scope checks.
- `server/src/config/firebaseAdmin.ts` explicitly prevents mock Firebase mode in production.

**Missing or unsafe**

- There is no sign-in/session UI in `client/src/main.tsx`; `client/src/services/firebase.ts` only exposes configuration helpers.
- The server accepts role and branch claims from the decoded token but does not load the authoritative `users`, `roles`, `permissions`, or branch membership record from PostgreSQL.
- `request.actor.userId` is populated from Firebase `uid`, while financial tables reference `users.id` UUIDs. There is no UID-to-user-row lookup. Unless deployments deliberately make those values identical, real payment writes can fail foreign-key checks or audit the wrong identity.
- The requested role/portal model is broader than the five-role allowlist.

**Classification:** server boundary exists; end-user authentication and authoritative identity resolution are disconnected.

### 2. RBAC and branch isolation — **PARTIAL**

**Working**

- Payment commands allow `admin`, `manager`, `officer`, and `collector`.
- Reconciliation posting allows `admin` and `manager`.
- Telemetry allows `admin`, `manager`, and `accountant`.
- Non-admin requests are denied when their token branch does not equal the requested branch.

**Missing**

- `permissions` and `role_permissions` are schema-only; runtime authorization is role-list based.
- There are no route-level permissions for the brief's portal actions.
- There are no separate company-admin, branch-manager, finance, marketing, client, or equivalent portal experiences.
- There is no server-side enforcement of disabled users from `users.status`.

**Classification:** coarse command guards are implemented; complete least-privilege RBAC is not.

### 3. Role portals and frontend navigation — **NOT IMPLEMENTED**

The frontend has one React render path in `client/src/main.tsx`, with no router and no authenticated route boundary. The visible screen is a field-operations page containing:

- A collector route summary.
- A local collection form.
- A local receipt preview.
- A manager variance component.

There are no real portal shells or navigation paths for the brief's administrator, company, branch, loan officer, field, finance/accounting, marketing, or client experiences. The isolated canvas mockup is not the production app and is correctly excluded from this capability claim.

### 4. Client, KYC, risk, and loan lifecycle — **DATA MODEL/PURE LOGIC ONLY**

**Present**

- Tables exist for clients, businesses, KYC records, applications, risk assessments, loans, and repayment schedules.
- `server/src/services/workflow.ts` and `server/src/services/state-machines.ts` contain tested transition logic.
- Loan statuses include approved, disbursed, active, overdue, defaulted, written off, and completed.

**Absent**

- No API routes expose client onboarding, KYC review, risk assessment, application submission, approval, disbursement, restructuring, delinquency, default, write-off, or completion.
- No UI exposes those workflows.
- No guarantor, collateral, credit-bureau, document, or identity-verification persistence was found.

**Classification:** schemas and unit-level lifecycle rules are not an end-to-end loan system.

### 5. Collections and payment posting — **PARTIAL / BACKEND-CONNECTED ONLY**

**Working in isolation**

- `POST /api/v1/payments` validates positive integer UGX amounts.
- The service locks the loan and first open schedule row.
- It allocates the submitted amount across principal and charge, updates the loan and schedule, creates a receipt, posts a balanced ledger transaction, and writes an audit event inside one PostgreSQL transaction.
- Idempotency is preserved through unique keys and a lookup of an existing payment.

**Disconnected**

- There are no read endpoints for clients, loans, schedules, payment history, or collection routes, so the UI cannot load authoritative records.
- `FieldCollectionForm` submits `clientId`, `paymentMethod`, and `deviceId` into a local record, but the server payment API accepts only loan, branch, amount, idempotency key, and optional receipt reference.
- The server does not create or update `field_collection_records` as part of the payment sync.
- The main screen hardcodes `collector-demo`, `branch-demo`, and `device-demo`.

### 6. Offline and synchronization — **LOCAL QUEUE IMPLEMENTED; LIVE SYNC BROKEN**

**Working**

- `client/src/services/offlineQueue.ts` stores event/state records in IndexedDB, with a localStorage fallback.
- It preserves idempotency keys, records retry/error state, listens for the browser `online` event, and never marks a record `Posted` until the sync callback returns success.
- The queue tests cover replay and idempotency behavior.

**Blocking defects**

1. `createPaymentSync()` calls `postPayment(..., undefined, ...)`, so queued requests contain no Authorization header. The protected endpoint returns 401. The queue classifies that failure as `Rejected`, not a retryable offline/network failure.
2. The main app does not obtain or pass a Firebase ID token. The manager component's `getToken` prop is hardcoded to `async () => ''`, so manager actions also return 401.
3. The queue sends a payment command, not a field-collection source record. `localId`, payment method, device ID, and capture metadata are not persisted server-side by the sync path.
4. No service worker or web app manifest was found. The queue is offline-tolerant JavaScript, but an installable/background-sync PWA has not been evidenced.
5. The UI's “Saved to the offline queue” message is truthful locally, but the current main application cannot provide a real server-confirmed collection flow.

**Classification:** local persistence and test doubles work; authenticated, server-backed synchronization is not complete.

### 7. Reconciliation and manager review — **PARTIAL**

**Working**

- `POST /api/v1/reconciliations/post-batch` is protected for manager/admin roles and branch-scoped.
- Variances fail closed unless manager override is supplied.
- Payment linkage, persisted policy lookup, pool locking, ledger posting, pool updates, and audit insertion are grouped in a transaction.
- A variance-quarantine helper and alerting path exist.

**Defects and missing behavior**

- The UI displays a synthetic `DEMO-BATCH-001`, with values derived from local browser records rather than a server query.
- The UI collects a decision reason but does not send it in the API request, and the API/database has no decision-reason field. The audit trail therefore cannot explain the manager decision.
- There is no read endpoint for pending reconciliation batches, no real review queue, and no reject/reopen workflow.
- `server/src/jobs/reconciliationCron.ts` exports a callable cycle, but `server/src/index.ts` only starts Fastify. No scheduler or worker invokes the cycle in the running application.

### 8. Ledger, capital pools, and financial mathematics — **FOUNDATION WITH A HIGH-RISK CALCULATION GAP**

**Working**

- `server/src/services/ledger.ts` rejects non-positive amounts, requires at least two lines, and requires equal debit/credit totals.
- The migrations define append-only triggers for ledger history and a deferred balance trigger.
- Payment and reconciliation services use transaction wrappers.
- Allocation policy percentages are validated and persisted policy rows are locked before use.
- UGX is the default ledger currency and financial values are represented as integer amounts.

**High-risk finding**

`server/src/services/reconciliation-posting.ts` calls `allocateRealizedSurplus(result.recordedAmount, ...)`. The allocator's input is explicitly named `realizedCharge`, and the handoff says only realized charges become allocatable capital. Passing the entire recorded batch amount can allocate principal and other cash as reserves, collection cost, growth capital, and retained profit. This is a financial correctness issue, not a presentation issue. The data model currently does not provide a clear realized-charge total for the reconciliation batch.

**Missing**

- No capital contribution, investor/funder, disbursement, expense, reserve release, or portfolio-deployment workflow.
- No financial statements, trial balance, portfolio-at-risk, aging, repayment, branch, collections, reconciliation, capital, or audit reports.
- No reversal/refund/chargeback lifecycle beyond a payment status enum.

### 9. Integrations — **PARTIAL**

**Present**

- Flutterwave signature verification uses a timing-safe comparison.
- Charge payloads are normalized and restricted to successful UGX events.
- Webhook replays reuse the transaction reference as an idempotency key.
- Protected telemetry endpoints expose health, pool, queue, and audit-stream views.
- Recursive sensitive-field masking is covered by tests.

**Missing or unverified**

- No live Flutterwave configuration or end-to-end provider verification is available in this environment.
- The webhook calls the same manual payment service and does not persist the provider transaction reference or gateway-specific method on the payment.
- No SMS, email, notification, credit-bureau, accounting-export, or document-storage integration was found.
- No external scheduler is configured for the reconciliation job.

### 10. Auditability, observability, and performance — **PARTIAL**

**Working**

- Core posting services insert audit events with correlation IDs.
- Telemetry endpoints are protected and redact sensitive metadata before streaming.
- Database queries use indexes for key branch/status/entity access patterns.
- A connection pool and queue-depth telemetry surface exists.

**Missing**

- No user-facing audit explorer, export, or retention/archival policy.
- No complete event coverage for the missing loan, client, permission, portal, and reporting workflows.
- No load/concurrency certification can be trusted while the current schema check fails.
- No production workflow is configured for the main application in this workspace.

## Prioritized findings

| ID | Severity | Finding | Impact |
|---|---|---|---|
| AUD-001 | Critical blocker | Current development database has no migrated schema; `db:check` and database suites fail | Financial controls and integration behavior are not currently verified |
| AUD-002 | Critical | Offline payment sync sends no Firebase Bearer token | Every real queued payment sync is rejected by the protected API |
| AUD-003 | Critical | Main UI and manager review use demo identities/data; manager token is empty | The visible workflow is not connected to real users, branches, loans, or review records |
| AUD-004 | High | Firebase UID is used as `users.id` without server-side identity lookup | Real financial inserts may fail foreign keys or attach to an unverified identity |
| AUD-005 | High | Capital allocation uses total `recordedAmount` as `realizedCharge` | Principal/cash can be misclassified as allocatable surplus |
| AUD-006 | High | Reconciliation decision reason is collected but discarded | Manager approvals/rejections are not fully auditable |
| AUD-007 | High | Reconciliation cron is not wired to a scheduler/worker | Automatic matched posting and variance quarantine will not run in production |
| AUD-008 | High | The brief's portals, loan APIs, reports, capital workflows, and client/guarantor features are absent | The product cannot support the stated operating model |
| AUD-009 | High | `uuid@9.0.1` is installed transitively through Firebase Admin dependencies and has two high advisories | Dependency integrity/robustness risk; upgrade the direct dependency chain |
| AUD-010 | Medium | No service worker/manifest or server-side field-source persistence | Offline support is local queueing, not a complete installable/recoverable PWA |

## Recommended remediation order

### P0 — restore trustworthy execution

1. Provision a disposable development PostgreSQL database, run migrations `001` through `005`, run `npm run db:check`, and rerun all database-backed tests.
2. Add authenticated client session handling and inject the current Firebase ID token into both queue replay and manager review.
3. Replace demo IDs and synthetic batches with server-backed queries for the authenticated user's branch, assigned loans, collection records, and reconciliation queue.
4. Add a server-side Firebase UID-to-`users` lookup, disabled-user check, authoritative role lookup, and branch-membership check before financial commands.
5. Correct the realized-charge source used by capital allocation and add database-backed tests that prove principal is not allocated as surplus.
6. Persist the manager decision reason and action state in the reconciliation model and audit event.

### P1 — complete the stated product surface

1. Add authenticated route/navigation shells for each requested portal.
2. Expose client, KYC, risk, loan application, approval, disbursement, repayment, delinquency, write-off, guarantor, and collateral workflows through protected APIs and UI.
3. Add reporting/read models and exports for portfolio, repayment, branch, collections, reconciliation, capital pools, and audit history.
4. Add capital source, disbursement, reserve, expense, and reversal workflows with append-only financial events.
5. Wire reconciliation automation to a real worker/scheduler with operational monitoring.

### P2 — hardening

1. Upgrade the direct Firebase Admin dependency chain to remove the vulnerable `uuid` version without bypassing package security controls.
2. Add a service worker/manifest and explicit retry classification for offline, authentication, conflict, and validation failures.
3. Add Firebase emulator/test-project tests for disabled users, revoked tokens, malformed claims, cross-branch access, and portal permissions.
4. Run concurrency, migration, ledger-trigger, rollback, and performance tests against a disposable PostgreSQL instance and record current results.

## Certification decision

**Decision: Do not certify for production or claim full-system completion.**

The existing backend primitives are a reasonable foundation for continued implementation, and several isolated unit/contract tests pass. The current application, however, is not an end-to-end microcredit platform and its visible offline collection workflow is not authenticated or connected to authoritative server data. The database must be migrated and the P0 findings must be resolved before financial behavior can be treated as operationally trustworthy.