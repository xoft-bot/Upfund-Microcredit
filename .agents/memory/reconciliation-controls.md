---
name: Reconciliation controls
description: Financial-control rules for reconciliation posting, surplus allocation, and automated cycles.
---

Reconciliation automation must hold one transaction-scoped scheduler coordination lock for the complete cycle, while financial allocation derives realized surplus only from penalty and interest components.

**Why:** A lock released after candidate discovery allows concurrent runners to duplicate work, and allocating gross cash can misclassify principal or overpayment as profit.

**How to apply:** Keep the production cycle behind the advisory lock, make posting idempotent by batch reference, require a reason for manual variance decisions, and regression-test both component totals and persisted pool allocations.