# Domain model

**Status:** DRAFT. Review is gate **G1**. Reviewers: @Hashtrak-sh, @akshit-anand.

This document explains *what* the entities are and *why* they're shaped this way. Column-level detail is in `SCHEMA_SPECIFICATION.md`. Diagrams are in `ERD.md`.

## 1. Design principles
1. **Booking is the aggregate root** of the transaction. Every change to booking state goes through `BookingEngine.transition()`.
2. **Configurable master data, controlled transactions.** Taxonomies (disciplines, groups, products, parameters, methods, units, reason codes) are configurable data. Transactional entities (booking, payment, report…) are fixed tables with real columns, foreign keys and CHECK constraints. JSONB is used only for (a) validated extension attributes on master data, (b) the TRF form body, validated against a versioned Zod schema, (c) frozen snapshots, (d) raw import and webhook payloads.
3. **Immutability of history.** Published or released things are never updated in place: price lists, report versions, ledger entries, custody events, status history, audit log, master-data versions, issued financial documents. Corrections are new rows.
4. **Snapshots at commitment points.** A booking stores what it was sold: price, GST rate, scope-line version, method, range, and accreditation certificate and validity. Later master-data changes never change existing bookings or financial records.
5. **Separation of duties is part of the data.** Rows that need two people carry both `maker_user_id` and `checker_user_id`, with `CHECK (checker_user_id IS NULL OR checker_user_id <> maker_user_id)`.
6. **Tenant keys on every row** that belongs to an organisation, so RLS and repository scoping are possible. Composite foreign keys guarantee that a child's keys equal its parent's.
7. **Money as integer paise**, and a **double-entry ledger** keeps customer money, lab payables, refunds, credits and (future) platform fees separate.

## 2. Bounded areas and aggregates

### 2.1 Identity and organisations
- **Organisation** (tenant): `CUSTOMER`, `LAB` or `PLATFORM`. Customer segment: `INDIVIDUAL`, `BUSINESS`, `INDUSTRY`, `GOVERNMENT`. A lab organisation can exist **unclaimed** (no members), created from NABL import.
- **AppUser**: a global identity (email, later phone). It isn't tied to one organisation.
- **Membership**: user ↔ organisation, with roles (`membership_role`). Lab memberships hold exactly one lab role and are assigned to sites (`membership_site`).
- Authentication artefacts: OTP challenges, MFA factors, sessions, invitations.

### 2.2 Master data
- **Taxonomy → NodeType (levels) → Node (values)**, with **AttributeDefinitions** per node type. The scope hierarchy is one taxonomy (`SCOPE`) with levels `DISCIPLINE → GROUP → PRODUCT → PARAMETER`. Test methods and standards are a separate taxonomy (`METHOD`), because one method serves many parameters. Reason codes, units, sample conditions and so on are further taxonomies.
- **Node versions** keep the full history. Each node has a stable `id` and a stable `code`.
- **ChangeSet** is the unit of review: prepared by one platform user (or proposed by a lab Checker), approved by another, then published atomically.
- **Import jobs** stage rows from CSV or Excel through a **mapping template** and produce change items.
- Reference entities: **AccreditationBody** (NABL) and **AccreditationStandard** (ISO/IEC 17025 testing, ISO/IEC 17025 calibration, ISO 15189 medical, with an `is_supported` flag).

### 2.3 Labs
- **LabSite** belongs to a lab organisation. It holds address, geo point (approved), receiving setup and the derived `is_bookable`. Claim status is on the organisation. Non-public contact details are in **LabSitePrivate**. **LabPenalty** records penalties for scoring.
- **Accreditation** belongs to a lab site: certificate number, standard, category (`TESTING` / `CALIBRATION`), validity and status. Versioned.
- **ScopeLine** belongs to a site and an accreditation and points to taxonomy nodes (discipline, group, product, parameter) and a method node, plus a range and a site type. Versioned.
- **PriceList** (per site, versioned, `DRAFT → PUBLISHED → SUPERSEDED`) and **PriceItem** (per scope line: price, prep charge, GST rate, sample quantity and packaging, TAT, availability).
- Operational configuration: **ReceivingHours**, **SiteClosure**, **RetentionRule**, **SlotTemplate**, **Slot**.
- Onboarding: **LabClaimRequest**, **KycDocument**, **BankAccount** (encrypted, verified).

### 2.4 Customers
- **CustomerSite** (plants and offices, geo, billing details), **CustomerSettings** (e.g. `requester_can_pay`), **LeadRequest** ("request this lab" and no-result leads).

### 2.5 Booking (aggregate root)
- **Booking**: customer org, requester, lab site (and lab org, denormalised), status, slot, money totals (snapshotted), deadlines, flags (deviation, on-behalf-of).
- **BookingLine**: one per parameter. Points to the `scope_line_version` and `price_item` used, and holds a frozen snapshot plus line status.
- **TRF**: versioned form body (JSONB, Zod-validated by `schema_version`).
- **BookingStatusHistory**: every transition.
- **CounterOffer**: the slot and/or quantity proposal and the response.
- **SlotHold**: capacity reservation while REQUESTED or COUNTERED.
- **BookingTransition**: the legal transitions as reference data, read by the status guard trigger.

### 2.6 Custody
- **Package**: one per declared parcel, with a signed QR payload, short code, label version, status and lab sample ID.
- **CustodyEvent**: append-only events per package or booking.
- **ReceiptRecord**: the Maker's submission and the Checker's decision, versioned per booking.
- **HoldCase**: the discrepancy and the customer's decision.
- **LabelPrint**: who printed or reprinted which label version, and the approvals for reprints.
- **QrSigningKey**: key registry (KMS key references, status, rotation).

### 2.7 Reports
- **Report**: one logical report per booking. It owns the report number and the ULR.
- **ReportVersion**: each upload and its review lifecycle. Maker and Checker, original and stamped file, hashes, verification code, supersession.
- **ReportShareLink**, **ReportAccessLog**, **VerificationEvent**, **BreakGlassGrant** (time-boxed platform access to a report file, approved by a second person).

### 2.8 Payments and finance
- **PaymentOrder** (an attempt) → **PaymentTransaction** (gateway-confirmed movements). **GatewayWebhookEvent** (raw, deduplicated).
- **Refund**, **Payout** with **PayoutItem** (bookings included in a payout), **PayoutHold**.
- **Ledger**: `ledger_account` (chart of accounts, party-scoped), `ledger_journal` (one business event), `ledger_entry` (debit/credit lines, balanced per journal).
- **FinancialDocument** (invoice, receipt, credit note, refund note) with **DocumentSeries** for gapless numbering per issuer and financial year.
- **FeeRule** (platform fee, zero in the MVP), **SettlementReportLine** (imported gateway settlement data for reconciliation).

### 2.9 Disputes and ratings
- **Dispute** (type, status, assignment, decision, outcome), **DisputeMessage**, **DisputeEvidence** (files), **Rating**.

### 2.10 Notifications
- **NotificationTemplate** (event × channel × locale × version), **Notification** (per recipient per channel, with in-app read state), **NotificationPreference**.

### 2.11 Platform
- **AuditLog** with **AuditLogChain** (the hash chain, sealed by the worker), **OutboxEvent**, **ProcessedEvent**, **Timer**, **IdempotencyRecord**, **ConfigParameter**, **HolidayCalendar**.

## 3. Key relationships (prose)
- Organisation(LAB) 1—N LabSite 1—N Accreditation 1—N ScopeLine N—1 Node(PARAMETER), N—1 Node(METHOD).
- LabSite 1—N PriceList 1—N PriceItem N—1 ScopeLine.
- Organisation(CUSTOMER) 1—N Booking N—1 LabSite. Booking 1—N BookingLine N—1 ScopeLineVersion, N—1 PriceItem.
- Booking 1—N TRF (versions), 1—N Package 1—N CustodyEvent, 1—N ReceiptRecord, 0..1 Report 1—N ReportVersion.
- Booking 1—N PaymentOrder 1—N PaymentTransaction. Booking 1—N Refund. Payout 1—N PayoutItem N—1 Booking.
- LedgerJournal 1—N LedgerEntry N—1 LedgerAccount. Journals reference the booking, payment, refund or payout that caused them.
- Booking 0..N Dispute. Booking 0..2 Rating (customer→lab, lab→customer).

## 4. Questions for the G1 review
1. Four platform roles (ADR-012), or a single `PLATFORM_OPS` role plus permissions?
2. RLS as defence in depth (ADR-005): confirm after the spike.
3. Booking numbers: is `LC-YYMM-NNNNNNN` acceptable, or does the owning authority have a numbering standard?
4. Does each lab site invoice separately (site GSTIN), or the lab organisation (OQ-08)?
5. Should `CustomerSite` be required for every non-individual booking (billing address source)?
