# LabConnect

**A government-operated marketplace for discovering and booking accredited laboratory testing services in India.**

> **Status:** Documentation and planning phase. No application code has been written yet.
> **Current phase:** Phase 1, the domain model and database design review (see [`docs/08-project/ROADMAP.md`](docs/08-project/ROADMAP.md)).

LabConnect helps individuals, businesses, industries and government organisations find a NABL-accredited laboratory by location, testing scope, accreditation and price. Customers book a test, pay online, drop the sample at the lab themselves, and receive a report that anyone can verify by QR code. Every sample receipt and every report goes through a Maker/Checker approval at the lab.

The MVP covers **industrial testing laboratories**. Calibration laboratories are listed and searchable, but they can't be booked yet. Medical laboratories (ISO 15189) are out of scope.

## Repository

| Item | Value |
|---|---|
| GitHub | `Hashtrak-sh/LabConnect` |
| Developers | `@Hashtrak-sh` (laboratory module), `@akshit-anand` (customer module) |
| Branches | `production` → Production · `main` → UAT · `dev-lab` and `dev-customer` → developer integration branches |
| Cloud | AWS, Mumbai region (`ap-south-1`) |
| Brand | Quality Council of India (QCI) Brand & Communication Guidelines (interim) |

## Where to start

| You are… | Read first |
|---|---|
| Claude Code | [`CLAUDE.md`](CLAUDE.md), then [`MASTER_PROMPT.md`](MASTER_PROMPT.md) |
| A developer joining the project | This file, then [`docs/README.md`](docs/README.md), then [`docs/06-engineering/GIT_WORKFLOW.md`](docs/06-engineering/GIT_WORKFLOW.md) |
| A reviewer of the database design | [`docs/03-database/`](docs/03-database/), starting with `DOMAIN_MODEL.md` |
| A product or business reviewer | [`docs/01-product/`](docs/01-product/), starting with `PROJECT_OVERVIEW.md` |
| A designer (later phase) | [`docs/09-design-handoff/`](docs/09-design-handoff/). Don't start until gate G2 has passed. |

## Proposed technology baseline

Next.js · React · TypeScript · Tailwind CSS · shadcn/ui · NestJS · PostgreSQL + PostGIS · Prisma · OpenSearch · Redis · AWS S3 · AWS SQS · Docker · AWS ECS/Fargate · GitHub Actions · OpenTelemetry · Playwright.

This stack is a **proposed baseline**. It gets validated during the architecture review, and any change is recorded in [`docs/08-project/DECISION_LOG.md`](docs/08-project/DECISION_LOG.md).

## Monorepo layout (target)

```text
LabConnect/
├── apps/
│   ├── web/            # Next.js: public pages, customer, lab and admin dashboards
│   ├── api/            # NestJS REST API
│   └── worker/         # NestJS worker: outbox relay, timers, queue consumers
├── packages/
│   ├── database/       # Prisma schema, migrations, seed data
│   ├── api-contract/   # OpenAPI specification (contract-first) and generated types
│   ├── shared/         # Domain constants, enums, state machine definition
│   ├── validation/     # Zod schemas (TRF, imports, shared DTO rules)
│   ├── ui/             # Shared React components (design phase)
│   └── config/         # ESLint, TypeScript and Prettier configuration
├── infrastructure/     # Infrastructure as code (AWS)
├── docs/               # This documentation pack
├── scripts/
├── tests/              # Cross-app end-to-end and contract tests
├── CLAUDE.md
├── MASTER_PROMPT.md
└── README.md
```

The full layout is in [`docs/06-engineering/REPOSITORY_STRUCTURE.md`](docs/06-engineering/REPOSITORY_STRUCTURE.md).

## Ground rules

1. Nothing is committed directly to `main` or `production`.
2. A feature isn't complete until its required tests pass.
3. Production deployment needs explicit, recorded approval.
4. Maker/Checker separation and tenant isolation are enforced on the server and are tested.
5. Requirements are never removed silently, and out-of-scope features are never added silently.
