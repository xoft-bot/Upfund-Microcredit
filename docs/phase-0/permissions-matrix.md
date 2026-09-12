# Unified Permissions Matrix

This matrix is the initial security baseline for the combined microcredit operating system. It is intentionally conservative. A permission must be granted explicitly; role labels alone must not authorize financial mutation.

| Capability | Super Admin | Manager | Branch Manager | Loan Officer | Collection Officer | Accountant | Auditor | Analyst | Marketing | Client |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Manage users, roles, and permissions | Full | No | Branch-scoped request | No | No | No | View | No | No | No |
| View clients | Full | All | Branch | Assigned/branch | Assigned | All needed for finance | Read | Aggregated or masked | Prospects/assigned | Own only |
| Create prospects and client records | Full | All | Branch | Assigned/branch | Limited field capture | No | No | No | Assigned | Self-registration if enabled |
| Verify KYC/business/location | Full | All | Branch | Submit | Field evidence only | No | Read | No | No | Provide documents |
| Create loan application | Full | All | Branch | Yes | No | No | No | No | No | Request only |
| Approve/reject loan | Full | Within policy | Branch limits | No, recommend | No | No | Audit | No | No | No |
| Disburse loan | Full | Policy limit | Policy limit | No | No | Finance confirmation | Audit | No | No | No |
| View repayment schedule | Full | All scope | Branch | Assigned | Assigned | All | Read | Aggregated | No | Own only |
| Record collection | Full | Override/review | Branch review | Assigned | Assigned | Reconcile | Audit | No | No | Client payment request only |
| Reverse or adjust collection | Full, dual control | Review/approve | Review/approve | No | No | Initiate/review | Audit | No | No | No |
| Reconcile cash/logbook/mobile money | Full | Approve variances | Branch approve | Submit | Submit | Approve/post | Read | No | No | Confirm receipt |
| Post expenses | Full | Branch request | Branch request | No | Yes | Audit | No | No | No | No |
| Write off or recover loan | Full, dual control | Recommend/approve by limit | Recommend | Flag only | Flag/follow up | Post accounting | Audit | No | No | No |
| Change loan products/policies | Full, versioned | Propose | Propose | No | No | Review financial impact | Review | No | No | No |
| View risk scores and sensitive analytics | Full | All scope | Branch | Assigned summary | Operational risk only | Portfolio level | Full | Masked/aggregate | No | No |
| Export reports | Full | Scope | Branch | Assigned operational | Assigned operational | Financial | Full | Aggregate | Marketing scope | Own statements |
| View audit logs | Full | Scope | Branch | Own actions where allowed | Own actions where allowed | Finance scope | Full | No | No | No |
| Use AI analytics | Full permitted data | Permitted scope | Branch scope | Operational scope | Collection scope | Finance scope | Audit scope | Aggregate only | Marketing scope | No internal risk data |
| Modify ledger directly | Never; commands only | Never | Never | Never | Never | Never | Never | Never | Never | Never |

## Mandatory control rules

Financial commands must execute server-side and must validate the actor, scope, prior entity state, policy version, idempotency key, and required approvals. The user interface may hide unavailable actions, but hidden controls are not a security boundary.

High-risk actions should use dual control: approval and disbursement, reversals, write-offs, policy changes, role changes, and capital withdrawals. The exact thresholds should be configurable, but the existence of a second review must not be silently disabled by a normal role.

A client may view only their own approved information. Internal risk reasons, reserve balances, officer performance, concentration analysis, and profitability calculations must not be exposed through client-facing endpoints.

Every authorization decision and every privileged command should produce an audit event, including denied attempts where useful for security monitoring.
