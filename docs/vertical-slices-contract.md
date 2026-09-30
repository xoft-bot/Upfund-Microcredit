# Upfund Vertical Slices Contract

**Status:** Implementation contract  
**Branch:** `docs/vertical-slices-spec`  
**Domains:** `/clients` and `/applications`  
**API namespace:** `/api/v1`  
**Currency:** `UGX`  
**Authorization:** ABAC: `role + organization/branch scope + assignment + action + approval authority`  
**Source of truth:** Server responses. Frontend navigation and masking are convenience layers; Fastify authorization and PostgreSQL query scoping are mandatory.

---

## 0. Global API conventions

### 0.1 Success envelope

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "requestId": "req_01J...",
    "asOf": "2026-09-30T12:00:00.000Z",
    "authoritative": true,
    "source": "database"
  }
}
```

`source` is one of `database`, `server_cache`, `local_queue`, `client_input`. A financial or authorization decision must never be based on `local_queue` or `client_input` alone.

### 0.2 Error envelope

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN_BRANCH_SCOPE",
    "message": "The requested record is outside the actor's branch scope.",
    "fieldErrors": []
  },
  "meta": {
    "requestId": "req_01J..."
  }
}
```

`message` must not disclose whether a protected record exists. Use `404 NOT_FOUND` instead of `403` where the product elects resource-existence hiding.

### 0.3 Common identifiers and formats

| Field | Type | Requirement |
|---|---|---|
| IDs | `string` | UUID or existing Upfund opaque ID; never expose sequential database IDs |
| Money | `integer` | Minor UGX units; UGX has zero decimal places, so `1800000` means UGX 1,800,000 |
| Timestamps | `string` | ISO-8601 UTC, e.g. `2026-09-30T12:00:00.000Z` |
| Date-only | `string` | ISO `YYYY-MM-DD` |
| Pagination cursor | `string` | Opaque, server-generated |
| ETag | `string` | Returned on detail responses; mutation may require `If-Match` |

---

# Section 1: Client Workspace API & Data Requirements

## 1.1 Client list endpoint

### Request

`GET /api/v1/clients`

Query parameters:

```json
{
  "q": "string, optional, 1-100 chars",
  "branchId": "string, optional, admin or explicitly authorized multi-branch scope only",
  "routeId": "string, optional, manager/collector assignment scope",
  "kycStatus": "pending | verified | rejected | expired, optional",
  "assignedOfficerId": "string, optional, manager/admin only",
  "pageSize": "integer, optional, 1-100, default 25",
  "cursor": "string, optional",
  "sort": "createdAt | displayName | kycStatus, optional, default createdAt",
  "direction": "asc | desc, optional, default desc"
}
```

Server rules:

- `organizationId` is always taken from the authenticated `UserContext`; client-supplied organization IDs are ignored/rejected.
- Non-admin branch filtering is intersected with the actor's allowed branch scope; it cannot expand scope.
- Collector results are limited to clients attached to an active assigned loan/route.
- Accountant results are restricted to the fields in the Accountant masking profile below.
- Results are deterministic for a given cursor and scope.

### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "cl_01JCLIENT001",
        "externalRef": "UPF-KLA-1042",
        "displayName": "Sarah Namatovu",
        "branch": {
          "id": "br_kampala_central",
          "name": "Kampala Central"
        },
        "route": {
          "id": "rt_nakawa",
          "name": "Nakawa"
        },
        "kycStatus": "verified",
        "assignedOfficer": {
          "id": "usr_grace_akello",
          "displayName": "Grace Akello"
        },
        "activeLoansSummary": {
          "count": 1,
          "principalOutstandingMinor": 735000,
          "overdueMinor": 0,
          "nextDueOn": "2026-10-03"
        },
        "createdAt": "2026-01-15T09:30:00.000Z",
        "updatedAt": "2026-09-30T10:42:00.000Z"
      }
    ],
    "nextCursor": "eyJvZmZzZXQiOjI1fQ=="
  },
  "meta": {
    "requestId": "req_01JCLIENTLIST",
    "authoritative": true,
    "source": "database",
    "asOf": "2026-09-30T10:42:00.000Z"
  }
}
```

## 1.2 Client detail endpoint

### Request

`GET /api/v1/clients/:id`

No query parameter may expand access scope. The server loads the target client, evaluates ABAC, and applies role masking before serialization.

### Response schema

```json
{
  "ok": true,
  "data": {
    "id": "cl_01JCLIENT001",
    "externalRef": "UPF-KLA-1042",
    "displayName": "Sarah Namatovu",
    "branch": {
      "id": "br_kampala_central",
      "name": "Kampala Central"
    },
    "route": {
      "id": "rt_nakawa",
      "name": "Nakawa"
    },
    "kyc": {
      "status": "verified",
      "verifiedAt": "2026-01-16T14:20:00.000Z",
      "verifiedBy": {
        "id": "usr_manager_01",
        "displayName": "Peter Ouma"
      },
      "expiresOn": "2027-01-16",
      "documentCount": 4,
      "missingDocumentTypes": []
    },
    "assignedOfficer": {
      "id": "usr_grace_akello",
      "displayName": "Grace Akello"
    },
    "activeLoansSummary": {
      "count": 1,
      "principalOutstandingMinor": 735000,
      "overdueMinor": 0,
      "nextDueOn": "2026-10-03",
      "statusCounts": {
        "active": 1,
        "overdue": 0,
        "defaulted": 0
      }
    },
    "loans": [
      {
        "id": "ln_01JLOAN001",
        "reference": "LN-2201",
        "status": "active",
        "principalAmountMinor": 1800000,
        "outstandingPrincipalMinor": 735000,
        "overdueMinor": 0,
        "nextDueOn": "2026-10-03"
      }
    ],
    "applicationsSummary": {
      "count": 2,
      "latestStatus": "approved",
      "latestApplicationId": "app_01JAPP001"
    },
    "createdAt": "2026-01-15T09:30:00.000Z",
    "updatedAt": "2026-09-30T10:42:00.000Z"
  },
  "meta": {
    "requestId": "req_01JCLIENTDETAIL",
    "authoritative": true,
    "source": "database",
    "asOf": "2026-09-30T10:42:00.000Z",
    "etag": "\"client-v7-01JCLIENT001\""
  }
}
```

## 1.3 Client field definitions

| Field | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | yes | Stable opaque client identifier |
| `externalRef` | string | yes | Human-facing Upfund reference, unique within organization |
| `displayName` | string | yes | Approved display name; masking rules apply |
| `branch.id` | string | yes | Authoritative organizational branch |
| `branch.name` | string | yes | Display label for branch |
| `route.id` | string/null | no | Current route/zone assignment |
| `route.name` | string/null | no | Current route/zone label |
| `kyc.status` | enum | yes | `pending`, `verified`, `rejected`, `expired` |
| `assignedOfficer` | object/null | yes | Current operational owner; not necessarily payment collector |
| `activeLoansSummary.count` | integer | yes | Count of non-closed loans |
| `principalOutstandingMinor` | integer | yes | Server-calculated principal outstanding in UGX minor units |
| `overdueMinor` | integer | yes | Server-calculated overdue amount |
| `nextDueOn` | date/null | yes | Earliest unpaid due date |
| `loans` | array | yes | Loans visible under role scope; never infer hidden loans from count |
| `applicationsSummary` | object | yes | Summary only; full application access is separately authorized |
| `createdAt`, `updatedAt` | timestamp | yes | Server timestamps |

## 1.4 Client status and scope rules

| Actor | Client list/detail scope |
|---|---|
| Admin | Organization-wide, subject to organization membership |
| Manager | `branchId IN user.branchIds`; route filters may narrow only |
| Officer | `branchId IN user.branchIds`; assigned/officer work scope may narrow |
| Collector | Client must be linked to an active loan/route assignment for the collector |
| Accountant | Organization/financial scope; only masked financial-relevant dossier fields |

A Manager whose scope is `Kampala Central` must not receive a Mbarara client record. If the product requires regional managers, that must be represented by a distinct scope attribute, not inferred from the generic `manager` role.

## 1.5 Client HTTP status contract

| Status | Code | Use |
|---:|---|---|
| 200 | — | Authorized list/detail response |
| 400 | `INVALID_QUERY` | Malformed filter, cursor, or page size |
| 401 | `UNAUTHENTICATED` | Missing/invalid session |
| 403 | `FORBIDDEN_BRANCH_SCOPE` | Target is known but outside actor's branch scope and existence may be disclosed |
| 403 | `FORBIDDEN_ASSIGNMENT` | Collector targets an unassigned client/loan |
| 403 | `FORBIDDEN_ROLE` | Role has no client access |
| 404 | `CLIENT_NOT_FOUND` | No record, or existence hiding is enabled for this actor/resource |
| 409 | `STALE_CLIENT_VERSION` | Mutation uses an old ETag/version |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Correlation ID required; no sensitive details |

**Collector example:** `GET /api/v1/clients/:id` for an unassigned client must return either `403 FORBIDDEN_ASSIGNMENT` or `404 CLIENT_NOT_FOUND`, according to the configured existence-hiding policy. It must never return `200` merely because the client is in the same branch or route.

---

# Section 2: Application Lifecycle State Machine Contract

## 2.1 Canonical states

```text
draft
  -> submitted_for_kyc
  -> kyc_verified
  -> risk_assessed
  -> approved
  -> disbursed

submitted_for_kyc -> draft              (return_for_correction)
submitted_for_kyc -> rejected
kyc_verified      -> rejected
risk_assessed     -> rejected
approved          -> rejected            (only before disbursement and by policy)
```

Terminal states for this slice: `disbursed`, `rejected`. No endpoint may skip required states or accept an arbitrary `status` supplied by the client.

### Transition authority

| Transition | Allowed roles | Required conditions |
|---|---|---|
| `draft -> submitted_for_kyc` | Officer, Manager, Admin | Required client/application fields complete |
| `submitted_for_kyc -> kyc_verified` | Manager, Admin | KYC evidence complete; no self-approval |
| `kyc_verified -> risk_assessed` | Officer, Manager, Admin | Risk assessment complete; actor has work scope |
| `risk_assessed -> approved` | Manager, Admin | Independent decision; amount within authority or escalation satisfied |
| `approved -> disbursed` | Manager, Admin | Funding available; approval valid; ledger transaction balanced |
| Any review state -> `rejected` | Manager, Admin | Rejection reason required; actor has authority |

## 2.2 Common application response

```json
{
  "id": "app_01JAPP001",
  "clientId": "cl_01JCLIENT001",
  "branchId": "br_kampala_central",
  "productId": "prod_growth_01",
  "requestedAmountMinor": 1800000,
  "currency": "UGX",
  "status": "risk_assessed",
  "createdBy": {
    "id": "usr_officer_01",
    "displayName": "Grace Akello"
  },
  "currentOwner": {
    "id": "usr_manager_01",
    "displayName": "Peter Ouma"
  },
  "kyc": {
    "status": "verified",
    "verifiedAt": "2026-09-30T08:00:00.000Z",
    "verifiedByUserId": "usr_manager_02"
  },
  "risk": {
    "status": "assessed",
    "score": 22,
    "assessedAt": "2026-09-30T09:30:00.000Z",
    "assessedByUserId": "usr_officer_01"
  },
  "timeline": [
    {
      "fromState": "kyc_verified",
      "toState": "risk_assessed",
      "actorUserId": "usr_officer_01",
      "reason": null,
      "createdAt": "2026-09-30T09:30:00.000Z"
    }
  ],
  "createdAt": "2026-09-29T11:00:00.000Z",
  "updatedAt": "2026-09-30T09:30:00.000Z"
}
```

## 2.3 `POST /api/v1/applications/:id/submit`

### Request JSON schema

```json
{
  "reason": "Initial submission for KYC review",
  "expectedVersion": 3
}
```

`reason` is optional for ordinary submission and required for resubmission after correction. `expectedVersion` is required for all mutable application transitions.

### Success response

`200 OK`

```json
{
  "ok": true,
  "data": {
    "application": {
      "id": "app_01JAPP001",
      "status": "submitted_for_kyc",
      "version": 4,
      "submittedAt": "2026-09-30T10:00:00.000Z",
      "submittedByUserId": "usr_officer_01"
    },
    "transition": {
      "fromState": "draft",
      "toState": "submitted_for_kyc",
      "actorUserId": "usr_officer_01",
      "createdAt": "2026-09-30T10:00:00.000Z"
    }
  },
  "meta": { "requestId": "req_submit_01", "authoritative": true, "source": "database" }
}
```

## 2.4 `POST /api/v1/applications/:id/verify-kyc`

### Request JSON schema

```json
{
  "decision": "verify",
  "evidenceIds": ["doc_01", "doc_02", "doc_03"],
  "reason": "All required KYC evidence reviewed",
  "expectedVersion": 4
}
```

`decision` is `verify` or `reject`. For `reject`, `reason` is mandatory and `evidenceIds` may be empty.

### Success response

`200 OK`

```json
{
  "ok": true,
  "data": {
    "application": {
      "id": "app_01JAPP001",
      "status": "kyc_verified",
      "version": 5,
      "kyc": {
        "status": "verified",
        "verifiedByUserId": "usr_manager_01",
        "verifiedAt": "2026-09-30T10:20:00.000Z"
      }
    },
    "transition": {
      "fromState": "submitted_for_kyc",
      "toState": "kyc_verified",
      "actorUserId": "usr_manager_01",
      "createdAt": "2026-09-30T10:20:00.000Z"
    }
  },
  "meta": { "requestId": "req_kyc_01", "authoritative": true, "source": "database" }
}
```

## 2.5 `POST /api/v1/applications/:id/assess-risk`

### Request JSON schema

```json
{
  "riskScore": 22,
  "recommendation": "proceed",
  "factors": [
    { "code": "repayment_history", "result": "positive", "weight": 0.4 },
    { "code": "business_stability", "result": "positive", "weight": 0.3 },
    { "code": "affordability", "result": "review", "weight": 0.3 }
  ],
  "notes": "Affordability within product policy; proceed to independent approval.",
  "expectedVersion": 5
}
```

Constraints:

- `riskScore` is an integer from `0` to `100`.
- `recommendation` is `proceed`, `review`, or `decline`.
- `factors` must contain at least one item.
- The server recomputes or validates policy-derived values; it does not trust a client score for approval authority.

### Success response

`200 OK`, with application status `risk_assessed` and a persisted risk assessment/audit event.

```json
{
  "ok": true,
  "data": {
    "application": {
      "id": "app_01JAPP001",
      "status": "risk_assessed",
      "version": 6,
      "risk": {
        "status": "assessed",
        "score": 22,
        "recommendation": "proceed",
        "assessedByUserId": "usr_officer_01",
        "assessedAt": "2026-09-30T10:30:00.000Z"
      }
    },
    "transition": {
      "fromState": "kyc_verified",
      "toState": "risk_assessed",
      "actorUserId": "usr_officer_01",
      "createdAt": "2026-09-30T10:30:00.000Z"
    }
  },
  "meta": { "requestId": "req_risk_01", "authoritative": true, "source": "database" }
}
```

## 2.6 `POST /api/v1/applications/:id/decide`

### Request JSON schema

```json
{
  "decision": "approve",
  "reason": "Risk approved within manager authority",
  "expectedVersion": 6,
  "secondApproverId": null
}
```

`decision` is `approve` or `reject`. `reason` is mandatory for both decisions. `secondApproverId` is required when policy specifies a second approver or the requested amount exceeds the single-approver threshold but remains within dual-approval limits.

### Success response: approve

`200 OK`

```json
{
  "ok": true,
  "data": {
    "application": {
      "id": "app_01JAPP001",
      "status": "approved",
      "version": 7,
      "decision": {
        "type": "approve",
        "decidedByUserId": "usr_manager_01",
        "decidedAt": "2026-09-30T10:45:00.000Z",
        "reason": "Risk approved within manager authority"
      }
    },
    "transition": {
      "fromState": "risk_assessed",
      "toState": "approved",
      "actorUserId": "usr_manager_01",
      "createdAt": "2026-09-30T10:45:00.000Z"
    }
  },
  "meta": { "requestId": "req_decide_01", "authoritative": true, "source": "database" }
}
```

### Success response: reject

The same envelope is returned with `status: "rejected"`, `decision.type: "reject"`, and a mandatory rejection reason.

## 2.7 Exact self-approval guard contract

The guard runs before any state mutation or ledger/disbursement side effect.

Condition:

```text
application.created_by === authenticated_actor.id
AND authenticated_actor is the proposed decider
```

Response:

**HTTP `403 Forbidden`**

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN_SELF_APPROVAL",
    "message": "The application creator cannot make the credit decision.",
    "fieldErrors": [
      {
        "field": "decision",
        "code": "SELF_APPROVAL_NOT_ALLOWED",
        "message": "An independent authorized reviewer is required."
      }
    ]
  },
  "meta": {
    "requestId": "req_decide_self_01"
  }
}
```

Requirements:

- The application status remains unchanged.
- No transition-history row is created for the rejected attempt unless security audit policy records denied attempts separately.
- A mandatory authorization audit event records actor, application ID, branch, request ID, and denial code.
- The frontend must render an explanatory blocked state, not a generic network error.

## 2.8 Application error contract

| Status | Code | Meaning |
|---:|---|---|
| 400 | `INVALID_TRANSITION_PAYLOAD` | Schema or required reason/evidence invalid |
| 401 | `UNAUTHENTICATED` | Missing/invalid session |
| 403 | `FORBIDDEN_BRANCH_SCOPE` | Application outside actor branch scope |
| 403 | `FORBIDDEN_ROLE` | Role cannot perform transition |
| 403 | `FORBIDDEN_SELF_APPROVAL` | Creator attempted to decide own application |
| 403 | `APPROVAL_THRESHOLD_EXCEEDED` | Amount exceeds actor authority |
| 403 | `SECOND_APPROVER_REQUIRED` | Policy requires another approver |
| 404 | `APPLICATION_NOT_FOUND` | No record, or existence hiding enabled |
| 409 | `STALE_APPLICATION_VERSION` | `expectedVersion` does not match current version |
| 409 | `INVALID_STATE_TRANSITION` | Current state cannot transition to requested state |
| 422 | `REQUIRED_EVIDENCE_MISSING` | KYC/risk evidence incomplete |
| 500 | `INTERNAL_ERROR` | No state mutation committed; correlation ID required |

---

# Section 3: Role-Specific Data Masking & Scope Matrix

## 3.1 Client dossier field profiles

`HIDDEN` means the property is omitted, not returned as `null`. `MASKED` means a stable partial value may be returned. Masking is performed server-side before the response leaves the API.

| Dossier field | Admin | Manager | Officer | Collector | Accountant |
|---|---|---|---|---|---|
| `id` | Full | Full in branch scope | Full in branch/work scope | Full for assigned records | Full for financial-linked records |
| `externalRef` | Full | Full | Full | Full for assignment | Full |
| `displayName` | Full | Full | Full | Full for assignment | Full or initials per privacy policy |
| `branch` | Full | Full in own scope | Full in own scope | Own branch only | Financial scope |
| `route` | Full | Full in own branch | Full if operationally needed | Assigned route only | HIDDEN unless reconciliation requires it |
| `phone` | Full | Full | Full for servicing | Last 4 digits by default; full only when collection policy permits | HIDDEN |
| `nationalId` | Full with privileged audit | Masked except last 4 | Masked except last 4 | HIDDEN | HIDDEN |
| `address` | Full | Full | Full for KYC | Route-relevant locality only | HIDDEN |
| `kyc.status` | Full | Full | Full | Status only | Status only |
| `kyc.documents` | Full metadata/content by privilege | Metadata and review status | Metadata; content if assigned reviewer | HIDDEN | Verification status only |
| `assignedOfficer` | Full | Full | Full | Display name only | HIDDEN |
| `activeLoansSummary` | Full | Full | Full | Assignment-only | Posted financial summary |
| `loans` | All organization | Own branch | Own branch/work scope | Assigned loans only | Posted loan records only |
| `applicationsSummary` | Full | Full | Assigned/branch scope | HIDDEN by default | Approved/disbursed summary only |
| `savings/deposits` | Full by permission | Branch scope | HIDDEN unless product workflow requires | HIDDEN | Posted balance only |
| `createdAt`, `updatedAt` | Full | Full | Full | Full for assigned record | Full for financial record |
| audit history | Full | Branch events | Own/assigned workflow events | Own collection events | Financial events |

## 3.2 Scope enforcement rules

1. Every client dossier query includes `organization_id = actor.organization_id`.
2. Manager and Officer queries include `branch_id = ANY(actor.branchIds)` unless a narrower assignment/work queue is required.
3. Collector queries join active assignments by `collector_user_id`, `loan_id`, `client_id`, and effective assignment dates.
4. Accountant queries use posted/authoritative financial joins and must not expose operational PII that is not necessary for accounting.
5. Cross-branch aggregates require an explicit `organization_report` permission; an ordinary branch-scoped Manager must not receive row-level data from another branch.
6. Query parameters can reduce scope only. They cannot expand it.
7. A masked field must not be recoverable through a second endpoint without an independent permission check.
8. Export endpoints apply the same masking and scope rules as interactive detail endpoints.

---

# Section 4: Route Authorization Mapping

| Method | Endpoint | Resource/action | Allowed roles | Scope | Required guards |
|---|---|---|---|---|---|
| `GET` | `/api/v1/clients` | `client:read` | Admin, Manager, Officer, Collector, Accountant | Role-specific client scope | Auth, organization, branch/assignment scope, masking |
| `GET` | `/api/v1/clients/:id` | `client:read` | Admin, Manager, Officer, Collector, Accountant | Role-specific dossier scope | Auth, object scope, masking, existence-hiding policy |
| `POST` | `/api/v1/clients` | `client:create` | Admin, Manager, Officer | Actor branch | Auth, branch scope, required fields, audit |
| `PATCH` | `/api/v1/clients/:id` | `client:update` | Admin, Manager, Officer | Client branch/work scope | Auth, object scope, ETag/version, immutable-field rules, audit |
| `POST` | `/api/v1/applications/:id/submit` | `application:submit` | Officer, Manager, Admin | Application branch/work scope | Auth, state guard, required-fields guard, version guard, audit |
| `POST` | `/api/v1/applications/:id/verify-kyc` | `application:verify_kyc` | Manager, Admin | Application branch | Auth, branch scope, evidence guard, no-self-approval, version guard, audit |
| `POST` | `/api/v1/applications/:id/assess-risk` | `application:assess_risk` | Officer, Manager, Admin | Application branch/work scope | Auth, KYC state, risk payload validation, version guard, audit |
| `POST` | `/api/v1/applications/:id/decide` | `application:decide` | Manager, Admin | Application branch/global | Auth, risk state, no-self-approval, threshold, second approver, version guard, audit |
| `GET` | `/api/v1/applications` | `application:read` | Admin, Manager, Officer | Organization/branch/work scope | Auth, branch scope, masking |
| `GET` | `/api/v1/applications/:id` | `application:read` | Admin, Manager, Officer, Accountant | Role-specific scope | Auth, object scope, masking |

### Fastify registration requirements

```ts
app.get(
  "/api/v1/clients/:id",
  { preHandler: [authenticate, requirePermission("client", "read")] },
  getClientDetail,
);

app.post(
  "/api/v1/applications/:id/decide",
  {
    preHandler: [
      authenticate,
      requirePermission("application", "decide"),
      requireApplicationState("risk_assessed"),
      requireNoSelfApproval(),
      requireApprovalThreshold(),
      requireExpectedVersion(),
      requireAudit("application.decision"),
    ],
  },
  decideApplication,
);
```

The handler must execute authorization and the state mutation in the same transaction boundary where a race could otherwise permit an unauthorized or duplicate transition. The SQL update must include the expected current state/version in its `WHERE` clause and verify exactly one row changed.

---

# Section 5: Integration Acceptance Checklist

Slices 1 and 2 are not complete until all five scenarios pass as Fastify integration tests against a test PostgreSQL database with real authorization middleware and query scoping.

## Test 1 — Collector cannot cross assignment scope

**Setup:** Collector `collector_nakawa` is assigned loan `LN-2201` and client `CL-1042`; client `CL-1063` is in the same Kampala Central branch but assigned to another collector.

**Requests:**

```http
GET /api/v1/clients/CL-1042
Authorization: Bearer <collector_nakawa>
```

Expected: `200`, dossier contains only assigned-client fields.

```http
GET /api/v1/clients/CL-1063
Authorization: Bearer <collector_nakawa>
```

Expected: `403 FORBIDDEN_ASSIGNMENT` or policy-approved `404 CLIENT_NOT_FOUND`; no PII in response; authorization audit event exists.

## Test 2 — Manager cannot cross branch scope

**Setup:** Manager is scoped only to `Kampala Central`; application `APP-MBR-001` belongs to `Mbarara`.

**Request:**

```http
GET /api/v1/applications/APP-MBR-001
Authorization: Bearer <kampala_manager>
```

Expected: `403 FORBIDDEN_BRANCH_SCOPE` or policy-approved `404`; no application fields disclosed. Adding `?branchId=mbarara` must not change the result.

## Test 3 — Self-approval is rejected exactly

**Setup:** Application `APP-001` has `created_by = usr_officer_01`; the same authenticated user calls the decision endpoint.

**Request:**

```http
POST /api/v1/applications/APP-001/decide
Authorization: Bearer <usr_officer_01>
Content-Type: application/json

{
  "decision": "approve",
  "reason": "Approve",
  "expectedVersion": 6
}
```

Expected: HTTP `403`; error code `FORBIDDEN_SELF_APPROVAL`; exact field error `SELF_APPROVAL_NOT_ALLOWED`; application state/version unchanged; no approval or ledger side effect.

## Test 4 — Valid independent decision is atomic and auditable

**Setup:** Application is `risk_assessed`, belongs to the manager's branch, creator differs from manager, amount is within authority.

**Request:** Manager calls `/decide` with the current version.

Expected:

- HTTP `200`.
- State changes exactly once to `approved`.
- Version increments exactly once.
- One transition-history row is inserted.
- One mandatory audit event is inserted.
- A concurrent request with the old version returns `409 STALE_APPLICATION_VERSION`.
- No duplicate approval is created.

## Test 5 — Client masking and authoritative source are enforced

**Setup:** Same client is requested by Admin, Officer, Collector, and Accountant tokens.

Expected:

- Admin receives the full permitted dossier.
- Officer receives branch/work-scope fields and permitted KYC metadata.
- Collector receives only assignment-scoped fields; national ID is absent/masked and unassigned loans are absent.
- Accountant receives posted financial fields and no unnecessary phone, national ID, address, or KYC document contents.
- Every response has `meta.authoritative = true` and `meta.source = "database"` for the integration test.
- Attempting to retrieve a masked field from a secondary endpoint is independently denied.

---

# Section 6: Completion gates

The implementation may be marked complete only when:

- OpenAPI/JSON Schema validators reject malformed request bodies before handlers run.
- Fastify integration tests cover all five scenarios above.
- Unit tests cover every application transition and forbidden transition.
- PostgreSQL queries enforce organization, branch, and assignment scopes without trusting client-supplied scope IDs.
- Self-approval, approval thresholds, and expected-version checks execute server-side.
- Client response serialization applies role masking before logging or sending the response.
- Every mutable action emits the required audit event in the same transaction or through a durable outbox.
- No frontend state label such as `SERVER_CONFIRMED`, `APPROVED`, or `DISBURSED` is rendered from local state without the corresponding authoritative API response.
- API documentation and frontend clients use the exact field names and enum values in this contract.
- A failed authorization check produces no domain mutation, ledger posting, status transition, or version increment.
