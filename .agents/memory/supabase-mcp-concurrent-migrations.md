---
name: Supabase MCP concurrent migrations
description: Supabase MCP applyMigration wraps SQL in a transaction, which rejects CREATE INDEX CONCURRENTLY.
---

Supabase MCP `applyMigration` runs migrations transactionally, so migrations containing `CREATE INDEX CONCURRENTLY` cannot be applied unchanged. Use idempotent non-concurrent index definitions when the schema is empty or downtime is acceptable, or use a separately supported non-transactional path for live large-table indexing.

**Why:** The repository migrator explicitly handles concurrent-index migrations outside its transaction, but the Supabase MCP migration endpoint does not.

**How to apply:** Inspect migration directives before applying production migrations; preserve the migration name/history and verify indexes after applying the compatible SQL.