# GitHub and Firebase Delivery Plan

## Repository model

GitHub is the source of truth for application code, contracts, Firebase rules, indexes, migrations, test fixtures, deployment workflows, and documentation. Production data, identity documents, service-account keys, and environment secrets must never be committed.

Use protected `main` for deployable code. Work in short-lived branches named by domain, such as `feature/credit-client-onboarding`, `feature/loan-ledger`, or `feature/collector-offline-sync`. Frontend and backend agents may work concurrently, but every cross-boundary change must update the API contract and its tests in the same pull request or in an explicitly ordered pair of pull requests.

## Environments

Maintain at least three Firebase environments: development, preview/test, and production. Pull-request previews must use development or an isolated preview project with synthetic data. Firebase documents that Hosting preview URLs interact with the real backend resources of the Firebase project, so preview environments must never point at production data or live money-movement providers.

Production deployments should occur only after review, passing type checks, unit tests, financial invariant tests, security-rule tests, integration tests, and a migration review. Deployment credentials should be stored as GitHub environment secrets with production approval gates.

## CI checks

Every pull request should run frontend type checking and tests, backend tests, linting, Firebase Rules tests, schema/API compatibility checks, dependency checks, and a build. Financial commands should run invariant tests including duplicate submission, reversal, allocation, reconciliation, and balance conservation cases.

A merge to the deployable branch should build the frontend, deploy Hosting, deploy server functions or services, deploy Firestore indexes and rules, and run a post-deploy smoke test against the appropriate environment. Rules, schema, and function deployment should be versioned and reviewable.

## Data and migration controls

Schema changes must be backward-compatible during rollout or include a migration plan. Never perform destructive migrations on financial collections. New fields should be introduced with safe defaults, then backfilled by an audited script. Old fields should remain readable until all clients and services use the replacement.

Seed data for previews must be synthetic and clearly labeled. Production exports must be access-controlled, encrypted where appropriate, and retained according to the business’s approved retention policy. Google Sheets exports are secondary backup/reporting outputs, not a substitute for controlled database backup and restoration testing.

## Agent handoff workflow

The frontend agent first consumes the contract and builds mock-driven screens. The backend agent implements commands and read models against the same schemas. Contract tests run against mocks and the real development backend. The frontend agent then replaces mock transport with the development endpoint without changing business calculations in the UI.

Any agent-generated change must state which domain it modifies, which invariants it preserves, which permissions it relies on, which environment it targets, and how it was tested. Agents must not introduce credentials, alter production configuration, change financial policy defaults, or weaken rules to make a test pass.

## Deployment decision

Firebase Hosting is suitable for the static web frontend and pilot deployment. Firebase Authentication, Storage, Functions, and Firestore can support the initial operational platform, subject to quotas and security review. If the financial ledger becomes too relational or reporting-heavy for Firestore, introduce PostgreSQL behind the same API contract rather than rewriting the frontend. The migration must preserve ledger IDs, event ordering, audit history, and read-model semantics.
