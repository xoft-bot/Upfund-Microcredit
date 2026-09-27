---
name: Offline queue monitoring
description: The authoritative semantics for manager stale offline-queue metrics.
---

Stale offline-queue records are server-scoped `field_collection_records` with `synced_at IS NULL`, `captured_at` older than seven days, and an unresolved collection status. Pending totals may include all unresolved records in the same scope.

**Why:** The manager dashboard must not infer queue health from a client device's local storage or turn an unavailable server response into a false zero.

**How to apply:** Keep branch, role, and client visibility in the server aggregate; use the existing authenticated queue-count polling path; render an explicit unavailable state when counts fail.