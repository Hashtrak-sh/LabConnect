# Repository structure

**Status:** Approved baseline (it can be refined in P0-03 with a PR).

Tooling: **pnpm workspaces + Turborepo**, Node.js LTS (pinned in `.nvmrc` and `engines`), TypeScript strict.

```text
LabConnect/
├── .github/
│   ├── workflows/            ci.yml, deploy-uat.yml, release-production.yml, nightly.yml
│   ├── ISSUE_TEMPLATE/
│   ├── CODEOWNERS
│   └── pull_request_template.md
├── apps/
│   ├── web/                  Next.js (App Router)
│   │   ├── src/app/
│   │   │   ├── (public)/     search, lab/[siteCode], v/[code], share/[token], request-lab
│   │   │   ├── (auth)/       sign-in, mfa, invitation
│   │   │   ├── customer/     dashboard, bookings, payments, reports, org settings
│   │   │   ├── lab/          inbox, scan, receipts, testing, reports, catalogue, capacity, users, onboarding
│   │   │   └── admin/        ops board, labs, master data, imports, change sets, disputes, finance, config, audit
│   │   ├── src/features/     feature folders (customer-*, lab-*, admin-*, shared-*)
│   │   ├── src/lib/          api client (generated), auth, i18n, formatting
│   │   └── messages/en.json  i18n strings (hi.json later)
│   ├── api/                  NestJS
│   │   ├── src/
│   │   │   ├── modules/      platform, identity, files, masterdata, labs, customers, search,
│   │   │   │                 booking, custody, reports, payments, disputes, notifications, admin
│   │   │   ├── common/       guards, filters, interceptors, decorators, tenant scope
│   │   │   └── main.ts
│   │   └── test/             API tests over HTTP, in-process (supertest)
│   │       ├── support/      createTestApp(); contract/: the OpenAPI contract-test harness (contractRequest)
│   │       └── contract/     endpoint coverage, not-implemented.txt, validator tests (TESTING_STRATEGY §8)
│   └── worker/               NestJS standalone: outbox relay, consumers, timers, jobs
├── packages/
│   ├── database/             prisma/schema/*, prisma/migrations/*, src/seed/*, src/factories/* (test-utils), src/db-context.ts
│   ├── core/                 server-side code shared by api and worker, by module: src/platform/ (clock, config, audit, outbox, relay); test/db/ (Testcontainers) (ADR-020)
│   ├── api-contract/         openapi/ (openapi.yaml, paths/, components/), src/generated/ (bundle, types; git-ignored), test/,
│   │                         src/client.ts (typed client), src/examples.ts (contract examples as mocks)
│   ├── shared/               enums, booking-state-machine.ts, permissions.ts, error-codes.ts, money, time
│   ├── validation/           zod: trf.v1, imports, query params, config values
│   ├── ui/                   design-system components (design phase)
│   └── config/               eslint, tsconfig, prettier, dependency-cruiser presets
├── infrastructure/           IaC (AWS CDK in TypeScript, ADR-015 adopted as a default, P3-11): lib/stacks/ delivery, network, data, messaging, edge, compute, observability; test/ (offline assertions); scripts/ (the login-user step of the migration task); README.md. A workspace package, @labconnect/infrastructure.
├── tests/
│   ├── e2e/                  Playwright specs + fixtures
│   └── load/                 k6 scripts
├── scripts/                  dev setup, seed, db reset, codegen
├── docs/                     this documentation pack
├── Dockerfile · .dockerignore   images api, worker, migrate (one file, one target each; no web image yet)
├── docker-compose.yml        postgres+postgis, redis, opensearch, localstack, mailpit
├── turbo.json · pnpm-workspace.yaml · package.json · .nvmrc · .editorconfig · .env.example
├── eslint.config.mjs · .dependency-cruiser.cjs · .prettierignore · .gitattributes
├── CLAUDE.md · MASTER_PROMPT.md · README.md
```

**`packages/core` and the apps.** `apps/api/src/modules/<module>` and `apps/worker/src/modules/<module>` hold wiring only: Nest providers, controllers, queue consumers and the polling runner. The logic they call is in `packages/core/src/<module>/`. The package is built (`dist/`) before the apps that use it, like the other packages. Its database tests (`packages/core/test/db/`) reuse the container, template database and helpers of `packages/database/test/db/` and run in `pnpm test:db`.

**API contract tests are not in `tests/contract/`** (the original plan). They live in `apps/api/test/` (harness in `test/support/contract/`, its tests in `test/contract/`) because the pnpm workspace covers only `apps/*` and `packages/*`, and the harness boots the API in-process with the API's own dependencies and lint rules. See TESTING_STRATEGY §8.

## Ownership map (CODEOWNERS)
| Path | Owners |
|---|---|
| `apps/web/src/app/customer/`, `apps/web/src/features/customer-*`, `apps/api/src/modules/customers`, `.../search` | @akshit-anand |
| `apps/web/src/app/lab/`, `apps/web/src/features/lab-*`, `apps/api/src/modules/{labs,custody,reports}` | @Hashtrak-sh |
| `packages/database/`, `packages/core/`, `packages/api-contract/`, `packages/shared/`, `apps/api/src/modules/{booking,payments,identity,platform,masterdata}`, `infrastructure/`, `.github/` | both |
