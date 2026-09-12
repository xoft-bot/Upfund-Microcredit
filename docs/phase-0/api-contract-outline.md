# API Contract Outline

The frontend and backend must share this contract before independent implementation begins. The transport may be Firebase callable functions for the pilot, REST for broader interoperability, or an adapter over either; the command names, validation, state transitions, and response semantics remain stable.

## Common request and response envelope

```json
{
  "correlationId": "uuid",
  "idempotencyKey": "uuid",
  "actorContext": "provided by authenticated session, never trusted from client payload",
  "payload": {}
}
```

Successful responses use `{ "ok": true, "data": {}, "correlationId": "uuid" }`. Errors use `{ "ok": false, "error": { "code": "ERROR_CODE", "message": "safe human-readable message", "details": {} }, "correlationId": "uuid" }`. Financial commands must be idempotent: repeating the same idempotency key returns the original result and must not create a second posting.

## Read models

The frontend consumes role-filtered read models rather than assembling financial truth from unrelated documents. Initial read models include `DashboardSummary`, `ClientProfile`, `LoanDetail`, `CollectionRoute`, `ReconciliationBatch`, `PortfolioRiskSummary`, `CapitalPosition`, `LiquidityPosition`, `AccountingSummary`, and `AuditEventPage`.

Each read model should include `asOf`, `sourceVersion`, and the applicable scope. Financial amounts should be returned as integer minor units or integer UGX values, never binary floating-point values. Dates and timestamps must use an explicit timezone convention, with the business timezone configured rather than assumed.

## Core commands

| Command | Required checks | Financial effect |
|---|---|---|
| `createClient` | actor scope, duplicate checks, required KYC fields | No ledger effect |
| `submitKyc` | document metadata, actor scope, KYC state | No ledger effect |
| `createLoanApplication` | active client, KYC status, product rules | No ledger effect |
| `approveLoan` | approval limit, risk review, valid state, dual control if required | Reserves or commitment may be recorded according to policy |
| `disburseLoan` | approved state, available liquidity, disbursement reference, idempotency | Principal receivable and cash/mobile-money entries |
| `recordCollection` | active loan, amount, receipt, payment method, duplicate checks | Cash/receivable and waterfall allocation entries |
| `submitOfflineCollection` | local ID, officer/device, receipt, timestamp | Pending until validated and posted once |
| `reverseCollection` | original exists, reason, dual approval | Reversal entries; original remains immutable |
| `allocateIncome` | policy version, collected amount, approval rules | Reserve, expense, and growth-pool entries |
| `recordExpense` | category, branch, evidence, actor scope | Expense and cash/payable entries |
| `submitReconciliation` | expected vs actual, variance reason, evidence | Reconciliation status; no silent adjustment |
| `writeOffLoan` | delinquency policy, approval limit, evidence | Write-off and reserve entries |
| `recordRecovery` | recovery case, payment evidence | Recovery and reserve/receivable entries |
| `reassessCredit` | current history, policy version, human review | Score/recommendation snapshot; no automatic disbursement |
| `changePolicy` | privileged role, effective date, approval | Configuration version only |

## Required state transitions

Client: `prospect → application → KYC pending → verified/rejected/review required → active/suspended`.

Loan application: `draft → submitted → under review → approved/rejected → disbursed/cancelled`.

Loan: `approved → active → delinquent → completed/defaulted/restructured → recovered/written off/closed`.

Collection: `captured offline or online → pending validation → posted → reconciled`, with alternate `rejected`, `duplicate`, or `reversal pending` outcomes.

## Invariants

A successful disbursement creates exactly one disbursement event for its idempotency key. A posted collection cannot be deleted. A correction creates a linked reversal or adjustment. The sum of ledger postings for a transaction must balance according to the configured chart of accounts. A loan balance is derived from posted events and may be cached, but a cached balance is never the sole source of truth. A policy change affects new calculations only unless an explicit, audited backfill is approved.

## Frontend integration rules

The frontend must not write directly to authoritative financial collections. It calls commands, displays server-returned results, handles pending/retry states, and refreshes read models after success. Mock handlers must use the same request and response schemas. Backend changes that alter field names, enums, state transitions, or error codes require a contract version update and frontend test update.
