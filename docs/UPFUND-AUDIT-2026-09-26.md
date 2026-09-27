# Upfund Microcredit Architecture, Security, and Live Audit

**Audit date:** 2026-09-26  
**Scope:** workspace source, dependency state, security scans, local integration tests, Firebase Hosting, and the Render API  
**Production data policy:** no production users, payments, loans, or database rows were created or changed

## Executive summary

The active Upfund application has a sound split architecture:

- Firebase Hosting serves the React PWA.
- Firebase Authentication establishes the user identity.
- The Render Fastify service resolves the application user strictly by `firebase_uid`.
- PostgreSQL remains the server-authoritative source for roles, branch scope, client scope, queues, ledger state, and reconciliation.
- Offline collection records are bound to the authenticated user namespace before queue records are accessed.

The local workspace is in a verified state. TypeScript, lint, the full test suite, the production build, and the production dependency audit pass. The three security scanners report no active SAST or privacy-flow findings. The platform dependency scanner still reports old package versions that are absent from the current pnpm lockfile and cleaned install; this is documented below rather than addressed with unsafe overrides.

The main remaining gap is operational: the local `/api/v1/branches` endpoint and branch selector are implemented and tested, but the deployed Render API still returns `404` because these changes have not been published. Authenticated live end-to-end behavior also remains unverified because no approved non-production Firebase test account/token was available. No production account was created to bypass that limitation.

## Architecture findings

### Confirmed controls

1. **Authentication and authorization are separated correctly.** Firebase supplies the bearer identity; the API resolves the active application user by Firebase UID and uses database-backed role, branch, client, and permission fields for authorization.
2. **Branch scope is enforced server-side.** Non-admin users cannot select another branch by changing a query parameter. Admins can receive the complete branch list and select a specific branch for branch-scoped queues and reconciliation.
3. **Offline queue isolation is explicit.** Queue storage is bound to the current Firebase user before queued records are read or retried. Storage failures emit telemetry instead of becoming silent failures.
4. **Counts and protected reads remain server-authoritative.** Unauthenticated requests to the session and queue-count endpoints return `401`.
5. **Reconciliation controls remain intact.** The existing self-approval, payment-set locking, idempotency, and ledger tests pass. No protected accounting or posting files were changed in this audit.
6. **Public API caching is not enabled.** `/api/` and `/health` remain uncached.

### Local changes verified

- Added `GET /api/v1/branches` with role and branch-scope enforcement.
- Added the authenticated branch selector with URL persistence.
- Refreshed collection and reconciliation data when the selected branch changes.
- Added route tests for admin visibility, own-branch visibility, and non-admin spoof rejection.
- Made authorization guards return immediately after sending a denial.
- Removed Firebase-linked email addresses and UIDs from test-account seed logs.
- Sanitized database health fallback diagnostics.
- Added telemetry for queue user-binding and device-ID storage failures.
- Removed the duplicate root `package-lock.json`; pnpm is now the authoritative package manager and documentation uses pnpm commands.
- Hardened the tracked legacy starter API so its CORS default is deny-by-default rather than unrestricted.

## Security results

### Scanner results

| Scanner | Result | Notes |
|---|---:|---|
| SAST | 0 findings | The legacy starter CORS finding was fixed; the final scan is clean. |
| HoundDog privacy/security flow scan | 0 findings | Earlier Firebase-linked logging findings were removed. |
| `pnpm audit --prod` | 0 vulnerabilities | No production dependency advisories remain. |
| Platform dependency audit | 0 critical, 8 high, 5 moderate, 2 low reported | The reported high/low package versions are not in `pnpm-lock.yaml` or the cleaned `node_modules`; see the resolution note below. |

### Dependency resolution note

The active lockfile and clean install resolve the previously reported package families to safe versions:

- `brace-expansion` 5.0.12
- `fast-uri` 4.1.3
- `js-yaml` 4.3.2
- `nanoid` 6.0.1
- `qs` 6.16.0

The platform scanner continued to report old versions such as `brace-expansion` 5.0.8 and `fast-uri` 3.1.4 after `node_modules` was removed and reinstalled from the frozen pnpm lockfile. Those directories are absent from the clean install. The scanner output should therefore be treated as stale or workspace-scope mixed data until its dependency-tree input is refreshed.

The authoritative full `pnpm audit` reports three moderate **development-only** advisories:

- `@opentelemetry/core` through `firebase-tools`, fixed in 2.8.0 and requiring a major upgrade.
- Vitest and `@vitest/mocker`, fixed in Vitest 4.1.11 and requiring a major upgrade.

They are not present in the production dependency graph. Upgrading them was intentionally deferred because both are development tooling, the proposed changes are major-version changes, and the conservative audit goal was to avoid changing tested runtime behavior without a compatibility pass.

## Live verification

| Check | Result |
|---|---|
| Firebase Hosting `/` | `200` |
| Firebase Hosting `/manifest.webmanifest` | `200` |
| Render `/health` | `200`, database reported `up` |
| Trusted Firebase CORS preflight | `204`, `Access-Control-Allow-Origin: https://upfund-microcredit.web.app` |
| Untrusted CORS preflight | `204`, no allow-origin header |
| Render `/api/v1/session` without token | `401 UNAUTHENTICATED` |
| Render `/api/v1/queues/counts` without token | `401 UNAUTHENTICATED` |
| Render `/api/v1/branches` | `404`; the local route has not been deployed |

An authenticated live flow was not attempted with a newly created or guessed account. A least-privilege non-production Firebase account and token are required to verify session resolution, branch visibility, branch switching, collection queue reads, and reconciliation reads against the deployed service.

## Verification evidence

All final local checks passed on Node `v24.12.0` with pnpm `10.26.1`. The repository declares Node `>=20.0.0 <22.0.0`; the Node 24 engine warning is an environment mismatch and should be resolved by running CI/deployment checks on the declared Node range.

- TypeScript typecheck: pass
- ESLint: pass
- Tests: **26 files, 182 tests passed**
- Production build: pass
- Production dependency audit: **0 vulnerabilities**
- Git diff check: pass

The full tests include the database-backed payment, reconciliation, reporting, and idempotency coverage. The offline queue test file was not modified and its nine tests pass.

## Remaining risks and next actions

1. **Publish the local branch-scope changes** before admin users depend on branch selection. After publication, repeat the public smoke checks and the protected route checks.
2. **Run authenticated live E2E checks** with an approved non-production Firebase test account. Do not create or mutate production users during that verification.
3. **Review the two development-tool major upgrades** in a separate compatibility change, then rerun the full test/build/audit sequence.
4. **Run CI and deployment verification on Node 20 or 21** to match the declared engine range; the current local environment is Node 24.
5. **Keep `.import-backup` registered artifact handling explicit.** It remains tracked because configured preview artifacts reference it; it was hardened rather than deleted during this audit.
