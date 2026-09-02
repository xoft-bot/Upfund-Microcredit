---
name: Render database diagnostics
description: Distinguish Render startup configuration failures from runtime PostgreSQL connectivity failures during production health checks.
---

Render can start the API while the production database connection still fails. A passing runtime-config validation proves only that a non-empty, syntactically valid `DATABASE_URL` or `PGURI` was supplied; `/health` must still complete `SELECT 1`.

**Why:** The API intentionally redacts PostgreSQL driver details from public health responses, so a `503 DATABASE_UNAVAILABLE` cannot identify wrong credentials, network access, TLS, or pool exhaustion from the endpoint alone.

**How to apply:** Compare a production-TLS `SELECT 1` from a trusted environment with the Render health result. If the trusted connection passes and Render returns 503, inspect Render's secret value, Supabase network/access policy, and runtime logs rather than changing application query code.