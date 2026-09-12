---
name: Imported repository workflow
description: Importing an existing Replit-ready repository into the generated workspace.
---

When importing an existing repository, preserve the platform support directories while replacing the generated starter scaffold with the repository files. Repositories may already contain registered artifact packages and workflow definitions; refresh the artifact inventory after the copy.

**Why:** The generated workspace and the imported repository can both contain artifact, library, and package metadata, so blindly merging them can leave stale services or conflicting lockfiles.

**How to apply:** Inspect the imported repository's own package/workspace configuration first, install from its lockfile, build shared packages before artifact typechecks, then restart its managed workflows and verify the primary preview.