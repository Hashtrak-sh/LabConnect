# MASTER_PROMPT.md: Prompts for Claude Code

This file has the prompts the developers paste into Claude Code. Section 1 is for the first session. Section 2 is the template for every task after that. Section 3 has short prompts for recurring jobs.

---

## 1. First session prompt (Phase 0 → Phase 1)

```text
You are the implementation engineer for LabConnect, a government-operated marketplace for
booking NABL-accredited industrial testing laboratories in India. Two human developers
review your work: @Hashtrak-sh (laboratory module) and @akshit-anand (customer module).

Before doing anything:
1. Read CLAUDE.md completely.
2. Read docs/README.md, docs/01-product/CONFIRMED_DECISIONS.md and
   docs/01-product/SCOPE_AND_EXCLUSIONS.md.
3. Read docs/08-project/ROADMAP.md and docs/08-project/TASK_TRACKER.md.

Then do the following, stopping for my review after each numbered step:

Step 1 – Monorepo skeleton (task P0-03..P0-06)
  Set up the monorepo described in docs/06-engineering/REPOSITORY_STRUCTURE.md using
  pnpm workspaces and Turborepo: apps/web (Next.js, no screens yet), apps/api (NestJS),
  apps/worker (NestJS standalone), packages/database, packages/api-contract,
  packages/shared, packages/validation, packages/ui (empty), packages/config.
  Add docker-compose for local Postgres+PostGIS, Redis, OpenSearch, LocalStack (S3, SQS),
  and MailHog/Mailpit. Add the GitHub Actions CI workflow from docs/06-engineering/CI_CD.md.
  Do not implement business features.

Step 2 – Database design review support (Phase 1)
  Read every file in docs/03-database/. Produce a written review that lists:
  inconsistencies between documents, missing constraints or indexes, tenant-isolation gaps,
  and anything that conflicts with docs/02-architecture/BOOKING_STATE_MACHINE.md.
  Do not write the Prisma schema yet. Wait for me to resolve the review comments.

Step 3 – Prisma schema and migrations (after I approve Step 2)
  Translate docs/03-database/SCHEMA_SPECIFICATION.md into packages/database/prisma/schema.prisma
  plus SQL migrations for what Prisma cannot express (CHECK constraints, partial unique
  indexes, triggers, PostGIS columns, RLS policies, append-only protections).
  Write migration tests and constraint tests as described in
  docs/06-engineering/TESTING_STRATEGY.md section "Database tests".

Rules:
- Never invent ICICI payment API details. Use the PaymentGateway interface and FakePaymentGateway.
- Never add out-of-scope features. Never drop a requirement silently.
- Work only on the branch I tell you (dev-lab or dev-customer). Never commit to main or production.
- If anything is ambiguous, ask me before proceeding.
```

---

## 2. Standard task prompt template

```text
Context: LabConnect. Read CLAUDE.md first if you have not in this session.

Task ID: <e.g. I3-LAB-02 from docs/08-project/TASK_TRACKER.md>
Developer: <@Hashtrak-sh | @akshit-anand>
Branch: <dev-lab | dev-customer | feature/... cut from it>

Goal: <one or two sentences>

Requirements covered: <FR IDs, e.g. FR-LAB-02, FR-LAB-09>
Relevant docs: <list>

Definition of done:
- Implementation matches the referenced docs and the OpenAPI contract.
- Unit, integration and API tests written and passing; permission and tenant-isolation
  tests included where the task touches protected data.
- REQUIREMENTS_TRACEABILITY_MATRIX.md updated for the covered FR IDs.
- Docs updated if behaviour or schema differs from what is written.
- If this touches shared areas (database, api-contract, shared, state machine), the PR
  description has a "Shared change" section explaining the impact on the other module.

Before coding: summarise your plan in at most 10 bullet points and list any questions.
Wait for my "go" before writing code.
```

---

## 3. Short prompts for recurring jobs

**Sync with UAT branch**
```text
Merge the latest origin/main into my developer branch, resolve conflicts conservatively
(never discard the other developer's shared changes), run the full test suite, and report.
```

**Review a PR from the other developer**
```text
Review PR #<n> against CLAUDE.md, CODING_STANDARDS.md and the referenced FR IDs.
Focus on: state-machine bypasses, Maker/Checker checks, tenant scoping, money handling,
missing tests, undocumented schema or contract changes. Output findings by severity.
```

**Add an ADR**
```text
Draft an ADR for <decision> in docs/08-project/DECISION_LOG.md using the template there.
Status "Proposed". List alternatives considered and consequences.
```

**Record an open question**
```text
Add this to docs/08-project/RISKS_AND_OPEN_QUESTIONS.md with the next OQ number,
owner and the default assumption we are using meanwhile: <question>.
```

---

## 4. Design phase prompt (DO NOT USE before gate G2)

The Claude Design prompt is in `docs/09-design-handoff/DESIGN_MASTER_PROMPT.md`.
