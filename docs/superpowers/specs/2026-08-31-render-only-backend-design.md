# Render-only Backend and Firebase Hosting Design

## Status

Approved for implementation on 2026-08-31.

## Goal

Separate the deployed application into:

- A React/Vite PWA built and hosted by Firebase Hosting.
- A Fastify/Node.js API deployed as a Render Web Service.
- PostgreSQL hosted by Supabase and reached by the Render service.
- Firebase Authentication used by the PWA and verified by the API.

Firebase Cloud Functions are retired from the production path. The legacy
payment provider is removed entirely because the current financial flow is server-authoritative and
manual/mobile-money payment methods are already represented without that
provider.

## Runtime boundary

The existing Fastify application remains the API implementation. Its standalone
entry point will:

- Listen on `process.env.PORT`, defaulting to `10000` for a Render-compatible
  production process and remaining compatible with local development.
- Bind to `process.env.HOST` or `0.0.0.0`.
- Expose `/health` without authentication.
- Return HTTP 200 with `database: "up"` when PostgreSQL responds to `SELECT 1`.
- Return HTTP 503 with `database: "down"` when the database check fails.
- Use `DATABASE_URL` first and `PGURI` as a compatibility fallback.
- Compile to executable JavaScript under `dist/server`; `npm run start` will
  execute the compiled server rather than requiring `tsx` in production.

Production CORS will read `CORS_ORIGINS` as a comma-separated list of exact
HTTPS origins. Wildcards, non-HTTPS origins, paths, queries, and fragments are
rejected in production. Development may use the existing local origin
configuration.

## Frontend and hosting

The Vite build output remains `client/dist`, which Firebase Hosting serves.
`firebase.json` will contain only the Hosting configuration and the SPA
fallback. It will not reference Firebase Functions.

The client API service will use `VITE_API_BASE_URL` as an optional absolute API
origin. When unset, it will use relative paths, which preserves the local
Vite-to-Fastify proxy and allows same-origin hosting configurations. Production
Firebase builds will set the variable to the deployed Render URL; the URL will
not be invented or committed as a placeholder.

The Vite development server will continue proxying `/api` and `/health` to the
local Fastify port. Static assets, the manifest, and the service worker remain
part of the PWA build.

## Removal boundaries

The Firebase Functions wrapper, its package and build configuration, and its
Firebase deployment block will be removed. Firebase client/Admin
Authentication code remains because it is required for identity.

All legacy provider-specific code and configuration will be deleted, including the
webhook route/service, tests, environment variables, secret declarations,
documentation references, and the direct dependency if one exists. No generic
payment posting or reconciliation behavior will be removed.

## Database readiness and seeding

The schema check will use one canonical list of 25 required custom tables and
report the actual count accurately, including `collector_assignments`.

The approved JSON seed remains fail-closed, transactional, and idempotent.
`ADMIN_FIREBASE_UID` will optionally add or update one administrator identity:

- The value must be a non-empty Firebase UID.
- The seed requires explicit approved input and an existing branch/role
  context when those fields are needed by the current schema.
- The administrator is identified by Firebase UID and a stable UUID, not a
  fabricated email, name, financial record, branch, or token.
- Re-running the seed updates the existing admin mapping rather than creating a
  duplicate.

`DATABASE_URL` and `PGURI` will both be documented for Supabase/Render
configuration, with secrets kept outside Git.

## Testing and verification

Tests will cover:

- Render-style port and compiled-server startup.
- Health success and database failure status codes.
- `DATABASE_URL`/`PGURI` selection and strict `CORS_ORIGINS`.
- `VITE_API_BASE_URL` URL construction.
- Firebase Hosting configuration without Functions.
- The absence of legacy provider paths/configuration.
- Accurate 25-table schema reporting.
- Approved, idempotent admin UID seeding and rejection of invalid input.

The implementation is complete only when `npm run build`, `npm test`,
`npm run lint`, `npm run db:check`, and a production-like `/health` smoke check
pass.

## Commit and synchronization workflow

Each cohesive implementation slice will be:

1. Changed and tested.
2. Committed with a focused message.
3. Pushed to `origin/main`.
4. Confirmed with `git status` and `git log` against the remote.

No force-pushes or unrelated user-provided attachments will be used.