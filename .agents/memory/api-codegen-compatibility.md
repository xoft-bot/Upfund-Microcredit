---
name: API codegen compatibility
description: The workspace currently uses Zod 3 with generated client schemas.
---

When extending the OpenAPI contract, prefer numeric schemas for values that only need numeric behavior in the generated client; the current Orval/Zod combination emits `zod.int()` for OpenAPI integer fields, which is not available in the installed Zod runtime.

**Why:** Code generation succeeds, but the workspace typecheck fails after generation when those integer helpers appear.

**How to apply:** Re-run codegen and the full typecheck after changing the API contract; if an integer field triggers this issue, use a numeric schema unless integer-specific runtime validation is required.