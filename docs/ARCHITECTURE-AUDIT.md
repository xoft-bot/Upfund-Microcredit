# Architecture and Workflow Audit

**Audit date:** 2026-08-31  
**Scope:** Firebase-hosted PWA, Render API, Supabase PostgreSQL, offline field workflow, and the imported workspace.

## System data flow

1. **Browser/PWA:** Firebase Hosting serves the static React client from `client/dist`. The browser uses the Firebase Web SDK for email/password sign-in and receives a Firebase ID token.
2. **Authenticated API request:** The client sends the ID token as `Authorization: Bearer <token>` to the Render API. Same-origin development requests are proxied from the Vite client; production requests use the configured API base URL.
3. **Identity and authorization:** Fastify verifies the token with Firebase Admin, checks revocation, resolves the Firebase UID against an active PostgreSQL user, and derives role, permissions, branch, and client scope from database records. Firebase claims are not the authorization source.
4. **Business transaction:** Authorized route handlers validate request shapes, enforce role/branch/client scope, and execute parameterized SQL. Financial writes run in PostgreSQL transactions and append ledger/audit records with correlation IDs and idempotency keys.
5. **Database:** The Render process connects to Supabase PostgreSQL through a pooled TLS connection. Health checks execute `SELECT 1`; reconciliation uses a PostgreSQL advisory lock so only one scheduler instance processes a cycle at a time.
6. **Offline field operations:** The PWA stores collection state and events in IndexedDB, falls back to localStorage when IndexedDB is unavailable, and retries queued payments after authentication or when the browser returns online. The server remains authoritative when queued records are posted.

## Public and protected surfaces

- Public: `GET /health` and the static Firebase Hosting shell.
- Authenticated: session, portal, collection, reporting, payment, lifecycle, reconciliation, and telemetry endpoints.
- Privileged: manager/admin reconciliation decisions, accountant reporting, and operational telemetry are enforced server-side.
- The service worker caches static shell requests only and explicitly excludes `/api/` and `/health`.

## Capacity and free-tier risks

- **Render cold starts:** autoscaling or sleeping instances can make the first health/API request slow. The client polls health every 30 seconds, so it should show an unavailable state during a wake-up rather than treating stale data as live.
- **Supabase connection limits:** the API defaults to a maximum pool of 5 connections and caps configuration at 10. This is conservative for small tiers, but concurrent reporting, reconciliation, and payment traffic can queue at the pool; monitor `waiting` and `idle` pool metrics.
- **Pooler requirement:** production configuration requires the Supabase transaction pooler port `6543`. A direct database port or incorrect TLS/network policy will pass configuration parsing only if the URL is syntactically valid but will fail the runtime `SELECT 1`.
- **Long-running scheduler:** the reconciliation timer is disabled unless explicitly configured and requires a valid actor UUID and interval of at least 60 seconds. Render restarts or sleeps can delay cycles; the advisory lock prevents duplicate work but is not a durable job queue.
- **Request rate limits:** Fastify applies a process-local limit of 60 requests per minute. Multiple instances have independent counters, so this is a basic abuse control rather than a global quota.
- **Browser storage limits:** IndexedDB/localStorage are device/browser resources. A storage failure is surfaced to the collector UI; queued records must not be considered posted until the API returns a successful, idempotent result.

## Audit results

- Render health was reachable on 2026-08-31 and reported `database: up`.
- Firebase Hosting returned the expected PWA shell with HTTP 200.
- CORS preflight from `https://upfund-microcredit.web.app` returned the matching `Access-Control-Allow-Origin`.
- A preflight from an untrusted origin returned no `Access-Control-Allow-Origin`.
- Protected API routes returned `401 UNAUTHENTICATED` without a bearer token.
- A complete authenticated production mutation was not attempted because no test Firebase user credentials were available; creating or mutating a production user would be unsafe for an audit.

## Remediation completed

- Upgraded direct Fastify, Vite, Firebase Admin, ESLint, and tsx dependencies to maintained Node 20-compatible releases.
- Removed the imported starter scaffold backup and its duplicate managed workflows.
- Replaced the unused `ALLOWED_ORIGINS` runtime key with the server's actual `CORS_ORIGINS` key.
- Added observable telemetry for token-claim failures, service-worker registration failures, and queue-loop failures.
- Added PostgreSQL pool closure and rejection handling to graceful shutdown.

## Remaining operational recommendations

1. Add a dedicated non-production Firebase test account mapped to a least-privilege database user for repeatable authenticated smoke tests.
2. Monitor Render latency, restarts, and scheduler executions together with Supabase pool waiters and connection saturation.
3. Move reconciliation to a durable external scheduler/queue if missed cycles become unacceptable under sleeping or autoscaling instances.
4. Keep production build and Render deployment on Node 20 until the application is intentionally migrated and tested on Node 22.