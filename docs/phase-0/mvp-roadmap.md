# Unified MVP Roadmap

## Phase 0 — Contract and financial foundation

Deliver the PRD, entity relationship model, permission matrix, state-transition map, API contract, policy/versioning model, ledger posting rules, financial invariants, test fixtures, environment strategy, and architecture decision record. This phase must resolve the meaning of charge, income, reserve, expense, profit, and growth capital before dashboards become authoritative.

## Phase 1 — Controlled pilot operations

Implement authentication, users, roles, branches, client/prospect onboarding, KYC status, business and location verification, references, documents, configurable loan products, and basic audit logging. The pilot should work for roughly 30–50 borrowers and two officers without requiring every later portal.

## Phase 2 — Loan lifecycle

Implement applications, approval workflow, disbursement recording, configurable repayment schedules, loan states, digital receipts, payment commands, idempotency, and the first ledger postings. Add a basic admin and officer interface driven by the API contract.

## Phase 3 — Field collections and reconciliation

Implement the mobile-first collector workflow, assigned collections, expected/collected/outstanding amounts, partial and late payments, controlled offline capture, synchronization, receipt numbers, physical logbook fields, cash reconciliation, mobile-money references, variance review, and collection alerts.

## Phase 4 — Risk and portfolio control

Implement configurable scoring, risk grades, PAR 1/7/30/60/90, default and recovery states, concentration monitoring, fraud flags, credit-graduation recommendations, officer/branch segmentation, and management review queues. Do not automatically increase limits without configured policy and review.

## Phase 5 — Accounting and capital recycling

Implement the four pools, versioned allocation policies, expense management, capital contributions and withdrawals, write-offs, recoveries, double-entry-compatible journal structure, cash/bank/mobile-money reconciliation, realized net capital, CIR, liquidity, survival capacity, and self-sustainability status.

## Phase 6 — Management intelligence

Implement admin, branch, finance, risk, and reporting dashboards; daily/weekly/monthly reports; CSV export; Google Sheets backup/export; notifications; concentration alerts; and performance drill-downs. All dashboards consume shared read models from the ledger and portfolio engines.

## Phase 7 — AI and advanced analytics

Add a read-only AI/MCP layer over authorized aggregate and operational data. Add natural-language portfolio questions, risk explanations, alerts, and report summaries. Any mutation requires a separate human approval workflow with explicit permissions and audit records.

## Phase 8 — Simulation and scale hardening

Add 3/6/12/24-month portfolio simulation, scenario testing, forecasting, portfolio optimization, load testing, disaster recovery drills, stronger observability, and a deliberate assessment of whether the ledger should move to or be supplemented by PostgreSQL while Firebase continues to provide hosting, authentication, storage, and selected realtime capabilities.

## Definition of done for the pilot

The pilot is not complete when the screens look polished. It is complete when a real authorized operator can onboard a client, verify KYC, create and approve a loan, record a disbursement, collect and receipt daily payments, reconcile physical and digital records, correct an error without deleting history, see the resulting ledger and capital pools, identify overdue exposure, and export a defensible operational report.
