---
name: Database verification
description: Verify the development database independently before trusting imported audit or handoff claims.
---

The imported project’s audit and handoff documents may describe a restored schema even when the current development database is empty. Treat those documents as historical context, run the project’s schema check, and apply the repository migrations before relying on database-backed tests.

After a hard reset to upstream, the development database can retain constraints or migration records from the discarded branch. Reconcile those differences before testing, preserving data and reverting only stale local DDL.

**Why:** Imported workspaces can have code and documentation restored without carrying over the database state that produced the original evidence.

**How to apply:** Before database feature work or certification claims, verify the active schema from the current workspace and database rather than relying on snapshots.