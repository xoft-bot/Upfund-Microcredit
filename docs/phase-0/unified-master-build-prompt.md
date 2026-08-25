# Unified Master Build Prompt

Build the **Progressive Credit and Microfinance Operating System** described in the Phase 0 documents in this directory. Treat the original concept, the first architecture diagrams, and the additional diagrams as one specification. Do not build a simple CRUD loan app.

The system serves a Uganda-based short-cycle lender working with informal businesses. It must operate for an initial pilot of approximately 30–50 borrowers, one branch, and a small officer team, while preserving an architecture path to thousands of clients. It must support onboarding, KYC, business and location verification, references and guarantors, configurable loan products, approval, disbursement, daily collections, digital receipts, offline field capture, physical-logbook reconciliation, recovery, write-offs, risk, PAR, credit graduation, accounting, four capital pools, liquidity, profitability, management dashboards, reports, alerts, backup, and a read-only AI analytics layer.

Use the existing repository foundation where appropriate, but keep legacy investment-club semantics separate from the new microfinance domain. Reuse infrastructure patterns only after checking that their rules and formulas do not conflict with this specification.

## Non-negotiable financial rule

Never treat gross loan charges as profit or available lending capital. Distinguish principal capital, contractual charge, collected charge, credit-loss reserve, collection cost, operating cost, tax/regulatory provision where applicable, realized net profit, retained profit, and deployable growth capital. Maintain principal, credit-loss, operating, and growth/reinvestment pools. Only realized eligible surplus may increase sustainable lending capacity.

Build the financial ledger and capital-allocation engine before treating dashboards as authoritative. Use append-only financial history, unique IDs, idempotency, reversal/adjustment entries, policy-version snapshots, server-side authorization, and immutable audit events. Never delete or overwrite financial history.

## Required architecture

Use a mobile-first React/TypeScript frontend with a route/workspace model, Firebase Authentication, Firestore or a carefully designed relational supplement, Cloud Storage, server-side functions or services, App Check, messaging, GitHub version control, Firebase Hosting, and secondary Google Sheets export/backup. Keep financial commands behind an API or callable-function boundary. Do not permit client-side writes to authoritative financial records.

The shared contracts are `unified-requirements-inventory.md`, `permissions-matrix.md`, `api-contract-outline.md`, `financial-ledger-spec.md`, `mvp-roadmap.md`, and `existing-repository-gap-analysis.md`. Any implementation must conform to them or update them through review.

## Required delivery sequence

First produce and review requirements, schema, relationships, permissions, state transitions, financial invariants, API schemas, allocation policies, and test fixtures. Then implement authentication, roles, clients, KYC, businesses, and loan products. Next implement applications, approval, disbursement, schedules, payments, receipts, collections, offline synchronization, and reconciliation. Then add risk/PAR/credit graduation, followed by accounting/capital recycling/liquidity/CIR/self-sustainability, management intelligence, AI/MCP, and simulation.

## Acceptance criteria

The system is not accepted because it looks polished. An authorized operator must be able to onboard a client, verify KYC, create and approve a loan, record a disbursement, collect and receipt payments, reconcile physical and digital records, correct a mistake without deleting history, see ledger-derived capital pools and liquidity, identify overdue exposure, and export a defensible report. The same workflow must be covered by automated tests and work with configured permissions and audit events.
