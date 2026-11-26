# Task tracker

**Status:** Living document. Owner codes: **H** = @Hashtrak-sh, **A** = @akshit-anand, **S** = shared (lead named first). Status: ☐ todo · ◐ in progress · ☑ done. Move to GitHub Issues/Projects once the repository is set up (P0-07). This file stays the index.

## Phase 0: Foundations
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P0-01 | Commit the documentation pack to `main` | H | — | ☑ |
| P0-02 | Apply GitHub settings (GIT_WORKFLOW §5), create `dev-lab`, `dev-customer`, `production` | H | P0-01 | ◐ |
| P0-03 | Monorepo skeleton (pnpm, Turborepo, apps, packages, config) | S (H) | P0-02 | ☑ |
| P0-04 | docker-compose (Postgres+PostGIS, Redis, OpenSearch, LocalStack, Mailpit) + `scripts/dev-setup` | S (A) | P0-03 | ☑ |
| P0-05 | Lint, format, typecheck, dependency-cruiser config | S (A) | P0-03 | ☑ |
| P0-06 | `ci.yml` with placeholder test jobs | S (H) | P0-05 | ☑ |
| P0-07 | GitHub Project board + issue templates in use | S (A) | P0-02 | ☐ |
| P0-08 | Obtain the QCI Brand & Communication Guidelines PDF content into `09-design-handoff/BRAND_GUIDELINES.md` (OQ-19) | H | — | ☑ |

P0-02: everything in GIT_WORKFLOW §5 is applied except GitHub OIDC → AWS roles (P3-11). Required status checks on `main` and `production` were switched on on 2026-11-24 (lint, typecheck, unit, build, db, audit, codeql). During the single-developer period the owner set required approvals on `main` to 0; this goes back to 1 approval with code-owner review when A starts.

P0-03 to P0-06 are implemented on `feature/P0-03-monorepo-skeleton` and marked done when that PR merges. P0-04 and P0-05 were done by H together with P0-03 at the owner's request.

P0-08 note: the PDF (v1.0, May 2024) has no colour codes, clear-space values or web typeface. Those stay open under OQ-19 and are listed in BRAND_GUIDELINES §9.

## Phase 1: Domain and database (gate G1)
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P1-01 | Claude Code consistency review of `03-database/*` (MASTER_PROMPT Step 2) | S (H) | P0-03 | ☑ |
| P1-02 | Developers' review meeting. Resolve DOMAIN_MODEL §4 questions. | S | P1-01 | ☑ |
| P1-03 | Prisma schema: platform, identity, files | S (H) | P1-02 | ☑ |
| P1-04 | Prisma schema: master data, labs | S (H) | P1-02 | ☑ |
| P1-05 | Prisma schema: customers, booking, custody, reports | S (A) | P1-02 | ☑ |
| P1-06 | Prisma schema: payments, ledger, disputes, notifications | S (H) | P1-02 | ☑ |
| P1-07 | Raw SQL migrations: extensions, PostGIS, CHECKs, partial uniques, triggers C-01..C-30, AO protections, partitions | S (H) | P1-03..06 | ☑ |
| P1-08 | RLS spike (Prisma + SET LOCAL + pooling). Update ADR-005. | S (H) | P1-07 | ☑ |
| P1-09 | DB test suite (TESTING_STRATEGY §4) | S (A) | P1-07 | ☑ |
| P1-10 | `seed:reference`, `seed:platform-admin`, `seed:demo` | S (A) | P1-07 | ☑ |
| P1-11 | Test factories (`bookingInState`, etc.) | S (A) | P1-10 | ☑ |
| P1-12 | **G1 review and sign-off** | S | P1-08..11 | ☑ |

P1-03 to P1-07 are implemented together on `feature/P1-03-database-schema` (the Prisma schema for all 101 tables and seven migrations) and marked done when that PR merges. P1-09: the suite exists with 91 tests and covers every registered constraint; A reviews it and extends it. P1-08: the spike passed and is on `feature/P1-08-rls-spike`; done when that PR merges. P1-10 and P1-11 are implemented on `feature/P1-10-seeds-and-factories` and marked done when that PR merges; H did them at the owner's request, and A reviews them. `seed:load` is not part of P1-10 and is not built.

Single-developer period (from 2026-11-24): A is not working on the project for now. H reviews and decides alone until A starts; tasks led by A are done by H. OQ-24 to OQ-32 were settled on that basis with their defaults (`RISKS_AND_OPEN_QUESTIONS.md`). All Phase 0 and Phase 1 implementation PRs were merged to `main` on 2026-11-24. G1 was signed off by H on 2026-11-24 (`ROADMAP.md`).

## Phase 2: API contracts (gate G2)
| ID | Task | Owner | Depends | Status |
|---|---|---|---|---|
| P2-01 | OpenAPI skeleton, conventions, error schema, auth endpoints | S (H) | G1 | ☑ |
| P2-02 | Public search, lab pages, slots, leads | A | P2-01 | ☑ |
| P2-03 | Booking, counter, cancel, handover, hold decision | S (A) | P2-01 | ☑ |
| P2-04 | Lab onboarding, catalogue, capacity, inbox, decisions | H | P2-01 | ☑ |
| P2-05 | Custody, receipts, reports, verification, share | H | P2-01 | ☑ |
| P2-06 | Payments (adapter-level), disputes, admin | S (H) | P2-01 | ☑ |
| P2-07 | `packages/shared`: state machine table + doc-equality test, permissions map, error codes | S (H) | P2-01 | ☑ |
| P2-08 | Contract test harness | S (A) | P2-01 | ☑ |
| P2-09 | **G2 review and sign-off** | S | P2-02..08 | ☑ |

P2-01 is implemented on `feature/P2-01-openapi-skeleton`: the split contract in `packages/api-contract/openapi/` (shared components, API_CONTRACTS §1 and `/health`), generation, Redocly lint and the contract convention tests; done when that PR merges.

P2-02 is implemented on `feature/P2-02-public-search-contract`: the ten `/public` operations of API_CONTRACTS §2, the public-field deny-list test, and a doc-equality test where covering another section is one line; done when that PR merges.

P2-07 is implemented on `feature/P2-07-shared-domain`: `packages/shared/src/` holds the booking state machine (T-01..T-28 and the unambiguous §4 sub-state machines), the role → permission map, the error-code catalogue and the money helpers, with doc-equality tests against the documents, the Prisma enums, the `booking_transition` migration rows and the OpenAPI enums; done when that PR merges.

## Phase 3: Backend foundations
| ID | Task | Owner | Status |
|---|---|---|---|
| P3-01 | Platform: Clock, Config, Audit (hash chain), Outbox + relay, processed_event | H | ☑ |
| P3-02 | Timers + BusinessCalendar + holiday seed | H | ☑ |
| P3-03 | Identity: email OTP, sessions, refresh rotation, MFA, step-up | A | ☑ |
| P3-04 | Guards, CurrentActor, TenantScope, repositories, RLS wiring | H | ☑ |
| P3-05 | Permission-matrix test generator + isolation test harness | A | ☑ |
| P3-06 | Files: upload URL, quarantine, scan adapter (fake + GuardDuty), validation, download URL | H | ☑ |
| P3-07 | BookingEngine skeleton (transition function, history, guard trigger integration) | H | ☑ |
| P3-08 | Notifications: consumer, templates, email (SES/Mailpit), in-app | A | ☑ |
| P3-09 | PaymentGateway interface + FakePaymentGateway + webhook intake | H | ☑ |
| P3-10 | Search service: Postgres fallback + OpenSearch index + sync consumer | A | ☑ |
| P3-11 | IaC: UAT environment | H | ☑ code and tests; not deployed |
| P3-12 | `deploy-uat.yml` | H | ☑ code and tests; never run |

P3-12 is ☑ as code and tests only; **the workflow has never run, and no AWS call was made.** `.github/workflows/deploy-uat.yml` builds and pushes the `api`, `worker` and `migrate` images (tag = commit SHA, skipped when the tag exists), runs the migration task and fails on a non-zero exit code, then rolls the `api` and `worker` services and fails if the primary deployment is not the new task definition with a completed rollout (a circuit-breaker rollback is a failure), then calls `/v1/health` when `UAT_API_BASE_URL` is set. It changes the application only: it runs no CDK, and the `uat-deployer` role lost its right to assume the CDK bootstrap roles (OQ-179). It does nothing until a person sets the repository variable `UAT_DEPLOY_ENABLED` and the role ARN variable. The logic is in Node scripts under `infrastructure/scripts/deploy/`, with offline tests of the scripts and of the workflow file's invariants. Not built: a `web` service and image (skeleton), Playwright against UAT, posting results anywhere, `release-production.yml`. Open: who may trigger UAT deployments (OQ-185), image-tag drift against CDK (OQ-186), no migration rollback (OQ-187), the first real run (OQ-188), the smoke test's public URL (OQ-189), pinning actions in `ci.yml` (OQ-196), task definition revisions (OQ-197). Details: `CI_CD.md` "As built (P3-12)" and `infrastructure/README.md`.

P3-11 is ☑ as code and tests only; **nothing is deployed and no AWS account was used.** `infrastructure/` is a CDK v2 app with seven stacks (delivery, network, data, messaging, edge, compute, observability) and 150+ offline assertion tests, plus the root `Dockerfile` (targets `api`, `worker`, `migrate`) and `.dockerignore`. Left for people: the AWS account and its bootstrap, the first image push, the signing key, SES sender verification, DNS, the GitHub environment, and the staging check of the GuardDuty path (OQ-168, OQ-169). Not built: CloudFront and the web service (the web app is a skeleton), the dashboards, and alarms for signals the application does not emit yet. The API now sends the sign-in code through the SES sender the worker uses (its task role may `ses:SendEmail` on the same three resources); what stays open is a verified SES identity and leaving the SES sandbox, because in the sandbox only verified addresses can receive a sign-in code (OQ-172, OQ-175). Details: `infrastructure/README.md` and `AWS_ENVIRONMENTS_AND_DEPLOYMENT.md` "As built (P3-11)". `deploy-uat.yml` is P3-12.

P3-10 is built, with these left out on purpose or by decision: the HTTP endpoints (the customer search increment), typeahead, AWS SigV4 signing (OQ-156), pincode to point (OQ-153), the nightly rebuild with an alias swap (OQ-157), and the emitters of the events the sync consumes (OQ-158). The OpenSearch suite runs by hand (`pnpm --filter @labconnect/core test:opensearch`), not in CI. See "As built (P3-10)" in `docs/05-integrations/SEARCH.md`.

P3-06 is ☑: the file service, quarantine and clean prefixes, the fake and the GuardDuty scan result adapters (documented event shape, verdict bound to the scanned object's ETag), validation, image EXIF stripping and re-encoding (JPEG and PNG), and download URLs. Not part of it: the HTTP upload and download endpoints (they come with the feature increments, behind the P3-04 guards), the PDF library (OQ-117, deferred to report stamping), HEIC to JPEG (OQ-167), and the EventBridge rule, queue policy and staging check of GuardDuty (P3-11, OQ-168, OQ-169). See "As built (P3-06)" in `docs/05-integrations/FILES_AND_REPORTS.md`.

P3-08 is ☑ for what its text lists: the consumer, the recipient rules of the matrix, code and stored templates, the SES, SMTP and in-memory senders, the delivery pass, the worker jobs and the four `/me` endpoints. The booking adapter of the context port is now wired (the worker consumes the queue when `NOTIFICATIONS_CONTEXT_SOURCE=booking` and the queue URL are set, OQ-140, OQ-160 to OQ-164), as are the booking timer handlers and the worker's single booking engine. Not part of it, and still to do: the adapters for disputes, refunds, payouts, accreditation, invitations and label reprints, the admin template endpoints, bounce handling and Hindi. See "As built (P3-08)" in `docs/05-integrations/NOTIFICATIONS.md`.

P3-01 also adds the global exception filter (every error in the shared problem shape) and the `X-Request-Id` middleware. Three expected-failure tests in `apps/api/test/generic-responses.spec.ts` mark these gaps; they become normal tests when P3-01 closes them.

## Phase 4: Design (after G2)
| ID | Task | Owner | Status |
|---|---|---|---|
| D-01 | Finalise BRAND_GUIDELINES from the QCI PDF | H | ☐ |
| D-02 | Run Claude Design with DESIGN_MASTER_PROMPT (output: `09-design-handoff/designs/`, provisional brand values) | S | ☑ |
| D-03 | Review designs against the user flows and accessibility | S | ☐ |
| D-04 | Implement design tokens and core components in `packages/ui` | A | ☐ |

## Phase 5: Increments
Task lists are expanded per increment at its kickoff, using the IDs `I<n>-CUS-xx`, `I<n>-LAB-xx`, `I<n>-ADM-xx`, `I<n>-SHR-xx`. Each task references FR, AC and EC IDs.

### I1: Directory, customer slice (A)
Kicked off 2026-11-25 by A. Backend first: screens (`apps/web`) wait for the D-03 approval of the designs (CLAUDE.md §2). Branch: `feature/I1-CUS-public-search` from `dev-customer`.

| ID | Task | Refs | Depends | Status |
|---|---|---|---|---|
| I1-CUS-01 | `GET /public/search/labs` (`searchLabs`): query parsing, pincode port, controller over `LazySearchService` | FR-DIS-01..05, AC-DIS-01/02/05, EC-05 | P3-10, OQ-153 (pincode) | ☑ |
| I1-CUS-02 | `GET /public/lab-sites/{siteId}` profile (`getPublicLabSite`) | FR-DIS-06, AC-DIS-03/04, EC-06 | P3-04 | ☑ |
| I1-CUS-03 | `GET /public/lab-sites/{siteId}/scope` with search inside the scope | FR-DIS-06 | I1-CUS-02 | ☑ |
| I1-CUS-04 | `GET /public/lab-sites/{siteId}/prices` (bookable sites only) | FR-DIS-06, FR-BKG-03 | I1-CUS-02 | ☑ |
| I1-CUS-05 | `GET /public/lab-sites/{siteId}/slots` (no capacity counts) | FR-BKG-04, EC-13 | I1-CUS-02 | ☐ |
| I1-CUS-06 | `GET /public/taxonomies/{code}/nodes` (filter values) | FR-DIS-03 | — | ☐ |
| I1-CUS-07 | `POST /public/leads` (request a lab, no-result lead) | FR-DIS-07, AC-DIS-04, EC-05, EC-06 | OQ-194 | ☐ |
| I1-CUS-08 | `GET /public/search/suggest` (typeahead) | FR-DIS-01 | I1-CUS-01 | ☐ |
| I1-CUS-09 | Public rate limits (60/min search, leads per OQ-194) | API_CONVENTIONS §7 | OQ-88 (Redis limiter, shared with H) | ☐ |
| I1-CUS-10 | Search, lab page and request-a-lab screens | FR-DIS-01..07 | D-03, D-04 | ☐ |

I1-CUS-02 builds the first piece of the `labs` module, which @Hashtrak-sh owns: the public read side of `LabDirectoryService` (`packages/core/src/labs/`, `apps/api/src/modules/labs/`). A built it at the owner's agreement to review, so it is a shared change. It also moves `withPublicReadContext` from `search` to `platform` and the accreditation verification URL helper into `labs`, because MODULE_BOUNDARIES rule 5 forbids importing `search`. The rule for which sites are public repeats search's `visibleLinesSql` until search reads through this service (OQ-152); the database test checks both give the same answer for every site of the search world.

## Phase 6–7
| ID | Task | Owner | Status |
|---|---|---|---|
| H-01 | k6 load tests vs NFR-03..06 | A | ☐ |
| H-02 | ZAP + pen test + remediation | H | ☐ |
| H-03 | Accessibility audit (WCAG 2.1 AA) | A | ☐ |
| H-04 | ICICI sandbox certification | H | ☐ |
| H-05 | DR drill | H | ☐ |
| H-06 | Runbook completion, Ops training | S | ☐ |
| H-07 | Production environment + real NABL import rehearsal | H | ☐ |
| H-08 | G3, then G4 | S | ☐ |
