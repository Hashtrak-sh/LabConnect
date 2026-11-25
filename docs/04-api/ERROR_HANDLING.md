# Error handling

**Status:** Approved at gate G2 (2026-11-25).

## 1. Error envelope (RFC 9457 problem+json compatible)
```json
{
  "type": "https://labconnect/errors/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "code": "INVALID_STATE_TRANSITION",
  "detail": "Booking LC-2611-0004821 cannot be accepted from state PAID.",
  "requestId": "01JD…",
  "errors": [ { "path": "lines[2].scopeLineId", "code": "SCOPE_LINE_NOT_BOOKABLE", "message": "…" } ],
  "meta": { "currentState": "PAID" }
}
```
Content type: `application/problem+json`. `detail` is safe for end users. It never includes stack traces, SQL, or other tenants' data.

## 2. Error codes (initial catalogue)

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Schema validation errors in `errors[]` |
| `UNAUTHENTICATED` | 401 | No or invalid token |
| `STEP_UP_REQUIRED` | 401 | Fresh MFA needed (`meta.maxAgeSeconds`) |
| `MFA_ENROLMENT_REQUIRED` | 403 | The role needs MFA and the user hasn't enrolled |
| `FORBIDDEN` | 403 | Role doesn't permit the action |
| `SELF_APPROVAL_FORBIDDEN` | 403 | The Checker was the Maker |
| `FOUR_EYES_REQUIRED` | 403 | Master-data approver equals preparer |
| `NOT_FOUND` | 404 | Doesn't exist **or** is outside the caller's scope |
| `INVALID_STATE_TRANSITION` | 409 | `meta.currentState` |
| `CONCURRENT_MODIFICATION` | 412 | `If-Match` mismatch |
| `REQUEST_IN_PROGRESS` | 409 | Duplicate idempotent request in flight |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different body |
| `SLOT_UNAVAILABLE` | 409 | Capacity taken |
| `SITE_NOT_BOOKABLE` | 422 | BR-001 failed (`meta.reasons[]`) |
| `SCOPE_LINE_NOT_BOOKABLE` | 422 | Not active, not priced, or wrong site |
| `OPEN_BOOKING_LIMIT` | 429 | BR-015 |
| `COUNTER_FIELD_NOT_ALLOWED` | 422 | Price or method in a counter |
| `PAYMENT_AMOUNT_MISMATCH` | 422 | Internal: capture ≠ booking total |
| `QR_INVALID_SIGNATURE` | 422 | Tampered or unknown key |
| `QR_WRONG_SITE` | 422 | `meta.intendedSite` (name and address only) |
| `PACKAGE_ALREADY_RECEIVED` | 409 | |
| `PACKAGE_VOIDED` | 422 | Old label version |
| `FILE_NOT_CLEAN` | 422 | Scan pending, infected or invalid |
| `REPORT_PARAMETER_NOT_BOOKED` | 422 | BR-061 |
| `ULR_NOT_UNIQUE` | 409 | BR-062 |
| `DISPUTE_WINDOW_CLOSED` | 422 | BR-080 |
| `RATE_LIMITED` | 429 | `Retry-After` header |
| `OTP_INVALID` / `OTP_EXPIRED` / `OTP_LOCKED` | 422/422/429 | |
| `GATEWAY_UNAVAILABLE` | 503 | Partner outage. Safe to retry. |
| `INTERNAL_ERROR` | 500 | Generic. Correlate with `requestId`. |

## 3. Implementation rules
- Domain code throws typed `DomainError(code, meta)`. A global Nest exception filter maps them to the envelope. Unknown errors become `INTERNAL_ERROR` and are logged with the stack trace (server side only).
- Codes are an enum in `packages/shared/src/error-codes.ts` and are listed in the OpenAPI `components.schemas.ErrorCode`.
- The web app maps codes to localised messages (`errors.<CODE>`). Never show raw `detail` for 5xx.
- Webhook endpoints always return 2xx once the event is persisted (even if processing fails later), to stop gateway retry storms. Processing errors go to the DLQ and alerts.
