---
name: Mockup sandbox setup
description: The generated mockup artifact may need a local dependency install before its preview workflow can start.
---

When a new mockup sandbox workflow reports that Vite is missing, install the sandbox package dependencies before debugging component code.

**Why:** Artifact creation can finish before the isolated sandbox has a usable `node_modules`, so the workflow may fail with `vite: not found` even when the package manifest is correct.

**How to apply:** Check the sandbox dependency directory and workflow logs immediately after creating the artifact; install only inside the sandbox, then restart its managed preview workflow.