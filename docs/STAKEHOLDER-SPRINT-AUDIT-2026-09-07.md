# Upfund Microcredit Stakeholder Sprint Audit

**Audit date:** 2026-09-07  
**Scope:** RLS hardening, controlled underwriting, assigned-loan collection capture, CI quality gates, database verification, and frontend deployment.

## Executive summary

The sprint implementation is present in the workspace and has been verified locally. The production Supabase schema includes Migration 015 with row-level security enabled and forced on all 28 custom application tables. The underwriting integration suite covers the Migration 014 timeline and evidence fields, the risk-assessment approval gate, and the Migration 015 RLS state. Field officers and collectors now select assigned loans from a server-backed dropdown instead of entering free-form client and loan identifiers.

## Delivered controls

| Area | Evidence | Result |
| --- | --- | --- |
| CI quality pipeline | `.github/workflows/ci.yml` | Runs on pushes and pull requests targeting `main`; installs with the frozen pnpm lockfile, then runs typecheck, lint, tests, and build on Node 20. |
| Database security | `migrations/015_enable_rls.sql` | Enables and forces RLS on all 28 custom tables, grants backend access to available `postgres` and `service_role` roles, and revokes direct table access from public browser roles. |
| Underwriting controls | `tests/integration/underwriting.test.ts` | Verifies the application timeline, KYC evidence notes, risk rationale/timestamps, the RLS catalog state, and the `RISK_ASSESSMENT_REQUIRED` approval guard. |
| Assigned-loan collection capture | `server/src/routes/collectionQueries.ts`, `server/src/services/collector-reporting.ts` | Provides an authenticated `/api/v1/collections/assigned-loans` endpoint scoped to the officer or collector’s branch and assignments. |
| Field collection UX | `client/src/components/field/FieldCollectionForm.tsx`, `client/src/services/api.ts` | Loads assigned loans after Firebase session resolution and renders a required selector with client, route, and outstanding-principal context. |

## Database verification

- Supabase project: `upfund microcredit` (`xswscmiosovflvodhzpp`).
- Migrations 001 through 015 are recorded in Supabase.
- Production verification found all 28 custom tables with `relrowsecurity = true` and `relforcerowsecurity = true`.
- Each table has backend policies for the available server roles.
- The local `DATABASE_URL` points to Replit development PostgreSQL (`helium`), so local `pnpm run db:migrate` and `pnpm run db:check` validate the local test database. Production DDL was applied through the authorized Supabase migration API.

## Verification results

- TypeScript typecheck: passed.
- ESLint: passed.
- Test suite: 18 test files passed; 84 tests passed; no skipped tests after local schema initialization.
- Production build: passed; Vite generated the client bundle and the server TypeScript build completed.

## Deployment

Firebase Hosting is configured for the production PWA at:

<https://upfund-microcredit.web.app>

The live Firebase channel was previously confirmed at that URL. A final hosting deployment is run after this audit commit so the deployed frontend reflects the current workspace.

## Residual considerations

- Render service health still requires a configured Render service URL or Render integration for independent verification.
- The server-side PostgreSQL role remains the intended application data boundary; browser roles do not receive direct table privileges.
- Any future change to the custom-table list must update the RLS migration/checker and its integration coverage together.