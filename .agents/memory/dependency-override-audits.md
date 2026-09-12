---
name: Dependency override audits
description: How to interpret dependency scanner results when npm overrides replace vulnerable transitive versions.
---

The resolved dependency tree and `npm audit` are authoritative for whether an npm override is active; a scanner can still report the vulnerable version declared by a transitive package even when the lockfile resolves the package to a patched version.

**Why:** The workspace security scanner reported `uuid@9.0.1` after npm had resolved every installed uuid copy to the pinned `11.1.1` override, while `npm audit` reported zero vulnerabilities.

**How to apply:** Confirm the lockfile entry and `npm ls <package> --all`, keep the override pinned exactly, rerun both audit paths, and document the scanner limitation rather than downgrading to the vulnerable resolution.