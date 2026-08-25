# Infrastructure Decisions — Phase 0 Approved

## Decision summary

The microcredit platform will use **Google Cloud SQL for PostgreSQL** as its authoritative operational and financial database. Firebase will provide Authentication, Hosting, Cloud Storage, and selected supporting services. The application API will run as a server-side service between the React/Vite PWA and Cloud SQL.

This decision is based on architectural alignment rather than the lowest possible pilot cost. Cloud SQL keeps the database, Firebase project, IAM, billing, monitoring, backup controls, and deployment ecosystem under Google Cloud. Cloud SQL supports PostgreSQL in the Johannesburg region (`africa-south1`), which is preferable for a Uganda-focused operating system because the database can be placed closer to the initial users and field operations than the currently documented Neon regions. Cloud SQL also supports regional high availability with synchronous replication across zones and automated failover, and its backup service supports encrypted automated backups, point-in-time recovery, retention, and restoration to another instance or region. [1] [2] [3]

Neon remains a viable lower-cost development alternative, but it is not selected as the authoritative production database. Neon’s current documentation lists no Africa region, fixes a project’s region at creation, and describes its Free plan as intended for prototypes and small teams with a 0.5 GB/project storage limit, 100 CU-hours/project, 5 GB egress, and a short history window. Its Launch/Scale plans add production-oriented controls, but using it would place the primary database outside the Google Cloud/Firebase environment and introduce a later provider migration or multi-cloud operating burden. [4] [5]

## Selected PostgreSQL provider

| Environment | Provider | Region | Instance class | Availability | Database |
|---|---|---|---|---|---|
| Local | PostgreSQL Docker/Local PostgreSQL | Developer machine | Disposable | Not applicable | `microcredit` |
| Development | Google Cloud SQL for PostgreSQL | `africa-south1` (Johannesburg) | Enterprise, small zonal instance | Automated backups; no HA initially | `microcredit_dev` |
| Staging | Google Cloud SQL for PostgreSQL | `africa-south1` (Johannesburg) | Enterprise, production-like small instance | Automated backups; HA optional until release rehearsal | `microcredit_staging` |
| Production | Google Cloud SQL for PostgreSQL | `africa-south1` (Johannesburg) | Enterprise, right-sized dedicated instance | Regional HA enabled before real client funds/data | `microcredit` |

The production instance must use automated backups, point-in-time recovery, deletion protection, maintenance windows, monitoring, connection limits, and a tested restore procedure. Regional HA is not required for local development and should not be enabled merely to increase early cost; it is required before the first real-money production pilot unless a documented risk acceptance says otherwise. Cloud SQL states that an HA instance costs approximately twice the standalone instance because it maintains a primary and standby across zones. [2]

The API must use connection pooling and a small controlled pool per runtime instance. Migrations run through the deployment pipeline, never from the browser. Financial migrations are forward-compatible, reviewed, and tested against a restored backup before production application.

## Firebase project naming

Firebase recommends a separate Firebase project for each environment, and Firebase’s Hosting guidance specifically recommends separate projects rather than using multiple Hosting sites to mirror development, staging, and production. [6] [7]

The following are the canonical requested project IDs. They are lowercase, hyphen-separated, human-readable, and under Firebase Hosting’s site-ID length constraints. Firebase project IDs are globally unique and immutable after resources are provisioned, so availability must be checked during creation; if a requested ID is already taken, add a short organization-approved suffix consistently across all environments rather than renaming later. [8]

| Environment | Firebase display name | Firebase project ID | Default Hosting site | Environment label |
|---|---|---|---|---|
| Development | Letsgrow Microcredit — Development | `letsgrow-microcredit-dev` | `letsgrow-microcredit-dev.web.app` | `development` |
| Staging | Letsgrow Microcredit — Staging | `letsgrow-microcredit-staging` | `letsgrow-microcredit-staging.web.app` | `staging` |
| Production | Letsgrow Microcredit — Production | `letsgrow-microcredit-prod` | `letsgrow-microcredit-prod.web.app` | `production` |

The existing investment-club Firebase project must not be used by any of these environments. The new Firebase projects must have separate Authentication users, Storage buckets, service accounts, logs, analytics configuration, and provider secrets. Development and staging use synthetic or anonymized data only. Production is tagged as the production environment in Firebase/Google Cloud and is protected by approval gates.

## Firebase services by environment

| Service | Development | Staging | Production |
|---|---|---|---|
| Authentication | Enabled; test identities | Enabled; test identities | Enabled; real users after launch gate |
| Hosting | Preview/development deployment | Release-candidate deployment | Protected production deployment |
| Cloud Storage | Synthetic documents | Synthetic/anonymized documents | Private KYC/document storage |
| Firestore | Not authoritative; emulator or supporting metadata only if needed | Supporting metadata only if needed | Supporting metadata only if needed |
| Cloud Functions/Run adapters | Mock/sandbox providers | Sandbox providers | Production providers only after approval |
| Analytics | Off or separated | Off unless testing | Production property only |

Firestore is not the financial source of truth. If it is enabled for a supporting feature, it must not contain a competing balance, ledger, repayment, or capital-pool truth.

## Environment aliases and configuration

The repository will use the following Firebase CLI aliases:

```text
dev     -> letsgrow-microcredit-dev
staging -> letsgrow-microcredit-staging
prod    -> letsgrow-microcredit-prod
```

Environment variables must be named by function, not by provider-specific implementation. Examples include `DATABASE_URL`, `DATABASE_POOL_MAX`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_AUTH_TENANT`, `API_BASE_URL`, `APP_ENV`, `ALLOWED_ORIGINS`, `SENTRY_DSN` or equivalent error-tracking endpoint, and provider-specific secrets. Only public Firebase web configuration may be exposed to the PWA; Cloud SQL credentials, Firebase Admin credentials, webhook secrets, and signing keys remain server-side.

## Provider change policy

This decision is valid for Phase 0 and the initial production pilot. If Cloud SQL cost or operational complexity becomes a material blocker, Neon or another managed PostgreSQL provider may be evaluated only through a written comparison covering region, backups, HA, encryption, IAM, private connectivity, incident response, data export, and migration testing. The API and domain model must remain storage-neutral, but no provider change may occur after real-money launch without a tested migration and reconciliation plan.

## References

[1]: https://cloud.google.com/sql/pricing "Google Cloud SQL pricing"

[2]: https://cloud.google.com/sql/docs/postgres/high-availability "Cloud SQL for PostgreSQL high availability"

[3]: https://cloud.google.com/sql/docs/postgres/backup-recovery/backups "Cloud SQL for PostgreSQL backups overview"

[4]: https://neon.com/pricing "Neon pricing plans"

[5]: https://neon.com/docs/introduction/regions "Neon regions"

[6]: https://firebase.google.com/docs/projects/dev-workflows/overview-environments "Firebase overview of environments"

[7]: https://firebase.google.com/docs/hosting/multisites "Firebase Hosting multiple sites"

[8]: https://firebase.google.com/docs/projects/learn-more "Understand Firebase projects and identifiers"
