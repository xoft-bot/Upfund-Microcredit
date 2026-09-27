---
name: Workspace security scanner scope
description: Platform security scans may include tracked backup artifacts and stale dependency-tree data beyond the active pnpm install.
---

Treat the active pnpm lockfile, a clean frozen install, and `pnpm audit --prod` as the authoritative production dependency evidence. Platform scanner results can include tracked legacy artifacts and stale package versions that are absent from the current lockfile; reconcile paths and resolved versions before changing dependencies or deleting registered backup artifacts.

**Why:** This workspace's platform dependency scan continued to report old package versions after a clean pnpm reinstall, while the exact versions were absent from the lockfile and filesystem. Its SAST scan also included a registered legacy backup artifact outside the deployed app.

**How to apply:** When auditing this project, compare every scanner package/version and file path against `pnpm-lock.yaml`, a clean `node_modules`, and active artifact/workflow registrations. Fix genuine findings, document scanner-scope mismatches, and do not delete registered backups without confirming their artifact references.