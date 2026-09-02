# Database and Domain Schema Plan

## Source-of-truth rule

The application must have one authoritative source for each financial fact. Operational read models may be denormalized for speed, but they must be derived from authoritative events and include an `asOf` timestamp and source version. No dashboard may independently recompute balances using a different formula.

Google Cloud SQL for PostgreSQL is authoritative from Stage 1 onward. Firebase services may support authentication, hosting, storage, messaging, and non-authoritative metadata, but Firestore must not become a competing source of truth for financial facts. The API contract remains storage-neutral so read models can evolve without rewriting the frontend.

## Identity and organization

`users` stores authenticated identity, status, contact information, and security metadata. `roles` and `permissions` store configurable authorization definitions. `userRoleAssignments` links users to roles and optional branch or portfolio scope. `branches` stores branch identity, geography, limits, and status. `officerAssignments` links officers to branches, clients, and collection portfolios with effective dates.

## Client and KYC

`clients` stores the canonical client record and lifecycle status. `businesses` stores the client’s business profile, operating pattern, estimated cash flow, and verification status. `locations` stores normalized location data and verification evidence. `kycRecords` stores KYC status, verification method, reviewer, timestamps, and review reason. `documents` stores only metadata and controlled-storage references. `references` and `guarantors` store relationships and verification outcomes. Duplicate checks must cover national ID/reference, phone, business, and suspicious location combinations.

## Loan domain

`loanProducts` stores versioned product rules: amount range, charge method, fees, tenure, repayment frequency, grace period, late-payment policy, exposure limits, required score, cycle requirements, and eligibility policy. `loanApplications` stores the application snapshot, evidence, risk recommendation, approvals, and rejection reason. `loans` stores the approved contract and product-policy version used. `repaymentSchedules` stores expected installments. `payments` stores captured payment events, method, provider reference, receipt link, and posting status. `receipts` stores immutable receipt information. `collections` stores field activity, route assignment, expected amount, collected amount, variance, and synchronization status.

## Risk and recovery

`creditScores` stores score snapshots with factor values, weights, policy version, reason codes, and reviewer. `riskAssessments` stores risk grade, exposure, PAR, fraud flags, and decision status. `portfolioSnapshots` stores time-indexed aggregates. `recoveryCases` stores delinquency stage, actions, assignments, outcomes, and promises to pay. `writeOffs` store approved write-off events and accounting treatment. `concentrationSnapshots` store borrower, geography, business-type, branch, and officer concentration metrics.

## Financial domain

`ledgerTransactions` stores the transaction header: unique ID, source event, actor, timestamp, idempotency key, correlation ID, policy version, currency, status, and reversal links. `ledgerEntries` stores balanced debit/credit lines against a controlled chart of accounts and pool classifications. `capitalPools` stores principal, credit-loss reserve, operating reserve, and growth/reinvestment positions as derived balances with reconciliation metadata. `capitalContributions` and `capitalWithdrawals` record external funding and withdrawals. `expenses` stores approved expenses, categories, evidence, branch, payment method, and accounting treatment. `reconciliations` stores expected amount, recorded amount, submitted amount, variance, evidence, review status, and resolution entries.

## Configuration and platform

`allocationPolicies`, `scoringPolicies`, `graduationPolicies`, `riskThresholds`, `notificationPolicies`, and `systemConfiguration` are versioned, effective-dated, approved records. `notifications` stores delivery intent and provider status. `auditEvents` is append-only and records actor, action, entity, old/new summaries where safe, correlation ID, device/IP metadata where appropriate, and result. `reports` stores report metadata and generated artifact references, not uncontrolled copies of sensitive data.

## Integrity requirements

All financial identifiers are unique and server-generated. All amounts are integer UGX values or integer minor units. Timestamps are server-generated for posted events. Financial history is append-only. Corrections create reversal or adjustment entries linked to the original. Idempotency keys prevent duplicate commands. Provider references, receipt IDs, offline local IDs, and mobile-money transaction IDs must be unique within their relevant provider or device scope.

## Firestore modeling guidance

Use separate collections for authoritative entities and bounded read models. Avoid a single hot document for the entire portfolio or bank balance. Use append-only event collections, partitioned or sharded aggregate updates where necessary, and scheduled snapshot generation for management dashboards. All queries require deliberate indexes and pagination. Security rules should expose only the minimum read/write surface; privileged commands should use server-side authorization and IAM.

## Migration boundary

If reporting later moves to a read replica, reporting store, or warehouse, preserve entity IDs, transaction IDs, event ordering, policy versions, audit links, and API response shapes. PostgreSQL remains the authoritative financial and operational database unless a separately approved and tested provider migration occurs.
