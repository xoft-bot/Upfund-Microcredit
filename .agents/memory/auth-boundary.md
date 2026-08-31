---
name: Auth identity boundary
description: Compatibility and authorization rules for database-backed Firebase identities.
---

The authentication boundary must normalize both camelCase and legacy snake_case identity fields, while permissions always come from the database role-permission mapping rather than Firebase claims.

**Why:** Existing route tests and callers use both field styles, and portal authorization must remain server-authoritative.

**How to apply:** When adding authenticated routes or identity attributes, preserve both aliases at request.user, build Actor from the normalized values, and read permission grants from the resolved database user.