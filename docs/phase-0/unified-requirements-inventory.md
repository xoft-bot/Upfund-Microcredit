# Unified Requirements Inventory

## Product identity

The product is a configurable, auditable credit operating system for a Uganda-based microfinance operation serving informal businesses. It must support an initial pilot of approximately 30–50 borrowers, two or more officers, and one branch, while preserving a path to 5,000–10,000+ borrowers without rewriting the core architecture. It is not a simple CRUD loan application.

## Core business loop

The complete loop is prospecting, client onboarding, KYC, business and location verification, references or guarantors, risk assessment, application, approval, disbursement, daily collections, digital receipts, physical-logbook compatibility, reconciliation, allocation of collected income, cycle completion, credit reassessment, repeat lending, tier progression, recovery or write-off where necessary, and portfolio reporting.

## Economic rules

The platform must never equate gross charges with profit or available lending capital. It must separately track principal capital, gross contractual charges, collected charges, credit-loss reserve, operating reserve, collection costs, operating costs, taxes or regulatory provisions where applicable, net realized profit, retained profit, and deployable growth capital. Four conceptual pools are required: principal capital, credit-loss reserve, operating reserve, and growth/reinvestment capital.

All allocation percentages, product terms, tier thresholds, risk weights, approval limits, expense classifications, and notification thresholds must be configurable and versioned. Historical transactions must retain the policy version used when they were posted. Allocation policies shown in the diagrams are illustrative and inconsistent; they must not be hard-coded.

## Lending and risk

Loan products need configurable amount, range, tenure, repayment frequency, repayment days, pricing or charge, fees, grace periods, late-payment rules, renewal rules, exposure limits, score requirements, cycle requirements, and repayment requirements. Credit graduation must be a recommendation or review outcome, not an automatic increase based solely on completed cycles.

The risk system must calculate configurable credit scores, risk grades, PAR 1/7/30/60/90, default rates, late-payment rates, collection efficiency, recovery rate, write-offs, net credit loss, exposure, concentration, liquidity, and officer or branch anomalies. It must segment results by branch, officer, tier, product, business type, geography, cycle, and risk grade.

## Users and workspaces

Roles include super administrator, manager, branch manager, loan officer, collection officer, marketing officer, accountant, auditor, read-only analyst, and client. Permissions must be configurable and least-privilege. The major workspaces are administration, branch management, loan origination, field collection, finance and reconciliation, risk and portfolio management, marketing, reporting, client information, and audit.

Field interfaces must be mobile-first, low-bandwidth aware, and capable of controlled offline capture. Offline records require local transaction ID, timestamp, officer ID, client ID, amount, payment method, receipt number, and device ID where available. Synchronization must validate, detect duplicates, post once, update the ledger, and return confirmation.

## Financial integrity

The accounting foundation should be double-entry-compatible even if the pilot begins with a simpler ledger presentation. Financial records are append-only wherever possible. Corrections use reversal, adjustment, or correction entries rather than deletion or overwriting. Every loan, payment, receipt, client, and financial transaction has a unique identifier. Important actions generate immutable audit events with actor, timestamp, action, entity, old/new values where appropriate, device or IP metadata where appropriate, and approval/reconciliation information.

The system must support cash, bank, mobile-money, receivables, income, expenses, reserves, growth capital, capital contributions, withdrawals, recoveries, write-offs, and management summaries resembling an income statement, cash flow, balance-sheet-style view, portfolio report, and reconciliation reports.

## Data and integrations

The logical data areas are users, roles, permissions, clients, businesses, locations, KYC records, documents, references, guarantors, loan products, applications, loans, schedules, payments, receipts, collections, expenses, branches, officer assignments, scores, risk assessments, portfolio snapshots, reserve pools, capital contributions, ledger entries, write-offs, recoveries, notifications, audit logs, configuration, reports, and simulation results.

The integration boundary includes Firebase Authentication, Firestore or a relational financial store, Cloud Storage, server-side functions, App Check, messaging, SMS/USSD, mobile money, email, identity verification, maps/geolocation, Google Sheets backup/export, and possible future credit-bureau, ERP, and regulatory-reporting systems. External providers must be isolated behind adapters with idempotency, retries, failure states, provider references, and manual fallback.

Google Sheets is secondary backup/reporting only. The application database is the source of truth. Physical logbooks remain a field-level backup and reconciliation instrument during the pilot.

## Dashboards and routes

The proposed frontend route map includes login, dashboard, clients, client detail, KYC, applications, application detail, loans, loan detail, collections, reconciliation, credit scoring, risk, portfolio, PAR, capital, liquidity, accounting, expenses, reports, branches, officers, marketing, settings, audit, and notifications. Initial screens should prioritize the operational loop and role-specific dashboards rather than implementing every route as a fully featured module at once.

## Alerts and intelligence

Management alerts should cover PAR, net credit loss, operating-cost overruns, dangerous liquidity, insufficient reserves, collection declines, default increases, officer cash variance, excessive growth or capital utilization, and concentration by borrower, geography, business type, officer, or branch.

The optional AI/MCP layer should be read-only by default. It may query authorized portfolio statistics, risk summaries, collections, defaults, liquidity, capital recycling, CIR, operational metrics, reports, and alerts. It must not approve loans, disburse funds, delete or modify financial records, change credit limits, or alter accounting entries unless a separate human-approval workflow is deliberately introduced.

## Simulation and sustainability

A simulation engine should accept initial capital, clients, average loan, repayment period, gross charge, default and net-credit-loss rates, collection and staff costs, operating costs, growth rate, and repeat-borrower rate. It should project portfolio, revenue, losses, operating cost, net profit, growth capital, liquidity, CIR, PAR, borrower count, and loan capacity over 3, 6, 12, and 24 months.

The sustainability engine must report CIR, but must not declare self-sustainability from CIR alone. It should also calculate operational sustainability, credit sustainability, reserves, liquidity, current lending capacity, repeat-client capacity, new-client capacity, survival capacity if external capital stops today, and expansion capacity.

## Build-order requirement

Phase 0 must produce the PRD, schema, entity relationships, permissions matrix, financial calculation engine, credit-scoring rules, capital-allocation rules, API specification, architecture diagram, test fixtures, and decision log. The capital-allocation and financial-ledger engine should be finalized before dashboards are treated as authoritative. Later phases can add authentication/KYC, loans and collections, risk/PAR, accounting and capital recycling, management intelligence, AI/MCP, and simulation.

## Non-negotiable design decision

Frontend and backend agents may work in parallel only after the contract is defined. The shared source of truth is the GitHub repository, with typed API schemas, state machines, financial invariants, environment definitions, test fixtures, and CI checks. No agent should independently invent the business rules or silently replace the authoritative ledger.
