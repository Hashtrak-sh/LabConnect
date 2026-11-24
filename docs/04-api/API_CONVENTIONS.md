# API conventions

**Status:** DRAFT for gate G2.

## 1. Contract-first
- The source of truth is `packages/api-contract/openapi.yaml` (OpenAPI 3.1).
- Process: change the YAML in a PR → both developers review it (shared change) → generate types (`openapi-typescript`) and the web client → implement.
- The NestJS implementation is validated against the contract in CI (contract tests, see TESTING_STRATEGY §5).

## 2. URLs and resources
- Base: `https://<api-host>/v1`. Plural nouns, kebab-case: `/v1/lab-sites/{siteId}/price-lists`.
- Commands that are state transitions use **sub-resource verbs** under the aggregate: `POST /v1/bookings/{id}/accept`, `/reject`, `/counter`, `/cancel`. One endpoint per transition makes permissions and audit unambiguous. (The FS's single `/decision` endpoint is split up on purpose. ADR-011.)
- Scoped views: `/v1/me/...` (current user), `/v1/customer/...` (active customer org), `/v1/lab/...` (active lab org), `/v1/admin/...` (platform), `/v1/public/...` (no auth).
- IDs in URLs are UUIDs. Human references (`booking_no`) are accepted only on lookup endpoints.

## 3. Requests and responses
- JSON, `camelCase` fields. Dates are `YYYY-MM-DD`. Timestamps are ISO-8601 UTC with `Z`.
- Money: `{ "amountPaise": 123400, "currency": "INR" }`. The client formats it in Indian style.
- Single resource: the object itself. Collections: `{ "data": [...], "page": { "nextCursor": "...", "limit": 25 } }`.
- **Cursor pagination** (opaque base64 of sort key + id). `limit` defaults to 25, maximum 100.
- Filtering: `?status=REQUESTED,ACCEPTED&createdFrom=2026-11-01`. Sorting: `?sort=-createdAt`.
- Sparse expansion: `?include=lines,trf` where it's documented.

## 4. Headers
| Header | Use |
|---|---|
| `Authorization: Bearer <access JWT>` | All authenticated calls (web uses an httpOnly cookie → BFF route handler adds the header) |
| `X-Active-Membership: <uuid>` | Optional switch, validated against the session |
| `Idempotency-Key` | **Required** on every POST that creates or changes something |
| `If-Match: "<lockVersion>"` | Required on PATCH/PUT and on transition commands of mutable aggregates. A mismatch returns 412. |
| `ETag` | Returned on aggregates (`"<lockVersion>"`) |
| `X-Request-Id` | Echoed or generated, and propagated to logs and traces |

## 5. Idempotency
- Key scope: (`Idempotency-Key`, user, route). The first request stores `IN_PROGRESS`. A repeat with the same body hash returns the stored response. A repeat with a different body returns `422 IDEMPOTENCY_KEY_REUSED`. A concurrent duplicate returns `409 REQUEST_IN_PROGRESS`.
- Retained for 24 h.

## 6. Status codes
200 OK, 201 Created, 202 Accepted (async), 204 No Content, 400 malformed, 401 unauthenticated or step-up required, 403 forbidden (role or Maker=Checker), 404 not found or out of tenant scope, 409 state conflict, 412 precondition failed, 413 too large, 415 unsupported media, 422 validation or business rule, 429 rate limit, 5xx server. The error body is in `ERROR_HANDLING.md`.

## 7. Rate limits (Redis)
- Public search: 60/min per IP. Verification: 30/min per IP. OTP request: 5 per 15 min per destination, 20/h per IP. Authenticated: 300/min per user. Webhooks: no rate limit, but IP allow-list if ICICI publishes ranges.

## 8. Versioning
Breaking changes need `/v2` or a new endpoint. Additive changes are fine. Deprecations are announced in `CHANGELOG` with a `Deprecation` header.
