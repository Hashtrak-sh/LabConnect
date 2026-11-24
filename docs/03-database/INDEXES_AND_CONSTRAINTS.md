# Indexes, constraints and triggers

**Status:** DRAFT for gate G1, revised after the P1-01 design review (`DESIGN_REVIEW_P1-01.md`). This is the **register**: every CHECK, unique key, exclusion constraint and trigger in the schema is listed here, and every row needs a migration test (see `06-engineering/TESTING_STRATEGY.md` §4). **Crit** = critical to money, custody, separation of duties or tenant isolation. The tests are in `packages/database/test/db/`; a test there fails if a registered constraint has none.

Triggers raise their own SQLSTATE codes so that callers and tests can tell them apart: `LC001` append-only table, `LC002` illegal booking transition, `LC003` frozen row, `LC004` cross-row rule.

Kinds: **CHECK**, **UNIQUE** (including partial), **FK** (composite foreign key that enforces a rule), **EXCL** (exclusion constraint), **TRG** (trigger), **GRANT**.

## 1. Constraint register

### 1.1 Separation of duties and roles
| # | Table | Constraint | Kind | Crit | Purpose |
|---|---|---|---|---|---|
| C-01 | `receipt_record` | `checker_user_id IS NULL OR checker_user_id <> maker_user_id` | CHECK | ✔ | No self-approval |
| C-02 | `report_version` | Same as C-01 | CHECK | ✔ | No self-approval |
| C-03 | `label_print` | `approved_by_user_id IS NULL OR approved_by_user_id <> printed_by_user_id` | CHECK | ✔ | Reprint approved by a different person |
| C-04 | `md_change_set` | `approved_by_user_id IS NULL OR approved_by_user_id <> prepared_by_user_id` | CHECK | ✔ | Four-eyes on master data |
| C-05 | `membership_role` | Partial unique (`membership_id`) WHERE role is a lab role AND `revoked_at IS NULL` | UNIQUE | ✔ | One lab role per user per lab |
| C-06 | `membership_role` | `trg_role_matches_org_type` | TRG | ✔ | No customer role on a lab org, and so on |
| C-07 | `membership_site` | Trigger: the site belongs to the membership's org | TRG | ✔ | Site scoping |
| C-31 | `membership` | `trg_membership_platform_staff`: platform staff join only a PLATFORM org; nobody else joins one | TRG | ✔ | RR-5 |
| C-32 | `break_glass_grant` | `approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id`; approved ⇒ `approved_at` and `expires_at` set | CHECK | ✔ | Break-glass needs a second person |
| C-33 | `membership_role` | Partial unique (`membership_id`, `role`) WHERE `revoked_at IS NULL` | UNIQUE | | No duplicate active role |
| C-34 | `membership_site` | Partial unique (`membership_id`, `lab_site_id`) WHERE `revoked_at IS NULL` | UNIQUE | | No duplicate assignment |
| C-35 | `mfa_factor` | Partial unique (`user_id`, `factor_type`) WHERE verified and not revoked | UNIQUE | | One active factor |
| C-36 | `user_session` | FK (`active_membership_id`, `user_id`) → `membership (id, user_id)` | FK | ✔ | A session activates only its own user's membership |
| C-37 | `invitation_site` | Trigger: the site belongs to the invitation's org | TRG | | Site scoping |

### 1.2 Tenant keys
| # | Table | Constraint | Kind | Crit | Purpose |
|---|---|---|---|---|---|
| C-08 | `booking` | FK (`lab_site_id`, `lab_org_id`) → `lab_site (id, organisation_id)` (replaces the earlier trigger) | FK | ✔ | Tenant key correctness |
| C-38 | every **+TK** table | FK (`booking_id`, `customer_org_id`, `lab_org_id`) → `booking`, or the same three-column key to its parent | FK | ✔ | A child's tenant keys always equal its booking's (E-01) |
| C-39 | every **+ORG** table | FK (`lab_site_id`, `organisation_id`) → `lab_site` | FK | ✔ | Lab-owned rows carry the right org (E-02) |
| C-40 | `booking` | FKs (`customer_site_id`, `customer_org_id`) → `customer_site`; (`slot_id`, `lab_site_id`) → `slot`; (`price_list_id`, `lab_site_id`) → `price_list` | FK | ✔ | References stay inside the tenant and site |
| C-41 | `payout` | FK (`bank_account_id`, `lab_org_id`) → `bank_account (id, organisation_id)` | FK | ✔ | Pay only into the lab's own account |
| C-42 | `receipt_package`, `report_version`, `report_parameter_result` | FKs that include `booking_id` to `receipt_record`, `package`, `report`, `report_version`, `booking_line` | FK | ✔ | Both sides belong to the same booking (BR-063) |

### 1.3 Booking
| # | Table | Constraint | Kind | Crit | Purpose |
|---|---|---|---|---|---|
| C-09 | `booking` | `trg_booking_status_guard`: a status change needs `current_setting('app.transition_id')`, and (`transition_id`, old, new) must be a row of `booking_transition` | TRG | ✔ | Only the engine changes status, and only along legal transitions |
| C-10 | `booking` | `total_paise = subtotal_paise + gst_paise + platform_fee_paise`; every amount ≥ 0 | CHECK | ✔ | Money consistency |
| C-11 | `booking_line` | Trigger: price columns are immutable once the booking status isn't REQUESTED | TRG | ✔ | Snapshot immutability |
| C-43 | `booking` | Trigger: the four total columns are immutable once the status isn't REQUESTED | TRG | ✔ | Totals are frozen (A-09) |
| C-44 | `booking` | CANCELLED ⇒ cancellation code and party set; REJECTED ⇒ rejection reason set; `frozen_at` ⇒ `frozen_reason`; `declared_package_count` 1–50 | CHECK | | State consistency |
| C-45 | `booking_line` | `line_total_paise = unit_price_paise + sample_prep_paise + gst_paise`; all ≥ 0; `gst_rate_bp` 0–2800 | CHECK | ✔ | Money consistency |
| C-46 | `booking_line` | FK (`scope_line_version_id`, `scope_line_id`) → `scope_line_version`; trigger: scope line on the booking's site, price item in the booking's price list | FK + TRG | | Snapshot coherence |
| C-29 | `counter_offer` | At least one of slot, drop date, per-line quantity or quantity notes | CHECK | | Meaningful counter |
| C-47 | `counter_offer` | Partial unique (`booking_id`) WHERE `status = 'PENDING'` | UNIQUE | | One open counter |
| C-15 | `slot` | `held_count + booked_count <= capacity`; both ≥ 0; `capacity > 0`; `ends_at > starts_at` | CHECK | ✔ | No overbooking |
| C-48 | `slot_hold` | Partial unique (`booking_id`) WHERE `released_at IS NULL`; `kind = 'SOFT'` ⇒ `expires_at` set | UNIQUE + CHECK | | One live hold |
| C-49 | `booking_transition` | Unique NULLS NOT DISTINCT (`transition_id`, `from_status`) | UNIQUE | | Reference data |

### 1.4 Custody and reports
| # | Table | Constraint | Kind | Crit | Purpose |
|---|---|---|---|---|---|
| C-23 | `package` | Unique (`short_code`), never reused | UNIQUE | ✔ | Unambiguous lookup, also for voided labels (C-09 of the review) |
| C-24 | `qr_signing_key` | Partial unique (`purpose`) WHERE `status = 'ACTIVE'`; unique (`key_id`) | UNIQUE | ✔ | One signing key per purpose |
| C-50 | `custody_event` | Partial unique (`device_id`, `client_seq`) WHERE both set | UNIQUE | ✔ | An offline scan is recorded once |
| C-51 | `receipt_record` | Decision, checker and `decided_at` all set or all null; APPROVED or HOLD_CONFIRMED ⇒ `lab_sample_id`; `discrepancy_flag` ⇒ notes; counts ≥ 0 | CHECK | ✔ | State consistency |
| C-52 | `receipt_record` | Trigger: no change after `decided_at` is set | TRG | ✔ | Decided receipts are frozen |
| C-53 | `hold_case` | Partial unique (`booking_id`) WHERE status is OPEN or ESCALATED | UNIQUE | | One open hold |
| C-21 | `report` | Partial unique (`ulr_no`) WHERE not null; unique (`lab_site_id`, `report_no`) WHERE not null | UNIQUE | ✔ | ULR uniqueness. The ULR lives on `report`, so amendments keep it. |
| C-22 | `report_version` | Partial unique (`report_id`) WHERE status in (DRAFT, IN_REVIEW) | UNIQUE | ✔ | One open version |
| C-54 | `report_version` | Partial unique (`report_id`) WHERE `status = 'RELEASED'` | UNIQUE | ✔ | One current version |
| C-55 | `report_version` | Not DRAFT ⇒ file, hash, bound package, bind event, issue date, `submitted_at`, verification code, signing key set; RETURNED ⇒ comments; RELEASED or SUPERSEDED ⇒ checker, MFA time, `decided_at`, `released_at`, stamped file and hash; `is_amendment` ⇒ reason | CHECK | ✔ | State consistency |
| C-56 | `report_version` | Trigger: a RELEASED row can only become SUPERSEDED (setting `superseded_by_version_id`); a SUPERSEDED row never changes | TRG | ✔ | Released reports are frozen |
| C-30 | `report_parameter_result` | Trigger: the booking line isn't CANCELLED (same booking is guaranteed by C-42) | TRG | ✔ | Parameter subset (BR-061) |
| C-57 | `report_access_log` | `access_type = 'BREAK_GLASS'` ⇒ `grant_id` set | CHECK | ✔ | Break-glass is always tied to a grant |

### 1.5 Prices and lab configuration
| # | Table | Constraint | Kind | Crit | Purpose |
|---|---|---|---|---|---|
| C-12 | `price_list` | Partial unique (`lab_site_id`) WHERE `status = 'PUBLISHED'` | UNIQUE | ✔ | One effective list |
| C-13 | `price_list`, `price_item` | Trigger: no UPDATE or DELETE when published (except PUBLISHED → SUPERSEDED with `effective_to`) | TRG | ✔ | Price immutability |
| C-58 | `price_item` | `price_paise ≥ 0`, `sample_prep_paise ≥ 0`, `gst_rate_bp` 0–2800, `tat_days > 0`, `sample_qty > 0`; trigger: the scope line is on the price list's site | CHECK + TRG | | Sane prices |
| C-14 | `scope_line` | FK (`accreditation_id`, `lab_site_id`) → `accreditation (id, lab_site_id)` | FK | | Coherence |
| C-59 | `scope_line` | Partial unique (`lab_site_id`, `natural_key_hash`) WHERE `status = 'ACTIVE'` | UNIQUE | | De-duplication |
| C-60 | `accreditation` | `valid_to >= valid_from`; unique (`accreditation_body_id`, `certificate_no`) | CHECK + UNIQUE | | Sane validity |
| C-61 | `lab_site` | `(listing_status = 'BOOKABLE') = is_bookable` | CHECK | | The two derived flags agree |
| C-62 | `receiving_hours` | `closes_at > opens_at`; weekday 1–7; no overlapping rows per (site, weekday) | CHECK + EXCL | | Sane hours |
| C-63 | `site_closure`, `slot_template`, `retention_rule` | `ends_on >= starts_on`; `end_time > start_time`, `capacity > 0`, weekday 1–7; `retention_days > 0` | CHECK | | Sane configuration |
| C-64 | `lab_claim_request` | Partial unique (`organisation_id`) WHERE status is PENDING_OTP or PENDING_REVIEW | UNIQUE | | One pending claim |
| C-28 | `bank_account` | `ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'`; partial unique NULLS NOT DISTINCT (`organisation_id`, `lab_site_id`) WHERE primary and not retired | CHECK + UNIQUE | ✔ | Format; one primary account |

### 1.6 Payments and ledger
| # | Table | Constraint | Kind | Crit | Purpose |
|---|---|---|---|---|---|
| C-16 | `payment_order` | Partial unique (`booking_id`) WHERE status in (CAPTURED, REFUNDED_PARTIAL, REFUNDED_FULL) | UNIQUE | ✔ | One capture per booking, also after a refund |
| C-65 | `payment_order` | `amount_paise > 0`; trigger: equals `booking.total_paise` on insert; unique (`gateway`, `gateway_order_ref`), (`idempotency_key`), (`booking_id`, `attempt_no`) | CHECK + TRG + UNIQUE | ✔ | Charge exactly the booking total |
| C-66 | `payment_transaction` | Unique (`gateway`, `gateway_txn_ref`, `txn_type`); `amount_paise > 0` | UNIQUE + CHECK | ✔ | No duplicate gateway movement |
| C-17 | `gateway_webhook_event` | Unique (`gateway`, `event_id`) | UNIQUE | ✔ | Replay protection |
| C-18 | `ledger_entry` | Both amounts ≥ 0 and exactly one > 0; deferred trigger: Σ debit = Σ credit per journal | CHECK + TRG | ✔ | Double entry |
| C-19 | `refund` | `amount_paise > 0`; trigger: Σ refunds not FAILED ≤ Σ captured for the payment order, with a row lock | CHECK + TRG | ✔ | No over-refund, also for refunds in flight |
| C-20 | `payout_item` | Partial unique (`booking_id`) WHERE `voided_at IS NULL` | UNIQUE | ✔ | No double payout |
| C-67 | `payout` | `amount_paise > 0`; RELEASED ⇒ releaser and time set | CHECK | ✔ | State consistency |
| C-68 | `financial_document` | Unique (`document_series_id`, `doc_no`); total = taxable + CGST + SGST + IGST; IGST excludes CGST and SGST | UNIQUE + CHECK | ✔ | Gapless numbering, tax arithmetic |
| C-69 | `document_series` | Unique (`issuer_org_id`, `doc_type`, `financial_year`); `next_number ≥ 1` | UNIQUE + CHECK | | One series |
| C-70 | `fee_rule`, `config_parameter` | No overlapping effective windows per key and scope; `effective_to > effective_from` | EXCL + CHECK | | One value at any time |
| C-71 | `ledger_account` | Unique NULLS NOT DISTINCT (`code`, `party_org_id`) | UNIQUE | | One account per party |

### 1.7 Disputes, master data, platform
| # | Table | Constraint | Kind | Crit | Purpose |
|---|---|---|---|---|---|
| C-72 | `dispute` | Partial unique (`booking_id`) WHERE status is open; unique (`dispute_no`); decided ⇒ outcome, rationale, decider; refund amount ≥ 0 | UNIQUE + CHECK | | One open dispute |
| C-73 | `dispute` | Trigger: after `decided_at` only `status` may change, and only to CLOSED | TRG | ✔ | Decisions are frozen |
| C-74 | `rating` | Scores 1–5; LAB_TO_CUSTOMER ⇒ not public; unique (`booking_id`, `direction`) | CHECK + UNIQUE | | Sane ratings |
| C-75 | `md_change_set` | APPROVED or PUBLISHED ⇒ approver and time; PUBLISHED ⇒ `published_at` | CHECK | | State consistency |
| C-76 | `md_node` | `effective_to > effective_from`; unique (`taxonomy_id`, `code`); trigger: parent in the same taxonomy, at the level above | CHECK + UNIQUE + TRG | | Tree coherence |
| C-77 | columns that point at a taxonomy node | `assert_md_node(node_id, taxonomy_code, node_type_code)` trigger on `scope_line`, `receipt_record.condition_node_id`, `hold_case.reason_node_id`, `booking` reason codes, `dispute.type_node_id`, `refund.reason_code` | TRG | | A reason code comes from the right list (C-15 of the review) |
| C-26 | `organisation` | `(org_type = 'CUSTOMER') = (customer_segment IS NOT NULL)` | CHECK | | Segment required |
| C-27 | `gstin` columns | `gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`; `organisation`: partial unique (`org_type`, `gstin`) | CHECK + UNIQUE | | Format; one org per type per GSTIN |
| C-78 | `config_parameter`, `holiday_calendar`, `retention_rule`, `slot`, `idempotency_record` | Unique keys declared NULLS NOT DISTINCT (see the spec) | UNIQUE | | The "null means default" row is unique |
| C-79 | `otp_challenge` | `attempts` 0–5 | CHECK | | Throttle |
| C-80 | `audit_log_chain` | Unique (`chain_month`, `seq`); unique (`audit_log_id`) | UNIQUE | ✔ | One chain per month |
| C-25 | every AO table | `REVOKE UPDATE, DELETE, TRUNCATE` from `app_rw` and `app_worker`, plus `trg_append_only` that raises an error | GRANT + TRG | ✔ | Append-only |
| C-81 | `outbox_event`, `gateway_webhook_event` | Column-level `GRANT UPDATE` on the processing columns only; `outbox_event` to `app_worker` only | GRANT | ✔ | Events cannot be rewritten |

## 2. Indexes

Unique keys from the register above are not repeated here.

### Search and discovery (Postgres side)
- `lab_site`: GIST (`geo_point`); B-tree (`is_bookable`, `listing_status`); (`organisation_id`); (`pincode`).
- `scope_line`: (`lab_site_id`, `status`); (`parameter_node_id`, `status`); (`product_node_id`); (`discipline_node_id`); (`method_node_id`).
- `md_node`: (`taxonomy_id`, `node_type_id`, `status`); (`parent_id`); GIST (`path`); GIN trigram on `name` (`pg_trgm`) for admin lookup; GIN (`aliases`).
- `accreditation`: (`lab_site_id`, `status`); (`valid_to`) for expiry sweeps.
- `price_item`: (`scope_line_id`).

### Booking and operations
- `booking`: (`customer_org_id`, `status`, `created_at DESC`); (`lab_site_id`, `status`, `created_at DESC`); (`lab_org_id`, `status`); (`status`, `status_changed_at`) for the ops board; (`requester_user_id`, `created_at DESC`) for "own records only"; (`slot_id`); (`customer_org_id`, `lower(btrim(item_name))`, `lower(btrim(batch_no))`, `created_at`) for duplicate detection, case- and space-insensitive.
- `booking_line`: (`booking_id`); (`scope_line_id`) for EC-02 impact queries.
- `booking_status_history`: (`booking_id`, `occurred_at`).
- `counter_offer`: (`booking_id`).
- `slot`: (`lab_site_id`, `slot_date`, `status`).
- `slot_hold`: (`slot_id`) WHERE `released_at IS NULL`; (`expires_at`) WHERE `released_at IS NULL`.
- `package`: (`booking_id`).
- `custody_event`: (`booking_id`, `server_received_at`); (`package_id`).
- `receipt_record`: partial (`booking_id`) WHERE `decision IS NULL` for pending approvals.
- `hold_case`: (`status`, `due_at`).
- `label_print`: (`booking_id`).
- `report`: (`lab_org_id`); (`customer_org_id`).
- `report_version`: partial (`status`) WHERE `status = 'IN_REVIEW'`; unique (`verification_code`).
- `report_parameter_result`: (`booking_line_id`).
- `report_share_link`: (`report_version_id`); unique (`token_hash`).
- `report_access_log`: (`report_version_id`, `occurred_at`).
- `verification_event`: (`verification_code`, `occurred_at`); (`ip_hash`, `occurred_at`).
- `dispute`: (`customer_org_id`, `status`); (`lab_org_id`, `status`); (`status`, `lab_response_due_at`).
- `lead_request`: (`status`, `created_at`).

### Identity and labs
- `membership`: (`organisation_id`, `status`).
- `membership_site`: (`lab_site_id`) WHERE `revoked_at IS NULL`.
- `user_session`: unique (`refresh_token_hash`); (`token_family_id`); (`user_id`) WHERE `revoked_at IS NULL`.
- `otp_challenge`: (`destination_hash`, `purpose`, `created_at`).
- `invitation`: unique (`token_hash`); (`organisation_id`, `email`).
- `app_user`: unique (`email`); partial unique (`phone_e164`).
- `lab_claim_request`: (`organisation_id`, `status`).
- `customer_site`, `bank_account`, `kyc_document`: (`organisation_id`).
- `receiving_hours`: (`lab_site_id`, `weekday`). `site_closure`: (`lab_site_id`, `starts_on`).
- `lab_penalty`: (`lab_org_id`, `occurred_at`).

### Master data
- `md_change_set`: (`status`, `submitted_at`). `md_change_item`: (`change_set_id`); (`target_type`, `target_id`).
- `import_job`: (`status`); (`organisation_id`).

### Platform
- `outbox_event`: partial (`occurred_at`) WHERE `published_at IS NULL`.
- `timer`: partial (`due_at`) WHERE `status = 'PENDING'`; (`aggregate_type`, `aggregate_id`).
- `audit_log`: per partition (`entity_type`, `entity_id`, `occurred_at`); (`actor_user_id`, `occurred_at`).
- `notification`: (`recipient_user_id`, `channel`, `read_at`) for the in-app inbox; (`event_id`).
- `idempotency_record`: (`expires_at`) for cleanup.

### Finance
- `payment_order`: (`booking_id`); partial (`status`, `reconcile_until`) WHERE `status = 'PENDING'`.
- `payment_transaction`: (`payment_order_id`).
- `gateway_webhook_event`: partial (`received_at`) WHERE `processing_status IN ('RECEIVED','FAILED')`.
- `refund`: (`booking_id`); (`payment_order_id`); (`status`).
- `payout`: (`lab_org_id`, `status`); (`status`, `eligible_at`). `payout_item`: (`payout_id`).
- `payout_hold`: (`booking_id`) WHERE `released_at IS NULL`.
- `ledger_entry`: (`account_id`, `journal_id`). `ledger_journal`: (`booking_id`); (`payment_transaction_id`); (`refund_id`); (`payout_id`).
- `financial_document`: (`booking_id`).
- `settlement_report_line`: (`gateway_txn_ref`); (`match_status`).

## 3. Extensions
`postgis`, `pg_trgm`, `ltree`, `citext`, `pgcrypto`, `btree_gist` (for the exclusion constraints in C-62 and C-70). Use the `pg_uuidv7` extension if it's available on RDS, otherwise generate IDs in the application (default).

## 4. Partitioning
- `audit_log`: monthly range partitions. The primary key is (`id`, `occurred_at`). A default partition exists, so an insert never fails for want of a partition. Creating monthly partitions is DDL and needs the owner role; how that job runs is OQ-28.
- `custody_event`, `notification`, `verification_event`: plain tables in year 1, with monthly partitioning considered once they pass ~50M rows.
