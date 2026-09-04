# Supabase, Firebase, and Officer Portal Integration Audit

**Audit date:** 2026-09-04  
**Repository:** `xoft-bot/Upfund-Microcredit`  
**Scope:** Firebase Authentication and Hosting, PostgreSQL/Supabase integration, authorization boundaries, officer portal UX, loan disbursement, payment collection, and reconciliation tracking.

## Executive conclusion

The system uses a sound high-level integration boundary: Firebase provides authentication and static hosting, while the Render API connects directly to PostgreSQL/Supabase and remains the authority for users, roles, branches, loans, payments, ledger entries, and reconciliation. No Firebase Firestore, Realtime Database, or Cloud Storage data path is present in the repository. Therefore, the primary backend security boundary is the Render API plus PostgreSQL, not Firebase database rules.

The most important findings were workflow and object-authorization issues. The two highest-priority code issues identified in this review have now been fixed in the working tree:

1. **The officer portal displayed a generic “next review” action that exposed transitions the officer was not authorized to perform.** This is now fixed: the UI only exposes submit/approve actions when the authoritative session permissions support them, and it no longer auto-submits hardcoded KYC or risk decisions.
2. **The officer portal hardcoded a risk score, risk grade, policy version, and KYC verification method.** This is now removed from the portal action path. KYC and risk must be completed by a dedicated controlled workflow before manager approval appears.
3. **The disbursement idempotency replay path returned an existing disbursement before checking the requesting actor’s loan branch.** This is now fixed: the loan is locked and branch-authorized before replay lookup, and reuse of a key for a different loan returns a conflict.
4. **Disbursement now posts a balanced ledger transaction atomically.** New disbursements debit `loan.receivable`, credit `cash.disbursement`, and include the ledger transaction ID in the audit metadata.
5. **Firebase configuration is fail-closed for production credentials and mock authentication is blocked in production.** This is good. However, Firebase security rules are not present because the application does not use Firebase data products; if Firestore or Storage is added later, it must not be assumed that Firebase Auth alone protects those resources.
6. **Database-backed integration tests cannot be certified in the current environment.** The code-level and non-database tests are strong, but a PostgreSQL/Supabase environment with migrations through `013` is required to verify actual constraints, row locks, transaction behavior, and object-level authorization.

## 1. Integration architecture

The current data path is:

```text
Firebase Authentication
        |
        | Firebase ID token
        v
React/Vite SPA on Firebase Hosting
        |
        | Authorization: Bearer <ID token>
        v
Fastify API on Render
        |
        | Firebase Admin verifyIdToken(..., true)
        | Firebase UID -> active PostgreSQL users row
        v
PostgreSQL/Supabase transaction pooler
        |
        +-- users, roles, permissions, branches
        +-- clients, applications, loans, schedules
        +-- payments, receipts, ledger, audit
        +-- disbursements, field collections, reconciliations
```

This is preferable to using Firebase claims as the source of financial authorization. The server resolves the active database user by `firebase_uid`, checks `status = 'active'`, loads the database role and permissions, and sets the request actor to the database UUID. Firebase claims are still used by the client for initial presentation, but server routes do not rely on those claims for financial authority.

## 2. Firebase review

### Positive controls

- Production runtime validation rejects mock Firebase mode.
- Firebase Admin credentials are server-only.
- The client only reads `VITE_FIREBASE_*` public identifiers.
- ID tokens are verified with revocation checking.
- An authenticated Firebase user must map to an active PostgreSQL user.
- Missing or invalid tokens return `401`.
- Valid Firebase users without an active database mapping return `403`.
- The client reports token-claim failures rather than silently granting a portal.
- Firebase Hosting serves static assets and does not act as the financial API.

### Gaps and silent-failure risks

| ID | Severity | Finding | Consequence |
|---|---|---|---|
| FB-001 | Medium | No Firestore, Realtime Database, or Storage rules are tracked. | Not a current vulnerability because those services are not used, but future additions could be deployed without a rules review. |
| FB-002 | Medium | The client derives a provisional identity from Firebase claims, while the API derives authoritative identity from PostgreSQL. | Stale claims can make the UI display a role or branch that the API later rejects. The UI should treat `/api/v1/session` as the final identity source. |
| FB-003 | Low | If the Firebase client is not configured, the app renders a signed-out state rather than a differentiated configuration failure. | Misconfigured environments can look like an ordinary login state. |
| FB-004 | Low | The Firebase Hosting rewrite catches unknown paths and serves the SPA shell. | Missing files or invalid static URLs can return HTML with HTTP 200, masking deployment mistakes. |

## 3. Supabase/PostgreSQL review

### Positive controls

- The application uses parameterized PostgreSQL queries.
- Production configuration prefers the Supabase transaction pooler.
- Production rejects an effective direct port `5432` configuration.
- Connection pool size is bounded.
- Database credentials are not exposed to Vite.
- Financial writes use transaction wrappers and row locks.
- Payments, receipts, loan balance changes, schedule updates, ledger entries, field-collection records, overpayment holdings, and audit events are grouped atomically.
- Reporting queries use branch and collector assignment filters.
- The schema has unique idempotency keys for payments and disbursements.
- The schema includes append-only ledger/audit controls and balance checks.

### Gaps and silent-failure risks

| ID | Severity | Finding | Consequence |
|---|---|---|---|
| DB-001 | High | No live or disposable PostgreSQL instance was available during this review. | Database-backed tests and `db:check` cannot verify Supabase integration, migration order, constraints, or row-level behavior. |
| DB-002 | Resolved | `disburseLoan()` now loads and branch-authorizes the locked loan before idempotency replay, and rejects a key reused for another loan. | Cross-branch disbursement replay metadata is no longer returned by this path. |
| DB-003 | Medium | The API uses application-level branch checks rather than PostgreSQL Row Level Security. | Any future direct database client, reporting job, or forgotten query could bypass the intended branch boundary. Keep DB access server-only or add RLS as defense in depth. |
| DB-004 | Medium | The reconciliation scheduler is optional and disabled unless several environment variables are set. | A Render deployment can appear healthy while automatic reconciliation is not running. Startup logs should expose a clear scheduler status and monitoring should alert when disabled in production. |
| DB-005 | Medium | The field collection query permits manager/officer branch queries and collector-specific filters, while collector assignment scope is enforced in reporting SQL but not uniformly documented as a policy. | Future endpoints may accidentally use branch-only scope when assignment scope is required. |

## 4. Officer portal UX review

### Current experience

The officer portal is rendered inside the role-conditioned `PortalDashboard`. It includes:

- Workspace hero and officer role chip.
- Client, application, active-loan, and outstanding-principal metrics.
- Collector/reporting dashboard for the officer’s own assignment context.
- New loan application form with active loan-product selection, assigned client selection, and requested amount.
- Client creation form with display name and external reference.
- Application pipeline list.
- Repayment book with loan status and outstanding principal.

The layout is visually clean, responsive, and consistent with the manager portal. The officer can create a client and then create a draft application for that client. Branch and client scope are checked server-side.

### UX findings

| ID | Severity | Finding | Consequence |
|---|---|---|---|
| OFF-001 | Resolved | Application actions are now permission-aware and limited to submission or approval where the current session permits them. | Officer/client users no longer see generic actions that the API will reject. |
| OFF-002 | Resolved | Hardcoded KYC and risk transitions were removed from the portal action path. | Underwriting data is no longer silently fabricated by a generic “next step” button. |
| OFF-003 | Medium | The officer can create applications but the UI does not clearly show whether an application is draft, submitted, KYC verified, risk assessed, manager approved, rejected, or disbursed as a timeline. | The officer cannot easily understand where work is blocked or who owns the next step. |
| OFF-004 | Medium | The repayment book displays loan IDs and status but does not show disbursement reference/date, next due date, schedule balance, or collection history. | Officers cannot reliably track the post-approval lifecycle from their portal. |
| OFF-005 | Medium | Collection is separated into the collector role. An officer without collector assignment receives a generic no-workflow message. | The product distinction between loan officer and field collector is safe but not self-explanatory. |
| OFF-006 | Low | Success messages say “Application approved and loan account created” after the manager action, but the officer’s page reload is the only tracking mechanism. | The user has no durable activity history or event timeline. |

## 5. Loan application, approval, and disbursement tracking

### Application lifecycle

The current lifecycle is:

```text
draft
  -> submitted
  -> kyc_verified
  -> risk_assessed
  -> approved OR rejected
```

On approval, the server creates a loan in `approved` status and creates an initial repayment schedule. The manager can then disburse the approved loan.

The API records:

- application creator;
- submitted timestamp;
- KYC record and reviewer;
- risk assessment, score, grade, policy version, and assessor;
- approval/rejection actor and timestamp;
- reason in the audit event;
- loan account and initial schedule;
- disbursement reference, idempotency key, amount, posting actor, and creation timestamp;
- loan state transition to `disbursed`;
- loan audit event.

### Disbursement behavior

The manager portal shows a **Disburse** button for loans in `approved` status. It generates a deterministic reference and idempotency key based on the loan ID. The server locks the loan, verifies the state transition, changes the status to `disbursed`, inserts a `loan_disbursements` row, and emits an audit event.

The implementation now creates a balanced ledger transaction in the same database transaction as the loan status and disbursement row: debit `loan.receivable` and credit `cash.disbursement`. The ledger idempotency key is derived from the disbursement idempotency key, and the ledger transaction ID is preserved in the disbursement audit event. This should still be verified against a disposable PostgreSQL database before production use.

## 6. Collection and repayment tracking

### Payment flow

A collection is entered by the collector field form with client ID, loan ID, amount, payment method, device ID, and capture timestamp. The browser stores the record locally and assigns an idempotency key. On synchronization, the client obtains a Firebase ID token and calls `POST /api/v1/payments`.

The server then:

1. Locks and validates the loan branch.
2. Validates the optional client ID against the loan’s client.
3. Checks payment idempotency.
4. Locks the first open repayment schedule row.
5. Calculates allocation across penalty, interest, principal, and overpayment.
6. Inserts the payment and receipt.
7. Reduces outstanding principal by the principal component only.
8. Updates schedule paid amounts and status.
9. Posts a balanced payment ledger transaction.
10. Creates an overpayment holding when required.
11. Persists a `field_collection_records` source record.
12. Writes a payment audit event.
13. Returns receipt, allocation, outstanding principal, status, and ledger transaction ID.

Field collection records begin as `pending_reconciliation`. Reporting distinguishes posted/verified amounts from pending reconciliation amounts. This is the correct separation between captured cash and manager-approved reconciliation.

### Collection tracking weaknesses

- The officer portal does not show a collection history or next repayment schedule.
- The collector form uses free-text IDs rather than an assigned-loan picker.
- The officer and collector experiences are separated but do not explain the handoff.
- The manager portal can review reconciliation batches, but the officer portal does not expose the status of a submitted collection batch.
- The application stores field collection metadata, but a user-facing receipt and reconciliation timeline is not presented in the officer workspace.

## 7. Recommended fixes

### P0 security and accounting fixes

1. Add integration tests for cross-branch disbursement replay, repeated same-branch disbursement, mismatched loan ID/idempotency key, and disbursement ledger balance.
2. Run all database-backed tests against a disposable PostgreSQL instance with migrations `001` through `013`.

### P1 officer workflow fixes

1. Add dedicated forms or controlled workflow screens for KYC and risk assessment that capture verification method, evidence/reason, score, risk grade, and policy version.
3. Add an application timeline showing actor, timestamp, state, decision reason, and next owner.
4. Add loan detail views containing disbursement status/reference/date, repayment schedule, payments, receipts, and outstanding balances.
5. Add assigned-client and assigned-loan selectors to reduce free-text collection errors.

### P2 defense in depth

1. Keep Firebase data products out of scope unless explicit Firestore/Storage rules are added and reviewed.
2. Add startup telemetry for Firebase live mode, database connectivity, effective pooler port, and reconciliation scheduler enabled/disabled state without exposing secrets.
3. Add a route-level authorization matrix test generated from the permission seed and route definitions.
4. Consider PostgreSQL Row Level Security as defense in depth if any non-API service will receive database credentials.

## Final verdict

The Firebase-to-API authentication boundary and Supabase/PostgreSQL financial architecture are fundamentally sound, and the payment collection path is substantially tracked from offline capture through receipt, ledger, field source, reconciliation, and audit. The officer portal is visually coherent and supports client/application initiation.

The current officer workflow should not yet be treated as a production underwriting workflow because the UI hardcodes risk decisions and exposes unauthorized state-transition buttons. The most urgent backend fix is the disbursement idempotency replay authorization gap, followed by adding a ledger entry for disbursement if disbursements are part of the financial accounting model. The most urgent UX fix is to align visible officer actions with the server permission matrix and provide lifecycle timelines instead of relying on a reload and transient notices.

## References

[1]: https://github.com/xoft-bot/Upfund-Microcredit "Upfund Microcredit GitHub repository"
[2]: https://firebase.google.com/docs/auth/admin/verify-id-tokens "Firebase Admin ID token verification documentation"
[3]: https://firebase.google.com/docs/rules "Firebase Security Rules documentation"
[4]: https://supabase.com/docs/guides/database/postgres/row-level-security "Supabase PostgreSQL Row Level Security documentation"
[5]: https://www.postgresql.org/docs/current/explicit-locking.html "PostgreSQL explicit locking documentation"

## Evidence reviewed

- `client/src/services/firebase.ts`
- `server/src/config/firebaseAdmin.ts`
- `server/src/config.ts`
- `server/src/db.ts`
- `server/src/services/lifecycle.ts`
- `server/src/services/payment-posting.ts`
- `server/src/services/collection-queries.ts`
- `server/src/services/collector-reporting.ts`
- `client/src/components/portals/PortalDashboard.tsx`
- `client/src/services/api.ts`
- `migrations/001_stage1_core.sql` through `migrations/013_collector_assignments.sql`
- authorization, reporting, payment, reconciliation, and workflow tests
