# Upfund Authorization & Product Rules Matrix

Authoritative reference for how access control actually works in this codebase, reconciled against the
Manus ABAC proposal. Written after inspecting the real code (`server/src/middleware/auth.ts`,
`authorization.ts`, `readApis.ts`, `lifecycle.ts`, `state-machines.ts`, `payment-posting.ts`,
`reconciliation-posting.ts`, `collector-assignments.ts`, `ledger.ts`) and after the accompanying V1 patch
(self-approval guard + collector client-read scope). No generic rule-evaluator, no declarative permission
framework, no RLS migration — none of that is in scope here or in the patch.

---

## 1. Enforced Baseline Controls (Preserved)

These already existed, are already tested, and this patch did not touch them.

| Control | Where | What it does |
|---|---|---|
| Strict Firebase UID lookup | `server/src/middleware/auth.ts`, `resolveDatabaseUser` | Resolves the authenticated user by `firebase_uid` only — no email or raw-ID fallback. This was a deliberate fix for a real account-takeover vector; it must never be relaxed. |
| Single-branch scoping | `authorization.ts`, `requireBranchScope`; `readApis.ts`, `scopeFor` | Every non-admin user has exactly one `branchId`. Route-level `requireBranchScope` rejects a request whose target branch doesn't match; `scopeFor` additionally filters every list/detail query's `WHERE` clause by branch. |
| Officer `created_by` scoping | `readApis.ts`, `scopeFor` | For `application`, `loan`, `payment`, and `audit` reads, an officer is further filtered to rows tracing back to applications they created. Clients stay branch-wide for officers (no `created_by` column on `clients`, a deliberate design decision, not a gap). |
| Collector assignment scoping | `readApis.ts`, `scopeFor`; `payment-posting.ts` | A collector's visibility into `loan` and (as of this patch) `client` records is filtered through a live `collector_assignments` join, date-bounded by `effective_from`/`effective_to`. Posting a payment additionally checks for an active assignment at write time (`COLLECTOR_NOT_ASSIGNED`). |
| Reconciliation submitter ≠ decider | `reconciliation-posting.ts` | A batch's decider cannot be the same user who submitted it (`RECONCILIATION_SELF_APPROVAL`), and the payment set a decision applies to is locked to what was originally submitted (`sameFacts` membership check, not just amount totals). |
| Idempotency-key reuse handling | `payment-posting.ts` | Replaying a payment with the same idempotency key but a different payload returns `409 IDEMPOTENCY_KEY_REUSE_MISMATCH` rather than silently reapplying or silently returning success. |
| Double-entry ledger triggers | DB-level: `ledger_transactions_no_update`, `ledger_entries_no_update`, `ledger_entries_balanced` | Immutability and balance are enforced by Postgres triggers, independent of application code — the strongest guarantee in the system. An unbalanced or post-hoc-edited ledger entry cannot be written, full stop, regardless of what the application layer does. |
| Loan/application/KYC/payment state machines | `state-machines.ts` | Hard transition maps (`applicationTransitions`, `kycTransitions`, `loanTransitions`, `paymentTransitions`, `reconciliationTransitions`) — an illegal transition throws before any write happens. |

---

## 2. Immediate Security Fixes (V1 — shipped in this patch)

| Fix | Where | Rule |
|---|---|---|
| Self-approval guard on the application decision | `lifecycle.ts`, `decideApplication` | `actor.userId === application.created_by` → `403 FORBIDDEN_SELF_APPROVAL`. Applies regardless of role (admin included) and regardless of approve vs. reject. **Deliberately not applied to `reviewKyc` or `assessApplicationRisk`** — see the note below. |
| Extended collector client-detail read | `readApis.ts`, `scopeFor('client', …)` + new `clientDetailRoles` | `GET /api/v1/clients/:id` now allows `collector`, scoped to clients the collector has a live `collector_assignments` row for. The paginated `GET /api/v1/clients` list is unchanged — collectors still don't get a browsable client roster, only lookup of a specific assigned client. |

**Why the self-approval guard stops at the decision step, not KYC/risk too:** `role_permissions`
(migration 008) grants `officer` both `kyc.review` and `risk.assess`, but never `loans.approve` — only
`admin`/`manager` can call `decideApplication`. An officer reviewing KYC or assessing risk on an application
they themselves created is the existing, intended, tested workflow (an officer can never be the one to
approve a loan regardless of what else they did on it). Adding a creator-check to those two steps would have
broken that legitimate workflow (and the existing `underwriting.test.ts` coverage of it) for zero additional
security benefit — the only *reachable* self-approval path in the current permission model is a manager who
both creates and decides the same application, which is exactly what the guard now blocks.

---

## 3. Pending Product Decisions (Do Not Build Yet)

These require a stakeholder decision with an actual number or an actual scope boundary before any schema or
code work starts — building the mechanism ahead of the decision just creates an unpopulated, unenforced
control that looks safer than it is.

| Item | What's missing | What's needed before building |
|---|---|---|
| Approval-amount ceilings (`ApprovalAuthority`: `maxLoanAmountMinor`, `maxDisbursementAmountMinor`, `maxReconciliationVarianceMinor`) | No per-user or per-role amount limit exists anywhere today — every manager/admin has unlimited approval authority regardless of loan size. | Actual limit figures from the business, per role (and possibly per branch or per manager) — the same discipline already applied to PAR thresholds ("no new PAR definition without accounting sign-off"). |
| Accountant PII visibility scope on `clients`/`applications` | Accountant currently has real, working read access to `payments`, `reconciliation/queue`, PAR config, and reporting — but not to `clients`/`applications`/`loans` detail records. Manus's matrix assumes `POSTED_ONLY` accountant access to those too. | A product decision on exactly how much borrower PII (name only? full KYC dossier? nothing beyond what's already visible through payment/reconciliation evidence?) an accountant should see — this is a data-privacy scope question, not a permissions-plumbing question. |

---

## 4. Role-to-Resource Authorization Grid

| Role | Client | Application | Loan | Payment | Reconciliation | Ledger |
|---|---|---|---|---|---|---|
| **Admin** | Global read/write | Global read/write, decide¹ | Global read | Global read/write, reverse | Global read, approve/reject/post¹ | Global read/write |
| **Manager** | Branch read/write | Branch read/write, decide¹ | Branch read | Branch read/write, reverse | Branch read, approve/reject/post¹ | No direct write (only via posting flows) |
| **Officer** | Branch read (not `created_by`-scoped)² | Created-by read/write, submit, KYC review, risk assess | Created-by read | Created-by read | — | — |
| **Collector** | Assignment-scoped read³ | — | Assignment-scoped read | Assignment-scoped write (post), sync | Submit own collected batch⁴ | — |
| **Accountant** | — ⁵ | — ⁵ | — ⁵ | Global read (posted) | Read-only (queue + evidence)⁶ | Read-only |
| **Client** | Own record only | Own applications only | Own loans only | Own payments only | — | — |

**Footnotes:**
1. `NO_SELF_APPROVAL` — the actor deciding/approving/posting cannot be the same actor who created the
   application or submitted the reconciliation batch (Sections 1–2 above). Applies to admin too.
2. `clients` has no `created_by` column; officers see the full branch's client list by design, not just
   clients on applications they created — a deliberate exception to the officer-scoping pattern.
3. New in this patch: single-record lookup only (`GET /clients/:id`), assignment-scoped via
   `collector_assignments`. The paginated list stays admin/manager/officer-only.
4. Collector submits a batch; cannot approve/reject/post it (separation of duties — see Section 2 of the
   reconciliation self-approval control).
5. Not yet built — see Section 3 above ("Pending Product Decisions").
6. Accountant is explicitly denied `POST /reconciliations/post-batch` at the route level (admin/manager
   only) — read access to the queue is real and intentional, mutation access is not.

---

## 5. Deferred Architectural Items

Explicitly excluded from this phase and the reasoning for each — not oversights, deliberate scope cuts.

- **Generic `PermissionEvaluator` / declarative `PermissionRule` engine.** The current imperative approach
  (route-level preHandlers + `scopeFor()` + inline service-layer checks) is simpler, has a smaller blast
  radius per change, and every piece of it has been individually tested — several pieces were fixed from
  real production incidents (the reconciliation self-approval gap, the multi-installment payment waterfall,
  the payment-set lock). A declarative rule engine is a legitimate design for a much larger multi-tenant
  system; for Upfund's current size it would be strictly more code to produce the same behavior, and would
  introduce a new class of bug (misconfigured declarative rules) in place of bugs that are currently easy to
  find by reading one function.
- **PostgreSQL RLS as row-level filtering.** RLS is already on and forced on every application table, but
  every policy is `USING (true)` for the backend's connection role — its only real job is denying
  `anon`/`authenticated` direct database access, not filtering rows for the backend. The production
  connection authenticates as `postgres` with `rolbypassrls = true`, so RLS policies encoding
  branch/route/assignment predicates would be **dead code** against that role regardless of how correctly
  they're written — the backend would bypass them entirely. Real RLS filtering would additionally require the
  connection pool to `SET LOCAL app.user_id/app.branch_id/...` per request, which doesn't exist today. This is
  useful *later*, bundled with the already-flagged go-live item of moving the backend off the bypass-RLS role
  — not required now, and not something this phase's scope depends on.
- **Multi-branch users (`branchIds[]`) / multi-organization (`organizationId`) scoping.** No current Upfund
  user needs more than one branch; no current deployment has more than one organization. Building
  multi-valued scope now would mean a new `user_branches` join table and rewriting every `actor.branchId`
  call site in the codebase for a requirement that doesn't exist yet. Revisit only if a real multi-branch-user
  or multi-tenant requirement actually appears.
- **Route/zone as a first-class scoped entity (`routes` table, `assignedRouteIds`, `NO_CROSS_ROUTE`).**
  `collector_assignments.route_code` is a free-text field today; there's no `routes` table and no product
  requirement surfaced for a collector to hold multiple independently-scoped named routes. Not worth building
  speculatively.
