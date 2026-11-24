# Indexes, constraints and triggers

**Status:** DRAFT for gate G1. Everything listed here needs a migration test (see `06-engineering/TESTING_STRATEGY.md` §4).

## 1. Integrity constraints that are critical to the business

| # | Table | Constraint | Purpose |
|---|---|---|---|
| C-01 | `receipt_record` | `CHECK (checker_user_id IS NULL OR checker_user_id <> maker_user_id)` | No self-approval |
| C-02 | `report_version` | Same as C-01 | No self-approval |
| C-03 | `label_print` | `CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> printed_by_user_id)` | Reprint approval by a different person |
| C-04 | `md_change_set` | `CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> prepared_by_user_id)` | Four-eyes on master data |
| C-05 | `membership_role` | Partial unique (`membership_id`) WHERE role in lab roles AND `revoked_at IS NULL` | One lab role per user per lab |
| C-06 | `membership_role` | Trigger `trg_role_matches_org_type` | No customer role on a lab org, and so on |
| C-07 | `membership_site` | Trigger: the site belongs to the membership's org | Site scoping |
| C-08 | `booking` | Trigger `trg_booking_lab_org`: `lab_org_id = lab_site.organisation_id` | Tenant key correctness |
| C-09 | `booking` | Trigger `trg_booking_status_guard`: a status change needs `current_setting('app.transition_id')` | Only the engine changes status |
| C-10 | `booking` | `CHECK (total_paise = subtotal_paise + gst_paise + platform_fee_paise)` | Money consistency |
| C-11 | `booking_line` | Trigger: price columns are immutable once the booking status isn't REQUESTED | Snapshot immutability |
| C-12 | `price_list` | Partial unique (`lab_site_id`) WHERE `status='PUBLISHED'` | One effective list |
| C-13 | `price_list`, `price_item` | Trigger: no UPDATE or DELETE when published (except PUBLISHED→SUPERSEDED) | Price immutability |
| C-14 | `scope_line` | Trigger: `accreditation.lab_site_id = scope_line.lab_site_id` | Coherence |
| C-15 | `slot` | `CHECK (held_count + booked_count <= capacity AND held_count >= 0 AND booked_count >= 0)` | No overbooking |
| C-16 | `payment_order` | Partial unique (`booking_id`) WHERE `status='CAPTURED'` | One capture per booking |
| C-17 | `gateway_webhook_event` | Unique (`gateway`, `event_id`) | Replay protection |
| C-18 | `ledger_entry` | `CHECK ((debit_paise > 0) <> (credit_paise > 0))`, plus a deferred trigger: Σdebit = Σcredit per journal | Double entry |
| C-19 | `refund` | Trigger: Σ succeeded refunds ≤ Σ captured for the booking | No over-refund |
| C-20 | `payout_item` | Unique (`booking_id`) for non-cancelled payouts | No double payout |
| C-21 | `report_version` | Partial unique (`ulr_no`) for released versions, excluding the same report | ULR uniqueness |
| C-22 | `report_version` | Partial unique (`report_id`) WHERE status in (DRAFT, IN_REVIEW) | One open version |
| C-23 | `package` | Partial unique (`short_code`) WHERE `status <> 'VOIDED'` | Unambiguous lookup |
| C-24 | `qr_signing_key` | Partial unique (`purpose`) WHERE `status='ACTIVE'` | One signing key per purpose |
| C-25 | AO tables | `REVOKE UPDATE, DELETE … FROM app_rw`, plus a trigger that raises an error | Append-only |
| C-26 | `organisation` | `CHECK ((org_type='CUSTOMER') = (customer_segment IS NOT NULL))` | Segment required |
| C-27 | `gstin` columns | `CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')` | Format |
| C-28 | `bank_account.ifsc` | `CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$')` | Format |
| C-29 | `counter_offer` | `CHECK (proposed_slot_id IS NOT NULL OR proposed_drop_date IS NOT NULL OR per_line_quantity IS NOT NULL OR extra_quantity_notes IS NOT NULL)` | Meaningful counter |
| C-30 | `report_parameter_result` | Trigger: the line belongs to the same booking and isn't cancelled | Parameter subset |

## 2. Indexes

### Search and discovery (Postgres side)
- `lab_site`: GIST (`geo_point`); B-tree (`is_bookable`, `listing_status`); (`organisation_id`); (`pincode`).
- `scope_line`: (`lab_site_id`, `status`); (`parameter_node_id`, `status`); (`product_node_id`); (`discipline_node_id`); (`method_node_id`).
- `md_node`: (`taxonomy_id`, `node_type_id`, `status`); GIST (`path`); GIN trigram on `name` (`pg_trgm`) for admin lookup; GIN (`aliases`).
- `accreditation`: (`lab_site_id`, `status`); (`valid_to`) for expiry sweeps.

### Booking and operations
- `booking`: (`customer_org_id`, `status`, `created_at DESC`); (`lab_site_id`, `status`, `created_at DESC`); (`lab_org_id`, `status`); (`status`, `status_changed_at`) for the ops board; (`customer_org_id`, `item_name`, `batch_no`, `created_at`) for duplicate detection; unique (`booking_no`).
- `booking_line`: (`booking_id`); (`scope_line_id`) for EC-02 impact queries.
- `booking_status_history`: (`booking_id`, `occurred_at`).
- `slot`: (`lab_site_id`, `slot_date`, `status`).
- `package`: (`booking_id`); unique (`short_code`) partial.
- `custody_event`: (`booking_id`, `server_received_at`); (`package_id`).
- `receipt_record`: (`booking_id`, `version_no`); partial (`booking_id`) WHERE `decision IS NULL` for pending approvals.
- `report_version`: (`report_id`, `version_no`); partial (`status`) WHERE `status='IN_REVIEW'`; unique (`verification_code`).

### Platform
- `outbox_event`: partial (`occurred_at`) WHERE `published_at IS NULL`.
- `timer`: partial (`due_at`) WHERE `status='PENDING'`; (`aggregate_type`, `aggregate_id`).
- `audit_log`: per partition (`entity_type`, `entity_id`, `occurred_at`); (`actor_user_id`, `occurred_at`).
- `notification`: (`recipient_user_id`, `channel`, `read_at`) for the in-app inbox; (`event_id`).
- `idempotency_record`: (`expires_at`) for cleanup.

### Finance
- `payment_order`: (`booking_id`); partial (`status`, `reconcile_until`) WHERE `status='PENDING'`.
- `payment_transaction`: unique (`gateway_txn_ref`, `txn_type`).
- `payout`: (`lab_org_id`, `status`); (`status`, `eligible_at`).
- `ledger_entry`: (`account_id`, `journal_id`); `ledger_journal` (`booking_id`).
- `financial_document`: unique (`issuer_org_id`, `doc_no`); (`booking_id`).

## 3. Extensions
`postgis`, `pg_trgm`, `ltree`, `citext`, `pgcrypto`. Use the `pg_uuidv7` extension if it's available on RDS, otherwise generate IDs in the application (default).

## 4. Partitioning
- `audit_log`: monthly range partitions, created ahead by the worker.
- `custody_event`, `notification`, `verification_event`: plain tables in year 1, with monthly partitioning considered once they pass ~50M rows.
