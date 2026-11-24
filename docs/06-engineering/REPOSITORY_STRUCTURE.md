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
│   │   └── src/
│   │       ├── modules/      platform, identity, files, masterdata, labs, customers, search,
│   │       │                 booking, custody, reports, payments, disputes, notifications, admin
│   │       ├── common/       guards, filters, interceptors, decorators, tenant scope
│   │       └── main.ts
│   └── worker/               NestJS standalone: outbox relay, consumers, timers, jobs
├── packages/
│   ├── database/             prisma/schema/*, prisma/migrations/*, src/seed/*, src/factories/* (test-utils), src/db-context.ts
│   ├── api-contract/         openapi.yaml, generated/ (types, client)
│   ├── shared/               enums, booking-state-machine.ts, permissions.ts, error-codes.ts, money, time
│   ├── validation/           zod: trf.v1, imports, query params, config values
│   ├── ui/                   design-system components (design phase)
│   └── config/               eslint, tsconfig, prettier, dependency-cruiser presets
├── infrastructure/           IaC (AWS CDK in TypeScript, proposed ADR-015): network, data, compute, edge, observability
├── tests/
│   ├── e2e/                  Playwright specs + fixtures
│   ├── contract/             OpenAPI contract tests
│   └── load/                 k6 scripts
├── scripts/                  dev setup, seed, db reset, codegen
├── docs/                     this documentation pack
├── docker-compose.yml        postgres+postgis, redis, opensearch, localstack, mailpit
├── turbo.json · pnpm-workspace.yaml · package.json · .nvmrc · .editorconfig · .env.example
├── eslint.config.mjs · .dependency-cruiser.cjs · .prettierignore · .gitattributes
├── CLAUDE.md · MASTER_PROMPT.md · README.md
```

## Ownership map (CODEOWNERS)
| Path | Owners |
|---|---|
| `apps/web/src/app/customer/`, `apps/web/src/features/customer-*`, `apps/api/src/modules/customers`, `.../search` | @akshit-anand |
| `apps/web/src/app/lab/`, `apps/web/src/features/lab-*`, `apps/api/src/modules/{labs,custody,reports}` | @Hashtrak-sh |
| `packages/database/`, `packages/api-contract/`, `packages/shared/`, `apps/api/src/modules/{booking,payments,identity,platform,masterdata}`, `infrastructure/`, `.github/` | both |
