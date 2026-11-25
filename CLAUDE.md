# CLAUDE.md: Operating instructions for Claude Code

These instructions apply to every Claude Code session in this repository. Read this whole file before doing anything else.

## 1. What this project is

LabConnect is a government-operated marketplace for discovering and booking accredited (NABL) industrial testing laboratories in India. The MVP flow is: discover → book → lab Checker accepts → customer pays → customer self-drops the sample → lab Maker records receipt → Checker approves → testing → Maker uploads report → Checker approves with MFA → QR-verifiable report → 72-hour dispute window → payout.

## 2. Current phase

**Phase 3 (backend foundations) and Phase 4 (design).** Gates G1 (domain and database, 2026-11-24) and G2 (core API contracts, 2026-11-25) have passed.

While Phases 3 and 4 are open:
- **Backend:** build the platform services in the order of `docs/08-project/TASK_TRACKER.md` (Phase 3). The API contract in `packages/api-contract/` is the source of truth: change the contract first, then the implementation.
- **Design:** the design phase follows `docs/09-design-handoff/`, starting with D-01 (brand guidelines) and D-02 (the Claude Design run). Screens are implemented in `packages/ui` and `apps/web` only from approved designs (D-03).
- **Do not** build feature screens ahead of the designs, and do not start the breadth-first increments (Phase 5) before the Phase 3 foundations they depend on.

Check `docs/08-project/ROADMAP.md` at the start of every session to confirm which phase is current.

## 3. Read order for a new session

1. `CLAUDE.md` (this file)
2. `docs/01-product/CONFIRMED_DECISIONS.md`: what has been decided. Don't reopen these decisions without being asked.
3. `docs/01-product/SCOPE_AND_EXCLUSIONS.md`: what must not be built.
4. `docs/08-project/TASK_TRACKER.md`: what to work on.
5. The docs relevant to the task (the index is at `docs/README.md`).

## 4. Sources of truth and precedence

When documents disagree, apply this order (highest first):
1. `docs/01-product/CONFIRMED_DECISIONS.md` and accepted ADRs in `docs/08-project/DECISION_LOG.md`
2. The `docs/` documents in this pack
3. `docs/00-source/HANDOFF_SUMMARY.md`
4. `docs/00-source/FEATURE_SPECIFICATION.md`. Its *Specification Amendment* section overrides the rest of that document.

If you find a conflict that this order doesn't resolve, **stop and ask**. Don't pick an answer yourself.

## 5. Non-negotiable rules

### Scope
- Never add features from the exclusion list (pickup, riders, logistics, GPS tracking, subcontracting, negotiated price quotations, purchase orders, medical labs, calibration booking, native mobile apps, platform fees).
- Never remove or weaken a requirement silently. If one looks wrong, raise it as an open question.
- Keep modules extensible for the deferred features, but don't implement them.

### Security and integrity
- Maker/Checker separation is enforced **in the API and the database**, not only in the UI. A user holds exactly one lab role. A Checker can never approve a record they created as Maker.
- Every query that touches tenant data is scoped by organisation. Never accept an `orgId` from the client as authority; derive it from the authenticated membership.
- Booking state changes go only through the Booking engine's transition function. Never update `booking.status` directly anywhere else.
- Published price lists, released report versions, ledger entries, custody events, status history and audit logs are **immutable**. Corrections are new rows.
- Don't log secrets, OTPs, tokens, bank account numbers or report contents.
- Don't put personal data in URLs or query strings.

### Payments (ICICI)
- **Never invent ICICI Bank API endpoints, payload fields, webhook formats or capabilities.** Until the official documentation is in `docs/05-integrations/ICICI_PAYMENT_INTEGRATION.md`, code against the `PaymentGateway` interface and use `FakePaymentGateway` only.
- Don't assume split settlement, escrow or delayed payout support.

### Process
- Work on your developer branch (`dev-lab` or `dev-customer`) or a feature branch cut from it. **Never commit to `main` or `production`.**
- A task is done only when its tests are written and passing (see `docs/06-engineering/TESTING_STRATEGY.md`).
- Any change to `packages/database/`, `packages/api-contract/`, `packages/shared/` or the state machine is a **shared change**. Document it in the PR description and flag it for the other developer's review.
- Significant architectural decisions get an ADR entry in `docs/08-project/DECISION_LOG.md`.
- Keep docs in sync. If the implementation differs from a doc, update the doc in the same PR.
- Never deploy to production. Production deployment is a human-approved GitHub environment step.

## 6. Conventions (summary)

- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Money is integer **paise** (`bigint`), never floating point. Currency is `INR`.
- Timestamps are stored in UTC (`timestamptz`) and displayed in IST.
- IDs are UUIDv7. Human-readable references (booking numbers, short codes) are separate columns.
- API: REST, JSON, `/v1`, contract-first OpenAPI in `packages/api-contract/`. Errors follow `docs/04-api/ERROR_HANDLING.md`.
- Database naming: `snake_case` tables and columns. Prisma models are PascalCase mapped with `@@map`.
- Tests: Vitest for all apps and packages (ADR-019), Testcontainers for Postgres integration tests, Playwright for E2E.

Full details are in `docs/06-engineering/CODING_STANDARDS.md`.

## 7. When unsure

Ask. A short question is always better than a wrong assumption in booking, money, permissions or report integrity. Record anything that stays unresolved in `docs/08-project/RISKS_AND_OPEN_QUESTIONS.md`.

## 8. Developer context

| Developer | GitHub | Owns | Branch |
|---|---|---|---|
| Developer 1 | `@akshit-anand` | Customer module (search UX, booking, payment, customer dashboard) | `dev-customer` |
| Developer 2 | `@Hashtrak-sh` | Laboratory module (onboarding, pricing, capacity, receipt, reports) | `dev-lab` |
| Shared | both | Architecture, auth, database, booking engine, master data, payments core, admin, shared UI, integration tests | — |

Before you start a task, find out which developer you're working for (ask if it isn't clear). Stay within that developer's module unless the task is explicitly a shared one.
