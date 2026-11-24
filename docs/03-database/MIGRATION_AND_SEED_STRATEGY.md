# Migration and seed-data strategy

**Status:** DRAFT for gate G1.

## 1. Tooling
- **Prisma Migrate** creates migrations from `schema.prisma`. **Raw SQL** migrations (in the same migrations folder, run in order) cover: extensions, PostGIS columns (`Unsupported("geography(Point,4326)")`), CHECK constraints, partial unique indexes, triggers, RLS policies, grants, and partitions.
- Rule: **one migration per PR** that changes the schema, with a descriptive name (`20261201_0900_booking_core`).
- Migrations are **forward-only**. A rollback is a new migration. Destructive changes (drop or rename) use expand → migrate data → contract across at least two releases.
- DB roles: `app_owner` (runs migrations, owns objects), `app_rw` (application, no DDL, no BYPASSRLS), `app_ro` (reporting, read replicas later).

## 2. Process
1. A developer changes the schema on their dev branch and runs `pnpm db:migrate:dev`.
2. CI applies **all migrations from empty** to a Postgres+PostGIS container, runs the schema and constraint tests, and checks that `prisma migrate diff` shows no drift.
3. On merge to `main`, the UAT deploy pipeline runs `prisma migrate deploy` as a one-off ECS task **before** the new app version rolls out.
4. Production: the same task, inside the approved release workflow, after an automated RDS snapshot.

Shared-change rule: any PR touching `packages/database/` needs approval from both developers (CODEOWNERS).

## 3. Seed data

| Set | Contents | Environments |
|---|---|---|
| `seed:reference` | Taxonomies and node types (SCOPE levels, METHOD, UNIT, all reason-code taxonomies), accreditation body (NABL), standards (17025 testing and calibration, 15189 unsupported), ledger chart of accounts, fee rules (platform fee 0, cancellation 10%, no-show 10%), config defaults (all BR defaults), notification templates (en-IN), holiday calendar (current and next year), first QR key registry entries (pointing to the environment's KMS keys) | All |
| `seed:platform-admin` | First `PLATFORM_ADMIN` user (email from an env var, MFA enrolment forced on first login) | All (separate command) |
| `seed:demo` | ~200 lab sites across Delhi NCR (fictitious, clearly marked "DEMO"), ~5,000 scope lines, 3 onboarded labs with Makers and Checkers, 3 customer orgs (individual, business, government), price lists, slots, sample bookings in every state | Local, UAT |
| `seed:load` | 15k sites, 2M scope lines, 5k customer orgs (synthetic) | Load-test env only |

Rules:
- Seeds are **idempotent** (upsert by stable `code`). Reference seeds run on every deploy.
- **No real personal data or real NABL data in the repository.** Real NABL data enters only through the admin import in each environment.
- Demo data never runs in production. The seed script refuses to run if `APP_ENV=production`.

## 4. Data import of real NABL data (per environment)
UAT: a sample of the real dataset, once permission is confirmed (OQ-03). Production: the full dataset through the import pipeline, with change-set review, before the closed beta.
