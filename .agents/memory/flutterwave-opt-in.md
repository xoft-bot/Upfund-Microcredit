---
name: Flutterwave opt-in
description: The legacy payment-provider integration is intentionally disabled unless explicitly enabled.
---

Flutterwave is not part of the product’s primary payment model. Keep its legacy webhook path disabled by default; enabling it must be an explicit environment choice and production must require real signing and actor configuration.

**Why:** The product uses Firebase for identity and PostgreSQL for server-authoritative lending and payment records; an unrelated provider must not block development, deployment, or those controls.

**How to apply:** Treat manual/offline payment posting and the existing ledger/audit flow as the supported path. Do not add Flutterwave secrets to normal environments, and do not silently process provider webhooks while the feature is disabled.