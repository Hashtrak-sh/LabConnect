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
- Status: **Proposed** (G2)
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
- Status: **Proposed** (G2)
- Decision: NestJS-implemented email OTP, TOTP MFA, rotating refresh tokens, sessions in Postgres, throttles in Redis.
- Alternatives: Amazon Cognito (custom auth flows for OTP are complex, and role-based MFA and step-up are awkward), a third-party IdP (data residency and cost questions for a government operator).
- Consequences: A security-critical code path, so it needs thorough tests and a pen-test focus.

## ADR-007: OpenSearch for discovery, behind a SearchService interface
- Status: **Proposed** (G2). Postgres fallback implementation retained. Revisit if benchmarks show Postgres meets NFR-03.

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
- Status: **Proposed** (G2)
- Decision: `/accept`, `/reject` and `/counter` replace the FS's single `/decision` endpoint. Likewise for receipts and reports.
- Consequences: Precise permissions, simpler validation, clearer audit.

## ADR-012: Four platform roles
- Status: **Accepted** (G1, 2026-11-24). `PLATFORM_OPS`, `PLATFORM_DATA_STEWARD`, `PLATFORM_FINANCE`, `PLATFORM_ADMIN`, to support four-eyes on master data and segregation of finance duties.

## ADR-013: OpenStreetMap-based maps via self-hosted tiles and geocoder
- Status: **Proposed**, pending OQ-17. Provider interfaces allow switching (CD-34).

## ADR-014: Stamp the verification QR at report submission
- Status: **Proposed** (G2)
- Decision: The worker stamps the copy when the Maker submits. The Checker reviews the stamped copy. Publishing is a synchronous transaction. The code resolves to Not found until release.
- Consequences: No asynchronous gap between approval and release. Stamping failures surface before approval.

## ADR-015: AWS CDK (TypeScript) for infrastructure as code
- Status: **Proposed**. Alternative: Terraform. CDK chosen for a single-language codebase.

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
