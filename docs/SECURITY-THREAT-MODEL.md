# Application Security and Threat Model

## Security objective

Protect client identity data, financial records, staff accounts, mobile-money references, documents, and business intelligence while preserving a complete operational audit trail. Security must be designed into commands, data access, interfaces, integrations, and deployment rather than added after the dashboard is built.

## Main threats

| Threat | Consequence | Primary controls |
|---|---|---|
| Stolen staff credentials | Unauthorized client or financial access | MFA for privileged roles, session controls, least privilege, anomaly alerts |
| Client reads another client’s data | Privacy breach and reputational harm | Object-level authorization, branch/assignment scope, rules tests |
| Unauthorized disbursement | Direct financial loss | Server-only command, approval state, dual control, idempotency, liquidity gate |
| Duplicate payment or offline replay | Incorrect balances and cash loss | Unique receipt/provider/local IDs, idempotency, sync validation |
| Payment alteration or deletion | Fraud and unreconcilable records | Append-only ledger, reversal/adjustment, immutable audit events |
| Compromised integration key | Data theft or unauthorized provider actions | Secret manager, scoped credentials, rotation, provider allowlists |
| Malicious document upload | Malware or data exposure | MIME/size validation, private storage, signed access, scanning/retention policy |
| Injection or unsafe query parameters | Data exposure or service compromise | Schema validation, allowlists, parameterized queries, output encoding |
| Brute-force and abuse | Account takeover or resource exhaustion | Rate limits, lockouts, device/IP signals, alerting |
| Insider fraud | Cash variance, false clients, manipulated records | Separation of duties, audit, reconciliation, anomaly detection, dual approval |
| Preview or test data reaches production | Real financial or identity impact | Separate Firebase projects, secrets, provider sandboxes, protected deploy gates |
| Ransomware or accidental deletion | Operational outage or data loss | Versioned backups, export, restoration drills, append-only replay, recovery runbook |

## Authorization model

Use deny-by-default authorization. A permission consists of an action, resource, and scope. Examples include `client.read:branch`, `loan.approve:branch`, `collection.record:assigned`, and `ledger.adjust:finance`. UI visibility is only a convenience; every command and read model enforces authorization server-side.

Privileged operations use dual control where practical. A user who creates a loan application should not automatically approve and disburse the same loan. A collector should not silently correct a cash variance. A finance user may prepare an adjustment, but a second authorized reviewer should approve it.

## Data protection

Do not expose internal risk scores, fraud flags, capital pools, officer performance, or profitability calculations through client APIs. Store identity documents privately, restrict access using server-validated metadata, log sensitive reads, and avoid placing documents or secrets in GitHub, frontend bundles, client local storage, or ordinary logs.

## Secure command design

Every financial command validates authentication, role, scope, input schema, prior state, business policy, amount limits, idempotency key, correlation ID, and evidence requirements. The command writes its ledger transaction and audit event atomically where possible. External provider calls use an explicit pending state and reconciliation path; a timeout must not be treated as a successful disbursement or collection.

## Rate limiting

Apply separate limits for authentication attempts, document operations, read-heavy analytics, client creation, loan applications, approvals, disbursements, collection posting, reversals, exports, and AI queries. Limits should consider user, device, IP, branch, and command where appropriate. A rate-limit rejection should not leak sensitive information and must carry a correlation ID for support.

## Logging and monitoring

Logs must be structured, correlated, privacy-aware, and separated from immutable audit events. Do not log full national IDs, document contents, secrets, or unnecessary payment details. Monitor failed authorization, repeated duplicate submissions, unusual reversals, backdated events, provider failures, suspicious officer patterns, high variance, unusual login behavior, and data-export activity.

## Security testing

Before production, test Firestore/Storage rules, object-level access, role escalation, branch escape, duplicate/replay attacks, malformed payloads, unauthorized state transitions, document access, rate limits, secret exposure, dependency vulnerabilities, and recovery procedures. Run security regression tests on every rules or authorization change.

## Recovery principle

Security controls must fail closed for financial writes while preserving safe operational visibility. If a provider, network, or notification system is unavailable, the system records a pending or manual-review state. It must not improvise a successful balance change merely to keep the interface moving.
