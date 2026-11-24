# LabConnect documentation index

This pack is the reference for everyone working on LabConnect. Documents marked **DRAFT** are waiting for review. Once a document is reviewed, change its status line and record the approval in `08-project/DECISION_LOG.md`.

## 00: Source material (read-only)
| File | Purpose |
|---|---|
| [FEATURE_SPECIFICATION.md](00-source/FEATURE_SPECIFICATION.md) | The original LabConnect feature specification (v1.0 draft, Oct 2026), converted from .docx. The amendment at the top overrides the rest of it. |
| [HANDOFF_SUMMARY.md](00-source/HANDOFF_SUMMARY.md) | Decisions from the planning conversation |
| [SOURCE_RECONCILIATION.md](00-source/SOURCE_RECONCILIATION.md) | Where the two sources disagreed and how each conflict was resolved |

## 01: Product and requirements
| File | Purpose |
|---|---|
| [PROJECT_OVERVIEW.md](01-product/PROJECT_OVERVIEW.md) | Vision, users, goals, success metrics |
| [CONFIRMED_DECISIONS.md](01-product/CONFIRMED_DECISIONS.md) | The binding decision register |
| [SCOPE_AND_EXCLUSIONS.md](01-product/SCOPE_AND_EXCLUSIONS.md) | What's in the MVP, what's deferred, what's excluded |
| [FUNCTIONAL_REQUIREMENTS.md](01-product/FUNCTIONAL_REQUIREMENTS.md) | Every requirement by module, with its MVP disposition |
| [NON_FUNCTIONAL_REQUIREMENTS.md](01-product/NON_FUNCTIONAL_REQUIREMENTS.md) | Performance, availability, accessibility, security targets |
| [ROLES_AND_PERMISSIONS.md](01-product/ROLES_AND_PERMISSIONS.md) | Roles and the permission matrix |
| [BUSINESS_RULES.md](01-product/BUSINESS_RULES.md) | Numbered business rules (BR-xxx) |
| [EDGE_CASES.md](01-product/EDGE_CASES.md) | Exception handling (EC-xx) with MVP disposition |
| [NOTIFICATIONS_MATRIX.md](01-product/NOTIFICATIONS_MATRIX.md) | Who gets told what, and on which channel |
| [ACCEPTANCE_CRITERIA.md](01-product/ACCEPTANCE_CRITERIA.md) | Testable Given/When/Then criteria |
| [REQUIREMENTS_TRACEABILITY_MATRIX.md](01-product/REQUIREMENTS_TRACEABILITY_MATRIX.md) | Requirement → design → API → table → test |
| [GLOSSARY.md](01-product/GLOSSARY.md) | Terms and abbreviations |

## 02: Architecture
| File | Purpose |
|---|---|
| [SYSTEM_ARCHITECTURE.md](02-architecture/SYSTEM_ARCHITECTURE.md) | Runtime components, deployment shape, key flows |
| [MODULE_BOUNDARIES.md](02-architecture/MODULE_BOUNDARIES.md) | Backend modules, what each owns, dependency rules |
| [BOOKING_STATE_MACHINE.md](02-architecture/BOOKING_STATE_MACHINE.md) | The authoritative booking lifecycle |
| [TENANT_ISOLATION.md](02-architecture/TENANT_ISOLATION.md) | The multi-tenancy model and how it's enforced |
| [AUDIT_AND_EVENT_ARCHITECTURE.md](02-architecture/AUDIT_AND_EVENT_ARCHITECTURE.md) | Audit log, outbox, domain events, timers |

## 03: Database (DRAFT, review is gate G1)
| File | Purpose |
|---|---|
| [DOMAIN_MODEL.md](03-database/DOMAIN_MODEL.md) | Aggregates, entities and the reasoning behind them |
| [ERD.md](03-database/ERD.md) | Entity relationship diagrams (Mermaid) |
| [SCHEMA_SPECIFICATION.md](03-database/SCHEMA_SPECIFICATION.md) | Table-by-table specification |
| [INDEXES_AND_CONSTRAINTS.md](03-database/INDEXES_AND_CONSTRAINTS.md) | Keys, checks, partial uniques, triggers, indexes |
| [VERSIONING_AND_SNAPSHOTS.md](03-database/VERSIONING_AND_SNAPSHOTS.md) | Effective dating, versioning, booking snapshots |
| [MASTER_DATA_MANAGEMENT.md](03-database/MASTER_DATA_MANAGEMENT.md) | Configurable taxonomies, imports, review and publication |
| [MIGRATION_AND_SEED_STRATEGY.md](03-database/MIGRATION_AND_SEED_STRATEGY.md) | Migrations, seed data, environments |
| [DESIGN_REVIEW_P1-01.md](03-database/DESIGN_REVIEW_P1-01.md) | Consistency review of this folder (task P1-01). Open findings for the P1-02 meeting. |

## 04: API (DRAFT, review is gate G2)
| File | Purpose |
|---|---|
| [API_CONVENTIONS.md](04-api/API_CONVENTIONS.md) | URL, versioning, pagination, idempotency, concurrency |
| [API_CONTRACTS.md](04-api/API_CONTRACTS.md) | The initial endpoint catalogue with request and response shapes |
| [AUTHENTICATION_AND_AUTHORISATION.md](04-api/AUTHENTICATION_AND_AUTHORISATION.md) | OTP, MFA, sessions, RBAC, guards |
| [ERROR_HANDLING.md](04-api/ERROR_HANDLING.md) | The error envelope and codes |

## 05: Integrations and capabilities
| File | Purpose |
|---|---|
| [ICICI_PAYMENT_INTEGRATION.md](05-integrations/ICICI_PAYMENT_INTEGRATION.md) | Investigation checklist and adapter design (no invented APIs) |
| [PAYMENTS_AND_LEDGER.md](05-integrations/PAYMENTS_AND_LEDGER.md) | Payments, refunds, payouts, ledger, financial documents |
| [NOTIFICATIONS.md](05-integrations/NOTIFICATIONS.md) | Notification architecture (email and in-app now, SMS and WhatsApp later) |
| [FILES_AND_REPORTS.md](05-integrations/FILES_AND_REPORTS.md) | Uploads, malware scanning, hashing, report lifecycle |
| [QR_AND_VERIFICATION.md](05-integrations/QR_AND_VERIFICATION.md) | QR payloads, signing, key rotation, public verification |
| [MAPS_AND_GEOCODING.md](05-integrations/MAPS_AND_GEOCODING.md) | OpenStreetMap, geocoding, the provider abstraction |
| [SEARCH.md](05-integrations/SEARCH.md) | The OpenSearch index design and sync |

## 06: Engineering
| File | Purpose |
|---|---|
| [REPOSITORY_STRUCTURE.md](06-engineering/REPOSITORY_STRUCTURE.md) | Monorepo layout |
| [CODING_STANDARDS.md](06-engineering/CODING_STANDARDS.md) | Code conventions |
| [GIT_WORKFLOW.md](06-engineering/GIT_WORKFLOW.md) | Branches, PRs, releases, hotfixes |
| [COLLABORATION_GUIDE.md](06-engineering/COLLABORATION_GUIDE.md) | How two developers and Claude Code work in parallel |
| [TESTING_STRATEGY.md](06-engineering/TESTING_STRATEGY.md) | Test levels, mandatory suites, coverage gates |
| [CI_CD.md](06-engineering/CI_CD.md) | GitHub Actions pipelines |

## 07: Operations
| File | Purpose |
|---|---|
| [AWS_ENVIRONMENTS_AND_DEPLOYMENT.md](07-operations/AWS_ENVIRONMENTS_AND_DEPLOYMENT.md) | Environments, AWS services, deployment, backup and DR |
| [SECURITY_AND_PRIVACY.md](07-operations/SECURITY_AND_PRIVACY.md) | Security controls, privacy, compliance review items |
| [OBSERVABILITY.md](07-operations/OBSERVABILITY.md) | Logs, metrics, traces, alerts, SLO dashboards |
| [RUNBOOK.md](07-operations/RUNBOOK.md) | Operational procedures |

## 08: Project management
| File | Purpose |
|---|---|
| [ROADMAP.md](08-project/ROADMAP.md) | Phases, gates, breadth-first increments |
| [TASK_TRACKER.md](08-project/TASK_TRACKER.md) | The task backlog with owners |
| [RISKS_AND_OPEN_QUESTIONS.md](08-project/RISKS_AND_OPEN_QUESTIONS.md) | Risk register and open questions |
| [DECISION_LOG.md](08-project/DECISION_LOG.md) | Architecture decision records |

## 09: Design handoff (LATER PHASE, don't start before gate G2)
See [09-design-handoff/README.md](09-design-handoff/README.md).
