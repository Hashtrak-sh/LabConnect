# Testing strategy

**Status:** Approved baseline. Principle: **features aren't done without their tests (CD-56). Failing code is never merged.**

## 1. Test levels and tools
| Level | Scope | Tools | Runs |
|---|---|---|---|
| Unit | Pure domain logic: state machine, money, fees, refunds, eligibility, calendar, QR payload, validation | Vitest (all apps and packages, ADR-019) | Every PR |
| Integration | Service + real Postgres/PostGIS (Testcontainers) + Redis + LocalStack | Vitest + Testcontainers | Every PR |
| Database | Migrations from empty, constraints, triggers, RLS, append-only | Vitest + Testcontainers + raw SQL | Every PR |
| API contract | Responses validate against `openapi.yaml`. Every documented endpoint exists. | Vitest + an OpenAPI response validator | Every PR |
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
- Apply all migrations to an empty DB, then: every table in `SCHEMA_SPECIFICATION.md` exists; every constraint in `INDEXES_AND_CONSTRAINTS.md` C-01..C-30 has a test that tries to violate it; `app_rw` can't UPDATE or DELETE AO tables; RLS hides other tenants' rows; `prisma migrate diff` shows no drift.

## 5. Coverage gates
- `packages/shared`, domain layers of `booking`, `payments`, `custody`, `reports`: **≥ 90% line, ≥ 85% branch**.
- The rest of the API: ≥ 80% line.
- Web: component and E2E coverage of critical journeys, with no global percentage gate.
- Coverage drops of more than 1% on a PR fail CI.

## 6. Test data and determinism
- Factories (`packages/database/test-utils`) build orgs, users with roles, sites, bookings in any state (`bookingInState('UNDER_TEST')`).
- An injected `Clock`. No sleeps. Timers run with `TimerService.runDue(now)`.
- Each integration test runs in its own schema or transaction. Tests run in parallel by worker.

## 7. Critical E2E journeys (Playwright)
J1 happy path (AC-E2E-01) · J2 reject and alternatives · J3 counter-offer · J4 payment failure and retry · J5 no-show · J6 receipt discrepancy → hold → proceed · J7 report returned → resubmit → publish · J8 amendment and superseded verification · J9 dispute → partial refund · J10 master-data import → publish → search · J11 lab claim → onboarding → bookable · J12 mobile scanner with offline queue.
