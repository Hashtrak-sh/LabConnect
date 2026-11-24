# API conventions

**Status:** DRAFT for gate G2.

## 1. Contract-first
- The source of truth is the OpenAPI 3.1 contract in `packages/api-contract/openapi/`, split per module so that tasks add files rather than edit one big one:
  - `openapi.yaml`: the root (info, `/v1` server, tags, security schemes, the path list, and every component by name). Tags and paths follow the sections of `API_CONTRACTS.md`; schemas are registered file by file, each under the name it has in its file (the order is described at the top of the file and checked by `test/components.test.ts`).
  - `paths/<module>.yaml`: the path items of one module (`auth.yaml`, `me.yaml`, `health.yaml`, …). A new path is added here and listed in the root.
  - `components/schemas/`: `common.yaml` (value types and references that more than one module uses: ids, timestamps, money, `LockVersion`, codes, `GeoPoint`, …), `errors.yaml`, `enums.yaml` (the enums that mirror a database enum, one definition each), `files.yaml` (upload and download URLs for every module, `FILES_AND_REPORTS.md`), and one file per module with the same name as its `paths/` file. A module file defines only its own schemas and references the shared files for the rest; `test/components.test.ts` fails when two schemas have the same structure without a recorded reason.
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

## 6. Status codes
200 OK, 201 Created, 202 Accepted (async), 204 No Content, 400 malformed, 401 unauthenticated or step-up required, 403 forbidden (role or Maker=Checker), 404 not found or out of tenant scope, 409 state conflict, 412 precondition failed, 413 too large, 415 unsupported media, 422 validation or business rule, 429 rate limit, 5xx server. The error body is in `ERROR_HANDLING.md`.

## 7. Rate limits (Redis)
- Public search: 60/min per IP. Verification: 30/min per IP. OTP request: 5 per 15 min per destination, 20/h per IP. Authenticated: 300/min per user. Webhooks: no rate limit, but IP allow-list if ICICI publishes ranges.

## 8. Versioning
Breaking changes need `/v2` or a new endpoint. Additive changes are fine. Deprecations are announced in `CHANGELOG` with a `Deprecation` header.
