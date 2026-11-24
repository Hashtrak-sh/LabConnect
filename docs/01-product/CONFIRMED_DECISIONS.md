# Confirmed decisions register

**Status:** Binding. To change a decision, create an ADR in `08-project/DECISION_LOG.md` and update this file in the same PR.

ID format: `CD-xx`. "Source" is where the decision came from: HS (handoff summary), FS (feature spec), R-xx (`00-source/SOURCE_RECONCILIATION.md`), or Q (product-owner answers, Nov 2026).

## Product

| ID | Area | Decision | Source |
|---|---|---|---|
| CD-01 | Ownership | Government-owned and government-operated. QCI brand guidelines apply for now. | HS, Q6 |
| CD-02 | Customer segments | Individuals, businesses, industries, government organisations | HS |
| CD-03 | Lab categories | Industrial **testing** labs are bookable. **Calibration** labs are listed and searchable but not bookable. **Medical (ISO 15189)** labs are excluded from import and display. | HS, R-01 |
| CD-04 | Unclaimed labs | Discoverable as "Listed", not bookable until claimed and onboarded | HS, FS FR-DAT-06 |
| CD-05 | Monetisation | No platform fee or commission in the MVP. The ledger supports a zero-valued fee line. | HS, R-05 |
| CD-06 | Pricing | Each lab site publishes its own price list | HS |
| CD-07 | Booking model | Standard (price-list) quotations and online payment | HS |
| CD-08 | Counter-offers | The Checker may propose a new slot and/or additional sample quantity. No price or method revisions. | R-02 |
| CD-09 | Excluded commercial | Negotiated quotations, purchase orders, credit terms, supplementary payments | HS, R-03 |
| CD-10 | Sample handover | Customer self-drop only. No pickup, rider, logistics or transit tracking. | FS amendment |
| CD-11 | Subcontracting | Excluded | HS, R-20 |
| CD-12 | QR labels | Printable by the customer, and by the lab Maker at the counter | HS, R-18 |
| CD-13 | Sample retention | Retention period per lab site and discipline. `retain_until` is recorded at receipt approval. | HS, R-19 |
| CD-14 | Disputes | Platform Ops decides outcomes. Payout holds are configurable. Every decision is audited. | HS |
| CD-15 | Payout window | 72-hour dispute window after report release before payout, subject to what the gateway can do | HS |
| CD-16 | Financial documents | Invoices, receipts, credit notes and refund documents are supported. Who issues which is still open (OQ-08). | HS |
| CD-17 | Report verification | Public verification shows authenticity and limited metadata. The PDF is never public. | HS |
| CD-18 | Data retention | Configurable. A 10-year default is proposed, pending legal review. | HS |
| CD-19 | Lab branches | One lab organisation, many lab sites. Each site has its own accreditation, scope, prices, capacity and users. | HS, R-04 |
| CD-20 | Language | English at launch. The UI is i18n-ready for Hindi. | Q6 |

## Roles and security

| ID | Area | Decision | Source |
|---|---|---|---|
| CD-21 | Customer roles | Customer Admin, Customer Requester, Customer Finance. One user may hold several customer roles. | HS |
| CD-22 | Lab roles | Lab Maker and Lab Checker only. They're mutually exclusive: a user holds exactly one per lab organisation. | HS, FS |
| CD-23 | Self-approval | A Checker can never approve a record they created as Maker. This is enforced in the API and the database. | FS |
| CD-24 | Bookable lab site | Claimed, onboarded, accreditation valid, testing category, published price list, and at least one active Maker and one active Checker who are different people | FS, CD-03 |
| CD-25 | Authentication | Email OTP in the MVP (phone OTP once SMS is introduced). TOTP MFA for Lab Checker, Customer Finance and all platform roles. Step-up MFA for report publishing and bank-detail changes. | HS, R-07 |
| CD-26 | Ops access to reports | Metadata only by default. Break-glass access is logged and limited to dispute investigation. | FS |

## Technical

| ID | Area | Decision | Source |
|---|---|---|---|
| CD-30 | Application shape | One web application with role-based dashboards (customer, lab, admin) plus public pages | HS |
| CD-31 | Cloud | Existing AWS account with IAM, region `ap-south-1` (Mumbai) | HS |
| CD-32 | Compute | ECS on Fargate | HS |
| CD-33 | Environments | Local, UAT (from `main`), production (from `production`) | Q8, R-13 |
| CD-34 | Maps | OpenStreetMap-based, behind a provider interface | HS |
| CD-35 | Notifications | Email and in-app in the MVP. SMS and WhatsApp can be added through the channel interface. | HS |
| CD-36 | Payment gateway | ICICI Bank. Settlement model to be decided after its capabilities are confirmed. | HS |
| CD-37 | Master data updates | Manual imports and edits by admins in the MVP. Automated NABL ingestion with admin review later. | HS |
| CD-38 | Master data model | Configurable taxonomies and attributes. Transactional tables stay strictly structured. | HS |
| CD-39 | Historical snapshots | Bookings freeze the scope, method, accreditation and price versions that applied when they were made | HS |
| CD-40 | Architecture style | Modular monolith (API + worker) with strict module boundaries, a transactional outbox and SQS | FS, HS |
| CD-41 | Proposed stack | See README. It's a baseline that gets validated in Phase 1 and Phase 2. | HS |
| CD-42 | API style | REST + JSON, `/v1`, contract-first OpenAPI | HS |
| CD-43 | Native mobile | None in the MVP. Responsive web, including the browser QR scanner. | HS |

## Process

| ID | Area | Decision | Source |
|---|---|---|---|
| CD-50 | Implementation | Claude Code implements. The developers review architecture, functionality and code quality. | HS |
| CD-51 | Repository | `github.com/Hashtrak-sh/LabConnect`. Collaborator: `akshit-anand`. | Q8 |
| CD-52 | Branches | `production` (prod), `main` (UAT), `dev-lab` (@Hashtrak-sh), `dev-customer` (@akshit-anand) | Q8 |
| CD-53 | Ownership | @akshit-anand owns the customer module, @Hashtrak-sh owns the lab module. Shared areas are co-owned. | HS, Q8 |
| CD-54 | Development style | Breadth-first increments across customer, lab and admin | HS |
| CD-55 | CI/CD | GitHub Actions from day one | HS |
| CD-56 | Testing | Comprehensive automated testing. A feature isn't done without its tests. | HS |
| CD-57 | Production release | Needs explicit approval (GitHub environment protection) | HS |
| CD-58 | Sequencing | Database and domain model first, then API contracts, then design (Claude Design), then UI | HS |
| CD-59 | Documentation format | Markdown in the repository | Q9 |
