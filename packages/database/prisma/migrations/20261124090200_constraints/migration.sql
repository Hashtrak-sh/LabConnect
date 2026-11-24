-- Constraints Prisma cannot express. Hand-written.
-- C-xx numbers refer to docs/03-database/INDEXES_AND_CONSTRAINTS.md.

-- ===================================================================
-- Unique keys that include a nullable column: NULLS NOT DISTINCT (C-78, C-49, C-71, C-28)
-- The index names match the Prisma schema, which declares them as plain unique keys.
-- ===================================================================
DROP INDEX "uq_config_parameter_window";
CREATE UNIQUE INDEX "uq_config_parameter_window" ON "config_parameter" ("key", "scope_type", "scope_id", "effective_from") NULLS NOT DISTINCT;

DROP INDEX "uq_holiday_calendar_date_region";
CREATE UNIQUE INDEX "uq_holiday_calendar_date_region" ON "holiday_calendar" ("holiday_date", "region_code") NULLS NOT DISTINCT;

DROP INDEX "uq_idempotency_record_key";
CREATE UNIQUE INDEX "uq_idempotency_record_key" ON "idempotency_record" ("idempotency_key", "actor_user_id", "route") NULLS NOT DISTINCT;

DROP INDEX "uq_bank_account_primary";
CREATE UNIQUE INDEX "uq_bank_account_primary" ON "bank_account" ("organisation_id", "lab_site_id") NULLS NOT DISTINCT WHERE ("is_primary" = true AND "retired_at" IS NULL);

DROP INDEX "uq_retention_rule_site_discipline";
CREATE UNIQUE INDEX "uq_retention_rule_site_discipline" ON "retention_rule" ("lab_site_id", "discipline_node_id") NULLS NOT DISTINCT;

DROP INDEX "uq_slot_site_discipline_start";
CREATE UNIQUE INDEX "uq_slot_site_discipline_start" ON "slot" ("lab_site_id", "discipline_node_id", "starts_at") NULLS NOT DISTINCT;

DROP INDEX "uq_booking_transition";
CREATE UNIQUE INDEX "uq_booking_transition" ON "booking_transition" ("transition_id", "from_status") NULLS NOT DISTINCT;

DROP INDEX "uq_ledger_account_code_party";
CREATE UNIQUE INDEX "uq_ledger_account_code_party" ON "ledger_account" ("code", "party_org_id") NULLS NOT DISTINCT;

-- ===================================================================
-- Expression index: duplicate detection ignores case and surrounding spaces (D-03)
-- ===================================================================
CREATE INDEX "ix_booking_duplicate_detection" ON "booking"
  ("customer_org_id", (lower(btrim("item_name"))), (lower(btrim("batch_no"))), "created_at");

-- ===================================================================
-- audit_log partitions. The default partition means an insert can never fail
-- for want of a partition.
-- ===================================================================
CREATE TABLE "audit_log_default" PARTITION OF "audit_log" DEFAULT;

-- Monthly partitions from November 2026 to December 2027. Later ones are a scheduled job (OQ-28).
DO $$
DECLARE
  m date := DATE '2026-11-01';
BEGIN
  WHILE m < DATE '2028-01-01' LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
                   'audit_log_' || to_char(m, 'YYYY_MM'), m, (m + INTERVAL '1 month')::date);
    m := (m + INTERVAL '1 month')::date;
  END LOOP;
END
$$;

-- ===================================================================
-- Separation of duties
-- ===================================================================
ALTER TABLE "receipt_record" ADD CONSTRAINT "ck_receipt_record_maker_checker" -- C-01
  CHECK ("checker_user_id" IS NULL OR "checker_user_id" <> "maker_user_id");
ALTER TABLE "report_version" ADD CONSTRAINT "ck_report_version_maker_checker" -- C-02
  CHECK ("checker_user_id" IS NULL OR "checker_user_id" <> "maker_user_id");
ALTER TABLE "label_print" ADD CONSTRAINT "ck_label_print_approver" -- C-03
  CHECK ("approved_by_user_id" IS NULL OR "approved_by_user_id" <> "printed_by_user_id");
ALTER TABLE "md_change_set" ADD CONSTRAINT "ck_md_change_set_four_eyes" -- C-04
  CHECK ("approved_by_user_id" IS NULL OR "approved_by_user_id" <> "prepared_by_user_id");
ALTER TABLE "break_glass_grant" ADD CONSTRAINT "ck_break_glass_grant_approver" -- C-32
  CHECK ("approved_by_user_id" IS NULL OR "approved_by_user_id" <> "requested_by_user_id");
ALTER TABLE "break_glass_grant" ADD CONSTRAINT "ck_break_glass_grant_approved" -- C-32
  CHECK (("approved_by_user_id" IS NULL AND "approved_at" IS NULL)
      OR ("approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL AND "expires_at" IS NOT NULL));

-- ===================================================================
-- Platform
-- ===================================================================
ALTER TABLE "config_parameter" ADD CONSTRAINT "ck_config_parameter_window" -- C-70
  CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");
ALTER TABLE "config_parameter" ADD CONSTRAINT "ex_config_parameter_no_overlap" -- C-70
  EXCLUDE USING gist (
    "key" WITH =,
    "scope_type" WITH =,
    (COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    tstzrange("effective_from", "effective_to") WITH &&
  );
ALTER TABLE "otp_challenge" ADD CONSTRAINT "ck_otp_challenge_attempts" -- C-79
  CHECK ("attempts" BETWEEN 0 AND 5);

-- ===================================================================
-- Identity
-- ===================================================================
ALTER TABLE "organisation" ADD CONSTRAINT "ck_organisation_segment" -- C-26
  CHECK (("org_type" = 'CUSTOMER') = ("customer_segment" IS NOT NULL));
ALTER TABLE "organisation" ADD CONSTRAINT "ck_organisation_gstin" -- C-27
  CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
ALTER TABLE "customer_site" ADD CONSTRAINT "ck_customer_site_gstin" -- C-27
  CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
ALTER TABLE "financial_document" ADD CONSTRAINT "ck_financial_document_gstin" -- C-27
  CHECK (("issuer_gstin" IS NULL OR "issuer_gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
     AND ("recipient_gstin" IS NULL OR "recipient_gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'));

-- ===================================================================
-- Master data
-- ===================================================================
ALTER TABLE "md_change_set" ADD CONSTRAINT "ck_md_change_set_state" -- C-75
  CHECK (("status" NOT IN ('APPROVED', 'PUBLISHED') OR ("approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL))
     AND ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL));
ALTER TABLE "md_node" ADD CONSTRAINT "ck_md_node_window" -- C-76
  CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" > "effective_from");
-- The path is filled by trg_md_node_path. It is nullable in the Prisma schema only so
-- that the Prisma client can create rows of a table with an unsupported column type.
ALTER TABLE "md_node" ADD CONSTRAINT "ck_md_node_path" CHECK ("path" IS NOT NULL); -- C-76

-- ===================================================================
-- Labs
-- ===================================================================
ALTER TABLE "lab_site" ADD CONSTRAINT "ck_lab_site_bookable_flags" -- C-61
  CHECK (("listing_status" = 'BOOKABLE') = "is_bookable");
ALTER TABLE "lab_site" ADD CONSTRAINT "ck_lab_site_pincode" CHECK ("pincode" ~ '^[0-9]{6}$');
ALTER TABLE "customer_site" ADD CONSTRAINT "ck_customer_site_pincode" CHECK ("pincode" ~ '^[0-9]{6}$');
ALTER TABLE "accreditation" ADD CONSTRAINT "ck_accreditation_validity" -- C-60
  CHECK ("valid_to" >= "valid_from");
ALTER TABLE "bank_account" ADD CONSTRAINT "ck_bank_account_ifsc" -- C-28
  CHECK ("ifsc" ~ '^[A-Z]{4}0[A-Z0-9]{6}$');
ALTER TABLE "receiving_hours" ADD CONSTRAINT "ck_receiving_hours" -- C-62
  CHECK ("closes_at" > "opens_at" AND "weekday" BETWEEN 1 AND 7);
ALTER TABLE "receiving_hours" ADD CONSTRAINT "ex_receiving_hours_no_overlap" -- C-62
  EXCLUDE USING gist (
    "lab_site_id" WITH =,
    "weekday" WITH =,
    int4range(EXTRACT(EPOCH FROM "opens_at")::int, EXTRACT(EPOCH FROM "closes_at")::int) WITH &&
  );
ALTER TABLE "site_closure" ADD CONSTRAINT "ck_site_closure_dates" -- C-63
  CHECK ("ends_on" >= "starts_on");
ALTER TABLE "slot_template" ADD CONSTRAINT "ck_slot_template" -- C-63
  CHECK ("end_time" > "start_time" AND "capacity" > 0 AND "weekday" BETWEEN 1 AND 7);
ALTER TABLE "retention_rule" ADD CONSTRAINT "ck_retention_rule_days" -- C-63
  CHECK ("retention_days" > 0 AND ("max_sampling_to_receipt_hours" IS NULL OR "max_sampling_to_receipt_hours" > 0));
ALTER TABLE "price_item" ADD CONSTRAINT "ck_price_item_values" -- C-58
  CHECK ("price_paise" >= 0 AND "sample_prep_paise" >= 0 AND "gst_rate_bp" BETWEEN 0 AND 2800
     AND "tat_days" > 0 AND "sample_qty" > 0);
ALTER TABLE "slot" ADD CONSTRAINT "ck_slot_capacity" -- C-15
  CHECK ("held_count" >= 0 AND "booked_count" >= 0 AND "capacity" > 0
     AND "held_count" + "booked_count" <= "capacity" AND "ends_at" > "starts_at");

-- ===================================================================
-- Booking
-- ===================================================================
ALTER TABLE "booking" ADD CONSTRAINT "ck_booking_totals" -- C-10
  CHECK ("total_paise" = "subtotal_paise" + "gst_paise" + "platform_fee_paise"
     AND "subtotal_paise" >= 0 AND "gst_paise" >= 0 AND "platform_fee_paise" >= 0);
ALTER TABLE "booking" ADD CONSTRAINT "ck_booking_state" -- C-44
  CHECK (("status" <> 'CANCELLED' OR ("cancellation_code_node_id" IS NOT NULL AND "cancelled_by_party" IS NOT NULL))
     AND ("status" <> 'REJECTED' OR "rejection_reason_node_id" IS NOT NULL)
     AND ("frozen_at" IS NULL OR "frozen_reason" IS NOT NULL)
     AND "declared_package_count" BETWEEN 1 AND 50
     AND "currency" = 'INR');
ALTER TABLE "booking_line" ADD CONSTRAINT "ck_booking_line_money" -- C-45
  CHECK ("line_total_paise" = "unit_price_paise" + "sample_prep_paise" + "gst_paise"
     AND "unit_price_paise" >= 0 AND "sample_prep_paise" >= 0 AND "gst_paise" >= 0
     AND "gst_rate_bp" BETWEEN 0 AND 2800
     AND ("required_sample_qty" IS NULL OR "required_sample_qty" > 0));
ALTER TABLE "counter_offer" ADD CONSTRAINT "ck_counter_offer_meaningful" -- C-29
  CHECK ("proposed_slot_id" IS NOT NULL OR "proposed_drop_date" IS NOT NULL
      OR "per_line_quantity" IS NOT NULL OR "extra_quantity_notes" IS NOT NULL);
ALTER TABLE "slot_hold" ADD CONSTRAINT "ck_slot_hold_soft_expiry" -- C-48
  CHECK ("kind" <> 'SOFT' OR "expires_at" IS NOT NULL);

-- ===================================================================
-- Custody and reports
-- ===================================================================
ALTER TABLE "receipt_record" ADD CONSTRAINT "ck_receipt_record_state" -- C-51
  CHECK ((("decision" IS NULL AND "checker_user_id" IS NULL AND "decided_at" IS NULL)
       OR ("decision" IS NOT NULL AND "checker_user_id" IS NOT NULL AND "decided_at" IS NOT NULL))
     AND ("decision" IS NULL OR "decision" = 'REJECTED_UNFIT' OR "lab_sample_id" IS NOT NULL)
     AND (NOT "discrepancy_flag" OR "discrepancy_notes" IS NOT NULL)
     AND "declared_package_count" >= 0 AND "actual_package_count" >= 0);
ALTER TABLE "report_version" ADD CONSTRAINT "ck_report_version_state" -- C-55
  CHECK (("status" = 'DRAFT' OR ("issue_date" IS NOT NULL AND "original_file_id" IS NOT NULL
            AND "original_sha256" IS NOT NULL AND "bound_package_id" IS NOT NULL
            AND "bind_event_id" IS NOT NULL AND "submitted_at" IS NOT NULL
            AND "verification_code" IS NOT NULL AND "signing_key_id" IS NOT NULL))
     AND ("status" <> 'RETURNED' OR "review_comments" IS NOT NULL)
     AND ("status" NOT IN ('RELEASED', 'SUPERSEDED') OR ("checker_user_id" IS NOT NULL
            AND "checker_mfa_at" IS NOT NULL AND "decided_at" IS NOT NULL AND "released_at" IS NOT NULL
            AND "stamped_file_id" IS NOT NULL AND "stamped_sha256" IS NOT NULL))
     AND (NOT "is_amendment" OR "amendment_reason" IS NOT NULL));
ALTER TABLE "report_access_log" ADD CONSTRAINT "ck_report_access_log_grant" -- C-57
  CHECK ("access_type" <> 'BREAK_GLASS' OR "grant_id" IS NOT NULL);

-- ===================================================================
-- Payments and ledger
-- ===================================================================
ALTER TABLE "payment_order" ADD CONSTRAINT "ck_payment_order_amount" CHECK ("amount_paise" > 0); -- C-65
ALTER TABLE "payment_transaction" ADD CONSTRAINT "ck_payment_transaction_amount" CHECK ("amount_paise" > 0); -- C-66
ALTER TABLE "refund" ADD CONSTRAINT "ck_refund_amount" CHECK ("amount_paise" > 0); -- C-19
ALTER TABLE "payout" ADD CONSTRAINT "ck_payout_state" -- C-67
  CHECK ("amount_paise" > 0
     AND ("status" <> 'RELEASED' OR ("released_by_user_id" IS NOT NULL AND "released_at" IS NOT NULL)));
ALTER TABLE "payout_item" ADD CONSTRAINT "ck_payout_item_amount" CHECK ("amount_paise" > 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ck_ledger_entry_one_side" -- C-18
  CHECK ("debit_paise" >= 0 AND "credit_paise" >= 0 AND (("debit_paise" > 0) <> ("credit_paise" > 0)));
ALTER TABLE "ledger_journal" ADD CONSTRAINT "ck_ledger_journal_tenant_keys" -- C-38
  CHECK (("booking_id" IS NULL AND "customer_org_id" IS NULL AND "lab_org_id" IS NULL)
      OR ("booking_id" IS NOT NULL AND "customer_org_id" IS NOT NULL AND "lab_org_id" IS NOT NULL));
ALTER TABLE "document_series" ADD CONSTRAINT "ck_document_series_next" CHECK ("next_number" >= 1); -- C-69
ALTER TABLE "financial_document" ADD CONSTRAINT "ck_financial_document_tax" -- C-68
  CHECK ("total_paise" = "taxable_paise" + "cgst_paise" + "sgst_paise" + "igst_paise"
     AND "taxable_paise" >= 0 AND "cgst_paise" >= 0 AND "sgst_paise" >= 0 AND "igst_paise" >= 0
     AND ("igst_paise" = 0 OR ("cgst_paise" = 0 AND "sgst_paise" = 0)));
ALTER TABLE "fee_rule" ADD CONSTRAINT "ck_fee_rule_window" -- C-70
  CHECK (("effective_to" IS NULL OR "effective_to" > "effective_from") AND "value" >= 0
     AND "lab_share_bp" BETWEEN 0 AND 10000);
ALTER TABLE "fee_rule" ADD CONSTRAINT "ex_fee_rule_no_overlap" -- C-70
  EXCLUDE USING gist (
    "fee_type" WITH =,
    "scope_type" WITH =,
    (COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    tstzrange("effective_from", "effective_to") WITH &&
  );

-- ===================================================================
-- Disputes and ratings
-- ===================================================================
ALTER TABLE "dispute" ADD CONSTRAINT "ck_dispute_state" -- C-72
  CHECK (("decided_at" IS NULL OR ("outcome" IS NOT NULL AND "decision_rationale" IS NOT NULL AND "decided_by_user_id" IS NOT NULL))
     AND ("status" <> 'DECIDED' OR "decided_at" IS NOT NULL)
     AND ("refund_amount_paise" IS NULL OR "refund_amount_paise" >= 0));
ALTER TABLE "rating" ADD CONSTRAINT "ck_rating_values" -- C-74
  CHECK ("score_overall" BETWEEN 1 AND 5
     AND ("score_tat" IS NULL OR "score_tat" BETWEEN 1 AND 5)
     AND ("score_communication" IS NULL OR "score_communication" BETWEEN 1 AND 5)
     AND ("direction" <> 'LAB_TO_CUSTOMER' OR NOT "is_public"));
