# Agent Handoff Prompts

## Handoff 0 — Planning gate

You are working only in `xoft-bot/Letsgrow-Microcredit`. Do not import or modify the investment-club repository. Read `docs/MASTER-PLAN.md` and every document under `docs/phase-0` before making changes. Do not write feature code until the PostgreSQL schema, ledger model, permissions, state transitions, API contract, environment matrix, threat model, and test plan are internally consistent. If a requirement is ambiguous, record a decision request rather than inventing a business rule.

## Handoff 1 — Coherent end-to-end skeleton

Build one connected skeleton rather than isolated frontend screens. Use React/Vite PWA for the frontend, a typed server API, Firebase Authentication for identity, PostgreSQL as the authoritative operational and financial store, and Firebase Hosting/Storage for the relevant platform services. Establish repository structure, environment validation, database migrations, authentication integration, RBAC boundary, health checks, error envelopes, correlation IDs, audit events, ledger primitives, idempotency, CI checks, and tests. Create a minimal non-monetary vertical slice proving authenticated user → authorized API → PostgreSQL → typed response → audit event. Do not add live mobile-money APIs.

The skeleton must be reviewable and runnable locally with documented commands. It must fail closed for unauthorized or invalid financial operations. No frontend code may connect directly to PostgreSQL.

## Handoff 2 — Frontend review and hardening

Review the existing frontend independently against the approved UX/UI plan. Build role-aware route shells, desktop management navigation, mobile-first field collection flow, typed hooks, loading/empty/error states, form validation, offline queue boundaries, and contract-compliant mock fixtures. Do not duplicate financial formulas in components. Use server-returned read models and command responses. Ensure the collector can identify today’s clients, expected amount, amount collected, outstanding amount, overdue days, risk indicator, and sync status with minimal navigation.

## Handoff 3 — Backend domain implementation

Implement the domain modules in sequence: clients/KYC/businesses, loan products, applications, approvals, disbursements, repayment schedules, manual cash/mobile-money collection recording, receipts, pending/reconciled status, daily officer reconciliation, branch reconciliation, and audit. Then add risk/PAR/graduation, recovery/write-offs, capital pools, allocation policies, expenses, liquidity, CIR, and sustainability. Every financial mutation is a server command with authorization, validation, idempotency, transaction boundaries, and append-only ledger postings.

## Handoff 4 — Integration

Connect the frontend to the development API using the same schemas as the mock transport. Verify complete workflows from client creation through collection and reconciliation. Test permissions for every role, branch isolation, client isolation, duplicate offline records, retries, provider failures, adjustment/reversal, and insufficient liquidity. Replace no business rule in the frontend to compensate for a backend mismatch; update the contract and tests instead.

## Handoff 5 — Production hardening

Before production, verify separate Firebase projects/environments, protected secrets, PostgreSQL backups and restore, Firebase Hosting preview isolation, CI/CD approvals, rules and API authorization tests, rate limits, dependency audit, log redaction, alerting, quota monitoring, outage runbooks, manual field fallback, and incident response. Live mobile-money APIs, identity verification, AI/MCP mutation, and advanced optimization remain later-stage additions unless separately approved.

## Required completion report from every agent

Every handoff must end with a concise report stating changed files, domain boundaries, schema/API changes, invariants preserved, permissions tested, environment used, tests run, known limitations, and any decision that requires human approval. No agent may claim production readiness based only on a successful build or a visually complete screen.
