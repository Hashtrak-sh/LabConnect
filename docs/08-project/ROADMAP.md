# Roadmap

**Status:** Approved sequencing (CD-58). Dates are set by the team once Phase 0 completes.

## Gates
| Gate | Name | Criteria | Approvers | Status |
|---|---|---|---|---|
| **G0** | Pack accepted | This documentation pack committed to `main`. Repository settings applied. | @Hashtrak-sh | ☐ |
| **G1** | Domain and database approved | `03-database/*`, `BOOKING_STATE_MACHINE.md`, `ROLES_AND_PERMISSIONS.md`, `TENANT_ISOLATION.md` reviewed. Review comments resolved. Prisma schema + migrations merged with all DB tests green. | both developers | ☐ |
| **G2** | Core API contracts stable | `openapi.yaml` for auth, search, booking, decision, payment (adapter-level), custody, receipt, report, dispute reviewed and merged. Contract tests green. | both developers | ☐ |
| **G3** | UAT sign-off | All MVP ACs pass in UAT. Load and security tests done. ICICI sandbox flow passes. | product owner + operating authority | ☐ |
| **G4** | Production approval | Legal and compliance review items closed or accepted. Runbook ready. DR drill done. Pen test with no open High findings. | product owner (+ authority) | ☐ |

**The design phase (Claude Design) can't start before G2.**

## Phases
| Phase | Goal | Main outputs |
|---|---|---|
| **0: Foundations** | Repository ready | Docs pack, GitHub settings, monorepo skeleton, docker-compose, CI pipeline |
| **1: Domain and database** | G1 | Design review, Prisma schema, SQL migrations, RLS spike, seed:reference, DB test suite |
| **2: API contracts and state machine** | G2 | OpenAPI (per module), shared enums, state machine package + tests, error catalogue, permission map |
| **3: Backend foundations** | Platform services ready | Auth (OTP, MFA, sessions), guards, tenant scope, audit, outbox + relay, timers, files + scan pipeline, config, notifications skeleton, FakePaymentGateway, AWS UAT environment (IaC) |
| **4: Design** | Visual design and components | Claude Design per `09-design-handoff/` → Claude Code implements `packages/ui` |
| **5: Breadth-first increments** | MVP features | I1–I6 below, each delivering customer, lab and admin slices together |
| **6: Hardening and UAT** | G3 | Load, security, accessibility, ICICI sandbox, DR drill, runbook, data import rehearsal |
| **7: Production launch** | G4 | Production environment, real NABL import, closed beta (20 customers, 30–50 labs) |

## Breadth-first increments (Phase 5)
| Inc | Theme | Customer slice (@akshit-anand) | Lab slice (@Hashtrak-sh) | Admin slice (shared) |
|---|---|---|---|---|
| **I1** | Directory | Public search, lab pages, request-a-lab | Claim flow (OTP and manual) | Imports, change sets, taxonomy admin, geocode queue |
| **I2** | Onboarding | Sign-up, org, sites, users | KYC, bank, users, hours, slots, retention, price-list import and publish, bookability | Claim, KYC and bank verification |
| **I3** | Request and decide | Booking create and edit, estimate, duplicate check, counter response, cancel | Inbox, accept, reject, counter, SLA reminders | Ops board v1, overrides |
| **I4** | Pay and hand over | Payment (Fake → ICICI sandbox), receipts, handover page, labels | Expected drops, counter label printing | Refund approvals, reconciliation v1 |
| **I5** | Receive, test, report | Status timeline, hold decision, report download, share, verification | Scanner (offline queue), receipt, approval, testing, report upload, bind, review, publish, amendment | Break-glass, audit viewer |
| **I6** | Close the loop | Disputes, ratings, financial documents | Dispute response, settlement advice | Disputes, payouts, holds, exports, config, templates |
