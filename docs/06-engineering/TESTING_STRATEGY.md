# Testing strategy

**Status:** Approved baseline. Principle: **features aren't done without their tests (CD-56). Failing code is never merged.**

## 1. Test levels and tools
| Level | Scope | Tools | Runs |
|---|---|---|---|
| Unit | Pure domain logic: state machine, money, fees, refunds, eligibility, calendar, QR payload, validation | Vitest (all apps and packages, ADR-019) | Every PR |
| Integration | Service + real Postgres/PostGIS (Testcontainers) + Redis + LocalStack | Vitest + Testcontainers | Every PR |
| Database | Migrations from empty, constraints, triggers, RLS, append-only | Vitest + Testcontainers + raw SQL | Every PR |
| API contract | Requests and responses validate against the OpenAPI contract. Every documented endpoint exists (staged). See §8. | Vitest + supertest + Ajv (JSON Schema 2020-12) | Every PR |
| Permission matrix | Every endpoint × role → expected allow/deny (generated from `permissions.ts`) | Vitest (supertest) | Every PR |
| Tenant isolation | Cross-org access for every tenant endpoint returns 404 or empty | Vitest (supertest) | Every PR |
| Workflow | Full booking lifecycle at the API level with a fake clock and fake gateway | Vitest | Every PR |
| Payment and webhook | Signature, replay, duplicate, out-of-order, amount mismatch, reconciliation | Vitest + FakePaymentGateway (+ ICICI sandbox in UAT) | Every PR / UAT |
| QR | Sign and verify, tamper, rotation, wrong site, voided label, short code | Vitest | Every PR |
| E2E | Critical user journeys in the browser | Playwright (desktop + mobile profile) | PR to `main` (smoke), nightly (full) |
| Accessibility | axe-core on key pages | Playwright + @axe-core | Nightly |
| Security | SAST (CodeQL), dependency audit, secrets scan, DAST (OWASP ZAP baseline on UAT) | GitHub | PR / nightly |
| Load | NFR-03/04/05 | k6 | Before G3 and before release |

## 2. Mandatory suites (block merge)
1. **Maker/Checker:** for receipt, report and reprint: same user → 403 at the API **and** DB CHECK violation at the SQL level. A user with both lab roles is impossible.
2. **Permission matrix:** 100% of the cells in `ROLES_AND_PERMISSIONS.md`.
3. **Tenant isolation:** every tenant endpoint.
4. **State machine:** every allowed transition succeeds. **Every disallowed (from, command) pair returns 409** (generated). The table equals the documentation (a snapshot test that parses the markdown table).
5. **Ledger invariants:** property-based tests (fast-check) over random sequences of payments, refunds, fees and payouts. Journals balance, with no over-refund and no double payout.
6. **Webhooks:** invalid signature, replay and duplicate are handled once and idempotently.
7. **Snapshot immutability:** a price list or master-data change after booking doesn't alter the booking.

## 3. Required tests per change type
| Change | Unit | Integration | Contract | Permission/Isolation | E2E |
|---|---|---|---|---|---|
| New endpoint | ✔ | ✔ | ✔ | ✔ | if user-facing journey |
| New transition | ✔ | ✔ (workflow) | ✔ | ✔ | update journey |
| Schema change | — | ✔ (DB tests) | — | RLS if tenant table | — |
| Pure rule change | ✔ | — | — | — | — |
| UI screen | component test | — | — | — | ✔ |

## 4. Database tests
- Apply all migrations to an empty DB, then: every table in `SCHEMA_SPECIFICATION.md` exists; every constraint in `INDEXES_AND_CONSTRAINTS.md` (C-01 to C-81) has a test that tries to violate it, and a test fails if one has none; `app_rw` can't UPDATE or DELETE AO tables; RLS hides other tenants' rows; `prisma migrate diff` shows no drift. `pnpm test:db` also runs the database tests of `packages/core` (platform services connected as the real `app_rw` and `app_worker` roles: grants, audit chain, outbox relay, `processOnce`). Run with `pnpm test:db` (needs Docker: the suite starts a PostGIS container, applies the migrations to a template database and gives each test file its own copy).

## 5. Coverage gates
- `packages/shared`, domain layers of `booking`, `payments`, `custody`, `reports`: **≥ 90% line, ≥ 85% branch**.
- The rest of the API: ≥ 80% line.
- Web: component and E2E coverage of critical journeys, with no global percentage gate.
- Coverage drops of more than 1% on a PR fail CI.

## 6. Test data and determinism
- Factories (`@labconnect/database/test-utils`, source in `packages/database/src/factories/`) build a platform team, customers, a scope catalogue, labs (onboarded or only listed) and bookings in any state (`bookingInState(tx, 'UNDER_TEST', { reference, customer, lab })`). They need the reference seed first, run inside a transaction on the owner connection, and walk a booking along the real transitions, so the database guards apply to test data too. `bookingInState` writes the status history, slot hold, counter-offer, payment with its ledger journal, packages and custody events, receipt, hold case, report version, dispute and payout hold. It does not write audit log, outbox events, timers, notifications, refunds, financial documents or payouts; the modules that own those add them.
- The database suite's older raw-SQL fixtures (`test/db/fixtures.ts`) stay for the constraint tests, which need to write rows the factories would refuse to.
- An injected `Clock`. No sleeps. Timers run with `TimerService.runDue(now)`.
- Each integration test runs in its own schema or transaction. Tests run in parallel by worker.

## 7. Critical E2E journeys (Playwright)
J1 happy path (AC-E2E-01) · J2 reject and alternatives · J3 counter-offer · J4 payment failure and retry · J5 no-show · J6 receipt discrepancy → hold → proceed · J7 report returned → resubmit → publish · J8 amendment and superseded verification · J9 dispute → partial refund · J10 master-data import → publish → search · J11 lab claim → onboarding → bookable · J12 mobile scanner with offline queue.

## 8. API contract tests (P2-08)
The implementation is held to the OpenAPI contract (`packages/api-contract/openapi/`) from the first endpoint on, and the check gets stricter by itself as endpoints arrive.

**Where it lives.** In `apps/api`, so it shares the API's lockfile entry, lint rules and in-process app boot: the harness in `apps/api/test/support/contract/`, its own tests in `apps/api/test/contract/`. Not in a root `tests/contract/` folder: that folder is outside the pnpm workspace (`apps/*`, `packages/*`) and the harness needs the API's dependencies.

**The helper.** Every HTTP-level API test calls the app through `contractRequest(app)`:

```ts
const app = await createTestApp(); // test/support/test-app.ts: AppModule + configureApp, in-process
const response = await contractRequest(app).post(`/v1/bookings/${id}/accept`, {
  headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key, 'If-Match': '"3"' },
});
expect(response.status).toBe(200); // then assert the domain outcome as usual
```

It matches the concrete path to a contract operation (templates under the `/v1` server prefix; a literal segment beats a parameter), then:
- **Request**, before sending: path, query and header parameters (required ones present, values valid against their schemas, no undeclared query parameters) and the JSON body (present when required, absent when the operation takes none, valid against the schema). A test that sends invalid input on purpose passes `{ invalidRequest: '<why>' }`; the response is still checked.
- **Response**: the status is declared (exact, `4XX` range or `default`), the content type is declared for it, a JSON body validates against the schema (JSON Schema 2020-12 with the OpenAPI 3.1 dialect, formats such as `uuid`, `date`, `date-time`, `email`, `uri` checked), required response headers are present and declared ones valid. Every error response must be the shared problem shape: `application/problem+json`, valid against the problem schema, a `code` from the catalogue (ERROR_HANDLING.md §2) and a `status` equal to the HTTP status.
- A violation fails the test with the operation, the JSON pointer and the reason, for example `Contract violation in the response of getHealth (GET /v1/health) → 200: response body: must NOT have additional properties ("uptimeSeconds")`.
- `undocumentedRequest(app)` calls a route that is not in the contract on purpose (an unknown path); `expectProblemResponse(response)` checks the problem shape of such a response.

**Every documented endpoint exists (staged).** `test/contract/endpoints.spec.ts` reads the routes the app really registers (from the Express router) and the operations in the contract, and fails if:
- the app serves a route the contract does not document (contract first);
- an operation is neither implemented nor listed in `apps/api/test/contract/not-implemented.txt`;
- a listed operation is implemented (the message names the line to remove), so the list only shrinks;
- the list names an operationId that is not in the contract, or is unsorted or has duplicates.

When a contract PR adds operations, add them to the list (sorted) or regenerate it with `pnpm --filter @labconnect/api contract:update-not-implemented` (it refuses to run in CI).

**Every implemented endpoint is exercised.** The helper records each operation it validated. The `contract-final` Vitest project runs after every other API test (`sequence.groupOrder`) and fails if an implemented operation was not called through `contractRequest()` in that run.

**Known gaps** are `it.fails` tests in `test/contract/generic-responses.spec.ts`, each with the reason and the task that closes it: Nest's default 404 is not the problem shape, and responses carry no `X-Request-Id` yet (Phase 3 platform work). When a gap closes, the `it.fails` test starts failing; turn it into `it`.

**For consumers.** `createApiClient({ baseUrl, fetch?, headers? })` from `@labconnect/api-contract` is a typed `openapi-fetch` client over the generated `paths` (`baseUrl` includes `/v1`). `contractExample(operationId, status)` from `@labconnect/api-contract/examples` returns the first example the contract documents for a response, as mock data for the side that is not built yet (COLLABORATION_GUIDE §2); it throws if there is none. A unit test of that package reports how many operations have no example for their success response.

**Commands.**
- `pnpm test:contract` (root): builds `@labconnect/api-contract` (bundle and types), then runs the `http` and `contract-final` projects of `apps/api`. CI job `contract`.
- `pnpm test` runs the same API tests too (all `apps/api` projects).
- `pnpm --filter @labconnect/api contract:update-not-implemented`: regenerates the not-implemented list.

**When you implement an endpoint:** write its API tests with `contractRequest()` (success and error cases), remove its line from `not-implemented.txt`, and run `pnpm test:contract`.
