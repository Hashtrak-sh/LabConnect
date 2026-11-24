# Database design review (task P1-01)

**Status:** OPEN. Input for the developers' review meeting (P1-02). No Prisma schema is written until the "Decide" items below are resolved (MASTER_PROMPT Step 2).
**Date:** 2026-11-24 · **Reviewer:** Claude Code, for @Hashtrak-sh

## 1. Scope and method

Read in full: every file in `docs/03-database/`, plus `BOOKING_STATE_MACHINE.md`, `TENANT_ISOLATION.md`, `AUDIT_AND_EVENT_ARCHITECTURE.md`, `MODULE_BOUNDARIES.md` and `ROLES_AND_PERMISSIONS.md`. Business rules, edge cases, ADR-014 and `FILES_AND_REPORTS.md` were consulted where the schema refers to them.

Mechanical cross-checks that **passed**:
- 91 tables in `SCHEMA_SPECIFICATION.md`; the same 91 are each owned by exactly one module in `MODULE_BOUNDARIES.md`. No orphans, no double ownership.
- `booking_status` has 18 values in the state machine, as the schema says.
- Every enum type named in a column definition appears in §13, with one exception (B-06).
- All 27 transitions have a `transition_id` that fits `varchar(6)`.

Nothing here was tested against a database. These are findings from reading; a few (marked "verify") depend on PostgreSQL or Prisma behaviour that the P1-07/P1-08 work should confirm.

**Severity**
- **Decide**: needs a decision from both developers before the schema can be written. The choice changes tables or columns.
- **Fix**: the docs are wrong or incomplete, the correction is clear, and I can apply it once you agree.
- **Minor**: wording or tidy-up. Worth fixing, blocks nothing.

**Counts:** 55 findings. 19 Decide, 29 Fix, 7 Minor. By section: 11 state machine (A), 14 cross-document (B), 16 constraints (C), 3 indexes (D), 11 tenant isolation (E).

## 2. Decisions needed first

All 19 "Decide" items need an answer. These nine shape the most tables, so they are the suggested order for the meeting:

1. **E-01** How child tables of a booking carry tenant keys (affects about 25 tables and every RLS policy).
2. **E-02** Whether lab-owned tables keyed only by `lab_site_id` also get `organisation_id`.
3. **A-01** When the report is stamped: at submission (ADR-014) or at release (schema and state machine).
4. **A-02** How a returned report is resubmitted, and what "amendment" means for `version_no`.
5. **A-03** The path for "sample unfit" and what T-16 does to packages and retention.
6. **A-06** Whether disputes can exist outside the `DISPUTED` booking state (billing disputes, BR-080).
7. **C-01** Uniqueness with nullable columns (seven unique keys do not work as written).
8. **E-06** Database roles for the worker and for SYSTEM jobs.
9. **C-13** How the audit hash chain is computed without serialising every transaction.

## 3. Conflicts with the booking state machine

### A-01 · Decide · Report stamping happens at two different times
- `BOOKING_STATE_MACHINE.md` T-21 lists "Stamp job" as a side effect of publishing.
- `SCHEMA_SPECIFICATION.md` §9.2 says `stamped_file_id`, `stamped_sha256` and `verification_code` are "set on release".
- ADR-014, `FILES_AND_REPORTS.md` §"Stamping and release" and `SYSTEM_ARCHITECTURE.md` say the worker stamps at **submission**, the Checker reviews the stamped copy, and publishing is one synchronous transaction.

The QR encodes the verification code, so the code must exist when the stamp is made. **Proposed:** follow ADR-014. `verification_code`, `signing_key_id`, `stamped_file_id` and `stamped_sha256` are set while the version is `IN_REVIEW`; T-19 gains "stamp job" as a side effect; T-21 gains the guard "`stamped_file_id` is set" and loses "Stamp job". The code resolves to "not found" until `status = RELEASED`.

### A-02 · Decide · A returned report cannot be resubmitted cleanly
T-20 sets the version to `RETURNED`. C-22 allows one open version (`DRAFT`, `IN_REVIEW`) per report, so the resubmission is a new row with `version_no = 2`. But §9.2 says `amendment_reason` is "required when `version_no > 1`", so a first-time resubmission is forced to give an amendment reason, and the first released report may be v2 or v3.

**Proposed:** an amendment is "a version created while an earlier version of the same report is `RELEASED`". Add `is_amendment boolean` (or `amends_version_id`) and require `amendment_reason` when it is set. Alternative: let a `RETURNED` version go back to `DRAFT` and be edited in place, which keeps v1 as the first release but loses the returned file from history.

### A-03 · Decide · "Sample unfit" and the hold path are incomplete
1. The schema has `receipt_decision = REJECTED_UNFIT`, custody event `SAMPLE_REJECTED`, and BR-076 / EC-35 define the refund. The transition table has no row for it. T-27 (`CancelBooking` from `SAMPLE_RECORDED`) is the nearest, but its guard is "line statuses supplied" and it does not mention the receipt decision or checker ≠ maker.
2. T-16 (`ON_HOLD → RECEIVED`, customer proceeds) does not set packages to `RECEIVED` or compute `retain_until`. Only T-14 does. BR-063 then blocks report binding, because the bound package must be `RECEIVED`. BR-049 defines `retain_until` from "receipt approved at", which never happens on this path.
3. The hold decision `CANCEL` has no named transition (presumably T-27 from `ON_HOLD`).

**Proposed:** add T-28 `RejectSample` (`SAMPLE_RECORDED → CANCELLED`, L-Checker, checker ≠ maker, reason required, BR-076 refund). Give T-16 the same package and retention side effects as T-14, with `retain_until` counted from the hold decision. State in T-27 that a hold decision of `CANCEL` uses it.

### A-04 · Fix · Timer names differ between documents
T-13 and T-19 start `RECEIPT_APPROVAL_DUE` and `REPORT_APPROVAL_DUE`. `AUDIT_AND_EVENT_ARCHITECTURE.md` §4, which defines the `timer_type` enum, has `RECEIPT_APPROVAL_REMINDER` and `REPORT_APPROVAL_REMINDER` instead. EC-54 says these items wait and are never auto-decided, so "reminder" looks right. Also: `timer_status` has `FAILED` and the table has `last_error` in the schema; the architecture doc lists neither. **Proposed:** use the `_REMINDER` names in the state machine and add `FAILED` and `last_error` to the architecture doc.

### A-05 · Decide · System and Ops actors are missing from the transition table
- EC-01 auto-cancels `REQUESTED` bookings when accreditation lapses, and `cancelled_by_party` has `SYSTEM`. T-25 to T-27 list only owner, C-Admin, L-Checker and Ops.
- `ROLES_AND_PERMISSIONS.md` note 2: "Ops can cancel at any non-terminal state". The table has no cancellation from `REPORT_IN_REVIEW`, `REPORT_RELEASED` or `DISPUTED`.
- Note 4 lets Ops accept, reject or counter "in exceptional cases". T-03 to T-05 list only the L-Checker.
- EC-01 says `PAID` or `HANDOVER_SET` bookings are "frozen". There is no frozen state or flag on `booking`.

**Proposed:** add `system` to T-25/T-26/T-27 actors; decide whether Ops override exists for T-03 to T-05 and for late-stage cancellation, and write it into the table or remove it from the permission notes; add `frozen_at` / `frozen_reason` columns if "frozen" must block actions.

### A-06 · Decide · Disputes outside the `DISPUTED` state
BR-080 allows a dispute "at any time for billing disputes on open bookings". T-22 only starts from `REPORT_RELEASED`. So a billing dispute on a booking in `UNDER_TEST` either has a `dispute` row while the booking stays in its state, or is not possible. Related gaps:
- No constraint limits a booking to one open dispute.
- Dispute status `WITHDRAWN` has no transition. T-24's guard is "dispute decided".

**Proposed:** decide whether `dispute` is independent of booking state for billing types. Add a partial unique index on `dispute(booking_id)` for open statuses. Let T-24 also fire on withdrawal, or add a transition back to `REPORT_RELEASED` if the window is still open.

### A-07 · Fix · When line prices freeze
§7.2 says price columns are immutable "after T-03". C-11 says "once the booking status isn't REQUESTED", which also freezes them in `COUNTERED`. The two agree in effect (a counter cannot change price) but not in words. **Proposed:** use the C-11 wording everywhere.

### A-08 · Decide · Counter-offers: drop date and quantity
BR-017 and T-04 allow a counter to change "only the slot and/or add sample-quantity requirements". `counter_offer` also has `proposed_drop_date`, and C-29 accepts it alone. Separately, when the customer accepts a counter with `per_line_quantity`, nothing says where the new quantity is recorded on the booking; `booking_line.snapshot` holds the sample quantity and is not covered by C-11. `booking.slot_id` is nullable while `preferred_drop_date` is not, which suggests bookings without slots exist.

**Proposed:** decide whether slot-less bookings exist. If yes, add "drop date" to BR-017 and T-04. Add `required_sample_qty` (or similar) to `booking_line`, written by T-07.

### A-09 · Decide · Booking totals after a line is cancelled
EC-02 and BR-073 cancel individual lines while the booking continues. `booking.total_paise` is fixed by C-10 and `payment_order.amount_paise` "must equal `booking.total_paise`". If totals are restated after capture, that rule breaks. **Proposed:** totals are frozen at T-03 and never restated; the net amount is derived from refunds. Write this in `VERSIONING_AND_SNAPSHOTS.md` §3.

### A-10 · Fix · The status guard trigger checks too little
C-09 only requires that `app.transition_id` is set. Any code that sets the variable can write any status. **Proposed:** the trigger also checks the (old status, new status) pair against a small `booking_transition` lookup table generated from `packages/shared`, the same source the doc-equality test uses. Cheap, and it makes the database refuse an invalid jump even if application code is wrong.

### A-11 · Minor · Smaller points
- T-08 records an explicit customer decline as `EXPIRED`, the same terminal state as a lapse. Only `counter_status` tells them apart. Fine if intended.
- T-12, T-26 and T-27 do not say the confirmed slot hold is released; T-10 and T-25 do.
- I found no rule for a payment captured after the booking reached `EXPIRED_UNPAID` (the BR-032 extension has ended). The duplicate-capture rule in §10.1 does not cover it.

## 4. Inconsistencies between documents

### B-01 · Fix · ULR uniqueness cannot work as an index (C-21)
§9.2 and C-21 specify a partial unique index on `report_version(ulr_no)` for `RELEASED` and `SUPERSEDED` rows "excluding the same report". An index cannot exclude rows by report. As written it would reject every amendment, because v1 (`SUPERSEDED`) and v2 (`RELEASED`) share the ULR. `report.ulr_no` already exists. **Proposed:** make `report.ulr_no` the single home with a plain partial unique index, and drop `report_version.ulr_no` (same for `report_no`, which is also duplicated), or keep the copies and enforce equality with a trigger.

### B-02 · Fix · "One capture per booking" stops working after a refund (C-16)
C-16 is unique on `payment_order(booking_id)` where `status = 'CAPTURED'`. The status then moves to `REFUNDED_PARTIAL` or `REFUNDED_FULL`, the row leaves the index, and a second order for the same booking can be captured. **Proposed:** predicate `status IN ('CAPTURED','REFUNDED_PARTIAL','REFUNDED_FULL')`, or a `captured_at IS NOT NULL` predicate.

### B-03 · Fix · "No double payout" cannot be a partial index (C-20)
`payout_item` is unique on `booking_id` "where the parent isn't CANCELLED". An index predicate cannot read the parent `payout` row. Also unclear: whether a `FAILED` payout frees its bookings. **Proposed:** add `voided_at` to `payout_item`, set when the parent is cancelled (or failed, if agreed), and make the index `WHERE voided_at IS NULL`.

### B-04 · Fix · `financial_document` is append-only and also cancellable
§10.12 is "AO once ISSUED". Its status enum is `ISSUED`, `CANCELLED`, so there is no pre-issued state, and moving to `CANCELLED` is an update on an append-only row. The note says cancellation is "only via a credit note". **Proposed:** make it fully append-only and drop `CANCELLED`; a document is cancelled when a credit note references it through `related_document_id`.

### B-05 · Fix · Refund cap counts only succeeded refunds (C-19)
Two refunds in `REQUESTED` or `SUBMITTED` can together exceed the captured amount and both succeed later. **Proposed:** the trigger sums every refund not in `FAILED`, and takes a row lock on the payment order.

### B-06 · Fix · Enum `claim_status_req` is missing from §13
Used by `lab_claim_request.status` (§5.7). Several inline value lists are also unnamed, so it is unclear whether they are enums or text: `import_row.match_result` and `action`, `import_mapping_template.source_format`, `report_access_log.access_type`, `payment_transaction.txn_type` and `status`, `gateway_webhook_event.processing_status`, `payout_hold.reason_type`, `ledger_account.normal_balance`, `ledger_journal.journal_type`, `fee_rule.fee_type` and `calc`, `settlement_report_line.match_status`, `rating.direction`, `dispute_message.visibility`, `document_series.doc_type`. **Proposed:** name each as an enum and add it to §13.

### B-07 · Decide · Change sets target tables that have no version history
`md_target_type` includes `LAB_ORG` and `SYNONYM`. Publication "appends a `*_version` row" (`MASTER_DATA_MANAGEMENT.md` §3), but `organisation` and `search_synonym` have no version table and no `current_version_no`, so `base_version_no` cannot be checked for them. **Proposed:** add `organisation_version` and `search_synonym_version`, or record history for these two only in the change item and the audit log and say so.

### B-08 · Fix · Standard columns are ambiguous per table
§0 says STD columns are on every table "unless marked otherwise". About half the tables are defined in one line with no marker. It is not stated whether append-only tables keep `created_by_user_id`, or whether `audit_log` (which lists its own `id` and `occurred_at`) has `created_at`. **Proposed:** add a one-page matrix to the spec: table × (STD, AO, +LV, partitioned). I can generate it for you to correct.

### B-09 · Fix · Inline CHECKs are not in the constraint register
`INDEXES_AND_CONSTRAINTS.md` says "everything listed here needs a migration test". About twenty CHECKs and triggers exist only as notes in the spec (for example `price_paise ≥ 0`, `gst_rate_bp` 0–2800, `tat_days > 0`, `declared_package_count` 1–50, `closes_at > opens_at`, `retention_days > 0`, rating 1–5, the `price_item` same-site trigger, `receipt_record` and `dispute` immutability). They would have no test. **Proposed:** the register lists every constraint; "critical" becomes a column.

### B-10 · Fix · Immutability promised but not specified
`VERSIONING_AND_SNAPSHOTS.md` pattern B says published or decided rows are "frozen by triggers". The register has a trigger only for price lists (C-13). Missing: `receipt_record` after `decided_at`, `report_version` after `RELEASED` (except the move to `SUPERSEDED` and `superseded_by_version_id`), `dispute` after `decided_at`.

### B-11 · Decide · `report_version` cannot be a draft
`report_no`, `issue_date`, `original_file_id`, `original_sha256`, `bound_package_id` and `bind_event_id` are all NOT NULL, but upload, bind and submit are separate steps and the status `DRAFT` exists. **Proposed:** make them nullable with `CHECK (status = 'DRAFT' OR … IS NOT NULL)`, or create the row only at submission and drop `DRAFT`.

### B-12 · Fix · `listing_status` and `is_bookable` say the same thing twice
`lab_site.listing_status` has `BOOKABLE` and is "derived"; `is_bookable` is also derived. They can drift. **Proposed:** `CHECK ((listing_status = 'BOOKABLE') = is_bookable)`, or keep only one.

### B-13 · Minor · ERD and prose drift
- 16 tables are absent from every diagram: `accreditation_body`, `config_parameter`, `customer_settings`, `customer_site`, `fee_rule`, `holiday_calendar`, `idempotency_record`, `label_print`, `lead_request`, `mfa_recovery_code`, `otp_challenge`, `qr_signing_key`, `report_access_log`, `search_synonym`, `settlement_report_line`, `verification_event`.
- The ERD draws `DOCUMENT_SERIES ||--o{ FINANCIAL_DOCUMENT`, but `financial_document` has no series key and no `financial_year` column.
- `DOMAIN_MODEL.md` §2.3 puts claim status on LabSite; the column is on `organisation`.
- `DOMAIN_MODEL.md` principle 5 writes the check as `maker <> checker`; the real one allows a null checker.
- `TENANT_ISOLATION.md` says "four classes" and lists five; it calls TRF content "customer-owned" although the lab must read it.
- §0 says currency sits on "money-bearing headers"; only `booking` has the column.

### B-14 · Minor · Hard deletes do happen
§0: "Domain rows are never hard-deleted." `idempotency_record` has an index "for cleanup", and expired OTP challenges and sessions will be purged too. **Proposed:** list the tables where `app_rw` (or the worker role) may DELETE.

## 5. Missing or incorrect constraints

### C-01 · Decide · Unique keys with nullable columns do not enforce uniqueness
PostgreSQL treats NULLs as distinct, so these allow duplicates exactly in the "null means default" case:

| Table | Unique key | Nullable column |
|---|---|---|
| `config_parameter` | (`key`, `scope_type`, `scope_id`, `effective_from`) | `scope_id` (GLOBAL) |
| `holiday_calendar` | (`holiday_date`, `region_code`) | `region_code` (national) |
| `retention_rule` | (`lab_site_id`, `discipline_node_id`) | `discipline_node_id` (default) |
| `slot` | (`lab_site_id`, `discipline_node_id`, `starts_at`) | `discipline_node_id` |
| `ledger_account` | (`code`, `party_org_id`) | `party_org_id` |
| `idempotency_record` | (`idempotency_key`, `actor_user_id`, `route`) | `actor_user_id` |
| `bank_account` | primary per (`organisation_id`, `lab_site_id`) | `lab_site_id` (org-level) |

**Proposed:** `UNIQUE NULLS NOT DISTINCT` (PostgreSQL 15+) in raw SQL for all seven. Prisma cannot express it (verify), so these join the raw-SQL list.

### C-02 · Fix · Ledger entries can be negative
C-18 is `(debit_paise > 0) <> (credit_paise > 0)`. A row with debit 100 and credit −5 passes. **Proposed:** add `debit_paise >= 0 AND credit_paise >= 0`.

### C-03 · Fix · RR-5 has no constraint
"Platform roles can't be combined with customer or lab memberships on the same user." `app_user.is_platform_staff` exists for this, but C-06 only checks role against org type. **Proposed:** trigger on `membership`: a user with `is_platform_staff` may only join a `PLATFORM` organisation, and other users may not.

### C-04 · Fix · No "one released version" rule
C-22 limits open versions. Nothing limits a report to one `RELEASED` version. **Proposed:** partial unique on `report_version(report_id) WHERE status = 'RELEASED'`.

### C-05 · Fix · Missing state-consistency checks
Rows whose columns must agree with their status or decision, none specified:
- `receipt_record`: decision set ⇔ `checker_user_id` and `decided_at` set; `lab_sample_id` required for `APPROVED` and `HOLD_CONFIRMED`; `discrepancy_notes` required when `discrepancy_flag`.
- `report_version`: `RELEASED` ⇒ checker, `checker_mfa_at`, `released_at`, stamped file and verification code set; `RETURNED` ⇒ `review_comments`.
- `booking`: `CANCELLED` ⇒ `cancellation_code_node_id` and `cancelled_by_party`; `REJECTED` ⇒ `rejection_reason_node_id`; all amounts ≥ 0.
- `md_change_set`: `APPROVED` or `PUBLISHED` ⇒ approver and `approved_at`.
- `dispute`: `DECIDED` ⇒ outcome, rationale, decider.
- `slot_hold`: `SOFT` ⇒ `expires_at` set.
- `booking_line`: `line_total_paise = unit_price_paise + sample_prep_paise + gst_paise`.
- `financial_document`: `total = taxable + cgst + sgst + igst`, and IGST excludes CGST/SGST.

### C-06 · Fix · Cross-row ownership that only the service checks
The register has C-08, C-14 and C-30 for this kind of rule; these siblings are missing:
- `booking.customer_site_id` belongs to `customer_org_id`; `slot_id` and `price_list_id` belong to `lab_site_id`.
- `booking_line`: the scope line belongs to the booking's site; `scope_line_version_id` belongs to `scope_line_id`; `price_item_id` belongs to `booking.price_list_id`.
- `receipt_package.package_id` and `report_version.bound_package_id` belong to the same booking (BR-063 is service-only while BR-061 has C-30).
- `payment_order.amount_paise = booking.total_paise`.
- `user_session.active_membership_id` belongs to `user_id`.
- `payout.bank_account_id` belongs to `lab_org_id`.

Most can be composite foreign keys instead of triggers (see E-01).

### C-07 · Fix · One pending item per booking
No uniqueness for: one `PENDING` `counter_offer` per booking, one `OPEN` `hold_case` per booking, one pending `lab_claim_request` per organisation, one active `mfa_factor` per user, one live (`membership_id`, `lab_site_id`) in `membership_site`.

### C-08 · Fix · Offline scans can be double-recorded
`custody_event` has `device_id` and `client_seq` for the offline queue (EC-50) but no uniqueness. A retried upload inserts the scan twice. **Proposed:** partial unique on (`device_id`, `client_seq`) where both are set.

### C-09 · Decide · Short codes can be reused after a label is voided (C-23)
`package.short_code` is unique only among non-voided packages. A voided code can be issued again, so typing the code from an old voided label could resolve to a different live package. With 32⁶ (about one billion) codes there is no need to reuse. **Proposed:** globally unique, never reused.

### C-10 · Decide · GSTIN unique across all organisations
`organisation.gstin` is unique where not null, and `org_type` is single-valued. A company that runs an accredited lab and also books tests elsewhere needs a `LAB` and a `CUSTOMER` organisation with the same GSTIN, which the constraint forbids. **Proposed:** unique on (`org_type`, `gstin`), unless one legal entity must map to one organisation.

### C-11 · Fix · Arrays of foreign keys
`custody_event.photo_file_ids uuid[]` and `invitation.site_ids uuid[]` cannot have foreign keys, so they can point at files or sites of another tenant. **Proposed:** `custody_event_photo` join table (or `file_link`), and `invitation_site`.

### C-12 · Fix · Effective windows can overlap
Nothing prevents two overlapping rows for the same `config_parameter` key and scope, or `fee_rule`. `receiving_hours` rows for one weekday can overlap. Missing simple checks: `site_closure.ends_on >= starts_on`, `slot.ends_at > starts_at`, `slot_template.end_time > start_time`. **Proposed:** exclusion constraints with `btree_gist` for the windows (adds one extension to §3), plain CHECKs for the rest.

### C-13 · Decide · Audit hash chain serialises all writes
`hash = SHA-256(prev_hash || row)` per partition means each insert must read the previous row's hash. Every booking transition writes an audit row in its own transaction, so all transitions across all tenants queue on one lock. **Proposed:** insert audit rows without a hash; the worker seals them in order in batches and writes the chain. The nightly verifier stays as is. Also note: a partitioned table's primary key must include `occurred_at`, so `audit_log.id` alone cannot be the key and nothing can reference it by foreign key.

### C-14 · Fix · Append-only by grants needs column grants and a second role
C-25 revokes UPDATE and DELETE on AO tables. Three tables need some updates: `outbox_event` (relay fields), `gateway_webhook_event` (processing fields), `timer`. "Only the relay may update" cannot be enforced while the API and the worker share `app_rw`. Covered by E-06. Also revoke `TRUNCATE`.

### C-15 · Minor · Taxonomy-typed references
Columns such as `condition_node_id` (must be `SAMPLE_CONDITION`), `discipline_node_id` (must be type `DISCIPLINE`) and `md_node.parent_id` (parent at the level above) are checked only in the service. A generic trigger function taking the expected taxonomy code would cover them; decide whether it is worth it.

### C-16 · Minor · References to non-primary keys
`package.signing_key_id` and `report_version.signing_key_id` are `varchar(8)` values pointing at `qr_signing_key.key_id`, a unique column that is not the primary key. Say explicitly that these are foreign keys to `key_id`.

## 6. Missing indexes

### D-01 · Fix · Foreign keys and work queues with no index
`INDEXES_AND_CONSTRAINTS.md` §2 covers search, booking and finance well. Not covered:

| Table | Index | Used for |
|---|---|---|
| `booking` | (`requester_user_id`, `created_at DESC`) | "Own records only" for C-Req |
| `booking` | (`slot_id`) | Slot cancellation on site closure (EC-13) |
| `dispute` | (`booking_id`); (`customer_org_id`, `status`); (`lab_org_id`, `status`); (`status`, `lab_response_due_at`) | Lists, SLA |
| `refund` | (`booking_id`); (`payment_order_id`); (`status`) | C-19, approvals queue |
| `payout_item` | (`payout_id`) | Payout detail |
| `payout_hold` | (`booking_id`) WHERE `released_at IS NULL` | Eligibility check on every payout |
| `hold_case` | (`booking_id`); (`status`, `due_at`) | Hold timer, Ops board |
| `counter_offer` | (`booking_id`) | Booking detail |
| `slot_hold` | (`slot_id`) WHERE `released_at IS NULL`; (`expires_at`) WHERE `released_at IS NULL` | Capacity, expiry sweep |
| `label_print` | (`booking_id`) | History |
| `report` | (`lab_org_id`); (`customer_org_id`) | Lists |
| `report_share_link` | (`report_version_id`) | Revocation on amendment |
| `report_access_log` | (`report_version_id`, `occurred_at`) | Access history |
| `verification_event` | (`verification_code`, `occurred_at`); (`ip_hash`, `occurred_at`) | Rate-limit analysis |
| `report_parameter_result` | (`booking_line_id`) | C-30 |
| `payment_transaction` | (`payment_order_id`) | Order detail |
| `gateway_webhook_event` | (`processing_status`) WHERE not `PROCESSED` | Retry queue |
| `settlement_report_line` | (`gateway_txn_ref`); (`match_status`) | Reconciliation |
| `ledger_journal` | (`payment_transaction_id`); (`refund_id`); (`payout_id`) | Tracing |
| `md_change_item` | (`change_set_id`); (`target_type`, `target_id`) | Review, history |
| `md_change_set` | (`status`, `submitted_at`) | Review inbox |
| `md_node` | (`parent_id`) | Tree browsing |
| `price_item` | (`scope_line_id`) | BR-003, impact queries |
| `import_job` | (`status`); (`organisation_id`) | Wizard |
| `membership` | (`organisation_id`, `status`) | User lists, BR-001 |
| `membership_site` | (`lab_site_id`) WHERE `revoked_at IS NULL` | BR-001 (a Maker and a Checker per site) |
| `user_session` | unique (`refresh_token_hash`); (`token_family_id`); (`user_id`) WHERE `revoked_at IS NULL` | Refresh, reuse detection |
| `otp_challenge` | (`destination_hash`, `purpose`, `created_at`) | Throttling |
| `invitation` | (`organisation_id`, `email`) | Pending invites |
| `lab_claim_request` | (`organisation_id`, `status`) | Claims queue |
| `customer_site`, `bank_account`, `kyc_document` | (`organisation_id`) | Tenant lists |
| `receiving_hours`, `site_closure` | (`lab_site_id`, …) | Slot generation |
| `lead_request` | (`status`, `created_at`) | Leads queue |

### D-02 · Fix · Uniqueness stated in prose but not in the register
`payment_order` (`gateway`, `gateway_order_ref`); `payment_order.idempotency_key`; `dispute.dispute_no`; `lab_site.site_code`; `organisation.gstin` (see C-10); `app_user.phone_e164`; `invitation.token_hash`; `report_share_link.token_hash`; `qr_signing_key.key_id`. Also `payment_transaction` is unique on (`gateway_txn_ref`, `txn_type`) without the gateway, so an ICICI and a FAKE reference could collide in lower environments.

### D-03 · Minor · Duplicate-detection index is case-sensitive
`booking` (`customer_org_id`, `item_name`, `batch_no`, `created_at`) matches raw text. "Cement OPC 53" and "cement opc 53 " would not match. **Proposed:** index normalised values (`lower(btrim(...))`), or store normalised copies.

## 7. Tenant-isolation gaps

### E-01 · Decide · Most shared transactional tables have no tenant keys
`TENANT_ISOLATION.md` rule 1: shared transactional rows carry both `customer_org_id` and `lab_org_id`. Only `booking`, `report`, `payment_order` and `dispute` do. These do not: `booking_line`, `trf`, `booking_status_history`, `counter_offer`, `slot_hold`, `package`, `custody_event`, `receipt_record`, `receipt_package`, `hold_case`, `label_print`, `report_version`, `report_parameter_result`, `report_share_link`, `report_access_log`, `payment_transaction`, `refund`, `payout_item`, `payout_hold`, `ledger_journal`, `dispute_message`, `dispute_evidence`, `rating`.

Also, only `booking.lab_org_id` is guarded (C-08). The tenant keys on `report`, `payment_order` and `dispute` can disagree with their booking and nothing would notice.

Options:
1. **Denormalise both keys onto every child, guaranteed by composite foreign keys** (recommended). `booking` gets `UNIQUE (id, customer_org_id, lab_org_id)`; each child's foreign key is (`booking_id`, `customer_org_id`, `lab_org_id`). The database then guarantees the keys match, with no triggers, and every RLS policy is a simple column comparison.
2. Keys only on roots; child policies use `EXISTS (SELECT 1 FROM booking …)`. Fewer columns, but every child read pays a sub-select and policies depend on each other.
3. RLS only on the four root tables; children are protected by the repositories alone. Simplest, weakest.

### E-02 · Decide · Lab-owned tables are keyed by site, not organisation
Rule 1 asks for `organisation_id` on every tenant-owned table. These have only `lab_site_id`: `accreditation`, `scope_line`, `price_list`, `price_item` (through its list), `receiving_hours`, `site_closure`, `retention_rule`, `slot_template`, `slot`. `import_row` and `md_change_item` have no key either. `price_list` is the sensitive one: drafts are lab-private, published lists are public, in the same table. **Proposed:** add `organisation_id` to the lab-private ones using the same composite-key approach; `price_list` policy = own organisation, or `status = 'PUBLISHED'`.

### E-03 · Decide · Site-level isolation is not in the database layer
Rule 4 limits lab users to their assigned sites. The RLS example compares only the organisation, and the session variables listed (`app.org_id`, `app.org_type`, `app.user_id`, `app.is_platform`) carry no site list. `payment_order`, `dispute` and most child tables have no `lab_site_id`. **Proposed:** state that site scoping is enforced by repositories only and tested by the isolation suite, or add `app.site_ids` and `lab_site_id` to the policies. Either is defensible; the doc should say which.

### E-04 · Fix · Public tables hold private columns
RLS works on rows, not columns. Tables classed as public reference contain values that are not public:
- `lab_site.contact_email` and `contact_phone`: the address the claim OTP is sent to. `public_contact`: "shown after payment".
- `organisation`: `pan_ciphertext`, `pan_last4`, `trust_flags` (for example a customer's no-pay count), `kyc_status`. The counterparty on a booking needs the name only.
- `app_user`: no organisation key at all. Email and phone of every user are readable by any connection that can read the table.

**Proposed:** move private columns to side tables (`lab_site_private`, `organisation_private`) with their own policies, or expose public data through views and revoke direct SELECT. `app_user` needs a policy: self, members of the same organisation, platform.

### E-05 · Fix · "Both parties" is too broad for three tables
A policy that lets both organisations on a booking read every row leaks:
- `dispute_message` with `visibility = 'PLATFORM_ONLY'`.
- `rating` with `direction = 'LAB_TO_CUSTOMER'` and `is_public = false`.
- `organisation.trust_flags` (see E-04).

**Proposed:** per-table policies that include the visibility column.

### E-06 · Decide · Worker and SYSTEM access
- The example policy has no branch for SYSTEM. Background jobs (rule 7) would see no rows unless they set `app.is_platform = 'true'`, which mixes up "platform staff" and "system job" in every policy and audit trail.
- `outbox_event.payload`, `timer.payload` and `idempotency_record.response_body` contain tenant data and have no tenant key. Any API connection can read all of them.

**Proposed:** a separate database role for the worker (`app_worker`) with its own grants: it alone can read and update `outbox_event` and `timer`, and the API role can only insert. Add `app.is_system` to the session settings and policies. This also resolves C-14.

### E-07 · Decide · Files shared between parties
`file_object` has one `owner_org_id`. A report PDF is owned by the lab and read by the customer; booking attachments are the reverse; receipt photos and dispute evidence are read by both and by Ops. Access depends on the entity the file is attached to, and `file_link` is polymorphic, so a row policy cannot follow it. **Proposed:** state that file access is never granted from `file_object` alone: the API resolves the owning entity first and checks that. For RLS, add nullable `customer_org_id` and `lab_org_id` to `file_object` for booking-related purposes.

### E-08 · Decide · Break-glass grants have nowhere to live
Rule 6 and permission note 7: platform access to a report file needs a time-boxed grant approved by `PLATFORM_ADMIN`. `report_access_log` records the access. No table records the request, the approver or the expiry. **Proposed:** `break_glass_grant` (`report_version_id`, `requested_by_user_id`, `reason`, `approved_by_user_id` with `CHECK <> requested_by`, `approved_at`, `expires_at`, `revoked_at`), and `report_access_log.grant_id`.

### E-09 · Fix · Lab proposals are classed as platform-only
`md_change_set` is in the "Platform" class (platform roles only), but a lab Checker creates `LAB_PROPOSAL` sets and must see their status. The table has `proposed_by_org_id`. **Proposed:** policy = platform, or `proposed_by_org_id` equals the session organisation; same for the set's change items.

### E-10 · Fix · Notes for the RLS spike (P1-08)
To check during the spike rather than decide now (verify):
- `current_setting('app.org_id', true)` returns an empty string, not NULL, on a pooled connection where the setting was used before. The `::uuid` cast then raises an error. Wrap in `nullif(…, '')`.
- State `WITH CHECK` explicitly on policies so inserts and updates are covered deliberately.
- Tables are owned by `app_owner`, which bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set. Migrations and seeds run as that role.

### E-11 · Minor · Lab penalties have no home
BR-074 and BR-079: lab penalties are "recorded for scoring". No table or column records one; `lab_site.responsiveness_score` is a derived number. **Proposed:** `lab_penalty` (lab organisation, site, booking, rule, occurred_at), owned by the `labs` module.

## 8. Open questions already in the docs that this review touches
- `DOMAIN_MODEL.md` §4 Q4 (does each site invoice separately?) decides whether `payout` and `document_series` need `lab_site_id`. `payout` has only `lab_org_id` while `bank_account` can be per site.
- OQ-14 (does an amendment reopen the dispute window?) interacts with A-02 and A-06.
- OQ-07 (fees, hold escalation) decides who can resolve an `ESCALATED` hold case. The permission matrix lets only the customer decide a hold.

## 9. Next step
Mark each finding **accept**, **change** or **reject** at the P1-02 meeting. I then update the source documents in one PR (docs only), and the Prisma schema work (P1-03 to P1-07) starts from the corrected spec.
