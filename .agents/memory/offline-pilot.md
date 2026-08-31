---
name: Authenticated offline pilot
description: Session and offline-sync boundary for the collector pilot.
---

Firebase establishes the browser session, but the client must obtain role, branch, permissions, and collector scope from the authenticated server session profile before rendering operational workflows.

**Why:** Firebase claims can be stale or incomplete, while PostgreSQL is the authoritative identity and financial boundary.

**How to apply:** Let queue replay request a current ID token at send time, keep auth and network failures retryable, surface server conflicts for review, and never let offline storage or token claims authorize financial scope.