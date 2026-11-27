# Architecture decision log

**Status:** Living document. New ADRs are appended. A changed decision gets a new ADR that supersedes the old one, and the old one is never edited (except its status line).

Template:
```
## ADR-NNN: Title
- Status: Proposed | Accepted | Superseded by ADR-XXX
- Date: YYYY-MM-DD · Deciders: …
- Context: …
- Decision: …
- Alternatives: …
- Consequences: …
```

---

## ADR-001: Modular monolith with API + worker
- Status: **Accepted** (G1, 2026-11-24) · Deciders: both developers
- Context: Two developers, an MVP at B2B scale (2k bookings/day peak), strong transactional consistency needs around bookings and money.
- Decision: One NestJS codebase deployed as `api` and `worker` services, one PostgreSQL database, strict module boundaries enforced by lint, and integration through an outbox to SQS.
- Alternatives: Microservices (operational overhead too high), a single process (timers and consumers would compete with HTTP).
- Consequences: Simple transactions. Services can be extracted later along module lines.

## ADR-002: Monorepo with pnpm workspaces and Turborepo
- Status: **Accepted** (HS) · Context: Shared types, contract and state machine between web and API. Decision: as stated. Consequences: one CI pipeline, CODEOWNERS per path.

## ADR-003: Contract-first OpenAPI
- Status: **Accepted** (G2, 2026-11-25)
- Context: Two developers building opposite sides of the same workflows in parallel.
- Decision: `packages/api-contract/openapi.yaml` (split per module) is the source. Types and the client are generated. Contract tests validate the implementation.
- Alternatives: Code-first (Nest Swagger decorators). It's easier for one developer but makes parallel work riskier.
- Consequences: Contract PRs come before feature PRs (COLLABORATION_GUIDE §2).

## ADR-004: Prisma ORM with raw SQL migrations for advanced constraints
- Status: **Accepted** (G1, 2026-11-24)
- Decision: Prisma for models and queries. Raw SQL in migrations for CHECK constraints, partial indexes, triggers, PostGIS, RLS and partitions.
- Consequences: Two migration sources in one folder. Drift checks in CI.

## ADR-005: PostgreSQL RLS as defence in depth for tenant isolation
- Status: **Accepted** (G1, 2026-11-24). Spike P1-08 passed on 2026-11-24.
- Decision: Application-level scoping is primary. RLS uses `SET LOCAL app.*` inside per-request transactions, set by `withDbContext` in `packages/database`.
- Spike result: with Prisma 7.10, the `pg` driver adapter and transaction-local settings, tenants stayed isolated across reused connections, under 600 concurrent units of work on a pool of 4, and through PgBouncer in transaction mode. The fallback (application scoping plus a nightly audit query) is not needed. Details and limits are in `TENANT_ISOLATION.md` §3.
- Alternatives: App-level only (simpler, but a single bug leaks data), schema-per-tenant (doesn't fit shared booking rows).
- Alternatives for setting the context: a per-query client extension. Rejected: inside an interactive transaction its writes were committed although the transaction rolled back.
- Consequences: Every request uses an interactive transaction, which holds one pooled connection for its whole length, so no slow external call (payment gateway, S3, email) is made inside one. Prisma's defaults (2 s to get a connection, 5 s per transaction) are set deliberately per use. The application connects as login users that inherit `app_rw` or `app_worker`, never as the owner. RDS Proxy is not verified.

## ADR-006: In-house passwordless authentication
- Status: **Accepted** (G2, 2026-11-25)
- Decision: NestJS-implemented email OTP, TOTP MFA, rotating refresh tokens, sessions in Postgres, throttles in Redis.
- Alternatives: Amazon Cognito (custom auth flows for OTP are complex, and role-based MFA and step-up are awkward), a third-party IdP (data residency and cost questions for a government operator).
- Consequences: A security-critical code path, so it needs thorough tests and a pen-test focus.

## ADR-007: OpenSearch for discovery, behind a SearchService interface
- Status: **Accepted** (G2, 2026-11-25). Postgres fallback implementation retained. Revisit if benchmarks show Postgres meets NFR-03.

## ADR-008: Database-backed timers processed by the worker
- Status: **Accepted** (G1, 2026-11-24)
- Decision: A `timer` table, `FOR UPDATE SKIP LOCKED` polling every 15 s, idempotent handlers that re-check state.
- Alternatives: Temporal (powerful, but adds infrastructure), EventBridge Scheduler per timer (high cardinality, harder to test), SQS delay (maximum 15 min).
- Consequences: Simple to test with a fake clock. Throughput is ample for the MVP.

## ADR-009: Settlement and payout mechanism
- Status: **Pending**, depends on OQ-01/02. Options A/B/C in `ICICI_PAYMENT_INTEGRATION.md` §5. Interim: Option C (manual payout file).

## ADR-010: Malware scanning with GuardDuty Malware Protection for S3
- Status: **Proposed**. Verify availability and pricing in ap-south-1. Alternative: ClamAV in a Lambda or ECS task. The `MalwareScanner` interface allows either.

## ADR-011: One endpoint per state transition
- Status: **Accepted** (G2, 2026-11-25)
- Decision: `/accept`, `/reject` and `/counter` replace the FS's single `/decision` endpoint. Likewise for receipts and reports.
- Consequences: Precise permissions, simpler validation, clearer audit.

## ADR-012: Four platform roles
- Status: **Accepted** (G1, 2026-11-24). `PLATFORM_OPS`, `PLATFORM_DATA_STEWARD`, `PLATFORM_FINANCE`, `PLATFORM_ADMIN`, to support four-eyes on master data and segregation of finance duties.

## ADR-013: OpenStreetMap-based maps via self-hosted tiles and geocoder
- Status: **Proposed**, pending OQ-17. Provider interfaces allow switching (CD-34).

## ADR-014: Stamp the verification QR at report submission
- Status: **Accepted** (G2, 2026-11-25)
- Decision: The worker stamps the copy when the Maker submits. The Checker reviews the stamped copy. Publishing is a synchronous transaction. The code resolves to Not found until release.
- Consequences: No asynchronous gap between approval and release. Stamping failures surface before approval.

## ADR-015: AWS CDK (TypeScript) for infrastructure as code
- Status: **Proposed. Adopted as the default for P3-11 (2026-11-25) under the single-developer MVP defaults; to be confirmed by @Hashtrak-sh and reviewed by @akshit-anand.** Nobody has approved it yet: if the choice changes, `infrastructure/` is replaced. Alternative: Terraform. CDK chosen for a single-language codebase.
- As built (P3-11): `infrastructure/` is the CDK v2 app (TypeScript, `aws-cdk-lib` 2.x, `tsc` plus the `aws-cdk` CLI, no extra tooling), with offline assertion tests in Vitest. See `infrastructure/README.md`. Nothing is deployed.

## ADR-016: Identifiers and money representation
- Status: **Accepted** (G1, 2026-11-24). UUIDv7 primary keys generated in the application, separate human-readable references, integer paise for money, basis points for rates.

## ADR-017: Branching model
- Status: **Accepted** (product owner, Nov 2026). `production` (prod), `main` (UAT), `dev-lab`, `dev-customer`, optional feature branches. See GIT_WORKFLOW.

## ADR-018: Test tooling
- Status: **Superseded by ADR-019** (test runner only). Jest for NestJS apps, Vitest for web and packages, Testcontainers, Playwright, k6, fast-check.

## ADR-019: Vitest as the single test runner; NestJS 12 (ESM)
- Status: **Proposed** (@Hashtrak-sh agreed 2026-11-24; needs @akshit-anand's review as a shared change)
- Date: 2026-11-24 · Deciders: both developers
- Context: ADR-018 chose Jest for the NestJS apps. The current NestJS major (12) is published as ES modules only, and its official starter tests with Vitest. Jest's ES-module support is still experimental. NestJS 11, the last CommonJS line, is now tagged `legacy`.
- Decision: Use NestJS 12 with ES modules for `apps/api` and `apps/worker`, and Vitest for every app and package. Testcontainers, Playwright, k6 and fast-check from ADR-018 are unchanged. TypeScript stays on 6.0.x until `@nestjs/cli` and `typescript-eslint` support 7.
- Alternatives: NestJS 11 + Jest (matches ADR-018 as written, but starts one major behind with an ESM migration ahead). NestJS 12 + Jest in experimental ESM mode (fragile).
- Consequences: One runner and one configuration style across the monorepo. Relative imports in the NestJS apps carry the `.js` extension. `CLAUDE.md` section 6 and `TESTING_STRATEGY.md` now say Vitest where they said Jest.

## ADR-020: `packages/core` for server-side code shared by the API and the worker
- Status: **Accepted** (2026-11-25), decided by @Hashtrak-sh alone during the single-developer period. @akshit-anand reviews it when he starts (shared change).
- Date: 2026-11-25
- Context: `MODULE_BOUNDARIES.md` says `apps/api`, `apps/worker` and `apps/web` share code only through `packages/*`. The platform services (Clock, config parameters, audit with its hash chain, outbox and relay, `processed_event`) are needed by both the API (it writes audit rows and events) and the worker (it relays events and seals the audit chain). The existing packages do not fit: `packages/shared` is pure data and helpers, `packages/database` is the schema and client.
- Decision: Add a workspace package `packages/core` (`@labconnect/core`): framework-free server-side code shared by `apps/api` and `apps/worker`, organised by module folder (`packages/core/src/platform/` now, `booking/` and others as they are built). It depends on `@labconnect/database` and `@labconnect/shared` only, never on `apps/*` or on a Nest package. The apps wrap it in thin Nest providers. The module-boundary rules of `MODULE_BOUNDARIES.md` apply to `packages/core/src/<module>/` as they do to `apps/*/src/modules/<module>/`, and `dependency-cruiser` enforces both. Everything in the package takes its time from an injected `Clock` (an ESLint rule forbids `new Date()` and `Date.now()` there). Its database tests run in `pnpm test:db` on the same Testcontainers setup as `packages/database`.
- Alternatives: duplicate the services in both apps (two copies of audit and outbox logic, which must not drift); put them in `packages/shared` (mixes server-only code with the code the web app imports); have the worker import from `apps/api` (breaks the rule that apps never import each other).
- Consequences: Domain logic that both processes need has one home and can be unit-tested without Nest. `apps/<app>/src/modules/<module>` holds only wiring (providers, controllers, queue consumers). A change to `packages/core` is a shared change, like `packages/database`.

## ADR-021: `packages/ui` on Tailwind CSS 4 and Radix, with the approved tokens as the Tailwind theme; maps on MapLibre GL
- Status: **Proposed** (2026-11-26) by @akshit-anand, for review by @Hashtrak-sh (shared change, D-04).
- Date: 2026-11-26
- Context: D-04 builds the design tokens and core components that every screen uses. `DESIGN_SYSTEM.md` (draft) names Tailwind CSS with shadcn/ui on Radix; the approved boards (`designs-pass-2/`, D-03) are drawn with a plain stylesheet, `lc.css`, whose semantic tokens already use the `--color-*`, `--radius-*`, `--shadow-*` and `--font-*` names that Tailwind 4 uses for its theme. `MAPS_AND_GEOCODING.md` leaves MapLibre GL or Leaflet to the design phase, with tiles behind a configurable URL (ADR-013, OQ-17).
- Decision: (1) `packages/ui` uses **Tailwind CSS 4**; `@labconnect/ui/styles.css` declares the approved semantic tokens as the Tailwind theme and clears the default palette (`--color-*: initial`), so a component can only use a semantic colour; the provisional brand primitives (`--qci-*`, OQ-19) stay in `:root` and are the one place to change for the QCI brand. (2) Interactive primitives (tabs, dialog and sheet, checkbox, slot) come from **Radix** (`radix-ui`), styled in the package, in the shadcn/ui way, without copying shadcn's files. (3) Maps use **MapLibre GL JS** with a raster tile URL from configuration and the attribution always shown; the map is loaded on the client only, when shown, and the list view stays the accessible way to every lab. (4) Components take all user-facing text as props from the app's messages. (5) Dependencies are pinned to exact versions published at least two weeks before they are added.
- Alternatives: port `lc.css` as plain CSS classes (closest to the boards, but hand-built dialog, tab and listbox accessibility, and no guard against raw colours); copy shadcn/ui's generated components (more code to own, and its default palette fights the semantic-only rule); Leaflet (simpler, but no vector tiles later and weaker clustering styling).
- Consequences: The web app imports `tailwindcss` and `@labconnect/ui/styles.css` and lists `packages/ui/src` with `@source`. A raw palette class or a hex literal in a component fails `packages/ui/src/tokens.test.ts` (DR-13). The token test also holds `styles.css` to every semantic token of the approved `lc.css`. Production map tiles remain open (OQ-17); on a developer machine the public OpenStreetMap tiles are acceptable for light use only.
