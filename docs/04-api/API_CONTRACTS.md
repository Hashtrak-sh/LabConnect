# Initial API contracts

**Status:** DRAFT for gate G2. This catalogue drives the contract in `packages/api-contract/openapi/` (see `API_CONVENTIONS.md` §1). Detailed schemas are written in the OpenAPI file during Phase 2 (tasks P2-01..P2-06). Role abbreviations are as in `01-product/ROLES_AND_PERMISSIONS.md`. T-xx refers to `02-architecture/BOOKING_STATE_MACHINE.md`.

## 1. Auth and identity (`/v1/auth`, `/v1/me`)
| Method | Path | Who | Purpose | FR |
|---|---|---|---|---|
| POST | `/auth/otp/request` | public | Request an email OTP (`{email, purpose}`). Always returns 202 (no account enumeration). | IAM-01 |
| POST | `/auth/otp/verify` | public | Verify the OTP. Returns a session (or an `mfaRequired` challenge). | IAM-01 |
| POST | `/auth/mfa/verify` | partial session | Complete MFA, or do a step-up (`{code}`) | IAM-03/04 |
| POST | `/auth/mfa/enrol` · `/auth/mfa/enrol/confirm` | auth | TOTP enrolment, with recovery codes | IAM-03 |
| POST | `/auth/refresh` | cookie | Rotate the refresh token | — |
| POST | `/auth/logout` · `/auth/logout-all` | auth | Revoke the session(s) | IAM-07 |
| GET | `/me` | auth | Profile, memberships, active membership, permissions | IAM-05 |
| POST | `/me/active-membership` | auth | Switch organisation | IAM-05 |
| GET/PATCH | `/me/notification-preferences` | auth | Mute or unmute | NOT-03 |
| GET | `/me/notifications?unread=true` · POST `/me/notifications/{id}/read` | auth | In-app inbox | NOT-01 |

## 2. Public (`/v1/public`) and search
| Method | Path | Purpose | FR |
|---|---|---|---|
| GET | `/public/search/labs?q=&lat=&lng=&pincode=&radiusKm=&discipline=&parameter=&method=&tatMax=&priceMax=&category=&cursor=` | Search sites with matched scope lines | DIS-01..05 |
| GET | `/public/search/suggest?q=` | Typeahead (parameters, products, standards, labs) | DIS-01 |
| GET | `/public/lab-sites/{siteId}` | Profile: accreditation, listing status, hours, address, rating | DIS-06 |
| GET | `/public/lab-sites/{siteId}/scope?q=&cursor=` | Scope tree and search inside the scope | DIS-06 |
| GET | `/public/lab-sites/{siteId}/prices` | Published price list (bookable sites only) | DIS-06 |
| GET | `/public/lab-sites/{siteId}/slots?from=&to=&discipline=` | Available slots | BKG-04 |
| POST | `/public/leads` | "Request a lab" or no-result lead | DIS-07 |
| GET | `/public/taxonomies/{code}/nodes?parent=` | Filter values | DIS-03 |
| GET | `/public/verify/{verificationCode}` | Verification result (limited metadata, hash) | RPT-08 |
| GET | `/public/share/{token}` | Resolve a share link → short-lived download URL | RPT-10 |

## 3. Customer org (`/v1/customer`)
| Method | Path | Who | Purpose | FR |
|---|---|---|---|---|
| POST | `/customer/organisations` | auth (no org) | Create a customer org (individual or organisation) | ONB-01 |
| GET/PATCH | `/customer/organisation` | C-Admin | Profile, GSTIN | ONB-01 |
| GET/POST/PATCH | `/customer/sites[/{id}]` | C-Admin | Customer sites | ONB-03 |
| GET/PATCH | `/customer/settings` | C-Admin | `requesterCanPay`, etc. | ONB-02 |
| GET/POST/DELETE | `/customer/users`, `/customer/invitations` | C-Admin | Users and roles | ONB-02 |

## 4. Bookings
| Method | Path | Who | Transition | FR |
|---|---|---|---|---|
| POST | `/bookings/estimate` | C-* | (none) Price estimate and validation | BKG-05 |
| POST | `/bookings/duplicate-check` | C-* | (none) | BKG-09 |
| POST | `/bookings` | C-Admin, C-Req, Ops | T-01 | BKG-01..06 |
| GET | `/bookings?scope=customer\|lab&status=&cursor=` | party | List (scoped by active org) | — |
| GET | `/bookings/{id}` | party | Detail (lines, TRF, status, timeline) | RPT-04 |
| PATCH | `/bookings/{id}` | owner, C-Admin | T-02 | BKG-10 |
| POST | `/bookings/{id}/attachments/upload-url` | owner | Pre-signed upload | BKG-08 |
| POST | `/bookings/{id}/accept` | L-Checker | T-03 | LAB-02 |
| POST | `/bookings/{id}/reject` | L-Checker | T-05 | LAB-02 |
| POST | `/bookings/{id}/counter` | L-Checker | T-04 | LAB-02 |
| POST | `/bookings/{id}/counter/accept` · `/counter/decline` | owner, C-Admin | T-07 / T-08 | LAB-03 |
| POST | `/bookings/{id}/cancel` | per matrix | T-25/26/27 | BKG-07 |
| GET | `/bookings/{id}/handover` | party | Instructions, deadline, QR list | LOG-02/04 |
| GET | `/bookings/{id}/labels.pdf?format=A4\|THERMAL_50x25` | owner, L-Maker, L-Checker | Labels (logged) | LOG-04/09 |
| POST | `/bookings/{id}/hold/decision` | owner, C-Admin | T-16 or REPLACE/CANCEL | RPT-03 |
| POST | `/bookings/{id}/start-testing` | L-Maker | T-18 | RPT-04 |
| PATCH | `/bookings/{id}/expected-report-date` | L-Maker | (none) ETA plus reason | RPT-04 |
| POST | `/bookings/{id}/lines/{lineId}/status` | L-Maker | Line status (for partial cancellation) | EC-19 |
| GET | `/bookings/{id}/timeline` | party | Status history + custody (redacted per party) | LOG-08 |
| GET | `/bookings/{id}/custody-trail.pdf` | owner, C-Admin | Download the custody trail | RPT-11 |
| POST | `/bookings/{id}/rating` | owner / L-Checker | Rating | SUP-01 |

### 4.1 `POST /v1/bookings` (example)
```json
// Request (Idempotency-Key required)
{
  "labSiteId": "0193…",
  "customerSiteId": "0193…",
  "slotId": "0193…",
  "preferredDropDate": "2026-12-03",
  "declaredPackageCount": 2,
  "lines": [ { "scopeLineId": "0193…" }, { "scopeLineId": "0193…" } ],
  "trf": { "schemaVersion": "trf.v1", "form": { "itemName": "TMT Bar Fe500D", "batchNo": "B-2311", "...": "..." },
           "conformityRequired": true, "decisionRule": "Simple acceptance" }
}
// 201 Response
{ "id": "0193…", "bookingNo": "LC-2611-0004821", "status": "REQUESTED",
  "total": { "amountPaise": 354000, "currency": "INR" }, "labDecisionDueAt": "2026-11-24T10:30:00Z",
  "lines": [ … ], "lockVersion": 0 }
```
Errors: `SITE_NOT_BOOKABLE`, `SCOPE_LINE_NOT_BOOKABLE`, `SLOT_UNAVAILABLE`, `OPEN_BOOKING_LIMIT`, `VALIDATION_FAILED`.

### 4.2 `POST /v1/bookings/{id}/counter`
```json
{ "proposedSlotId": "0193…", "perLineQuantity": [ { "lineId": "…", "sampleQty": 3, "unitCode": "PCS" } ],
  "message": "Need 3 bars for bend test" }
```
Any `price*` or `method*` field gives `422 COUNTER_FIELD_NOT_ALLOWED` (CD-08).

## 5. Payments
| Method | Path | Who | Purpose | FR |
|---|---|---|---|---|
| POST | `/bookings/{id}/payments` | C-Admin, C-Fin, (C-Req if allowed) | Create a payment order → `{gatewayCheckout: {...opaque per adapter}}` | PAY-01/02 |
| GET | `/bookings/{id}/payments` | party | Payment attempts and status | PAY-03 |
| POST | `/webhooks/payments/{gateway}` | gateway | Signed callback. Returns 2xx once persisted. | PAY-07 |
| GET | `/payments/return?orderRef=` | browser | Return URL. Shows the pending/success page. **Never** marks the booking paid by itself. | PAY-07 |
| GET | `/bookings/{id}/financial-documents` | party | Invoices, receipts, credit notes | FIN-02 |
| GET | `/financial-documents/{id}/download` | party | Signed URL | FIN-02 |

The `gatewayCheckout` shape is **adapter-defined** and stays opaque to the contract until the ICICI documentation is available (OQ-01).

## 6. Lab (`/v1/lab`)
| Method | Path | Who | Purpose | FR |
|---|---|---|---|---|
| POST | `/lab/claims` | auth | Start a claim (`{certificateNo}`) → OTP to the NABL email | DAT-07 |
| POST | `/lab/claims/{id}/verify-otp` · `/lab/claims/{id}/manual/upload-url` · `/lab/claims/{id}/manual` | auth | Verify, or upload a letterhead | DAT-07 |
| GET | `/lab/onboarding` | L-Checker | Checklist and bookability reasons | ONB-04 |
| POST | `/lab/kyc-documents/upload-url` · POST `/lab/kyc-documents` | L-Checker | KYC | ONB-04 |
| POST | `/lab/bank-accounts` | L-Checker (step-up) | Add bank details (masked in responses) | ONB-04 |
| GET/POST/PATCH | GET `/lab/users` · PATCH `/lab/users/{id}` · GET/POST `/lab/invitations` · PATCH `/lab/invitations/{id}` | L-Checker | Makers and Checkers, site assignment; revoke an invitation | ONB-06 |
| GET/PATCH | `/lab/sites/{siteId}` | L-Checker | Instructions, contact, max jobs | LAB-06 |
| PUT | `/lab/sites/{siteId}/receiving-hours` | L-Checker | Hours | LAB-06 |
| GET/POST/DELETE | GET/POST `/lab/sites/{siteId}/closures` · DELETE `/lab/sites/{siteId}/closures/{closureId}` | L-Checker | Closures (cancels slots) | EC-13 |
| GET/PUT | `/lab/sites/{siteId}/slot-templates` | L-Checker | Capacity templates | LAB-06 |
| GET/PATCH | GET `/lab/sites/{siteId}/slots` · PATCH `/lab/sites/{siteId}/slots/{slotId}` | L-Checker | Adjust or close generated slots | LAB-06 |
| GET/PUT | `/lab/sites/{siteId}/retention-rules` | L-Checker | Retention | ONB-07 |
| GET/PATCH | GET `/lab/sites/{siteId}/scope-lines` · PATCH `/lab/sites/{siteId}/scope-lines/{id}/availability` | L-Checker | Temporarily unavailable | LAB-07 |
| GET/POST | `/lab/sites/{siteId}/price-lists` | L-Checker | Versions; new DRAFT (copy of current) | ONB-05 |
| GET/POST | POST `/lab/sites/{siteId}/price-lists/imports/upload-url` · `/lab/sites/{siteId}/price-lists/imports` · GET `/lab/price-list-imports/{id}` · `/lab/price-list-imports/{id}/rows` · POST `/lab/price-list-imports/{id}/commit` · `/lab/price-list-imports/{id}/discard` | L-Checker | Bulk import → preview → commit to a DRAFT | ONB-05 |
| GET/PATCH | `/lab/price-lists/{id}/items` | L-Checker | Read and edit the draft | ONB-05 |
| POST | `/lab/price-lists/{id}/publish` · `/lab/price-lists/{id}/discard` | L-Checker | Publish (supersedes the previous one), or discard a draft | ONB-05 |
| POST | `/lab/sites/{siteId}/proposals` | L-Checker | Pin or scope correction proposal → change set | EC-04 |
| GET | `/lab/inbox?status=` | L-Maker, L-Checker | Requests, pending approvals, expected drops | LAB-01 |

## 7. Custody and receipt
| Method | Path | Who | Transition | FR |
|---|---|---|---|---|
| POST | `/custody/scan` | L-Maker | (none) Validate a QR or short code. Writes a custody event. Returns booking, TRF and expected count. | LOG-06, RPT-01 |
| POST | `/custody/scan-batch` | L-Maker | (none) Offline queue sync (`clientSeq`, `clientRecordedAt`) | EC-50 |
| POST | `/bookings/{id}/receipts/photos/upload-url` | L-Maker | Photo upload | RPT-02 |
| POST | `/bookings/{id}/receipts` | L-Maker | T-13 / T-17 | RPT-02 |
| POST | `/receipts/{id}/approve` | L-Checker | T-14 (`labSampleId`) | RPT-03 |
| POST | `/receipts/{id}/confirm-discrepancy` | L-Checker | T-15 | RPT-03 |
| POST | `/receipts/{id}/reject-unfit` | L-Checker | T-28 (CANCELLED, handling fee) | EC-35 |
| POST | `/packages/{id}/reprint-requests` · `/reprint-requests/{id}/approve` | L-Maker / L-Checker | (none) Void and reissue | EC-26 |

### 7.1 `POST /v1/custody/scan`
```json
// Request
{ "payload": "LC1.P.…", "siteId": "0193…", "deviceId": "d-7f3…", "clientRecordedAt": "…", "clientSeq": 412 }
// 200
{ "result": "ACCEPTED", "booking": { "id": "…", "bookingNo": "…", "status": "HANDOVER_SET" },
  "package": { "seqNo": 1, "total": 2, "status": "ISSUED" },
  "trf": { …summary… }, "expectedPackageCount": 2, "scannedPackages": [1] }
// 422 QR_WRONG_SITE → meta.intendedSite { name, addressLine, city }
```

## 8. Reports
| Method | Path | Who | Transition | FR |
|---|---|---|---|---|
| POST | `/bookings/{id}/report-versions/upload-url` | L-Maker | (none) Pre-signed PUT to quarantine | RPT-05 |
| POST | `/bookings/{id}/report-versions` | L-Maker | (none) Create DRAFT: fileId, reportNo, ULR, issueDate, bindPackagePayload, parameter results, amendmentReason? | RPT-05/06/09 |
| POST | `/report-versions/{id}/submit` | L-Maker | T-19 (or amendment review) | RPT-06 |
| POST | `/report-versions/{id}/return` | L-Checker | T-20 | RPT-07 |
| POST | `/report-versions/{id}/publish` | L-Checker + step-up | T-21 (or amendment release) | RPT-07/08 |
| GET | `/bookings/{id}/report` | party | Versions + status | RPT-10 |
| POST | `/report-versions/{id}/download-url` | permitted | 15-min signed URL (logged) | RPT-10 |
| POST/DELETE | `/report-versions/{id}/share-links[/{linkId}]` | C-Admin, owner, C-Fin | Create or revoke | RPT-10 |

## 9. Disputes
| Method | Path | Who | Purpose | FR |
|---|---|---|---|---|
| POST | `/bookings/{id}/disputes` | C-Admin, C-Req(own), C-Fin, L-Checker | T-22 | SUP-02 |
| GET | `/disputes/{id}` | parties, Ops | Detail | SUP-02 |
| POST | `/disputes/{id}/messages` · `/evidence/upload-url` · `/evidence` | parties | Communication and evidence | SUP-02 |
| POST | `/disputes/{id}/withdraw` | raiser | Withdraw | SUP-02 |

## 10. Admin (`/v1/admin`)
| Method | Path | Who | Purpose | FR |
|---|---|---|---|---|
| GET | `/admin/ops-board` | P-Ops | Counts by state, SLA breaches, overdue items | ADM-02 |
| GET | `/admin/bookings?…` · `/admin/bookings/{id}` | P-Ops | Search and detail (report metadata only) | ADM-02 |
| POST | `/admin/bookings/{id}/cancel` · `/override-decision` | P-Ops | Exceptional actions (reason required) | ADM-02 |
| GET/POST | `/admin/claims`, `/admin/claims/{id}/approve\|reject` | P-Ops | Claims | ADM-01 |
| POST | `/admin/kyc-documents/{id}/verify` · `/admin/bank-accounts/{id}/verify` | P-Ops / P-Fin | Verification | ADM-01 |
| GET/POST | `/admin/geocode-queue`, `/admin/lab-sites/{id}/pin` | P-Ops | Pin approval | DAT-03 |
| CRUD | `/admin/taxonomies`, `/admin/taxonomies/{id}/node-types`, `/admin/attribute-definitions` | P-Data | Configuration (through a change set) | MDM-01 |
| CRUD | `/admin/change-sets`, `/admin/change-sets/{id}/items`, `/submit`, `/approve`, `/reject`, `/publish` | P-Data / approver | Change-set workflow | MDM-03..09 |
| GET | `/admin/change-sets/{id}/impact` | P-Data | Impact analysis | MDM-07 |
| CRUD | `/admin/mapping-templates` | P-Data | Templates | MDM-04 |
| POST | `/admin/imports` (upload) · GET `/admin/imports/{id}` · `/rows` · POST `/commit` · `/discard` | P-Data | Import pipeline | MDM-04..06 |
| GET | `/admin/records/{type}/{id}/versions` | P-Data, P-Ops | History | MDM-03 |
| GET/POST | `/admin/disputes`, `/assign`, `/decide` | P-Ops | Disputes | SUP-02/03 |
| POST/DELETE | `/admin/bookings/{id}/payout-holds` | P-Ops / P-Fin | Holds | SUP-05 |
| GET/POST | `/admin/refunds`, `/admin/refunds/{id}/approve` | P-Fin | Refunds | PAY-06 |
| GET/POST | `/admin/payouts`, `/admin/payouts/{id}/release` (step-up) | P-Fin | Payouts | PAY-09 |
| GET/POST | `/admin/reconciliation/settlements` (import), `/admin/reconciliation/exceptions` | P-Fin | Reconciliation | FIN-03 |
| GET | `/admin/exports/{kind}.csv` | P-Fin | Accounting exports | FIN-04 |
| GET/PUT | `/admin/config/{key}` | P-Admin | Config parameters | ADM-03 |
| CRUD | `/admin/users`, `/admin/platform-roles` | P-Admin | Platform users | — |
| POST | `/admin/break-glass/report-access` | P-Ops request, P-Admin approve | Time-boxed access | CD-26 |
| GET | `/admin/audit-log?entityType=&entityId=&actor=` | platform | Audit search | ADM-05 |
| GET/PATCH | `/admin/leads` | P-Ops | Leads | ADM-06 |
| CRUD | `/admin/notification-templates` | P-Admin | Templates | NOT-02 |

## 11. Explicitly absent
No logistics, rider, pickup, tracking, transport-fee, subcontracting, purchase-order or supplementary-payment endpoints (SCOPE_AND_EXCLUSIONS §3).
