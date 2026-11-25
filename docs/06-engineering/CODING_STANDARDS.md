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
- **Protecting an endpoint** (details: `04-api/AUTHENTICATION_AND_AUTHORISATION.md` section 8, `02-architecture/TENANT_ISOLATION.md` section 5):
  1. Import `IdentityModule` in your module. Name the operation's roles and its `401`/`403`/`404` in the contract first.
  2. Put `@Authorised({ permission: 'booking.decide' })` on the handler (`stepUp: true` for the step-up list of AUTHENTICATION section 2). Never stack `AuthGuard` and the other guards by hand. A route with no declaration is refused.
  3. Take `@CurrentActor() actor`. Never use an organisation id from the path, query, body or headers as authority.
  4. In the service: `scope.run(actor, async (tx) => { ... })` (one transaction per use case, nothing slow inside it), and call Prisma on tenant tables only through a repository that extends `TenantRepository`.
  5. Load the resource through the repository (`assertVisible` turns `null` into 404), then `assertSiteInScope`, `assertNotSameUser` and the ○ or ◐ conditions from `grantsFor(actor.roles, code)`. Out of scope is 404; in scope but not permitted is 403.
  6. Test 401 without a token, 403 without the permission, 404 for another tenant's id, and add the isolation test for the new data.
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
