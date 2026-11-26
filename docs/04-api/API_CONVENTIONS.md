# API conventions

**Status:** Approved at gate G2 (2026-11-25).

## 1. Contract-first
- The source of truth is the OpenAPI 3.1 contract in `packages/api-contract/openapi/`, split per module so that tasks add files rather than edit one big one:
  - `openapi.yaml`: the root (info, `/v1` server, tags, security schemes, the path list, and every component by name). Tags and paths follow the sections of `API_CONTRACTS.md`; schemas are registered file by file, each under the name it has in its file (the order is described at the top of the file and checked by `test/components.test.ts`).
  - `paths/<module>.yaml`: the path items of one module (`auth.yaml`, `me.yaml`, `health.yaml`, …). A new path is added here and listed in the root.
  - `components/schemas/`: `common.yaml` (value types and references that more than one module uses: ids, timestamps, money, `LockVersion`, codes, `GeoPoint`, `PostalAddress`, `ContactPerson`, …), `errors.yaml`, `enums.yaml` (the enums that mirror a database enum, one definition each), `files.yaml` (upload and download URLs for every module, one request, one upload answer and one download answer shape, `FILES_AND_REPORTS.md` §1 and §2), and one file per module with the same name as its `paths/` file. A module file defines only its own schemas and references the shared files for the rest; `test/components.test.ts` fails when two schemas have the same structure without a recorded reason.
  - `components/`: `parameters.yaml`, `headers.yaml` and `responses.yaml`, shared by every module.
- Commands (from the repo root):
  - `pnpm contract:generate`: bundles the files into one document (`src/generated/openapi.json`) and generates TypeScript types (`src/generated/types.ts`, `openapi-typescript`). Both are git-ignored; `build`, `typecheck`, `test` and the root `lint` run it first.
  - `pnpm --filter @labconnect/api-contract lint:openapi`: Redocly lint (`redocly.yaml`, the `recommended` rules with documented changes).
  - `pnpm --filter @labconnect/api-contract test`: the lint, plus equality with `API_CONTRACTS.md` and checks of the conventions in this document and `ERROR_HANDLING.md`.
- Process: change the YAML in a PR → both developers review it (shared change) → generate types and the web client → implement.
- The NestJS implementation is validated against the contract in CI (`pnpm test:contract`, job `contract`; see TESTING_STRATEGY §8).

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

**As built (I1-SHR-01).** `IdempotencyService` (`packages/core/src/platform/idempotency.ts`, framework-free) and the `@Idempotent()` decorator with its interceptor (`apps/api/src/common/idempotency.interceptor.ts`). No real route uses them yet; the feature routes adopt `@Idempotent()` one by one, always after `@Authorised()`, and are proved on test-only routes for now.
- **Key.** 1 to 100 visible ASCII characters. A missing or malformed key is `400` (`VALIDATION_FAILED` with status 400, the transport-level answer of ERROR_HANDLING §3), checked after authentication, so a caller without a session gets `401` first.
- **Scope.** (key, user, route). `route` is the method and the **concrete** path without the query (`POST /v1/lab/claims/<uuid>/verify-otp`), so one key used on two resources is two independent records (OQ-204). A path over 200 characters is cut and hashed. The user comes from the session (`CurrentActor`); there is no anonymous mode and `@Idempotent()` refuses (`500`, handler not run) a route without a user (OQ-203). Never use it on `/auth/*` (OQ-33).
- **Request hash.** SHA-256 of the canonical JSON of the parsed body (key order does not matter; no body equals `{}`). Headers are not part of it.
- **Claim.** An `INSERT ... ON CONFLICT DO NOTHING` on the unique index; the loser reads the row. Of N simultaneous identical requests exactly one runs and the others get `409`. Results: `started`, `replay`, `in_progress` (409), `reused` (422).
- **Stored and replayed:** 2xx, and the `404`, `409` and `422` business answers of a handler. Everything else releases the key (OQ-199). A stored problem is replayed through the exception filter with the **current** request id (the stored row keeps only code, detail, meta and field errors). A replay repeats status and body only: no `ETag` or `Location` (OQ-200).
- **Stale `IN_PROGRESS`.** After 60 seconds (`IDEMPOTENCY_LOCK_TIMEOUT_MS`) a repeat with the same body takes the row over; the operation can then run twice if the first attempt had already committed (OQ-198). The lock time (`created_at`) identifies the holder; a holder that lost the row cannot complete or abandon it.
- **Release.** `abandon` expires the row, because `app_rw` cannot DELETE (OQ-202). `complete` and `abandon` accept a transaction client, so a handler can store the response in its own transaction (OQ-201).
- **Purge.** The worker job `idempotency-purge` deletes expired rows hourly in batches of 500 (`IDEMPOTENCY_PURGE_INTERVAL_MS`, `IDEMPOTENCY_PURGE_BATCH_SIZE`), as `app_worker`, and logs a count only.
- **Stored bodies are data at rest** and can hold personal data: no log line contains a request body, a response body or a hash input.

## 6. Status codes
200 OK, 201 Created, 202 Accepted (async), 204 No Content, 400 malformed, 401 unauthenticated or step-up required, 403 forbidden (role or Maker=Checker), 404 not found or out of tenant scope, 409 state conflict, 412 precondition failed, 413 too large, 415 unsupported media, 422 validation or business rule, 429 rate limit, 5xx server. The error body is in `ERROR_HANDLING.md`.

## 7. Rate limits (Redis)
- Public search: 60/min per IP. Verification: 30/min per IP. OTP request: 5 per 15 min per destination, 20/h per IP. Authenticated: 300/min per user. Webhooks: no rate limit, but IP allow-list if ICICI publishes ranges.

## 8. Versioning
Breaking changes need `/v2` or a new endpoint. Additive changes are fine. Deprecations are announced in `CHANGELOG` with a `Deprecation` header.
