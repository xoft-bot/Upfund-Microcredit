---
name: Preview tooling
description: Imported workspace quirks affecting Vite preview and ESLint verification.
---

The imported client uses Vite 6 and ESLint 9 flat configuration. Keep lint verification scoped to the project source and tests rather than scanning platform skill directories, and validate Vite options against the installed Vite types before adding preview settings.

**Why:** The imported repository contains many JavaScript files outside the application, and a seemingly standard Vite host option was rejected by the installed type definitions even though the preview worked with a bound client port.

**How to apply:** When configuring this project’s preview or quality scripts, preserve the existing two-process client/API arrangement, use the Replit web-preview port for the client, and run lint against `client/src`, `server/src`, `shared`, and `tests`.