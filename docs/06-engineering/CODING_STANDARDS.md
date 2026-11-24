# Coding standards

**Status:** Approved baseline.

## 1. General
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an explanatory `// eslint-disable-next-line` comment.
- ESLint (typescript-eslint, strict-type-checked) + Prettier. `dependency-cruiser` enforces the module rules in `02-architecture/MODULE_BOUNDARIES.md`.
- Naming: `PascalCase` types and classes, `camelCase` variables and functions, `SCREAMING_SNAKE` enum values, kebab-case file names.
- Small, pure functions for rules (fees, refunds, eligibility, state transitions), unit-tested exhaustively.
- No magic numbers for business values. Read them from `ConfigService` (with defaults from `packages/shared/config-defaults.ts`).

## 2. Backend (NestJS)
- Module layout: `controller` (HTTP only) → `application service` (use cases, transactions) → `domain` (pure rules, entities, errors) → `repository` (Prisma, tenant-scoped).
- **Transactions**: one use case = one DB transaction. Outbox, audit and history are written inside it.
- **Never** call another module's repository. Use its exported service or react to its events.
- **Booking status** changes only through `BookingEngine.transition(bookingId, transitionId, actor, input)`.
- DTO validation through generated OpenAPI types + Zod (or class-validator) at the controller boundary. Domain inputs are typed, already-validated objects.
- Time: inject `Clock`. Never call `new Date()` in domain code.
- Money: the `Money` helpers in `packages/shared` (`bigint` paise). Never use floats.
- Errors: throw `DomainError(code, meta)`. Never throw HTTP exceptions from the domain layer.
- Logging: structured (pino). Include `requestId`, `bookingId` and `actorId`. **Never** log OTPs, tokens, secrets, bank numbers, PAN, report content or raw webhook bodies.
- External calls go through adapters with timeouts, retries (idempotent operations only) and circuit breakers.

## 3. Database
- Follow `03-database/SCHEMA_SPECIFICATION.md` conventions. Every schema change comes with a migration, a test and a docs update.
- Use `SELECT … FOR UPDATE` (Prisma `$queryRaw` helper) when changing aggregates with invariants.
- No N+1 queries in list endpoints. Use explicit `include`/`select`.

## 4. Frontend (Next.js) (design phase onwards)
- Server Components for public pages (SEO). Client components for dashboards. TanStack Query for server state.
- All strings come from `messages/en.json` (next-intl). Never hard-code user-facing text.
- Format money with `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})` and dates in `Asia/Kolkata`.
- Accessibility: semantic HTML, labelled controls, focus management, axe checks in tests.
- Never compute permissions in the UI as a security measure. The UI only hides what the API also forbids.

## 5. Tests
See `TESTING_STRATEGY.md`. Test names describe behaviour: `it('rejects approval when checker is the maker')`.

## 6. Commits
Conventional Commits: `feat(booking): add counter-offer endpoint`, `fix(custody): …`, `docs: …`, `chore: …`, `test: …`. Reference the task ID in the body (`Task: I3-LAB-02`).
