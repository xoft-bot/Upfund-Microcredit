# Threat Model

## Project Overview

Upfund Microcredit is a React progressive web app for branch-scoped loan servicing,
field collections, reconciliation, and reporting. Firebase Hosting serves the browser
client, Render runs a Fastify Node.js API, Firebase Authentication establishes identity,
and Supabase PostgreSQL stores authoritative operational and financial data.

## Assets

- **Firebase identities and ID tokens** — compromise enables account impersonation and
  access to the privileges mapped to that identity.
- **Borrower and loan data** — names, client references, schedules, payments, receipts,
  and collection records are sensitive personal and financial data.
- **Ledger and reconciliation records** — integrity matters more than availability because
  these records drive cash accountability and financial reporting.
- **Database and Firebase service credentials** — server-side secrets can grant broad
  access to the application data plane and must never enter the browser bundle.
- **Offline device data** — IndexedDB/localStorage can contain queued collection records
  while a field device is offline and must be treated as sensitive local data.

## Trust Boundaries

- **Browser to Render API** — the client is untrusted; every protected request must carry
  a verifiable Firebase token and pass server-side authorization.
- **Firebase Authentication to Render** — Firebase proves the external identity, while the
  database mapping supplies the active user, role, permissions, and branch/client scope.
- **Render API to Supabase PostgreSQL** — the API holds the database credential and must
  use parameterized queries, TLS in production, transactions, and bounded pooling.
- **Authenticated user to privileged operation** — managers, admins, accountants, and
  collectors have different server-enforced capabilities and data scopes.
- **Offline browser storage to server reconciliation** — local records are untrusted
  until validated, authorized, and posted idempotently by the API.

## Scan Anchors

- Production entry points: `server/src/index.ts`, `server/src/app.ts`, and
  `client/src/main.tsx`.
- Highest-risk areas: `server/src/middleware/auth.ts`,
  `server/src/middleware/authorization.ts`, payment/reconciliation services, and
  `server/src/db.ts`.
- Public surface: `/health` and Firebase Hosting static assets.
- Authenticated/privileged surface: `/api/v1/*` routes and the legacy stage-one ledger
  command in `server/src/app.ts`.
- Dev-only areas: `tests/`, `migrations/`, `attached_assets/`, and
  `artifacts/mockup-sandbox/`; they are not part of the Render API runtime.

## Threat Categories

### Spoofing

The API must verify Firebase ID tokens with revocation checking and reject missing,
malformed, or invalid bearer tokens. A Firebase UID alone is not sufficient authorization:
the UID must resolve to an active database user. Production must use live Firebase Admin
credentials, never the mock token verifier.

### Tampering

The browser may submit payment, lifecycle, and reconciliation commands, but it cannot
choose its own role or widen its branch/client scope. The API must validate request
schemas, enforce state transitions, use parameterized SQL, and perform financial writes
inside transactions with idempotency protections and balanced ledger entries.

### Repudiation

Sensitive commands must write audit events containing the acting database user,
correlation ID, entity, action, and safe metadata. Telemetry and audit responses must
mask identifiers and secrets rather than exposing raw database records.

### Information Disclosure

Production CORS must allow only configured HTTPS origins. API error responses must use
safe messages and correlation IDs without stack traces or database credentials.
Firebase Admin credentials and database URLs must remain server-only; public Firebase
web configuration values are identifiers, not authorization secrets. Offline storage,
logs, and telemetry must not expose borrower or token data.

### Denial of Service

Public health checks should remain lightweight. API request bodies and query parameters
must be schema-bounded, rate limiting must remain enabled, database queries must be
bounded/paginated, and connection pools must stay within the Supabase tier limit.
The in-process reconciliation timer must remain opt-in and protected by an advisory
lock; a durable scheduler is recommended for reliable production processing.

### Elevation of Privilege

Role, permission, branch, and client checks must remain server-side on every protected
route. Claims may provide identity context but must not replace database permission
resolution. Any new portal or report must define its scope explicitly and reject
cross-branch overrides for non-admin users.