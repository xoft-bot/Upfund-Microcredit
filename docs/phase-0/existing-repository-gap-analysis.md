# Existing Repository Gap Analysis

## Current foundation

The selected `xoft-bot/Letsgrow` repository already contains a Firebase-hosted PWA architecture, Firebase Authentication, Firestore, Storage and messaging integrations, Cloud Functions, Google Sheets synchronization, role checks, callable-function conventions, correlation IDs, rate limiting, validation utilities, loan calculations, payment flows, arrears logic, financial invariant tests, load-test scripts, and an established UI component system.

The repository is therefore a useful technical foundation, not an empty project. It also already uses GitHub, Firebase Hosting, Cloud Functions, Firestore, and a mobile-capable web approach, so the desired deployment direction is compatible with the existing work.

## Important mismatch

The current repository is named and structured as an investment-club system. Its primary data model contains club members, contributions, dividends, fund buckets, arrears, and club-specific loan behavior. The current loan module includes member savings gates, a fixed interest constant, monthly schedule behavior, a pilot maximum, a waiting period, a single active-loan pattern, and a club loan pool. The current payment module centers on a club contribution/payment ledger and a contribution waterfall.

The unified product is broader and economically different. It requires clients and businesses, KYC, field officers, branches, daily short-cycle products, collection routes, offline collection capture, receipts, cash and mobile-money reconciliation, configurable allocation policies, four capital pools, a financial ledger, net credit loss, PAR, risk scoring, progressive lending, concentration controls, write-offs, recoveries, and a sustainability engine.

## Reuse recommendation

Reuse the repository’s infrastructure and engineering patterns, including authentication bootstrapping, deployment configuration, Firebase initialization, callable-function middleware, logging and correlation IDs, validation helpers, notification adapters, Sheets backup patterns, PWA packaging, testing conventions, and reusable UI primitives.

Do not silently rename the existing club collections into microfinance collections or replace existing financial semantics in place. Introduce a clearly versioned microcredit domain model and adapters. If the existing investment-club data is still live, preserve it as a separate bounded context or deploy the new credit operating system as a separate Firebase project/site with a deliberate migration plan.

## Immediate technical risks to resolve

The current Firestore rules permit some direct client access patterns for legacy collections and use a relatively small role vocabulary centered on admin/member behavior. The unified model requires branch-scoped and officer-scoped permissions, finance and audit roles, client isolation, and server-authoritative financial commands. The rules and callable authorization layer need a designed migration, not incremental exceptions.

The current loan and payment functions should not be treated as the new ledger engine without review. They contain legacy constants, club-specific eligibility gates, and contribution-oriented payment semantics. A new `credit` or `microfinance` module should expose the unified command contract and write append-only ledger events. Existing functions may be wrapped or retired only after regression tests and data-boundary decisions.

The current frontend is a React dashboard inside a larger vanilla SPA shell and includes club-specific four-tab navigation. It can provide reusable components and patterns, but the unified product should use a clear route and workspace model for admin, branch, officer, collector, finance, risk, and client contexts. The current screen system should be extended deliberately rather than forcing the microfinance workflows into the existing club navigation.

## Repository decision — approved direction

The microfinance platform uses a completely separate private repository and separate Firebase environments from the investment-club product. The selected repository is `xoft-bot/Letsgrow-Microcredit`. The old investment-club repository is not a dependency and must not be copied into the new application.

Only general engineering lessons may be reused after review, such as logging conventions, PWA practices, testing patterns, and deployment knowledge. Do not copy old investment-club schemas, financial formulas, role rules, or business logic into the microcredit domain. This preserves two independent products: the investment club and the microcredit operating system.

## Current status after this analysis

The new repository now contains the unified requirements inventory, architecture/build assessment, permissions matrix, API contract outline, financial ledger specification, MVP roadmap, master plan, database plan, security threat model, integrations plan, and this gap analysis under `docs/phase-0` and `docs/`. These documents should be reviewed before implementation agents write feature code.
