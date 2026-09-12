# Stage 3 PWA UI Specification

**Status:** Specification only; no Stage 3 production code is authorized.  
**System version:** `1.0.01`

## Purpose and users

Stage 3 introduces the field-operational PWA workflows for collectors, loan officers, and managers. The interface must remain usable on low-cost Android devices, intermittent mobile data, and narrow screens. It must never imply that a payment is financially posted while it is only stored locally or awaiting reconciliation.

| Role | Primary workflow | Sensitive actions |
|---|---|---|
| Collector | Record daily field collections and issue a receipt | Submit a collection batch; no variance approval |
| Loan officer | Review client, loan, and repayment context | View assigned branch/client scope |
| Manager | Review batches and resolve variances | Approve or reject a variance with reason |
| Admin | Oversight and configuration | Restricted to explicit administrative permissions |

## Offline-first logbook entry

The collector home screen should show today’s assigned route, expected collections, synchronization state, and unresolved local records. A collection form should capture client, loan, installment, amount, payment method, collector, local timestamp, device identifier, notes, and optional receipt number. Required fields must be validated locally before the record is queued.

Each offline record receives a client-generated local ID and an idempotency key. The local queue is append-only from the user’s perspective: edits create a correction event rather than silently rewriting a submitted financial fact. The UI must distinguish `Draft`, `Queued`, `Syncing`, `Recorded`, `Pending reconciliation`, `Posted`, `Rejected`, and `Needs review`.

When connectivity returns, synchronization must use the existing payment command contract. A retry must reuse the same idempotency key. Conflicts must be shown to the collector and resolved by a manager or authorized workflow; the client must not overwrite a server-posted payment.

## Cash collection and receipt rendering

After local validation, the collector may render a receipt preview containing the client name, loan reference, amount, principal/charge allocation when known, collector identity, receipt reference, local queue status, and a clear statement when posting is pending. The receipt must not display “paid” until the server confirms posting.

The design must support a printer-friendly receipt view and a compact screen view. It should support browser print and a future device-printer adapter without coupling the UI to a specific printer vendor. Receipt references must be server-generated for posted payments; a collector-entered number is treated as an external reference and must not replace the canonical server receipt ID.

## Manager variance dashboard

The manager dashboard should summarize pending batches by branch, collection date, submitted amount, recorded amount, expected amount, variance, age, submitting officer, and current status. A manager must be able to open a batch, inspect its payment records and receipt references, see the mathematical variance, enter a required decision reason, and approve or reject it.

A variance approval action must visibly state that it authorizes financial posting and must require an explicit confirmation. The client only invokes the protected reconciliation endpoint; it never performs pool allocation or ledger calculations locally. Failed authorization, stale batch versions, or server errors must leave the batch visibly unresolved.

| UI state | Allowed action | Server command |
|---|---|---|
| Draft | Edit or submit | None or batch-submit command |
| Pending review | Inspect | Read-only queries |
| Variance | Reject or approve with reason | Protected reconciliation command |
| Approved | View evidence | Read-only queries |
| Posted | View ledger/receipt evidence | Read-only queries |
| Rejected | View reason and create correction | New correction workflow |

## Accessibility, security, and observability

All forms require keyboard navigation, visible focus, labels, error summaries, and touch targets appropriate for field use. Sensitive client information should be minimized on shared-device screens and masked where practical. The PWA must not place Firebase tokens, database credentials, provider secrets, or authorization decisions in IndexedDB or service-worker caches.

Every sync attempt should expose a correlation ID and a non-sensitive status message. Diagnostic details belong in server logs, not in collector-facing errors. Telemetry must include system version `1.0.01`, route name, queue state, latency, and outcome without logging national IDs, raw tokens, or payment secrets.

## Acceptance criteria before implementation

Stage 3 implementation may begin only after the backend audit freeze is lifted and the API contract is reviewed. Acceptance requires offline queue replay with idempotent retry, no duplicate posted payments, receipt status accuracy, manager-only variance approval, branch-scoped data visibility, accessible error states, and evidence that a client cannot approve a variance or perform ledger calculations locally.
