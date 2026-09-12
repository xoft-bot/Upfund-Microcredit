# Upfund Microcredit

Upfund is a branch-aware microcredit operations workspace for managing loan applications, disbursements, field collections, and portfolio reporting.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/upfund-microcredit/src/App.tsx` — imported/adapted frontend workspace and route surface
- `artifacts/upfund-microcredit/src/index.css` — Upfund visual language and responsive layout
- `artifacts/api-server/src/routes/portfolio.ts` — demo portfolio API and in-memory workflow actions
- `lib/api-spec/openapi.yaml` — source-of-truth contract for the portfolio API
- `lib/api-client-react/src/generated/` — generated React Query client and schemas

## Architecture decisions

- The frontend uses the generated API client rather than duplicating request types.
- The initial adaptation uses a small in-memory API dataset so the full workflow is usable immediately without provisioning external services.
- Currency and branch context are Uganda-specific (UGX, Kampala Central) to match the source product domain.

## Product

- Portfolio overview with metrics, application pipeline, repayment queue, and recent activity
- Application review, advancement, and disbursement flows
- Searchable client directory with client creation
- Field collection capture for cash and mobile money
- Reporting, role context, responsive navigation, and workspace preferences

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
