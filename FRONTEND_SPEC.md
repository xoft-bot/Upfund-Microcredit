# FRONTEND_SPEC.md — Upfund UI/UX Specification

**Version:** 1.1 — **LOCKED** (baseline `d75a631`; Phase 1 read API on `phase1-read-api`)
**Paradigm:** role-scoped **workspaces and queues**, not dashboards.
**Companion docs:** `HANDOFF.md` (backend/ops), `docs/stage-3-ui-spec.md` (superseded where this file differs; its financial-honesty rules are kept).

---

## 0. Ground rules for any agent implementing this

1. **The server is authoritative.** Hiding a nav item is UX; every route stays guarded by `requireRoles` / `requireBranchScope`. The client never computes ledger, allocation or PAR figures.
2. **Never imply money is posted before the server says so.** Queue and badge labels map 1:1 to real server states (section 3). No friendly synonyms for `posted`, `pending_reconciliation`, etc.
3. **Do not touch payment/ledger/reconciliation write paths** (`payment-posting.ts`, `reconciliation-posting.ts`, `ledger.ts`, `schedule.ts`). The redesign adds read endpoints and UI only.
4. **Build only what has data.** Every screen lists its endpoint in section 6. If the endpoint is `MISSING`, build the endpoint (with tests) in the same phase, or cut the screen.
5. **Every phase ends green:** `npx tsc --noEmit && npm test && npm run build`, and existing tests are not weakened.
6. **Low-end Android first.** Lazy-load routes, no heavy UI library, touch targets ≥ 44px, works on slow data. The offline queue and service-worker behaviour (`/api/` and `/health` never cached) must not regress.

---

## 1. Decisions log (final design calls)

### Adopted
| Idea | Decision |
|---|---|
| Workspaces + queues instead of dashboards | Adopted as the core paradigm. |
| Action Center home | Adopted. Counts come from a server aggregate endpoint, never from capped client lists. |
| Role-scoped left nav (hidden, not disabled) | Adopted for all **7** roles, including `client` and `marketing`, which the source documents omitted. |
| Status → queue chips with counts | Adopted, defined as explicit predicates over real enums (section 3). |
| Universal record template (banner + tabs) | Adopted with real tabs only (section 4.3). |
| Breadcrumbs + real URLs | Adopted; requires a router (currently none). |
| Global search | Adopted for clients (name, external ref), loans, applications, receipts. |
| "My Work" | Adopted **as a section of Overview**, not a separate module. It is the Action Center filtered to "assigned to me". |
| Collector card-stack + sync badges | Adopted; extends existing `CollectorRouteView` / offline queue. |
| Split-panel reconciliation | Adopted **in a different form** (section 5.3): batch payments vs submitted/recorded totals. |

### Changed
| Source proposal | Change and reason |
|---|---|
| Accountant has **Full** access to Reconciliation | Wrong vs. code. `/api/v1/reconciliations/post-batch` allows `admin`/`manager` only; accountants get **read-only** reconciliation + evidence. |
| "Loans › Ready to Disburse" as a status | It is `loan.status = approved`. Named as such in the API; label may be friendly. |
| Application queues "New / Needs Review" | Enum is `draft, submitted, kyc_verified, risk_assessed, approved, rejected`. Queues are predicates over these (section 3). |
| Audit tab with IP address and payload delta | `audit_events` has no IP column and only stores `metadata`. Tab shows actor, action, time, correlation id, metadata. IP is out of scope. |
| Cmd/Ctrl+K palette, `/` shortcut | Deferred to polish. Field staff are on phones. |

### Rejected / deferred (no data or no policy behind them)
| Item | Why |
|---|---|
| Two-column **bank / mobile-money statement** matching with confidence scores | No statement import exists and mobile money is shelved. Do not build a UI over data that does not exist. |
| **Documents** tab | No document storage exists (KYC evidence is a text field). |
| Branch selector / multi-branch switching | Actors have a single `branchId`; only `admin` can pass a branch. Admin-only branch filter, no user switcher. |
| Notification bell | No notification model. Replace with the Action Center. |
| Phone-number search | `clients` has no phone column. |
| "Re-schedule" loan action | No such command exists. |
| Loss & provision, tax/statutory, period close, "unbalanced journal" and "missing receipt" exception engine | Nothing in server code or migrations. Requires accounting-policy decisions first. Phase 6, not Phase 5. |
| PAR labels/figures beyond what `reporting.ts` already computes | Definition must be confirmed with accounting before any UI labels a number "PAR 30". |

---

## 2. Application shell and navigation

```
┌───────────────────────────────────────────────────────────────┐
│ UPFUND   [ Search clients, loans, applications, receipts ]  User·Role·Branch │
├──────────────┬────────────────────────────────────────────────┤
│ Role nav     │ Breadcrumb                                      │
│ (badges)     │ Page title · queue chips · primary action       │
│              │ Search + filters                                │
│              │ Content (queue table / workspace tabs)          │
└──────────────┴────────────────────────────────────────────────┘
```

- **Desktop:** persistent sidebar. **Mobile:** bottom bar for collector/officer (3–4 items), drawer for others.
- **Routing:** path-based (e.g. `/applications/review/APP-…`). `firebase.json` already rewrites `**` → `/index.html` and `sw.js` falls back to `/index.html`, so no hosting change is needed. Add `react-router-dom`; lazy-load each module.
- **Shell replaces** the current single-page composition in `client/src/main.tsx`. Existing dashboards are mounted inside the shell first, then split into workspaces.

### 2.1 Role → navigation (matches server route guards)

| Role | Nav |
|---|---|
| admin | Overview · Clients · Applications · Loans · Collections · Reconciliation · Reports · Accounting (read) · Admin |
| manager | Overview · Clients · Applications · Loans · Collections · Reconciliation · Reports |
| officer | Overview (My Work) · Clients · Applications · Loans · Collections (read) |
| collector | Today · My Loans · Capture · Sync · History |
| accountant | Overview (Control Room) · Reconciliation (read) · Ledger/Reports · Evidence |
| marketing | Overview (product reach, no client PII) · Reports |
| client | My Loans · My Applications · Apply |

"Admin" (users/roles/branches/products) has **no backend** today. Ship the nav item only when Phase 6 adds it.

---

## 3. Queue definitions (server-side predicates)

Queues are filters over existing enums. The label is UX; the predicate is the contract.

**Applications** (`application_status`: draft, submitted, kyc_verified, risk_assessed, approved, rejected)
| Queue | Predicate |
|---|---|
| Drafts | `draft` |
| In review | `submitted`, `kyc_verified`, `risk_assessed` (sub-stage shown as a column: Awaiting KYC / Awaiting risk / Awaiting decision) |
| Approved | `approved` |
| Rejected | `rejected` |
| All | no filter |

**Loans** (`loan_status`: approved, disbursed, active, overdue, defaulted, written_off, completed)
| Queue | Predicate |
|---|---|
| Ready to disburse | `approved` |
| Active | `disbursed`, `active` |
| Due today | open installment with due date = today (derived, needs schedule join) |
| Overdue | `overdue` |
| Defaulted | `defaulted` |
| Written off | `written_off` |
| Completed | `completed` |

**Collections / payments** (`payment_status`: recorded, pending_reconciliation, verified, posted, reversed)
| Queue | Predicate |
|---|---|
| Today | collected today (collector-scoped) |
| Pending sync | **client-side only** (IndexedDB offline queue) |
| Pending reconciliation | `recorded`, `pending_reconciliation`, `verified` (label each state honestly) |
| Posted | `posted` |
| Reversed | `reversed` |

**Reconciliation** (`reconciliation_status`: pending, matched, variance, approved, rejected)
Queues: Open (`pending`, `matched`), Variance, Approved, Rejected.

---

## 4. Patterns

### 4.1 Action Center (Overview)
1. **Needs attention:** count cards → queue links (from `GET /queues/counts`).
2. **My Work:** items assigned to the current user (see gaps: officer assignment).
3. **Performance strip:** only figures the server already computes (`/reports/*`).
4. **Recent activity:** 5–10 items.

### 4.2 List view
Queue chips with counts · search · explicit filters (branch [admin only], product, date range) · sort · server-side pagination with "Showing X–Y of N". Status is **never** also a dropdown.

### 4.3 Record workspace (one template)
Banner: `[Entity] [ref] — [name]` · status badge · one key figure · primary action. Tabs (only those with data):

| Entity | Tabs |
|---|---|
| Application | Summary · KYC & Risk · Timeline · Audit |
| Loan | Summary · Schedule · Payments · Timeline · Audit |
| Client | Summary · Applications · Loans |
| Reconciliation batch | Summary · Payments · Decision · Audit |

Breadcrumb: `Module / Queue / Record / Tab`. "← Back to <queue>" preserves filters and page.

### 4.4 Honest-status rule
Receipt and payment UI show "Pending reconciliation" until the server confirms `posted`. Variance approval states that it authorizes financial posting and requires confirmation with a reason (existing behaviour, retained).

---

## 5. Domain workspaces

### 5.1 Collector (mobile-first)
Route header (target vs collected from `/reports/collector`), sync badge (`Synced` / `N pending sync` with manual "Sync now"), card stack (overdue / due today / paid), tap card → loan → **Capture payment** (amount, method, save → queued locally, receipt preview marked pending). Reuse `CollectorRouteView`, `FieldCollectionForm`, `offlineQueue.ts`.

### 5.2 Officer
Overview = My Work (my clients, my applications by stage). Client → application workspace (KYC → risk → submit).

### 5.3 Manager reconciliation
Batch list (Open / Variance / Approved / Rejected) → batch workspace. Left: **submitted vs recorded vs expected** totals and variance. Right: the batch's payments with receipt references and status. Decision panel: reason + explicit confirmation. Reuses `ManagerVarianceDashboard` data contract.

### 5.4 Accountant
**Phase 5 = evidence view only**: posted activity, ledger/pool figures already in `/reports/accountant`, reconciliation decisions (read-only). Control-room exception engine is Phase 6.

---

## 6. Endpoint gap table

`EXISTS` = usable now · `EXTEND` = exists, needs changes · `MISSING` = build first.

| Screen / feature | Needed | Status | Notes |
|---|---|---|---|
| Session/identity + role | `GET /api/v1/session` | EXISTS | Single `branchId` per actor. |
| Overview lists | `GET /api/v1/portal/overview` | EXTEND | Hard `LIMIT 50` on apps/loans/clients; keep for back-compat, stop using for queues. |
| **Queue counts** (nav badges, Action Center) | `GET /api/v1/queues/counts` | **MISSING** | One aggregate call, branch/role scoped. Distinct from `/telemetry/queues` (ops health, not user work). |
| Applications queue | `GET /api/v1/loan-applications?queue=&q=&page=&pageSize=&product=&from=&to=` | **MISSING** | Currently POST only. |
| Application record | timeline `GET …/:id/timeline` | EXISTS | Need `GET /loan-applications/:id` (single record + KYC + risk) → **MISSING**. |
| Application actions | submit / kyc / risk / decision | EXISTS | |
| Loans queue | `GET /api/v1/loans?queue=&q=&page=…` | **MISSING** | "Due today" needs schedule join. |
| Loan record | `GET /api/v1/loans/:id` | **MISSING** | Schedule `GET …/:id/schedule` EXISTS; payments-for-loan list **MISSING**. |
| Loan actions | disburse / status | EXISTS | |
| Clients list/search/record | `GET /api/v1/clients?q=&page=` and `/:id` | **MISSING** | POST exists. Search by `display_name` / `external_ref` only. |
| Global search | `GET /api/v1/search?q=` | **MISSING** | Grouped: clients, loans, applications, receipts. Branch-scoped. Min 2 chars, rate-limited. |
| Collector today/route | `GET /collections/assigned-loans`, `/collections/queue`, `/reports/collector` | EXISTS | Queue capped at 100; add cursor in Phase 4 if needed. |
| Collector capture | `POST /api/v1/payments` | EXISTS | Idempotent; do not modify. |
| Payments queue (manager/officer) | `GET /api/v1/payments?status=&page=` | **MISSING** | |
| Receipts lookup | by reference | **MISSING** | `receipts` table exists; only via search. |
| Reconciliation queue | `GET /reconciliations/queue` | EXTEND | Add status filter (only open batches today?) + pagination + history. |
| Reconciliation decision | `POST …/post-batch` | EXISTS | admin/manager only. |
| Manager analytics | `GET /reports/manager` | EXISTS | |
| Accountant evidence | `GET /reports/accountant` | EXISTS | |
| Audit tab (per record) | `GET /api/v1/audit?entityType=&entityId=` | **MISSING** | Rows with `branch_id = NULL` (pre-017) are admin-only; other roles will see an empty history for old records. State this in the UI. |
| Officer "My Work" | applications/clients assigned to officer | **MISSING** | Only `collector_assignments` exists; officer ownership needs a definition (creator? assignee column?). Decision required. |
| Admin: users/roles/branches/products | CRUD | **MISSING** | Phase 6. |
| Notifications | — | **MISSING / cut** | Not planned. |
| Documents | — | **MISSING / cut** | Not planned. |
| Accounting exceptions, provision, tax, period close | — | **MISSING** | Phase 6, needs policy. |

All new read endpoints: `authMiddleware` + `requireRoles` + `requireBranchScope`, whitelisted query schema (`additionalProperties: false`), `pageSize` max 100, deterministic ordering (`created_at DESC, id DESC`), response `{ ok, data:{ items, total, page, pageSize }, correlationId, version }`, and tests covering: cross-branch denial, role denial, pagination bounds, and empty results.

---

## 7. Phases

| Phase | Scope | Backend | Exit criteria |
|---|---|---|---|
| **0. Contract** ✅ | Spec frozen; section 9 decisions locked | none | Done |
| **1. Read API** *(built; hardened in `phase1-fixes`)* | `queues/counts`, paginated `loan-applications`, `loans`, `clients`, `payments` (GET), `search`, single-record GETs, `audit` GET | read-only + tests | Branch/role denial tests; typecheck/tests green; no write path touched |
| **2. Shell + routing** | Router, role nav, breadcrumbs, existing dashboards mounted inside shell, count badges | none | Every role lands on a working home; deep links survive refresh on Firebase Hosting; SW unchanged |
| **3. Queues + record workspaces** | Applications, Loans, Clients queues; universal record template; global search UI | — | Existing lifecycle actions all reachable via new screens; old portal removed only after parity |
| **4. Collector mobile** | Route header, card stack, sync badges, capture flow inside shell | maybe cursor on `collections/queue` | Offline queue tests unchanged and passing; manual QA on a low-end Android |
| **5. Manager reconciliation + accountant evidence** | Batch workspace, read-only accountant views | reconciliation queue filters/pagination | Variance approval still manager/admin only; QA checklist per role passes |
| **6. Finance controls & admin** *(separate project)* | Exceptions engine, provision, tax, period close, admin CRUD | substantial | Requires written accounting policy first |

**Execution model:** an agent may run Phases 1→5 in order, one phase per branch/PR, each ending green. Do not batch phases into one PR. Troubleshooting happens between phases against the role QA checklist (`qa-checklist-per-role.md`), extended with the new screens.

---

## 8. Acceptance checklist (every screen, before merge)

- [ ] Breadcrumb shows `Module / Queue / Record / Tab`; URL is shareable and survives refresh.
- [ ] Nav shows only the current role's items; server still 403s the rest.
- [ ] Queue chips show server-side counts; status is not also a dropdown.
- [ ] List has search, filters, server pagination, "Showing X–Y of N".
- [ ] Primary action visible above the fold on a 360px-wide screen.
- [ ] Status labels map to real enum values; no "paid/posted" wording before server confirmation.
- [ ] Empty, loading and error states exist; 403 uses the structured `ApiRequestError.code`, not string matching.
- [ ] No new write endpoints in Phases 1–5; `npx tsc --noEmit && npm test && npm run build` pass.
- [ ] Route is lazy-loaded; no regression to offline queue or service worker.

---

## 9. Locked decisions (owner-approved)

1. **Officer ownership = `created_by`.** An officer sees applications they created, and loans/payments that trace to those applications. `clients` has no `created_by` column, so officers see all clients in their branch (an officer must be able to open a client they just created and start an application). A later migration may add `clients.created_by`; until then this is the documented exception.
2. **PAR:** the UI shows only figures and formulas already computed in `server/src/services/reporting.ts`. No new PAR definitions on the client. Anything labelled "PAR" must match that service.
3. **Client role scope:** My Loans, My Applications, Apply. Nothing else.
4. **Defense in depth:** every read query carries an explicit `branch_id` predicate (or a client/collector/officer ownership predicate), independent of RLS or the DB role. Implemented in one function, `scopeFor()` in `server/src/routes/readApis.ts`; new endpoints must use it and must not hand-write scope SQL.

Role visibility on read endpoints (implemented and verified against a real Postgres schema):

| Role | Applications | Loans | Clients | Payments | Audit | Search | Counts |
|---|---|---|---|---|---|---|---|
| admin | all (optional `?branchId`) | all | all | all | all | all | all |
| manager | branch | branch | branch | branch | branch | branch | branch |
| officer | own (`created_by`) | own | branch | own | own actions | own + branch clients | own |
| collector | denied | assigned only | denied | denied | denied | denied | assigned loans only |
| accountant | denied | denied | denied | branch | branch | receipts only | branch |
| client | own | own | denied | denied | denied | own | own applications/loans |
