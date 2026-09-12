# Upfund Microcredit

A branch-aware microcredit operations platform for managing clients, loan applications, disbursements, field collections, reconciliation, and reporting.

## Run & Operate

- `pnpm --filter @workspace/upfund-microcredit run dev` — run the imported web app
- `pnpm --filter @workspace/api-server run dev` — run the preview API
- `pnpm run typecheck:artifacts` — build shared declarations and check the active web/API artifacts
- `pnpm run typecheck` — check the production-oriented `client` and `server` source
- `pnpm run build` — build the production-oriented client/server source
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI
- `pnpm run db:migrate` / `pnpm run db:check` — apply and verify PostgreSQL migrations for the production-oriented server

The active preview is routed through the artifact services at `/` (web) and `/api` (API). The repository also retains a separate production-oriented `client` + `server` path for Firebase Hosting and Render deployment.

## Stack

- pnpm workspaces, TypeScript, React, and Vite
- Preview API: Express 5 with generated Zod contracts
- Production-oriented API: Fastify with PostgreSQL and Firebase Admin authentication
- Database: PostgreSQL migrations under `migrations/`
- API contracts: `lib/api-spec/openapi.yaml`, generated into `lib/api-client-react` and `lib/api-zod`

## Where things live

- `artifacts/upfund-microcredit/` — active Upfund web experience and UI components
- `artifacts/api-server/` — active preview API with portfolio, client, application, loan, and collection routes
- `lib/api-spec/` — OpenAPI source of truth and Orval code generation
- `lib/api-client-react/` — generated React Query client used by the active web app
- `lib/api-zod/` — generated server-side schemas
- `client/` and `server/` — production-oriented PWA and Fastify backend
- `migrations/` — ordered PostgreSQL schema and financial workflow migrations
- `tests/` — unit, integration, workflow, offline queue, and runtime coverage
- `docs/` — architecture, deployment, security, and handoff documentation
- `shared/` — contracts and version values shared by the production-oriented path

## Architecture decisions

- PostgreSQL is the authoritative source for financial state; ledger and payment operations are transactional and idempotent.
- Firebase is used for identity; server-only Firebase Admin credentials must never enter the Vite client bundle.
- Field collection supports offline queuing, but the server remains responsible for posting, allocation, and ledger calculations.
- Branch scope and role checks are enforced on protected production-oriented routes.
- The preview artifact uses generated contracts and deterministic sample data so the UI can be explored without live credentials or a database.

## Product

The app provides a branch overview, application review, client directory, collection recording, reporting, role context, and operational status feedback. The production-oriented path also includes reconciliation, lifecycle, telemetry, accountant reporting, and collector workflows.

## User preferences

No project-specific preferences recorded.

## Gotchas

- Build the shared library declarations before checking artifact packages; use `pnpm run typecheck:artifacts`.
- Do not use production Firebase credentials, borrower data, payment providers, or identity documents in local/test environments.
- Production database changes must preserve ordered migrations, append-only financial history, double-entry balancing, idempotency, and server-side authorization.
- The root `client` + `server` path and the artifact preview path are separate runtime surfaces; update the relevant surface deliberately.

## Pointers

- `HANDOFF.md` — current implementation and deployment handoff
- `docs/DEPLOYMENT-RENDER-FIREBASE.md` — production deployment boundary
- `docs/ARCHITECTURE-AUDIT.md` — architecture review
- `docs/SECURITY-THREAT-MODEL.md` and `threat_model.md` — security constraints
