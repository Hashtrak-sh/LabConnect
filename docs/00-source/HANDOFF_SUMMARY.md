> **Source document (read-only).** This is the handoff summary from the planning conversation. Binding decisions now live in `docs/01-product/CONFIRMED_DECISIONS.md`.

# LabConnect Project Handoff Summary

## 1. Purpose

This document consolidates the decisions and working context established
in the LabConnect planning conversation. It is intended to be placed in
the root of the new GitHub repository and used as a reference when
preparing the project documentation and instructing Claude Code.

The immediate goal is to prepare a complete, consistent project handoff
pack. This is a documentation and planning handoff, not an instruction
to start implementing the application yet.

## 2. Product overview

LabConnect is intended to be a government-owned and government-operated
marketplace for discovering and booking laboratory testing services.

The platform should help individuals, businesses, industries and
government organisations find suitable laboratories based on testing
requirements, capabilities, location, accreditation and pricing.

The initial focus is on industrial testing and calibration laboratories.
Medical laboratories and ISO 15189-related services are excluded from
the MVP, while the architecture should allow the platform to expand
later.

### Confirmed product principles

-   Discovery-first customer experience.
-   Unclaimed laboratories may be visible in search but cannot accept
    bookings until claimed and onboarded.
-   Laboratories independently define their service prices.
-   The MVP supports standard quotations and online payments.
-   Platform monetisation is not required for the MVP.
-   The application should provide customer, laboratory and
    platform-administration experiences in one application, with
    role-based dashboards.
-   The platform should be extensible without making the MVP
    unnecessarily complex.

## 3. Confirmed decisions

  -----------------------------------------------------------------------
  Area                                Decision
  ----------------------------------- -----------------------------------
  Ownership and operation             Government-owned and
                                      government-operated

  Customer segments                   Individuals, businesses, industries
                                      and government organisations

  Initial lab categories              Industrial testing and calibration

  Excluded initial category           Medical laboratories / ISO 15189

  Unclaimed laboratories              Discoverable, but not bookable
                                      until claimed and onboarded

  MVP monetisation                    Not required

  Pricing                             Set independently by each
                                      laboratory

  MVP booking model                   Standard quotations and online
                                      payments

  Negotiated quotations / purchase    Not included in the MVP
  orders                              

  Application structure               One application with role-based
                                      dashboards

  Lab branches                        Multiple branches under a parent
                                      laboratory organisation

  Environments                        Separate local development, staging
                                      and production environments

  Cloud account                       Existing AWS account with IAM

  Cloud region                        AWS Mumbai, `ap-south-1`

  Initial deployment recommendation   AWS ECS/Fargate

  Maps                                OpenStreetMap initially, with the
                                      ability to change provider later

  Notifications                       Email and in-app first; SMS and
                                      WhatsApp should be supportable
                                      later

  Authentication                      Combination of email/phone OTP and
                                      MFA based on role

  Customer roles                      Admin, Requester and Finance

  Laboratory roles                    Maker and Checker, mutually
                                      exclusive

  Public report verification          Public authenticity verification,
                                      without exposing the report PDF

  Data retention                      Configurable; ten years is a
                                      proposal pending legal review

  Master-data updates                 Manual admin-controlled imports and
                                      edits in MVP

  Future master-data updates          Automated NABL ingestion with
                                      administrator review

  Master-data flexibility             Configurable categories,
                                      hierarchies and attributes, with
                                      controlled transactional schemas

  Master-data sources                 Multiple formats and sources

  Lab imports                         Bulk import of price lists and
                                      scope information

  File uploads                        Secure handling of required
                                      supporting documents and file types

  QR labels                           Printable by both customer and
                                      laboratory

  Sample retention                    Record basic sample-retention
                                      period in MVP

  Subcontracting                      Excluded from MVP

  Logistics                           No rider, logistics or
                                      sample-tracking system in MVP

  Native mobile app                   Not required for MVP; responsive
                                      web application

  Disputes                            Platform Operations can decide
                                      outcomes, with configurable payout
                                      holds and auditable decisions

  Payout window                       72-hour dispute window before
                                      payout, subject to payment-provider
                                      capabilities

  Payment gateway                     ICICI Bank gateway

  Settlement model                    To be configured later, after
                                      confirming ICICI capabilities

  Financial documents                 Invoices, receipts, credit notes
                                      and refund documentation should be
                                      supported

  Development approach                Claude Code implements; user
                                      reviews architecture, functionality
                                      and code quality

  Collaboration                       Two developers working in the same
                                      GitHub repository on separate
                                      branches

  Work ownership                      One developer focuses on customer
                                      module; the user focuses on
                                      laboratory module

  Development style                   Breadth-first across modules

  CI/CD                               GitHub Actions from the beginning

  Testing                             Comprehensive automated testing

  Production deployment               Requires explicit approval
  -----------------------------------------------------------------------

## 4. Important architecture and domain requirements

### 4.1 Database and master data

The database and domain model are the first major technical milestone.

The system must support ongoing changes to accreditation frameworks,
laboratory capabilities, testing categories, standards and other master
data.

The design should include:

-   Configurable master-data categories, hierarchies and attributes.
-   Multiple import formats and sources.
-   Import mapping and preview.
-   Duplicate and inconsistency detection.
-   Review, approval and publication.
-   Versioning and change history.
-   Effective and expiry dates where applicable.
-   Active/inactive status.
-   Administrative control over modifications.
-   A future path to automated NABL data ingestion with administrator
    review.

The transactional schema should remain controlled. Configurability in
master data should not mean that core transactional entities become
arbitrary or unstructured.

### 4.2 Historical snapshots

Bookings should preserve the applicable versions of important
information at the time of booking. This includes relevant scope,
standards and prices.

A later change to master data or a laboratory's price list must not
silently change an existing booking or its historical financial record.

### 4.3 Booking and laboratory workflow

The original feature specification describes a booking-centred workflow
with controlled state transitions.

The principal workflow includes:

1.  Customer submits a booking request.
2.  Laboratory Checker accepts or rejects the request.
3.  Customer completes payment after acceptance.
4.  Customer arranges self-drop of the sample.
5.  Laboratory Maker scans the QR code and records sample count,
    condition and supporting photos.
6.  Laboratory Checker approves receipt or places it on hold.
7.  Laboratory Maker uploads the test report.
8.  Laboratory Checker approves and publishes the report, with MFA.
9.  A 72-hour dispute period applies before payout, subject to the
    confirmed settlement mechanism.

The platform should enforce Maker/Checker separation on the server, not
merely through interface controls.

### 4.4 Reports and QR verification

-   Reports should be uploaded through secure file handling.
-   Uploaded files should undergo malware scanning.
-   File integrity should be recorded, including SHA-256 checksums.
-   Report publication should require Checker approval.
-   QR signing keys should be managed securely and support rotation.
-   Public verification should expose authenticity and limited metadata
    only.
-   The report PDF itself should remain private to authorised customer
    users.
-   Shared report links should be time-limited and revocable.

### 4.5 Payments and financial records

ICICI Bank is the intended payment gateway. The actual product,
integration documentation, webhook format and marketplace or settlement
capabilities still need to be confirmed.

Do not invent ICICI API endpoints or assume that split settlement,
escrow-like holding or delayed payouts are supported.

The architecture should maintain auditable financial records and keep
customer payments, laboratory amounts, refunds, credits and any future
platform fees distinguishable.

The 72-hour payout approach is a business requirement to validate
against the bank's actual capabilities.

## 5. Technology direction

The following stack was discussed as the proposed baseline. It should be
validated during architecture design rather than treated as an
irreversible decision.

  -----------------------------------------------------------------------
  Layer                               Proposed technology
  ----------------------------------- -----------------------------------
  Frontend                            Next.js, React and TypeScript

  UI                                  Tailwind CSS and shadcn/ui

  Backend                             NestJS and TypeScript

  Database                            PostgreSQL with PostGIS

  ORM                                 Prisma

  Search                              OpenSearch

  Cache                               Redis

  Object storage                      AWS S3

  Async messaging                     AWS SQS

  API style                           REST with OpenAPI

  Validation                          Zod and/or backend validation

  Testing                             Unit, integration, API and
                                      Playwright end-to-end tests

  Containers                          Docker

  Deployment                          AWS ECS/Fargate

  CI/CD                               GitHub Actions

  Observability                       OpenTelemetry and suitable
                                      metrics/logging dashboards
  -----------------------------------------------------------------------

A monorepo is recommended. A possible starting structure is:

``` text
labconnect/
├── apps/
│   ├── web/                 # Customer, Lab and Admin interfaces
│   └── api/                 # Backend API
├── packages/
│   ├── database/
│   ├── shared/
│   ├── ui/
│   ├── validation/
│   └── config/
├── infrastructure/
├── docs/
├── scripts/
├── tests/
├── CLAUDE.md
├── MASTER_PROMPT.md
└── README.md
```

The final repository structure should be documented before
implementation begins.

## 6. Developer collaboration

Two developers will work in the same GitHub repository using Claude Code
independently.

Proposed ownership:

-   Developer 1: customer-facing module and workflows.
-   Developer 2: laboratory module and workflows.
-   Shared ownership and coordination: architecture, authentication,
    database, booking engine, master data, payments, administration,
    shared UI components and integration tests.

Working rules:

-   Use separate feature branches.
-   Do not commit directly to `main`.
-   Use pull requests and required automated checks.
-   Agree on API contracts and database changes before parallel
    implementation.
-   Do not independently invent or alter shared booking rules or schema.
-   Document shared changes and coordinate changes that affect both
    modules.
-   Keep documentation updated alongside implementation.

The project should progress breadth-first. Customer, Lab and Admin
capabilities should advance in coordinated increments rather than
completing one entire module before starting the others.

## 7. Development and quality gates

The development process should be flexible enough to allow work across
modules to proceed in parallel.

However:

-   Features cannot be marked complete without their required tests.
-   Failing code must not be merged.
-   Critical security, financial and permission workflows must pass
    their checks.
-   Maker/Checker restrictions must be tested server-side.
-   Production deployment requires explicit approval.
-   Significant architecture decisions must be documented.
-   Claude Code must not silently remove requirements or introduce
    out-of-scope features.

Required testing areas include:

-   Unit tests.
-   Integration tests.
-   API contract tests.
-   Database and migration tests.
-   Role and permission tests.
-   Tenant-isolation tests.
-   End-to-end tests.
-   Payment and webhook tests.
-   QR generation and verification tests.
-   Maker/Checker workflow tests.
-   Security tests.

## 8. Security, compliance and operational considerations

The original feature specification includes security and non-functional
requirements such as:

-   TLS 1.2 or higher.
-   Encryption at rest using managed key services.
-   MFA for sensitive roles.
-   Server-side RBAC and tenant isolation.
-   Signed, time-limited report URLs.
-   Malware scanning for uploaded files.
-   Audit trails for important actions.
-   Webhook signature verification, replay protection and idempotency.
-   Transactional outbox for reliable event publication.
-   OWASP-oriented application security testing.
-   Backup and disaster-recovery planning.
-   Accessibility target of WCAG 2.1 AA.
-   Responsive support, including a mobile-friendly laboratory QR
    scanner.

The source specification proposes service-level targets and operational
sizing, including 99.5% application availability, 99.9% payment-webhook
and public-verification availability, search p95 below 800 ms, booking
p95 below 1.5 seconds, RPO of 15 minutes and RTO of 4 hours. These
should be reviewed and formally adopted during requirements and
architecture sign-off.

Legal and regulatory requirements, including DPDP, payment-provider
rules, GST, TDS, data retention and NABL data-use permissions, require
appropriate review. The project must not claim regulatory compliance
merely because controls have been designed.

## 9. Design phase sequencing

The user explicitly wants the database, schema, tables and related
foundations established before moving to visual design.

The agreed design workflow is:

1.  Claude Design creates the initial visual design.
2.  Claude Code implements and refines it.

The design handoff should be prepared now as documentation, but should
not be executed until the database/domain model and core API contracts
have been reviewed and stabilised.

Suggested design files:

-   `DESIGN_MASTER_PROMPT.md`
-   `DESIGN_BRIEF.md`
-   `DESIGN_SYSTEM.md`
-   `BRAND_GUIDELINES.md`
-   `UX_PRINCIPLES.md`
-   `COMPONENT_SPECIFICATION.md`
-   `CUSTOMER_USER_FLOWS.md`
-   `LAB_USER_FLOWS.md`
-   `ADMIN_USER_FLOWS.md`
-   `RESPONSIVE_DESIGN_GUIDELINES.md`

The intended visual direction is a professional hybrid: credible for a
government-operated platform while retaining the clarity and usability
of a modern SaaS product.

UX priorities include simple, task-oriented dashboards, clear next
actions, minimal cognitive load and responsive workflows.

## 10. Recommended project documentation pack

The complete repository handoff should include the following
documentation, organised into a coherent structure.

### Root instructions

-   `CLAUDE.md`
-   `MASTER_PROMPT.md`
-   `README.md`

### Product and requirements

-   Project overview.
-   Confirmed decisions.
-   Scope and exclusions.
-   Functional requirements.
-   Non-functional requirements.
-   Glossary.
-   User roles and permissions.
-   Business rules.
-   Acceptance criteria.
-   Requirements traceability matrix.

### Architecture and database

-   System architecture.
-   Module boundaries.
-   Domain model.
-   Entity Relationship Diagram.
-   Database schema and table specifications.
-   Indexes, constraints and relationships.
-   Tenant-isolation strategy.
-   Migration and seed-data strategy.
-   Booking lifecycle and state machine.
-   Master-data management specification.
-   Audit and event architecture.

### APIs and integrations

-   API conventions.
-   Initial API contracts.
-   Authentication and authorisation.
-   ICICI payment integration investigation and design.
-   Notification architecture.
-   File and report management.
-   QR generation and verification.
-   Maps integration.

### Engineering and operations

-   Repository structure.
-   Coding standards.
-   Error-handling conventions.
-   Git workflow.
-   Two-developer collaboration guidelines.
-   Testing strategy.
-   CI/CD plan.
-   AWS environment and deployment plan.
-   Observability and operations.
-   Security and privacy requirements.
-   Runbook.
-   Risks and open questions.
-   Architecture decision log.
-   Roadmap and task tracker.

### Future design handoff

The design files listed in Section 9 should be maintained separately and
clearly marked as a later phase.

## 11. Recommended order of work

The agreed execution sequence is:

1.  Create the GitHub repository.
2.  Add root project instructions and documentation.
3.  Establish the monorepo structure.
4.  Define architecture and module boundaries.
5.  Design the domain model and complete ERD.
6.  Define database schemas, tables, relationships, constraints and
    indexes.
7.  Review tenant isolation, roles, auditability and versioning.
8.  Establish migrations and seed-data strategy.
9.  Review and approve the database/domain model.
10. Define core API contracts and booking state transitions.
11. Establish backend foundations.
12. Once the database and core API contracts are stable, move to Claude
    Design.
13. Implement customer, lab and admin experiences breadth-first.
14. Test, deploy to staging and complete production-readiness checks.
15. Deploy to production only after approval.

## 12. Open items requiring confirmation or investigation

These items should remain visible in the project tracker rather than
being silently assumed.

1.  ICICI gateway product, technical documentation and webhook details.
2.  Whether ICICI supports the required delayed payout, marketplace or
    split-settlement arrangement.
3.  NABL master-data source permissions and update mechanism.
4.  Legal review of retention periods and applicable regulatory
    obligations.
5.  Final initial geographic launch cluster and participating
    laboratories.
6.  Final service-level targets and infrastructure sizing.
7.  Dispute policy details, evidence requirements and operational
    timelines.
8.  Exact invoice, credit-note and refund responsibilities.
9.  Final repository name, ownership and access permissions.
10. Final technology choices after architecture validation.

## 13. Instructions for the next project session

The next project session should begin by preparing the complete
repository-ready documentation pack from the original LabConnect Feature
Specification and the decisions in this handoff.

The first implementation-oriented task should be database and domain
architecture, not visual design or broad UI implementation.

Before database implementation, produce and review:

-   Domain entities and relationships.
-   ERD.
-   Table-by-table specifications.
-   Primary and foreign keys.
-   Constraints and indexes.
-   Tenant-isolation model.
-   Versioning and historical snapshot strategy.
-   Booking state machine.
-   Role and permission matrix.
-   Migration and seed-data approach.

Do not begin the Claude Design phase until the database/domain model and
core API contracts have been reviewed and stabilised.

------------------------------------------------------------------------

**Status:** Discovery decisions consolidated. Complete repository
handoff documentation remains to be generated. No application
implementation has been started as part of this planning conversation.
