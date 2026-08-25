# Integrations, Environments, CI/CD, and Operations Plan

## Environment matrix

| Environment | Firebase project | Data | External providers | Deployment source |
|---|---|---|---|---|
| Local | Emulator Suite | Synthetic seed data | Mock adapters | Developer branch |
| Development | Dedicated non-production project | Synthetic or sanitized test data | Sandbox credentials | Development branch/merge |
| Preview | Isolated preview project or isolated tenant | Synthetic PR data | Mock/sandbox only | Pull request |
| Staging | Dedicated pre-production project | Controlled test data | Sandbox where available | Release candidate |
| Production | Production project | Real data | Production credentials | Protected main/release approval |

Never allow preview builds to use production data or live payment credentials. Firebase Hosting preview channels can interact with the underlying project resources, so isolation is mandatory.

## Required configuration categories

Frontend configuration contains only public, non-sensitive Firebase identifiers and feature flags. Server configuration contains Firebase administrative access, provider secrets, signing keys, webhook verification secrets, email credentials, Sheets credentials, and optional AI credentials. Production secrets belong in managed secret storage or protected deployment environments, never in GitHub source or frontend bundles.

## Integration adapter contract

Every external integration implements a common adapter shape: `validateConfiguration`, `createRequest`, `send`, `verifyCallback`, `normalizeResponse`, `retryPolicy`, `reconciliationKey`, and `healthStatus`. Provider calls create a pending operation before leaving the system. A success, failure, timeout, duplicate, or unknown result is stored explicitly. Unknown provider results require reconciliation rather than an assumed success.

## Integration priorities

Firebase Authentication, database, object storage, and server execution are foundational. SMS and mobile-money integrations should be added behind adapters after the core ledger works with manual payment methods. Identity verification and maps/geolocation are valuable but can begin as manual evidence capture. Google Sheets is a backup/export path, not the source of truth. AI analytics comes last and is read-only by default.

## CI/CD stages

Pull requests run formatting, linting, type checks, unit tests, financial invariant tests, API contract compatibility checks, security-rule tests, dependency auditing, and production-like builds. A preview deployment uses synthetic data and posts a review URL. A release candidate runs integration and end-to-end tests against staging, migration checks, load smoke tests, and a restore verification.

Production deployment requires protected approval. The pipeline deploys frontend assets, server functions/services, database rules, indexes, and migrations in an ordered process, then executes smoke tests for authentication, client lookup, loan application, and a non-monetary test transaction. Financial data migrations require a separate approval record and rollback or forward-fix plan.

## Logging and error tracking

Use structured application logs with correlation IDs and safe error codes. Keep security/audit events separate from operational logs. Track authorization failures, duplicate/replay attempts, provider failures, reconciliation variances, function latency, queue age, sync failures, failed backups, and quota consumption. Logs must redact sensitive identifiers and document contents.

## Rate limiting

Use per-user and per-command limits, with additional device/IP signals where appropriate. Authentication and document endpoints receive stricter abuse controls. Financial commands are limited by role, branch, amount, and workflow stage. Export and AI endpoints receive separate quotas. Rate-limit state should be observable and should not permit a caller to bypass protection by changing a client-supplied identifier.

## Caching and CDN

Firebase Hosting’s CDN serves immutable frontend assets. Use content-hashed bundles and safe cache headers. Cache only derived, scope-checked read models with short TTLs where needed. Never cache authorization decisions, mutable financial command results, private documents, or a user-specific response without a correct key and invalidation strategy.

## Scaling and load balancing

Begin with managed backend execution, Cloud SQL for PostgreSQL, connection pooling, and paginated queries. Avoid hot aggregate rows/documents by using append-only events, periodic snapshots, and carefully designed counters. Load-test collection posting, dashboard reads, exports, notifications, and offline synchronization. If reporting volume grows, move heavy analytics to a reporting store or read replica, but PostgreSQL remains the authoritative financial ledger and operational database unless a separately approved, tested provider migration is completed.

## Availability and disaster recovery

Define recovery objectives before production. Maintain scheduled database/export backups, versioned document storage where available, infrastructure-as-code or reproducible Firebase configuration, and a tested restore procedure. Backups must be encrypted/access-controlled and restoration must be exercised, not merely configured. Keep a manual field-collection and receipt process for outages, then reconcile it through the same controlled workflow after recovery.

## Operational runbooks

The project needs runbooks for failed deployment, failed migration, Firebase outage, mobile-money timeout, duplicate payment, lost device, compromised staff account, high cash variance, unavailable SMS, failed Sheets export, suspected fraud, backup restoration, and emergency suspension of disbursements. Each runbook identifies who can act, what data is preserved, how the incident is logged, and how normal operations resume.

## References

[1]: https://firebase.google.com/docs/hosting/github-integration "Firebase: Deploy to live and preview channels via GitHub pull requests"

[2]: https://firebase.google.com/docs/hosting/usage-quotas-pricing "Firebase: Hosting usage, quotas, and pricing"

[3]: https://firebase.google.com/docs/firestore/security/get-started "Firebase: Get started with Cloud Firestore Security Rules"
