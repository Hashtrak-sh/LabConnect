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
| P2-01 | OpenAPI skeleton, conventions, error schema, auth endpoints | S (H) | G1 | ◐ |
| P2-02 | Public search, lab pages, slots, leads | A | P2-01 | ◐ |
| P2-03 | Booking, counter, cancel, handover, hold decision | S (A) | P2-01 | ☐ |
| P2-04 | Lab onboarding, catalogue, capacity, inbox, decisions | H | P2-01 | ☐ |
| P2-05 | Custody, receipts, reports, verification, share | H | P2-01 | ☐ |
| P2-06 | Payments (adapter-level), disputes, admin | S (H) | P2-01 | ☐ |
| P2-07 | `packages/shared`: state machine table + doc-equality test, permissions map, error codes | S (H) | P2-01 | ◐ |
| P2-08 | Contract test harness | S (A) | P2-01 | ☐ |
| P2-09 | **G2 review and sign-off** | S | P2-02..08 | ☐ |

P2-01 is implemented on `feature/P2-01-openapi-skeleton`: the split contract in `packages/api-contract/openapi/` (shared components, API_CONTRACTS §1 and `/health`), generation, Redocly lint and the contract convention tests; done when that PR merges.

P2-02 is implemented on `feature/P2-02-public-search-contract`: the ten `/public` operations of API_CONTRACTS §2, the public-field deny-list test, and a doc-equality test where covering another section is one line; done when that PR merges.

P2-07 is implemented on `feature/P2-07-shared-domain`: `packages/shared/src/` holds the booking state machine (T-01..T-28 and the unambiguous §4 sub-state machines), the role → permission map, the error-code catalogue and the money helpers, with doc-equality tests against the documents, the Prisma enums, the `booking_transition` migration rows and the OpenAPI enums; done when that PR merges.

## Phase 3: Backend foundations
| ID | Task | Owner | Status |
|---|---|---|---|
| P3-01 | Platform: Clock, Config, Audit (hash chain), Outbox + relay, processed_event | H | ☐ |
| P3-02 | Timers + BusinessCalendar + holiday seed | H | ☐ |
| P3-03 | Identity: email OTP, sessions, refresh rotation, MFA, step-up | A | ☐ |
| P3-04 | Guards, CurrentActor, TenantScope, repositories, RLS wiring | H | ☐ |
| P3-05 | Permission-matrix test generator + isolation test harness | A | ☐ |
| P3-06 | Files: upload URL, quarantine, scan adapter (fake + GuardDuty), validation, download URL | H | ☐ |
| P3-07 | BookingEngine skeleton (transition function, history, guard trigger integration) | H | ☐ |
| P3-08 | Notifications: consumer, templates, email (SES/Mailpit), in-app | A | ☐ |
| P3-09 | PaymentGateway interface + FakePaymentGateway + webhook intake | H | ☐ |
| P3-10 | Search service: Postgres fallback + OpenSearch index + sync consumer | A | ☐ |
| P3-11 | IaC: UAT environment | H | ☐ |
| P3-12 | `deploy-uat.yml` | H | ☐ |

## Phase 4: Design (after G2)
| ID | Task | Owner | Status |
|---|---|---|---|
| D-01 | Finalise BRAND_GUIDELINES from the QCI PDF | H | ☐ |
| D-02 | Run Claude Design with DESIGN_MASTER_PROMPT | S | ☐ |
| D-03 | Review designs against the user flows and accessibility | S | ☐ |
| D-04 | Implement design tokens and core components in `packages/ui` | A | ☐ |

## Phase 5: Increments
Task lists are expanded per increment at its kickoff, using the IDs `I<n>-CUS-xx`, `I<n>-LAB-xx`, `I<n>-ADM-xx`, `I<n>-SHR-xx`. Each task references FR, AC and EC IDs.

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
