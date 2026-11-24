-- CreateEnum
CREATE TYPE "config_scope" AS ENUM ('GLOBAL', 'LAB_ORG', 'LAB_SITE', 'CATEGORY');

-- CreateEnum
CREATE TYPE "timer_type" AS ENUM ('LAB_DECISION_REMINDER_50', 'LAB_DECISION_REMINDER_90', 'LAB_DECISION_DUE', 'COUNTER_RESPONSE_DUE', 'PAYMENT_REMINDER', 'PAYMENT_DUE', 'DROP_REMINDER', 'DROP_DEADLINE', 'NO_SHOW_DUE', 'RECEIPT_APPROVAL_REMINDER', 'HOLD_DECISION_DUE', 'REPORT_DUE', 'REPORT_APPROVAL_REMINDER', 'DISPUTE_WINDOW_END', 'PAYMENT_RECONCILE');

-- CreateEnum
CREATE TYPE "timer_status" AS ENUM ('PENDING', 'FIRED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "org_type" AS ENUM ('CUSTOMER', 'LAB', 'PLATFORM');

-- CreateEnum
CREATE TYPE "customer_segment" AS ENUM ('INDIVIDUAL', 'BUSINESS', 'INDUSTRY', 'GOVERNMENT');

-- CreateEnum
CREATE TYPE "claim_status" AS ENUM ('UNCLAIMED', 'CLAIM_PENDING', 'CLAIMED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('NOT_STARTED', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "org_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "role_code" AS ENUM ('CUSTOMER_ADMIN', 'CUSTOMER_REQUESTER', 'CUSTOMER_FINANCE', 'LAB_MAKER', 'LAB_CHECKER', 'PLATFORM_OPS', 'PLATFORM_DATA_STEWARD', 'PLATFORM_FINANCE', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "otp_channel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('LOGIN', 'LAB_CLAIM', 'VERIFY_EMAIL', 'VERIFY_PHONE');

-- CreateEnum
CREATE TYPE "mfa_factor_type" AS ENUM ('TOTP');

-- CreateEnum
CREATE TYPE "file_purpose" AS ENUM ('REPORT_ORIGINAL', 'REPORT_STAMPED', 'RECEIPT_PHOTO', 'BOOKING_ATTACHMENT', 'KYC_DOCUMENT', 'DISPUTE_EVIDENCE', 'IMPORT_SOURCE', 'FINANCIAL_DOCUMENT', 'LABEL_SHEET', 'CUSTODY_TRAIL');

-- CreateEnum
CREATE TYPE "scan_status" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR', 'REJECTED');

-- CreateEnum
CREATE TYPE "md_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "md_data_type" AS ENUM ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'ENUM', 'NODE_REF', 'STRING_ARRAY');

-- CreateEnum
CREATE TYPE "change_source" AS ENUM ('MANUAL', 'IMPORT', 'LAB_PROPOSAL', 'NABL_SYNC');

-- CreateEnum
CREATE TYPE "change_set_status" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "md_target_type" AS ENUM ('MD_NODE', 'LAB_ORG', 'LAB_SITE', 'ACCREDITATION', 'SCOPE_LINE', 'SYNONYM');

-- CreateEnum
CREATE TYPE "change_operation" AS ENUM ('CREATE', 'UPDATE', 'DEACTIVATE', 'REACTIVATE');

-- CreateEnum
CREATE TYPE "validation_status" AS ENUM ('VALID', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "import_kind" AS ENUM ('NABL_LABS', 'NABL_SCOPE', 'TAXONOMY_NODES', 'LAB_PRICE_LIST');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('UPLOADED', 'PARSING', 'PREVIEW_READY', 'FAILED', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "import_source_format" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "import_match_result" AS ENUM ('NEW', 'MATCHED', 'DUPLICATE_IN_FILE', 'CONFLICT');

-- CreateEnum
CREATE TYPE "import_row_action" AS ENUM ('CREATE', 'UPDATE', 'NO_CHANGE', 'SKIP', 'ERROR');

-- CreateEnum
CREATE TYPE "lab_category" AS ENUM ('TESTING', 'CALIBRATION', 'MEDICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "accreditation_status" AS ENUM ('VALID', 'SUSPENDED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "scope_site_type" AS ENUM ('PERMANENT', 'SITE', 'MOBILE');

-- CreateEnum
CREATE TYPE "geocode_status" AS ENUM ('PENDING', 'AUTO_OK', 'LOW_CONFIDENCE', 'MANUAL_APPROVED');

-- CreateEnum
CREATE TYPE "listing_status" AS ENUM ('LISTED', 'BOOKABLE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "claim_method" AS ENUM ('EMAIL_OTP', 'MANUAL');

-- CreateEnum
CREATE TYPE "claim_request_status" AS ENUM ('PENDING_OTP', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "price_list_status" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "slot_status" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "lead_kind" AS ENUM ('REQUEST_LAB', 'NO_RESULT');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('NEW', 'IN_PROGRESS', 'CLOSED_ONBOARDED', 'CLOSED_NO_ACTION');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('REQUESTED', 'COUNTERED', 'ACCEPTED', 'PAID', 'HANDOVER_SET', 'SAMPLE_RECORDED', 'ON_HOLD', 'RECEIVED', 'UNDER_TEST', 'REPORT_IN_REVIEW', 'REPORT_RELEASED', 'DISPUTED', 'COMPLETED', 'REJECTED', 'EXPIRED', 'EXPIRED_UNPAID', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "booking_line_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "party_type" AS ENUM ('CUSTOMER', 'LAB', 'PLATFORM', 'SYSTEM');

-- CreateEnum
CREATE TYPE "counter_status" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "hold_kind" AS ENUM ('SOFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "qr_purpose" AS ENUM ('BOOKING', 'PACKAGE', 'REPORT');

-- CreateEnum
CREATE TYPE "key_status" AS ENUM ('ACTIVE', 'VERIFY_ONLY', 'RETIRED');

-- CreateEnum
CREATE TYPE "package_status" AS ENUM ('ISSUED', 'RECEIVED', 'MISSING', 'VOIDED');

-- CreateEnum
CREATE TYPE "custody_event_type" AS ENUM ('QR_ISSUED', 'LABELS_PRINTED', 'LABEL_REPRINTED', 'LABEL_VOIDED', 'SCAN_ACCEPTED', 'SCAN_REJECTED', 'MANUAL_LOOKUP', 'RECEIPT_SUBMITTED', 'RECEIPT_APPROVED', 'RECEIPT_ON_HOLD', 'SAMPLE_REJECTED', 'REPORT_BOUND');

-- CreateEnum
CREATE TYPE "receipt_decision" AS ENUM ('APPROVED', 'HOLD_CONFIRMED', 'REJECTED_UNFIT');

-- CreateEnum
CREATE TYPE "hold_decision" AS ENUM ('PROCEED', 'REPLACE', 'CANCEL');

-- CreateEnum
CREATE TYPE "hold_status" AS ENUM ('OPEN', 'DECIDED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('IN_PROGRESS', 'RELEASED', 'AMENDMENT_IN_PROGRESS');

-- CreateEnum
CREATE TYPE "report_version_status" AS ENUM ('DRAFT', 'IN_REVIEW', 'RETURNED', 'RELEASED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "conformity_result" AS ENUM ('CONFORMS', 'DOES_NOT_CONFORM', 'NOT_STATED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "report_access_type" AS ENUM ('DOWNLOAD', 'SHARE_LINK_DOWNLOAD', 'BREAK_GLASS');

-- CreateEnum
CREATE TYPE "verification_result" AS ENUM ('GENUINE_CURRENT', 'GENUINE_SUPERSEDED', 'NOT_FOUND', 'REVOKED');

-- CreateEnum
CREATE TYPE "gateway_code" AS ENUM ('ICICI', 'FAKE');

-- CreateEnum
CREATE TYPE "payment_order_status" AS ENUM ('CREATED', 'PENDING', 'CAPTURED', 'FAILED', 'EXPIRED', 'REFUNDED_PARTIAL', 'REFUNDED_FULL');

-- CreateEnum
CREATE TYPE "payment_txn_type" AS ENUM ('CAPTURE', 'REFUND', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "payment_txn_status" AS ENUM ('SUCCESS', 'FAILED', 'PENDING');

-- CreateEnum
CREATE TYPE "webhook_processing_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('REQUESTED', 'APPROVED', 'SUBMITTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('PENDING', 'ON_HOLD', 'ELIGIBLE', 'RELEASED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payout_mechanism" AS ENUM ('GATEWAY_SETTLEMENT', 'BANK_TRANSFER_MANUAL', 'TBD');

-- CreateEnum
CREATE TYPE "payout_hold_reason" AS ENUM ('DISPUTE', 'OPS_MANUAL', 'COMPLIANCE');

-- CreateEnum
CREATE TYPE "ledger_normal_balance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ledger_journal_type" AS ENUM ('PAYMENT_CAPTURED', 'REFUND_ISSUED', 'CANCELLATION_FEE', 'NO_SHOW_FEE', 'PAYOUT_RELEASED', 'DUPLICATE_CAPTURE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "fin_doc_type" AS ENUM ('TAX_INVOICE', 'PAYMENT_RECEIPT', 'CREDIT_NOTE', 'REFUND_NOTE');

-- CreateEnum
CREATE TYPE "fee_type" AS ENUM ('PLATFORM_FEE', 'CANCELLATION_FEE', 'NO_SHOW_FEE', 'HANDLING_FEE');

-- CreateEnum
CREATE TYPE "fee_calc" AS ENUM ('PERCENT_BP', 'FLAT_PAISE');

-- CreateEnum
CREATE TYPE "settlement_match_status" AS ENUM ('MATCHED', 'UNMATCHED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('OPEN', 'AWAITING_LAB', 'AWAITING_CUSTOMER', 'UNDER_REVIEW', 'DECIDED', 'CLOSED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "dispute_outcome" AS ENUM ('NO_ACTION', 'PARTIAL_REFUND', 'FULL_REFUND', 'REPORT_AMENDMENT_REQUIRED', 'REFERRED_TO_LAB_COMPLAINT_PROCESS');

-- CreateEnum
CREATE TYPE "rating_direction" AS ENUM ('CUSTOMER_TO_LAB', 'LAB_TO_CUSTOMER');

-- CreateEnum
CREATE TYPE "message_visibility" AS ENUM ('ALL', 'PLATFORM_ONLY');

-- CreateEnum
CREATE TYPE "notif_channel" AS ENUM ('EMAIL', 'IN_APP', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "notif_status" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL,
    "booking_no" VARCHAR(20) NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "customer_site_id" UUID,
    "requester_user_id" UUID NOT NULL,
    "on_behalf_by_user_id" UUID,
    "lab_site_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "status" "booking_status" NOT NULL,
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "item_name" TEXT NOT NULL,
    "batch_no" VARCHAR(100),
    "product_node_id" UUID,
    "declared_package_count" INTEGER NOT NULL,
    "slot_id" UUID,
    "preferred_drop_date" DATE NOT NULL,
    "current_trf_version" INTEGER NOT NULL DEFAULT 1,
    "price_list_id" UUID NOT NULL,
    "subtotal_paise" BIGINT NOT NULL,
    "gst_paise" BIGINT NOT NULL,
    "platform_fee_paise" BIGINT NOT NULL DEFAULT 0,
    "total_paise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "lab_snapshot" JSONB NOT NULL,
    "lab_decision_due_at" TIMESTAMPTZ(6),
    "payment_due_at" TIMESTAMPTZ(6),
    "drop_deadline_at" TIMESTAMPTZ(6),
    "expected_report_date" DATE,
    "report_released_at" TIMESTAMPTZ(6),
    "dispute_window_ends_at" TIMESTAMPTZ(6),
    "retain_until" DATE,
    "deviation_noted" BOOLEAN NOT NULL DEFAULT false,
    "deviation_notes" TEXT,
    "cancellation_code_node_id" UUID,
    "cancelled_by_party" "party_type",
    "cancellation_notes" TEXT,
    "rejection_reason_node_id" UUID,
    "rejection_notes" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "frozen_at" TIMESTAMPTZ(6),
    "frozen_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_line" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "scope_line_id" UUID NOT NULL,
    "scope_line_version_id" UUID NOT NULL,
    "price_item_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "unit_price_paise" BIGINT NOT NULL,
    "sample_prep_paise" BIGINT NOT NULL,
    "gst_rate_bp" INTEGER NOT NULL,
    "gst_paise" BIGINT NOT NULL,
    "line_total_paise" BIGINT NOT NULL,
    "status" "booking_line_status" NOT NULL DEFAULT 'NOT_STARTED',
    "cancelled_reason" TEXT,
    "required_sample_qty" DECIMAL(12,3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "booking_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trf" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "schema_version" VARCHAR(10) NOT NULL,
    "form" JSONB NOT NULL,
    "conformity_required" BOOLEAN NOT NULL,
    "decision_rule" TEXT,
    "submitted_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "trf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "transition_id" VARCHAR(6) NOT NULL,
    "from_status" "booking_status",
    "to_status" "booking_status" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "role_code",
    "actor_party" "party_type" NOT NULL,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter_offer" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "proposed_slot_id" UUID,
    "proposed_drop_date" DATE,
    "extra_quantity_notes" TEXT,
    "per_line_quantity" JSONB,
    "message" TEXT NOT NULL,
    "status" "counter_status" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "proposed_by_user_id" UUID NOT NULL,
    "responded_by_user_id" UUID,
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counter_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_hold" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "kind" "hold_kind" NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "slot_hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_transition" (
    "seq" SMALLINT NOT NULL,
    "transition_id" VARCHAR(6) NOT NULL,
    "from_status" "booking_status",
    "to_status" "booking_status" NOT NULL,

    CONSTRAINT "booking_transition_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "qr_signing_key" (
    "id" UUID NOT NULL,
    "key_id" VARCHAR(8) NOT NULL,
    "purpose" "qr_purpose" NOT NULL,
    "kms_key_arn" TEXT NOT NULL,
    "status" "key_status" NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "verify_until" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "qr_signing_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "seq_no" INTEGER NOT NULL,
    "total_packages" INTEGER NOT NULL,
    "is_top_up" BOOLEAN NOT NULL DEFAULT false,
    "short_code" CHAR(6) NOT NULL,
    "label_version" INTEGER NOT NULL DEFAULT 1,
    "qr_payload" TEXT NOT NULL,
    "signing_key_id" VARCHAR(8) NOT NULL,
    "status" "package_status" NOT NULL DEFAULT 'ISSUED',
    "lab_sample_id" VARCHAR(60),
    "received_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_event" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "package_id" UUID,
    "event_type" "custody_event_type" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "role_code",
    "lab_site_id" UUID,
    "device_id" VARCHAR(64),
    "client_recorded_at" TIMESTAMPTZ(6),
    "client_seq" BIGINT,
    "server_received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clock_skew_flag" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "custody_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_record" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "declared_package_count" INTEGER NOT NULL,
    "actual_package_count" INTEGER NOT NULL,
    "condition_node_id" UUID NOT NULL,
    "item_matches" BOOLEAN NOT NULL,
    "batch_matches" BOOLEAN NOT NULL,
    "quantity_sufficient" BOOLEAN NOT NULL,
    "seal_intact" BOOLEAN NOT NULL,
    "observed_batch_no" VARCHAR(100),
    "discrepancy_flag" BOOLEAN NOT NULL DEFAULT false,
    "discrepancy_notes" TEXT,
    "maker_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "checker_user_id" UUID,
    "decision" "receipt_decision",
    "decision_notes" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "lab_sample_id" VARCHAR(60),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receipt_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_package" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "receipt_record_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "scanned_at" TIMESTAMPTZ(6) NOT NULL,
    "scan_event_id" UUID NOT NULL,
    "condition_node_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "receipt_package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hold_case" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "receipt_record_id" UUID NOT NULL,
    "reason_node_id" UUID NOT NULL,
    "details" TEXT,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "customer_decision" "hold_decision",
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "escalated_at" TIMESTAMPTZ(6),
    "status" "hold_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hold_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label_print" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "package_id" UUID,
    "label_version" INTEGER NOT NULL,
    "printed_by_user_id" UUID NOT NULL,
    "printed_by_party" "party_type" NOT NULL,
    "is_reprint" BOOLEAN NOT NULL DEFAULT false,
    "reprint_reason" TEXT,
    "approved_by_user_id" UUID,
    "file_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "label_print_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_event_photo" (
    "id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "custody_event_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "sha256" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "custody_event_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_site" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" JSONB NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "state_code" VARCHAR(4) NOT NULL,
    "geo_point" geography(Point,4326),
    "gstin" VARCHAR(15),
    "contact" JSONB,
    "is_default_billing" BOOLEAN NOT NULL DEFAULT false,
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_settings" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "requester_can_pay" BOOLEAN NOT NULL DEFAULT false,
    "default_customer_site_id" UUID,
    "report_recipients" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_request" (
    "id" UUID NOT NULL,
    "kind" "lead_kind" NOT NULL,
    "lab_site_id" UUID,
    "query" JSONB,
    "requester_user_id" UUID,
    "contact_email" CITEXT,
    "status" "lead_status" NOT NULL DEFAULT 'NEW',
    "assigned_to_user_id" UUID,
    "notes" TEXT,
    "notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "lead_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "dispute_no" VARCHAR(20) NOT NULL,
    "type_node_id" UUID NOT NULL,
    "raised_by_user_id" UUID NOT NULL,
    "raised_by_party" "party_type" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "dispute_status" NOT NULL DEFAULT 'OPEN',
    "lab_response_due_at" TIMESTAMPTZ(6),
    "assigned_to_user_id" UUID,
    "outcome" "dispute_outcome",
    "refund_amount_paise" BIGINT,
    "decision_rationale" TEXT,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_message" (
    "id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "dispute_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "author_party" "party_type" NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "message_visibility" NOT NULL DEFAULT 'ALL',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "dispute_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "dispute_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "direction" "rating_direction" NOT NULL,
    "rated_by_user_id" UUID NOT NULL,
    "score_overall" SMALLINT NOT NULL,
    "score_tat" SMALLINT,
    "score_communication" SMALLINT,
    "comment" TEXT,
    "is_public" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_object" (
    "id" UUID NOT NULL,
    "owner_org_id" UUID,
    "customer_org_id" UUID,
    "lab_org_id" UUID,
    "purpose" "file_purpose" NOT NULL,
    "bucket" VARCHAR(63) NOT NULL,
    "object_key" TEXT NOT NULL,
    "object_version_id" TEXT,
    "original_filename" TEXT,
    "declared_content_type" VARCHAR(100) NOT NULL,
    "detected_content_type" VARCHAR(100),
    "size_bytes" BIGINT NOT NULL,
    "sha256" BYTEA,
    "scan_status" "scan_status" NOT NULL DEFAULT 'PENDING',
    "scan_completed_at" TIMESTAMPTZ(6),
    "validation_errors" JSONB,
    "uploaded_by_user_id" UUID,
    "retention_class" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "file_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_link" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" UUID NOT NULL,
    "role" VARCHAR(40) NOT NULL,
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "file_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation" (
    "id" UUID NOT NULL,
    "org_type" "org_type" NOT NULL,
    "customer_segment" "customer_segment",
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "gstin" VARCHAR(15),
    "registered_address" JSONB,
    "claim_status" "claim_status" NOT NULL,
    "kyc_status" "verification_status" NOT NULL DEFAULT 'NOT_STARTED',
    "status" "org_status" NOT NULL DEFAULT 'ACTIVE',
    "nabl_lab_ref" VARCHAR(50),
    "current_version_no" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "phone_e164" VARCHAR(16),
    "phone_verified_at" TIMESTAMPTZ(6),
    "full_name" TEXT NOT NULL,
    "designation" TEXT,
    "status" "user_status" NOT NULL,
    "is_platform_staff" BOOLEAN NOT NULL DEFAULT false,
    "mfa_enrolled_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en-IN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "deactivated_at" TIMESTAMPTZ(6),
    "deactivated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_role" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role" "role_code" NOT NULL,
    "granted_by_user_id" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "membership_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_site" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "membership_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "roles" "role_code"[],
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenge" (
    "id" UUID NOT NULL,
    "channel" "otp_channel" NOT NULL,
    "destination_hash" BYTEA NOT NULL,
    "purpose" "otp_purpose" NOT NULL,
    "code_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "context_id" UUID,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "otp_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_factor" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "factor_type" "mfa_factor_type" NOT NULL,
    "secret_ciphertext" BYTEA NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "mfa_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_code" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" BYTEA NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "mfa_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "active_membership_id" UUID,
    "refresh_token_hash" BYTEA NOT NULL,
    "token_family_id" UUID NOT NULL,
    "mfa_verified_at" TIMESTAMPTZ(6),
    "ip_address" INET,
    "user_agent" TEXT,
    "device_label" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_site" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "invitation_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_private" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "pan_ciphertext" BYTEA,
    "pan_last4" VARCHAR(4),
    "trust_flags" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "organisation_private_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_version" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_set_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "organisation_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_site" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "site_code" VARCHAR(30) NOT NULL,
    "name" TEXT NOT NULL,
    "address" JSONB NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "state_code" VARCHAR(4) NOT NULL,
    "geo_point" geography(Point,4326),
    "geocode_confidence" DECIMAL(4,3),
    "geocode_status" "geocode_status" NOT NULL DEFAULT 'PENDING',
    "submission_instructions" TEXT,
    "max_open_jobs" INTEGER,
    "listing_status" "listing_status" NOT NULL DEFAULT 'LISTED',
    "is_bookable" BOOLEAN NOT NULL DEFAULT false,
    "bookability_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating_avg" DECIMAL(3,2),
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "responsiveness_score" DECIMAL(5,2),
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "current_version_no" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lab_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_site_version" (
    "id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_set_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "lab_site_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accreditation" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "accreditation_body_id" UUID NOT NULL,
    "standard_id" UUID NOT NULL,
    "lab_category" "lab_category" NOT NULL,
    "certificate_no" VARCHAR(50) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE NOT NULL,
    "status" "accreditation_status" NOT NULL,
    "status_as_of" DATE NOT NULL,
    "source_ref" TEXT,
    "current_version_no" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "accreditation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accreditation_version" (
    "id" UUID NOT NULL,
    "accreditation_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_set_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "accreditation_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_line" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "accreditation_id" UUID NOT NULL,
    "discipline_node_id" UUID NOT NULL,
    "group_node_id" UUID,
    "product_node_id" UUID,
    "parameter_node_id" UUID NOT NULL,
    "method_node_id" UUID,
    "method_text" TEXT,
    "range_text" TEXT,
    "range_min" DECIMAL(24,8),
    "range_max" DECIMAL(24,8),
    "range_unit_node_id" UUID,
    "site_type" "scope_site_type" NOT NULL,
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "temporarily_unavailable" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" DATE,
    "effective_to" DATE,
    "source_ref" TEXT,
    "natural_key_hash" BYTEA NOT NULL,
    "current_version_no" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "scope_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_line_version" (
    "id" UUID NOT NULL,
    "scope_line_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_set_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "scope_line_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_claim_request" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "method" "claim_method" NOT NULL,
    "status" "claim_request_status" NOT NULL,
    "authorisation_file_id" UUID,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "decision_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lab_claim_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_document" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "document_type_node_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "status" "verification_status" NOT NULL DEFAULT 'SUBMITTED',
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "kyc_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_account" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID,
    "account_holder_name" TEXT NOT NULL,
    "account_number_ciphertext" BYTEA NOT NULL,
    "account_number_last4" VARCHAR(4) NOT NULL,
    "ifsc" CHAR(11) NOT NULL,
    "status" "verification_status" NOT NULL DEFAULT 'SUBMITTED',
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_hours" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "opens_at" TIME(6) NOT NULL,
    "closes_at" TIME(6) NOT NULL,
    "cutoff_at" TIME(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "receiving_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_closure" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "site_closure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_rule" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "discipline_node_id" UUID,
    "retention_days" INTEGER NOT NULL,
    "max_sampling_to_receipt_hours" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "retention_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "price_list_status" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMPTZ(6),
    "effective_to" TIMESTAMPTZ(6),
    "published_by_user_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "import_job_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_item" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "scope_line_id" UUID NOT NULL,
    "price_paise" BIGINT NOT NULL,
    "sample_prep_paise" BIGINT NOT NULL DEFAULT 0,
    "gst_rate_bp" INTEGER NOT NULL DEFAULT 1800,
    "sample_qty" DECIMAL(12,3) NOT NULL,
    "sample_unit_node_id" UUID NOT NULL,
    "packaging_instructions" TEXT,
    "tat_days" INTEGER NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "price_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_template" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "discipline_node_id" UUID,
    "weekday" SMALLINT NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "slot_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "discipline_node_id" UUID,
    "slot_date" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "held_count" INTEGER NOT NULL DEFAULT 0,
    "booked_count" INTEGER NOT NULL DEFAULT 0,
    "status" "slot_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_site_private" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "contact_email" CITEXT,
    "contact_phone" VARCHAR(20),
    "public_contact" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lab_site_private_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_penalty" (
    "id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "booking_id" UUID,
    "rule" VARCHAR(10) NOT NULL,
    "reason" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "lab_penalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "md_taxonomy" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_hierarchical" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "md_taxonomy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "md_node_type" (
    "id" UUID NOT NULL,
    "taxonomy_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "parent_node_type_id" UUID,
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "md_node_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "md_attribute_definition" (
    "id" UUID NOT NULL,
    "node_type_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" TEXT NOT NULL,
    "data_type" "md_data_type" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_searchable" BOOLEAN NOT NULL DEFAULT false,
    "validation" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "md_attribute_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "md_node" (
    "id" UUID NOT NULL,
    "taxonomy_id" UUID NOT NULL,
    "node_type_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" VARCHAR(100) NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "path" ltree,
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "effective_from" DATE,
    "effective_to" DATE,
    "current_version_no" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "md_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "md_node_version" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_set_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "md_node_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "md_change_set" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source" "change_source" NOT NULL,
    "status" "change_set_status" NOT NULL DEFAULT 'DRAFT',
    "import_job_id" UUID,
    "proposed_by_org_id" UUID,
    "prepared_by_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "impact_summary" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "md_change_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "md_change_item" (
    "id" UUID NOT NULL,
    "change_set_id" UUID NOT NULL,
    "target_type" "md_target_type" NOT NULL,
    "target_id" UUID,
    "operation" "change_operation" NOT NULL,
    "proposed" JSONB NOT NULL,
    "diff" JSONB,
    "base_version_no" INTEGER,
    "validation_status" "validation_status" NOT NULL,
    "validation_messages" JSONB,
    "import_row_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "md_change_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mapping_template" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target_kind" "import_kind" NOT NULL,
    "source_format" "import_source_format" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "column_map" JSONB NOT NULL,
    "defaults" JSONB,
    "owner_org_id" UUID,
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "import_mapping_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL,
    "kind" "import_kind" NOT NULL,
    "organisation_id" UUID,
    "lab_site_id" UUID,
    "source_file_id" UUID NOT NULL,
    "source_label" TEXT,
    "mapping_template_id" UUID NOT NULL,
    "mapping_template_version" INTEGER NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'UPLOADED',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "conflict_count" INTEGER NOT NULL DEFAULT 0,
    "change_set_id" UUID,
    "price_list_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row" (
    "id" UUID NOT NULL,
    "import_job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "mapped" JSONB,
    "match_result" "import_match_result",
    "matched_target_id" UUID,
    "action" "import_row_action",
    "messages" JSONB,
    "organisation_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accreditation_body" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" TEXT NOT NULL,
    "verification_url_template" TEXT,
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "accreditation_body_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accreditation_standard" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" TEXT NOT NULL,
    "lab_category" "lab_category" NOT NULL,
    "is_supported" BOOLEAN NOT NULL DEFAULT true,
    "is_bookable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "accreditation_standard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_synonym" (
    "id" UUID NOT NULL,
    "term" CITEXT NOT NULL,
    "expands_to" TEXT[],
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "current_version_no" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "search_synonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_synonym_version" (
    "id" UUID NOT NULL,
    "search_synonym_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_set_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "search_synonym_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_template" (
    "id" UUID NOT NULL,
    "event_code" VARCHAR(100) NOT NULL,
    "channel" "notif_channel" NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "external_template_id" VARCHAR(100),
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "event_code" VARCHAR(100) NOT NULL,
    "event_id" UUID NOT NULL,
    "channel" "notif_channel" NOT NULL,
    "template_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "is_action_required" BOOLEAN NOT NULL DEFAULT false,
    "status" "notif_status" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" VARCHAR(200),
    "sent_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_code" VARCHAR(100) NOT NULL,
    "channel" "notif_channel" NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_order" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "gateway" "gateway_code" NOT NULL,
    "gateway_order_ref" VARCHAR(100),
    "amount_paise" BIGINT NOT NULL,
    "status" "payment_order_status" NOT NULL DEFAULT 'CREATED',
    "initiated_by_user_id" UUID NOT NULL,
    "checkout_expires_at" TIMESTAMPTZ(6),
    "reconcile_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transaction" (
    "id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "payment_order_id" UUID NOT NULL,
    "gateway" "gateway_code" NOT NULL,
    "gateway_txn_ref" VARCHAR(100) NOT NULL,
    "txn_type" "payment_txn_type" NOT NULL,
    "method" VARCHAR(30),
    "amount_paise" BIGINT NOT NULL,
    "status" "payment_txn_status" NOT NULL,
    "is_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "gateway_reported_at" TIMESTAMPTZ(6),
    "webhook_event_id" UUID,
    "raw_summary" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "payment_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_webhook_event" (
    "id" UUID NOT NULL,
    "gateway" "gateway_code" NOT NULL,
    "event_id" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload_ciphertext" BYTEA NOT NULL,
    "payload_sha256" BYTEA NOT NULL,
    "processing_status" "webhook_processing_status" NOT NULL DEFAULT 'RECEIVED',
    "processed_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "payment_order_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "reason_code_node_id" UUID NOT NULL,
    "policy_rule" VARCHAR(10),
    "initiated_by_party" "party_type" NOT NULL,
    "initiated_by_user_id" UUID,
    "approved_by_user_id" UUID,
    "status" "refund_status" NOT NULL DEFAULT 'REQUESTED',
    "gateway_refund_ref" VARCHAR(100),
    "credit_note_id" UUID,
    "dispute_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout" (
    "id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'PENDING',
    "mechanism" "payout_mechanism" NOT NULL DEFAULT 'TBD',
    "eligible_at" TIMESTAMPTZ(6),
    "released_by_user_id" UUID,
    "released_at" TIMESTAMPTZ(6),
    "external_ref" VARCHAR(100),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_item" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "voided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "payout_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_hold" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "reason_type" "payout_hold_reason" NOT NULL,
    "dispute_id" UUID,
    "placed_by_user_id" UUID,
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by_user_id" UUID,
    "released_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payout_hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "party_org_id" UUID,
    "normal_balance" "ledger_normal_balance" NOT NULL,
    "status" "md_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "ledger_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_journal" (
    "id" UUID NOT NULL,
    "booking_id" UUID,
    "customer_org_id" UUID,
    "lab_org_id" UUID,
    "journal_type" "ledger_journal_type" NOT NULL,
    "payment_transaction_id" UUID,
    "refund_id" UUID,
    "payout_id" UUID,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "posted_by_user_id" UUID,
    "reverses_journal_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "ledger_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit_paise" BIGINT NOT NULL DEFAULT 0,
    "credit_paise" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_series" (
    "id" UUID NOT NULL,
    "issuer_org_id" UUID NOT NULL,
    "doc_type" "fin_doc_type" NOT NULL,
    "financial_year" CHAR(7) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "document_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_document" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "doc_type" "fin_doc_type" NOT NULL,
    "document_series_id" UUID NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "issuer_org_id" UUID NOT NULL,
    "issuer_gstin" VARCHAR(15),
    "recipient_org_id" UUID NOT NULL,
    "recipient_gstin" VARCHAR(15),
    "related_document_id" UUID,
    "taxable_paise" BIGINT NOT NULL,
    "cgst_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_paise" BIGINT NOT NULL DEFAULT 0,
    "total_paise" BIGINT NOT NULL,
    "place_of_supply_state" VARCHAR(4),
    "sac_code" VARCHAR(8),
    "line_snapshot" JSONB NOT NULL,
    "file_id" UUID,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "e_invoice_irn" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "financial_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rule" (
    "id" UUID NOT NULL,
    "fee_type" "fee_type" NOT NULL,
    "scope_type" "config_scope" NOT NULL,
    "scope_id" UUID,
    "calc" "fee_calc" NOT NULL,
    "value" BIGINT NOT NULL,
    "lab_share_bp" INTEGER NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fee_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_report_line" (
    "id" UUID NOT NULL,
    "gateway" "gateway_code" NOT NULL,
    "settlement_date" DATE NOT NULL,
    "gateway_txn_ref" VARCHAR(100) NOT NULL,
    "gross_paise" BIGINT NOT NULL,
    "fee_paise" BIGINT NOT NULL,
    "tax_paise" BIGINT NOT NULL,
    "net_paise" BIGINT NOT NULL,
    "utr" VARCHAR(40),
    "import_job_id" UUID,
    "match_status" "settlement_match_status" NOT NULL DEFAULT 'UNMATCHED',
    "matched_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "settlement_report_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_parameter" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "scope_type" "config_scope" NOT NULL,
    "scope_id" UUID,
    "value" JSONB NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "change_reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "config_parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_calendar" (
    "id" UUID NOT NULL,
    "holiday_date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "region_code" VARCHAR(10),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "holiday_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "actor_user_id" UUID,
    "actor_membership_id" UUID,
    "actor_role" "role_code",
    "actor_org_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "request_id" VARCHAR(64),
    "ip_address" INET,
    "user_agent" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");
-- Edited by hand: Prisma cannot express partitioning (schema spec 1.3). Partitions are created in the constraints migration and, later, ahead of time by the worker.

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(60) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_event" (
    "consumer" VARCHAR(60) NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_event_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "timer" (
    "id" UUID NOT NULL,
    "timer_type" "timer_type" NOT NULL,
    "aggregate_type" VARCHAR(60) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "timer_status" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "fired_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "timer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" UUID NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "actor_user_id" UUID,
    "route" VARCHAR(200) NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "status" "idempotency_status" NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_chain" (
    "id" UUID NOT NULL,
    "chain_month" DATE NOT NULL,
    "seq" BIGINT NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "audit_occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "prev_hash" BYTEA,
    "hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_chain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "lab_site_id" UUID NOT NULL,
    "report_no" VARCHAR(60),
    "ulr_no" VARCHAR(30),
    "current_released_version_id" UUID,
    "status" "report_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_version" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "report_version_status" NOT NULL DEFAULT 'DRAFT',
    "is_amendment" BOOLEAN NOT NULL DEFAULT false,
    "issue_date" DATE,
    "original_file_id" UUID,
    "original_sha256" BYTEA,
    "stamped_file_id" UUID,
    "stamped_sha256" BYTEA,
    "bound_package_id" UUID,
    "bind_event_id" UUID,
    "amendment_reason" TEXT,
    "maker_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "checker_user_id" UUID,
    "checker_mfa_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "review_comments" TEXT,
    "verification_code" VARCHAR(16),
    "signing_key_id" VARCHAR(8),
    "superseded_by_version_id" UUID,
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "report_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_parameter_result" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "report_version_id" UUID NOT NULL,
    "booking_line_id" UUID NOT NULL,
    "conformity" "conformity_result" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "report_parameter_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_share_link" (
    "id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "report_version_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "last_accessed_at" TIMESTAMPTZ(6),
    "recipient_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "report_share_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_access_log" (
    "id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "report_version_id" UUID NOT NULL,
    "accessor_user_id" UUID,
    "access_type" "report_access_type" NOT NULL,
    "share_link_id" UUID,
    "grant_id" UUID,
    "reason" TEXT,
    "ip_address" INET,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "report_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_event" (
    "id" UUID NOT NULL,
    "verification_code" VARCHAR(16) NOT NULL,
    "result" "verification_result" NOT NULL,
    "ip_hash" BYTEA NOT NULL,
    "user_agent_family" VARCHAR(40),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_grant" (
    "id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "lab_org_id" UUID NOT NULL,
    "report_version_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "lock_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "break_glass_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_customer_org_id_status_created_at_idx" ON "booking"("customer_org_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "booking_lab_site_id_status_created_at_idx" ON "booking"("lab_site_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "booking_lab_org_id_status_idx" ON "booking"("lab_org_id", "status");

-- CreateIndex
CREATE INDEX "booking_status_status_changed_at_idx" ON "booking"("status", "status_changed_at");

-- CreateIndex
CREATE INDEX "booking_requester_user_id_created_at_idx" ON "booking"("requester_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "booking_slot_id_idx" ON "booking"("slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_booking_no_key" ON "booking"("booking_no");

-- CreateIndex
CREATE UNIQUE INDEX "booking_id_customer_org_id_lab_org_id_key" ON "booking"("id", "customer_org_id", "lab_org_id");

-- CreateIndex
CREATE INDEX "booking_line_scope_line_id_idx" ON "booking_line"("scope_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_line_booking_id_line_no_key" ON "booking_line"("booking_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "booking_line_booking_id_scope_line_id_key" ON "booking_line"("booking_id", "scope_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_line_id_booking_id_key" ON "booking_line"("id", "booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "trf_booking_id_version_no_key" ON "trf"("booking_id", "version_no");

-- CreateIndex
CREATE INDEX "booking_status_history_booking_id_occurred_at_idx" ON "booking_status_history"("booking_id", "occurred_at");

-- CreateIndex
CREATE INDEX "counter_offer_booking_id_idx" ON "counter_offer"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_counter_offer_pending" ON "counter_offer"("booking_id") WHERE ("status" = 'PENDING');

-- CreateIndex
CREATE INDEX "ix_slot_hold_slot_live" ON "slot_hold"("slot_id") WHERE ("released_at" IS NULL);

-- CreateIndex
CREATE INDEX "ix_slot_hold_expiry_live" ON "slot_hold"("expires_at") WHERE ("released_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_slot_hold_live" ON "slot_hold"("booking_id") WHERE ("released_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_booking_transition" ON "booking_transition"("transition_id", "from_status");

-- CreateIndex
CREATE UNIQUE INDEX "qr_signing_key_key_id_key" ON "qr_signing_key"("key_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_qr_signing_key_active" ON "qr_signing_key"("purpose") WHERE ("status" = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "package_short_code_key" ON "package"("short_code");

-- CreateIndex
CREATE UNIQUE INDEX "package_booking_id_seq_no_label_version_key" ON "package"("booking_id", "seq_no", "label_version");

-- CreateIndex
CREATE UNIQUE INDEX "package_id_booking_id_key" ON "package"("id", "booking_id");

-- CreateIndex
CREATE INDEX "custody_event_booking_id_server_received_at_idx" ON "custody_event"("booking_id", "server_received_at");

-- CreateIndex
CREATE INDEX "custody_event_package_id_idx" ON "custody_event"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "custody_event_id_customer_org_id_lab_org_id_key" ON "custody_event"("id", "customer_org_id", "lab_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_custody_event_device_seq" ON "custody_event"("device_id", "client_seq") WHERE ("device_id" IS NOT NULL AND "client_seq" IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_receipt_record_pending" ON "receipt_record"("booking_id") WHERE ("decision" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_record_booking_id_version_no_key" ON "receipt_record"("booking_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_record_id_booking_id_key" ON "receipt_record"("id", "booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_package_receipt_record_id_package_id_key" ON "receipt_package"("receipt_record_id", "package_id");

-- CreateIndex
CREATE INDEX "hold_case_status_due_at_idx" ON "hold_case"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hold_case_open" ON "hold_case"("booking_id") WHERE (status = ANY (ARRAY['OPEN'::hold_status, 'ESCALATED'::hold_status]));

-- CreateIndex
CREATE INDEX "label_print_booking_id_idx" ON "label_print"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "custody_event_photo_custody_event_id_file_id_key" ON "custody_event_photo"("custody_event_id", "file_id");

-- CreateIndex
CREATE INDEX "customer_site_organisation_id_idx" ON "customer_site"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_site_id_organisation_id_key" ON "customer_site"("id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_settings_organisation_id_key" ON "customer_settings"("organisation_id");

-- CreateIndex
CREATE INDEX "lead_request_status_created_at_idx" ON "lead_request"("status", "created_at");

-- CreateIndex
CREATE INDEX "dispute_customer_org_id_status_idx" ON "dispute"("customer_org_id", "status");

-- CreateIndex
CREATE INDEX "dispute_lab_org_id_status_idx" ON "dispute"("lab_org_id", "status");

-- CreateIndex
CREATE INDEX "dispute_status_lab_response_due_at_idx" ON "dispute"("status", "lab_response_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_dispute_no_key" ON "dispute"("dispute_no");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_id_customer_org_id_lab_org_id_key" ON "dispute"("id", "customer_org_id", "lab_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dispute_open" ON "dispute"("booking_id") WHERE (status = ANY (ARRAY['OPEN'::dispute_status, 'AWAITING_LAB'::dispute_status, 'AWAITING_CUSTOMER'::dispute_status, 'UNDER_REVIEW'::dispute_status]));

-- CreateIndex
CREATE INDEX "dispute_message_dispute_id_occurred_at_idx" ON "dispute_message"("dispute_id", "occurred_at");

-- CreateIndex
CREATE INDEX "dispute_evidence_dispute_id_idx" ON "dispute_evidence"("dispute_id");

-- CreateIndex
CREATE UNIQUE INDEX "rating_booking_id_direction_key" ON "rating"("booking_id", "direction");

-- CreateIndex
CREATE INDEX "file_object_owner_org_id_idx" ON "file_object"("owner_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_object_bucket_object_key_key" ON "file_object"("bucket", "object_key");

-- CreateIndex
CREATE INDEX "file_link_entity_type_entity_id_idx" ON "file_link"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "file_link_file_id_idx" ON "file_link"("file_id");

-- CreateIndex
CREATE INDEX "organisation_org_type_status_idx" ON "organisation"("org_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_org_type_gstin_key" ON "organisation"("org_type", "gstin");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_phone_e164_key" ON "app_user"("phone_e164");

-- CreateIndex
CREATE INDEX "membership_organisation_id_status_idx" ON "membership"("organisation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "membership_user_id_organisation_id_key" ON "membership"("user_id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_id_user_id_key" ON "membership"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_membership_role_active" ON "membership_role"("membership_id", "role") WHERE ("revoked_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_membership_role_one_lab_role" ON "membership_role"("membership_id") WHERE ((role = ANY (ARRAY['LAB_MAKER'::role_code, 'LAB_CHECKER'::role_code])) AND (revoked_at IS NULL));

-- CreateIndex
CREATE INDEX "ix_membership_site_site_active" ON "membership_site"("lab_site_id") WHERE ("revoked_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_membership_site_active" ON "membership_site"("membership_id", "lab_site_id") WHERE ("revoked_at" IS NULL);

-- CreateIndex
CREATE INDEX "invitation_organisation_id_email_idx" ON "invitation"("organisation_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "otp_challenge_destination_hash_purpose_created_at_idx" ON "otp_challenge"("destination_hash", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_mfa_factor_active" ON "mfa_factor"("user_id", "factor_type") WHERE ("verified_at" IS NOT NULL AND "revoked_at" IS NULL);

-- CreateIndex
CREATE INDEX "mfa_recovery_code_user_id_idx" ON "mfa_recovery_code"("user_id");

-- CreateIndex
CREATE INDEX "user_session_token_family_id_idx" ON "user_session"("token_family_id");

-- CreateIndex
CREATE INDEX "ix_user_session_user_live" ON "user_session"("user_id") WHERE ("revoked_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "user_session_refresh_token_hash_key" ON "user_session"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_site_invitation_id_lab_site_id_key" ON "invitation_site"("invitation_id", "lab_site_id");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_private_organisation_id_key" ON "organisation_private"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_version_organisation_id_version_no_key" ON "organisation_version"("organisation_id", "version_no");

-- CreateIndex
CREATE INDEX "lab_site_is_bookable_listing_status_idx" ON "lab_site"("is_bookable", "listing_status");

-- CreateIndex
CREATE INDEX "lab_site_organisation_id_idx" ON "lab_site"("organisation_id");

-- CreateIndex
CREATE INDEX "lab_site_pincode_idx" ON "lab_site"("pincode");

-- CreateIndex
CREATE INDEX "lab_site_geo_point_idx" ON "lab_site" USING GIST ("geo_point");

-- CreateIndex
CREATE UNIQUE INDEX "lab_site_site_code_key" ON "lab_site"("site_code");

-- CreateIndex
CREATE UNIQUE INDEX "lab_site_id_organisation_id_key" ON "lab_site"("id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_site_version_lab_site_id_version_no_key" ON "lab_site_version"("lab_site_id", "version_no");

-- CreateIndex
CREATE INDEX "accreditation_lab_site_id_status_idx" ON "accreditation"("lab_site_id", "status");

-- CreateIndex
CREATE INDEX "accreditation_valid_to_idx" ON "accreditation"("valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "accreditation_accreditation_body_id_certificate_no_key" ON "accreditation"("accreditation_body_id", "certificate_no");

-- CreateIndex
CREATE UNIQUE INDEX "accreditation_id_lab_site_id_key" ON "accreditation"("id", "lab_site_id");

-- CreateIndex
CREATE UNIQUE INDEX "accreditation_version_accreditation_id_version_no_key" ON "accreditation_version"("accreditation_id", "version_no");

-- CreateIndex
CREATE INDEX "scope_line_lab_site_id_status_idx" ON "scope_line"("lab_site_id", "status");

-- CreateIndex
CREATE INDEX "scope_line_parameter_node_id_status_idx" ON "scope_line"("parameter_node_id", "status");

-- CreateIndex
CREATE INDEX "scope_line_product_node_id_idx" ON "scope_line"("product_node_id");

-- CreateIndex
CREATE INDEX "scope_line_discipline_node_id_idx" ON "scope_line"("discipline_node_id");

-- CreateIndex
CREATE INDEX "scope_line_method_node_id_idx" ON "scope_line"("method_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_scope_line_natural_key_active" ON "scope_line"("lab_site_id", "natural_key_hash") WHERE ("status" = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "scope_line_id_lab_site_id_key" ON "scope_line"("id", "lab_site_id");

-- CreateIndex
CREATE UNIQUE INDEX "scope_line_version_scope_line_id_version_no_key" ON "scope_line_version"("scope_line_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "scope_line_version_id_scope_line_id_key" ON "scope_line_version"("id", "scope_line_id");

-- CreateIndex
CREATE INDEX "lab_claim_request_organisation_id_status_idx" ON "lab_claim_request"("organisation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_lab_claim_request_pending" ON "lab_claim_request"("organisation_id") WHERE (status = ANY (ARRAY['PENDING_OTP'::claim_request_status, 'PENDING_REVIEW'::claim_request_status]));

-- CreateIndex
CREATE INDEX "kyc_document_organisation_id_idx" ON "kyc_document"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_account_id_organisation_id_key" ON "bank_account"("id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bank_account_primary" ON "bank_account"("organisation_id", "lab_site_id") WHERE ("is_primary" = true AND "retired_at" IS NULL);

-- CreateIndex
CREATE INDEX "receiving_hours_lab_site_id_weekday_idx" ON "receiving_hours"("lab_site_id", "weekday");

-- CreateIndex
CREATE INDEX "site_closure_lab_site_id_starts_on_idx" ON "site_closure"("lab_site_id", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "uq_retention_rule_site_discipline" ON "retention_rule"("lab_site_id", "discipline_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_lab_site_id_version_no_key" ON "price_list"("lab_site_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "uq_price_list_published" ON "price_list"("lab_site_id") WHERE ("status" = 'PUBLISHED');

-- CreateIndex
CREATE UNIQUE INDEX "price_list_id_lab_site_id_key" ON "price_list"("id", "lab_site_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_id_organisation_id_key" ON "price_list"("id", "organisation_id");

-- CreateIndex
CREATE INDEX "price_item_scope_line_id_idx" ON "price_item"("scope_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_item_price_list_id_scope_line_id_key" ON "price_item"("price_list_id", "scope_line_id");

-- CreateIndex
CREATE INDEX "slot_template_lab_site_id_weekday_idx" ON "slot_template"("lab_site_id", "weekday");

-- CreateIndex
CREATE INDEX "slot_lab_site_id_slot_date_status_idx" ON "slot"("lab_site_id", "slot_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_slot_site_discipline_start" ON "slot"("lab_site_id", "discipline_node_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "slot_id_lab_site_id_key" ON "slot"("id", "lab_site_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_site_private_lab_site_id_key" ON "lab_site_private"("lab_site_id");

-- CreateIndex
CREATE INDEX "lab_penalty_lab_org_id_occurred_at_idx" ON "lab_penalty"("lab_org_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "md_taxonomy_code_key" ON "md_taxonomy"("code");

-- CreateIndex
CREATE UNIQUE INDEX "md_node_type_taxonomy_id_code_key" ON "md_node_type"("taxonomy_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "md_node_type_taxonomy_id_level_key" ON "md_node_type"("taxonomy_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "md_attribute_definition_node_type_id_key_key" ON "md_attribute_definition"("node_type_id", "key");

-- CreateIndex
CREATE INDEX "md_node_taxonomy_id_node_type_id_status_idx" ON "md_node"("taxonomy_id", "node_type_id", "status");

-- CreateIndex
CREATE INDEX "md_node_parent_id_idx" ON "md_node"("parent_id");

-- CreateIndex
CREATE INDEX "md_node_aliases_idx" ON "md_node" USING GIN ("aliases");

-- CreateIndex
CREATE INDEX "md_node_name_idx" ON "md_node" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "md_node_path_idx" ON "md_node" USING GIST ("path");

-- CreateIndex
CREATE UNIQUE INDEX "md_node_taxonomy_id_code_key" ON "md_node"("taxonomy_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "md_node_version_node_id_version_no_key" ON "md_node_version"("node_id", "version_no");

-- CreateIndex
CREATE INDEX "md_change_set_status_submitted_at_idx" ON "md_change_set"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "md_change_item_change_set_id_idx" ON "md_change_item"("change_set_id");

-- CreateIndex
CREATE INDEX "md_change_item_target_type_target_id_idx" ON "md_change_item"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "import_job_status_idx" ON "import_job"("status");

-- CreateIndex
CREATE INDEX "import_job_organisation_id_idx" ON "import_job"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_job_id_organisation_id_key" ON "import_job"("id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_import_job_id_row_number_key" ON "import_row"("import_job_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "accreditation_body_code_key" ON "accreditation_body"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accreditation_standard_code_key" ON "accreditation_standard"("code");

-- CreateIndex
CREATE UNIQUE INDEX "search_synonym_term_key" ON "search_synonym"("term");

-- CreateIndex
CREATE UNIQUE INDEX "search_synonym_version_search_synonym_id_version_no_key" ON "search_synonym_version"("search_synonym_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "notification_template_event_code_channel_locale_version_key" ON "notification_template"("event_code", "channel", "locale", "version");

-- CreateIndex
CREATE INDEX "notification_recipient_user_id_channel_read_at_idx" ON "notification"("recipient_user_id", "channel", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_id_recipient_user_id_channel_key" ON "notification"("event_id", "recipient_user_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_user_id_event_code_channel_key" ON "notification_preference"("user_id", "event_code", "channel");

-- CreateIndex
CREATE INDEX "ix_payment_order_pending" ON "payment_order"("status", "reconcile_until") WHERE ("status" = 'PENDING');

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_idempotency_key_key" ON "payment_order"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_booking_id_attempt_no_key" ON "payment_order"("booking_id", "attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_gateway_gateway_order_ref_key" ON "payment_order"("gateway", "gateway_order_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_id_customer_org_id_lab_org_id_key" ON "payment_order"("id", "customer_org_id", "lab_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payment_order_captured" ON "payment_order"("booking_id") WHERE (status = ANY (ARRAY['CAPTURED'::payment_order_status, 'REFUNDED_PARTIAL'::payment_order_status, 'REFUNDED_FULL'::payment_order_status]));

-- CreateIndex
CREATE INDEX "payment_transaction_payment_order_id_idx" ON "payment_transaction"("payment_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transaction_gateway_gateway_txn_ref_txn_type_key" ON "payment_transaction"("gateway", "gateway_txn_ref", "txn_type");

-- CreateIndex
CREATE INDEX "ix_gateway_webhook_event_unprocessed" ON "gateway_webhook_event"("received_at") WHERE (processing_status = ANY (ARRAY['RECEIVED'::webhook_processing_status, 'FAILED'::webhook_processing_status]));

-- CreateIndex
CREATE UNIQUE INDEX "gateway_webhook_event_gateway_event_id_key" ON "gateway_webhook_event"("gateway", "event_id");

-- CreateIndex
CREATE INDEX "refund_booking_id_idx" ON "refund"("booking_id");

-- CreateIndex
CREATE INDEX "refund_payment_order_id_idx" ON "refund"("payment_order_id");

-- CreateIndex
CREATE INDEX "refund_status_idx" ON "refund"("status");

-- CreateIndex
CREATE INDEX "payout_lab_org_id_status_idx" ON "payout"("lab_org_id", "status");

-- CreateIndex
CREATE INDEX "payout_status_eligible_at_idx" ON "payout"("status", "eligible_at");

-- CreateIndex
CREATE INDEX "payout_item_payout_id_idx" ON "payout_item"("payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payout_item_booking_live" ON "payout_item"("booking_id") WHERE ("voided_at" IS NULL);

-- CreateIndex
CREATE INDEX "ix_payout_hold_open" ON "payout_hold"("booking_id") WHERE ("released_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_ledger_account_code_party" ON "ledger_account"("code", "party_org_id");

-- CreateIndex
CREATE INDEX "ledger_journal_booking_id_idx" ON "ledger_journal"("booking_id");

-- CreateIndex
CREATE INDEX "ledger_journal_payment_transaction_id_idx" ON "ledger_journal"("payment_transaction_id");

-- CreateIndex
CREATE INDEX "ledger_journal_refund_id_idx" ON "ledger_journal"("refund_id");

-- CreateIndex
CREATE INDEX "ledger_journal_payout_id_idx" ON "ledger_journal"("payout_id");

-- CreateIndex
CREATE INDEX "ledger_entry_account_id_journal_id_idx" ON "ledger_entry"("account_id", "journal_id");

-- CreateIndex
CREATE INDEX "ledger_entry_journal_id_idx" ON "ledger_entry"("journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_series_issuer_org_id_doc_type_financial_year_key" ON "document_series"("issuer_org_id", "doc_type", "financial_year");

-- CreateIndex
CREATE INDEX "financial_document_booking_id_idx" ON "financial_document"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_document_document_series_id_doc_no_key" ON "financial_document"("document_series_id", "doc_no");

-- CreateIndex
CREATE INDEX "settlement_report_line_gateway_txn_ref_idx" ON "settlement_report_line"("gateway_txn_ref");

-- CreateIndex
CREATE INDEX "settlement_report_line_match_status_idx" ON "settlement_report_line"("match_status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_config_parameter_window" ON "config_parameter"("key", "scope_type", "scope_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "uq_holiday_calendar_date_region" ON "holiday_calendar"("holiday_date", "region_code");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_occurred_at_idx" ON "audit_log"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_occurred_at_idx" ON "audit_log"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_outbox_event_unpublished" ON "outbox_event"("occurred_at") WHERE ("published_at" IS NULL);

-- CreateIndex
CREATE INDEX "ix_timer_pending" ON "timer"("due_at") WHERE ("status" = 'PENDING');

-- CreateIndex
CREATE INDEX "timer_aggregate_type_aggregate_id_idx" ON "timer"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "idempotency_record_expires_at_idx" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_idempotency_record_key" ON "idempotency_record"("idempotency_key", "actor_user_id", "route");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_chain_chain_month_seq_key" ON "audit_log_chain"("chain_month", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_chain_audit_log_id_key" ON "audit_log_chain"("audit_log_id");

-- CreateIndex
CREATE INDEX "report_lab_org_id_idx" ON "report"("lab_org_id");

-- CreateIndex
CREATE INDEX "report_customer_org_id_idx" ON "report"("customer_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_booking_id_key" ON "report"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_ulr_no_key" ON "report"("ulr_no");

-- CreateIndex
CREATE UNIQUE INDEX "report_lab_site_id_report_no_key" ON "report"("lab_site_id", "report_no");

-- CreateIndex
CREATE UNIQUE INDEX "report_id_booking_id_key" ON "report"("id", "booking_id");

-- CreateIndex
CREATE INDEX "ix_report_version_in_review" ON "report_version"("status") WHERE ("status" = 'IN_REVIEW');

-- CreateIndex
CREATE UNIQUE INDEX "report_version_report_id_version_no_key" ON "report_version"("report_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "report_version_id_booking_id_key" ON "report_version"("id", "booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_version_id_customer_org_id_lab_org_id_key" ON "report_version"("id", "customer_org_id", "lab_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_version_verification_code_key" ON "report_version"("verification_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_report_version_open" ON "report_version"("report_id") WHERE (status = ANY (ARRAY['DRAFT'::report_version_status, 'IN_REVIEW'::report_version_status]));

-- CreateIndex
CREATE UNIQUE INDEX "uq_report_version_released" ON "report_version"("report_id") WHERE ("status" = 'RELEASED');

-- CreateIndex
CREATE INDEX "report_parameter_result_booking_line_id_idx" ON "report_parameter_result"("booking_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_parameter_result_report_version_id_booking_line_id_key" ON "report_parameter_result"("report_version_id", "booking_line_id");

-- CreateIndex
CREATE INDEX "report_share_link_report_version_id_idx" ON "report_share_link"("report_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_share_link_token_hash_key" ON "report_share_link"("token_hash");

-- CreateIndex
CREATE INDEX "report_access_log_report_version_id_occurred_at_idx" ON "report_access_log"("report_version_id", "occurred_at");

-- CreateIndex
CREATE INDEX "verification_event_verification_code_occurred_at_idx" ON "verification_event"("verification_code", "occurred_at");

-- CreateIndex
CREATE INDEX "verification_event_ip_hash_occurred_at_idx" ON "verification_event"("ip_hash", "occurred_at");

-- CreateIndex
CREATE INDEX "break_glass_grant_report_version_id_idx" ON "break_glass_grant"("report_version_id");

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_on_behalf_by_user_id_fkey" FOREIGN KEY ("on_behalf_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_product_node_id_fkey" FOREIGN KEY ("product_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_cancellation_code_node_id_fkey" FOREIGN KEY ("cancellation_code_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_rejection_reason_node_id_fkey" FOREIGN KEY ("rejection_reason_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_lab_site_id_lab_org_id_fkey" FOREIGN KEY ("lab_site_id", "lab_org_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_customer_site_id_customer_org_id_fkey" FOREIGN KEY ("customer_site_id", "customer_org_id") REFERENCES "customer_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_slot_id_lab_site_id_fkey" FOREIGN KEY ("slot_id", "lab_site_id") REFERENCES "slot"("id", "lab_site_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_price_list_id_lab_site_id_fkey" FOREIGN KEY ("price_list_id", "lab_site_id") REFERENCES "price_list"("id", "lab_site_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_line" ADD CONSTRAINT "booking_line_scope_line_id_fkey" FOREIGN KEY ("scope_line_id") REFERENCES "scope_line"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_line" ADD CONSTRAINT "booking_line_price_item_id_fkey" FOREIGN KEY ("price_item_id") REFERENCES "price_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_line" ADD CONSTRAINT "booking_line_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_line" ADD CONSTRAINT "booking_line_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_line" ADD CONSTRAINT "booking_line_scope_line_version_id_scope_line_id_fkey" FOREIGN KEY ("scope_line_version_id", "scope_line_id") REFERENCES "scope_line_version"("id", "scope_line_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "trf" ADD CONSTRAINT "trf_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "trf" ADD CONSTRAINT "trf_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "trf" ADD CONSTRAINT "trf_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_customer_org_id_lab_org__fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "counter_offer" ADD CONSTRAINT "counter_offer_proposed_slot_id_fkey" FOREIGN KEY ("proposed_slot_id") REFERENCES "slot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "counter_offer" ADD CONSTRAINT "counter_offer_proposed_by_user_id_fkey" FOREIGN KEY ("proposed_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "counter_offer" ADD CONSTRAINT "counter_offer_responded_by_user_id_fkey" FOREIGN KEY ("responded_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "counter_offer" ADD CONSTRAINT "counter_offer_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "counter_offer" ADD CONSTRAINT "counter_offer_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slot_hold" ADD CONSTRAINT "slot_hold_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slot_hold" ADD CONSTRAINT "slot_hold_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slot_hold" ADD CONSTRAINT "slot_hold_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "qr_signing_key" ADD CONSTRAINT "qr_signing_key_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "package" ADD CONSTRAINT "package_signing_key_id_fkey" FOREIGN KEY ("signing_key_id") REFERENCES "qr_signing_key"("key_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "package" ADD CONSTRAINT "package_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "package" ADD CONSTRAINT "package_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "custody_event" ADD CONSTRAINT "custody_event_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "custody_event" ADD CONSTRAINT "custody_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "custody_event" ADD CONSTRAINT "custody_event_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "custody_event" ADD CONSTRAINT "custody_event_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "custody_event" ADD CONSTRAINT "custody_event_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_record" ADD CONSTRAINT "receipt_record_condition_node_id_fkey" FOREIGN KEY ("condition_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_record" ADD CONSTRAINT "receipt_record_maker_user_id_fkey" FOREIGN KEY ("maker_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_record" ADD CONSTRAINT "receipt_record_checker_user_id_fkey" FOREIGN KEY ("checker_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_record" ADD CONSTRAINT "receipt_record_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_record" ADD CONSTRAINT "receipt_record_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_package" ADD CONSTRAINT "receipt_package_scan_event_id_fkey" FOREIGN KEY ("scan_event_id") REFERENCES "custody_event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_package" ADD CONSTRAINT "receipt_package_condition_node_id_fkey" FOREIGN KEY ("condition_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_package" ADD CONSTRAINT "receipt_package_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_package" ADD CONSTRAINT "receipt_package_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_package" ADD CONSTRAINT "receipt_package_receipt_record_id_booking_id_fkey" FOREIGN KEY ("receipt_record_id", "booking_id") REFERENCES "receipt_record"("id", "booking_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_package" ADD CONSTRAINT "receipt_package_package_id_booking_id_fkey" FOREIGN KEY ("package_id", "booking_id") REFERENCES "package"("id", "booking_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "hold_case" ADD CONSTRAINT "hold_case_reason_node_id_fkey" FOREIGN KEY ("reason_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "hold_case" ADD CONSTRAINT "hold_case_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "hold_case" ADD CONSTRAINT "hold_case_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "hold_case" ADD CONSTRAINT "hold_case_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "hold_case" ADD CONSTRAINT "hold_case_receipt_record_id_booking_id_fkey" FOREIGN KEY ("receipt_record_id", "booking_id") REFERENCES "receipt_record"("id", "booking_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "label_print" ADD CONSTRAINT "label_print_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "label_print" ADD CONSTRAINT "label_print_printed_by_user_id_fkey" FOREIGN KEY ("printed_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "label_print" ADD CONSTRAINT "label_print_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "label_print" ADD CONSTRAINT "label_print_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "label_print" ADD CONSTRAINT "label_print_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "label_print" ADD CONSTRAINT "label_print_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "custody_event_photo" ADD CONSTRAINT "custody_event_photo_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "custody_event_photo" ADD CONSTRAINT "custody_event_photo_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "custody_event_photo" ADD CONSTRAINT "custody_event_photo_custody_event_id_customer_org_id_lab_o_fkey" FOREIGN KEY ("custody_event_id", "customer_org_id", "lab_org_id") REFERENCES "custody_event"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_site" ADD CONSTRAINT "customer_site_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_site" ADD CONSTRAINT "customer_site_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_settings" ADD CONSTRAINT "customer_settings_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_settings" ADD CONSTRAINT "customer_settings_default_customer_site_id_fkey" FOREIGN KEY ("default_customer_site_id") REFERENCES "customer_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_settings" ADD CONSTRAINT "customer_settings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lead_request" ADD CONSTRAINT "lead_request_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lead_request" ADD CONSTRAINT "lead_request_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lead_request" ADD CONSTRAINT "lead_request_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lead_request" ADD CONSTRAINT "lead_request_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_type_node_id_fkey" FOREIGN KEY ("type_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_message" ADD CONSTRAINT "dispute_message_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_message" ADD CONSTRAINT "dispute_message_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_message" ADD CONSTRAINT "dispute_message_dispute_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("dispute_id", "customer_org_id", "lab_org_id") REFERENCES "dispute"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("dispute_id", "customer_org_id", "lab_org_id") REFERENCES "dispute"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rating" ADD CONSTRAINT "rating_rated_by_user_id_fkey" FOREIGN KEY ("rated_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rating" ADD CONSTRAINT "rating_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rating" ADD CONSTRAINT "rating_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_lab_org_id_fkey" FOREIGN KEY ("lab_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "file_link" ADD CONSTRAINT "file_link_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "file_link" ADD CONSTRAINT "file_link_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "organisation" ADD CONSTRAINT "organisation_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_deactivated_by_user_id_fkey" FOREIGN KEY ("deactivated_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "membership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership_site" ADD CONSTRAINT "membership_site_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "membership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership_site" ADD CONSTRAINT "membership_site_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "membership_site" ADD CONSTRAINT "membership_site_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "otp_challenge" ADD CONSTRAINT "otp_challenge_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_active_membership_id_user_id_fkey" FOREIGN KEY ("active_membership_id", "user_id") REFERENCES "membership"("id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invitation_site" ADD CONSTRAINT "invitation_site_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invitation_site" ADD CONSTRAINT "invitation_site_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invitation_site" ADD CONSTRAINT "invitation_site_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "organisation_private" ADD CONSTRAINT "organisation_private_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "organisation_private" ADD CONSTRAINT "organisation_private_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "organisation_version" ADD CONSTRAINT "organisation_version_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "organisation_version" ADD CONSTRAINT "organisation_version_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "md_change_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "organisation_version" ADD CONSTRAINT "organisation_version_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_site" ADD CONSTRAINT "lab_site_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_site" ADD CONSTRAINT "lab_site_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_site_version" ADD CONSTRAINT "lab_site_version_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_site_version" ADD CONSTRAINT "lab_site_version_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "md_change_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_site_version" ADD CONSTRAINT "lab_site_version_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accreditation" ADD CONSTRAINT "accreditation_accreditation_body_id_fkey" FOREIGN KEY ("accreditation_body_id") REFERENCES "accreditation_body"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accreditation" ADD CONSTRAINT "accreditation_standard_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "accreditation_standard"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accreditation" ADD CONSTRAINT "accreditation_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accreditation" ADD CONSTRAINT "accreditation_lab_site_id_organisation_id_fkey" FOREIGN KEY ("lab_site_id", "organisation_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accreditation_version" ADD CONSTRAINT "accreditation_version_accreditation_id_fkey" FOREIGN KEY ("accreditation_id") REFERENCES "accreditation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accreditation_version" ADD CONSTRAINT "accreditation_version_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "md_change_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accreditation_version" ADD CONSTRAINT "accreditation_version_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line" ADD CONSTRAINT "scope_line_discipline_node_id_fkey" FOREIGN KEY ("discipline_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line" ADD CONSTRAINT "scope_line_group_node_id_fkey" FOREIGN KEY ("group_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line" ADD CONSTRAINT "scope_line_product_node_id_fkey" FOREIGN KEY ("product_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line" ADD CONSTRAINT "scope_line_parameter_node_id_fkey" FOREIGN KEY ("parameter_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line" ADD CONSTRAINT "scope_line_method_node_id_fkey" FOREIGN KEY ("method_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line" ADD CONSTRAINT "scope_line_range_unit_node_id_fkey" FOREIGN KEY ("range_unit_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line" ADD CONSTRAINT "scope_line_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line" ADD CONSTRAINT "scope_line_lab_site_id_organisation_id_fkey" FOREIGN KEY ("lab_site_id", "organisation_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line" ADD CONSTRAINT "scope_line_accreditation_id_lab_site_id_fkey" FOREIGN KEY ("accreditation_id", "lab_site_id") REFERENCES "accreditation"("id", "lab_site_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line_version" ADD CONSTRAINT "scope_line_version_scope_line_id_fkey" FOREIGN KEY ("scope_line_id") REFERENCES "scope_line"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line_version" ADD CONSTRAINT "scope_line_version_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "md_change_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "scope_line_version" ADD CONSTRAINT "scope_line_version_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_claim_request" ADD CONSTRAINT "lab_claim_request_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_claim_request" ADD CONSTRAINT "lab_claim_request_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_claim_request" ADD CONSTRAINT "lab_claim_request_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_claim_request" ADD CONSTRAINT "lab_claim_request_authorisation_file_id_fkey" FOREIGN KEY ("authorisation_file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_claim_request" ADD CONSTRAINT "lab_claim_request_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_claim_request" ADD CONSTRAINT "lab_claim_request_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "kyc_document" ADD CONSTRAINT "kyc_document_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "kyc_document" ADD CONSTRAINT "kyc_document_document_type_node_id_fkey" FOREIGN KEY ("document_type_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "kyc_document" ADD CONSTRAINT "kyc_document_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "kyc_document" ADD CONSTRAINT "kyc_document_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "kyc_document" ADD CONSTRAINT "kyc_document_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receiving_hours" ADD CONSTRAINT "receiving_hours_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receiving_hours" ADD CONSTRAINT "receiving_hours_lab_site_id_organisation_id_fkey" FOREIGN KEY ("lab_site_id", "organisation_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "site_closure" ADD CONSTRAINT "site_closure_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "site_closure" ADD CONSTRAINT "site_closure_lab_site_id_organisation_id_fkey" FOREIGN KEY ("lab_site_id", "organisation_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "retention_rule" ADD CONSTRAINT "retention_rule_discipline_node_id_fkey" FOREIGN KEY ("discipline_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "retention_rule" ADD CONSTRAINT "retention_rule_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "retention_rule" ADD CONSTRAINT "retention_rule_lab_site_id_organisation_id_fkey" FOREIGN KEY ("lab_site_id", "organisation_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_job"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_lab_site_id_organisation_id_fkey" FOREIGN KEY ("lab_site_id", "organisation_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_item" ADD CONSTRAINT "price_item_scope_line_id_fkey" FOREIGN KEY ("scope_line_id") REFERENCES "scope_line"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_item" ADD CONSTRAINT "price_item_sample_unit_node_id_fkey" FOREIGN KEY ("sample_unit_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_item" ADD CONSTRAINT "price_item_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_item" ADD CONSTRAINT "price_item_price_list_id_organisation_id_fkey" FOREIGN KEY ("price_list_id", "organisation_id") REFERENCES "price_list"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slot_template" ADD CONSTRAINT "slot_template_discipline_node_id_fkey" FOREIGN KEY ("discipline_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slot_template" ADD CONSTRAINT "slot_template_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slot_template" ADD CONSTRAINT "slot_template_lab_site_id_organisation_id_fkey" FOREIGN KEY ("lab_site_id", "organisation_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slot" ADD CONSTRAINT "slot_discipline_node_id_fkey" FOREIGN KEY ("discipline_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slot" ADD CONSTRAINT "slot_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slot" ADD CONSTRAINT "slot_lab_site_id_organisation_id_fkey" FOREIGN KEY ("lab_site_id", "organisation_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_site_private" ADD CONSTRAINT "lab_site_private_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_site_private" ADD CONSTRAINT "lab_site_private_lab_site_id_organisation_id_fkey" FOREIGN KEY ("lab_site_id", "organisation_id") REFERENCES "lab_site"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_penalty" ADD CONSTRAINT "lab_penalty_lab_org_id_fkey" FOREIGN KEY ("lab_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_penalty" ADD CONSTRAINT "lab_penalty_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_penalty" ADD CONSTRAINT "lab_penalty_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_penalty" ADD CONSTRAINT "lab_penalty_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "lab_penalty" ADD CONSTRAINT "lab_penalty_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_taxonomy" ADD CONSTRAINT "md_taxonomy_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node_type" ADD CONSTRAINT "md_node_type_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "md_taxonomy"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node_type" ADD CONSTRAINT "md_node_type_parent_node_type_id_fkey" FOREIGN KEY ("parent_node_type_id") REFERENCES "md_node_type"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node_type" ADD CONSTRAINT "md_node_type_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_attribute_definition" ADD CONSTRAINT "md_attribute_definition_node_type_id_fkey" FOREIGN KEY ("node_type_id") REFERENCES "md_node_type"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_attribute_definition" ADD CONSTRAINT "md_attribute_definition_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node" ADD CONSTRAINT "md_node_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "md_taxonomy"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node" ADD CONSTRAINT "md_node_node_type_id_fkey" FOREIGN KEY ("node_type_id") REFERENCES "md_node_type"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node" ADD CONSTRAINT "md_node_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node" ADD CONSTRAINT "md_node_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node_version" ADD CONSTRAINT "md_node_version_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node_version" ADD CONSTRAINT "md_node_version_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "md_change_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_node_version" ADD CONSTRAINT "md_node_version_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_change_set" ADD CONSTRAINT "md_change_set_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_job"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_change_set" ADD CONSTRAINT "md_change_set_proposed_by_org_id_fkey" FOREIGN KEY ("proposed_by_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_change_set" ADD CONSTRAINT "md_change_set_prepared_by_user_id_fkey" FOREIGN KEY ("prepared_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_change_set" ADD CONSTRAINT "md_change_set_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_change_set" ADD CONSTRAINT "md_change_set_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_change_item" ADD CONSTRAINT "md_change_item_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "md_change_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_change_item" ADD CONSTRAINT "md_change_item_import_row_id_fkey" FOREIGN KEY ("import_row_id") REFERENCES "import_row"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "md_change_item" ADD CONSTRAINT "md_change_item_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_mapping_template" ADD CONSTRAINT "import_mapping_template_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_mapping_template" ADD CONSTRAINT "import_mapping_template_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_mapping_template_id_fkey" FOREIGN KEY ("mapping_template_id") REFERENCES "import_mapping_template"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "md_change_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_list"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_job"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_import_job_id_organisation_id_fkey" FOREIGN KEY ("import_job_id", "organisation_id") REFERENCES "import_job"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accreditation_body" ADD CONSTRAINT "accreditation_body_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accreditation_standard" ADD CONSTRAINT "accreditation_standard_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "search_synonym" ADD CONSTRAINT "search_synonym_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "search_synonym_version" ADD CONSTRAINT "search_synonym_version_search_synonym_id_fkey" FOREIGN KEY ("search_synonym_id") REFERENCES "search_synonym"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "search_synonym_version" ADD CONSTRAINT "search_synonym_version_change_set_id_fkey" FOREIGN KEY ("change_set_id") REFERENCES "md_change_set"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "search_synonym_version" ADD CONSTRAINT "search_synonym_version_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_template" ADD CONSTRAINT "notification_template_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "gateway_webhook_event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_payment_order_id_customer_org_id_lab_o_fkey" FOREIGN KEY ("payment_order_id", "customer_org_id", "lab_org_id") REFERENCES "payment_order"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_reason_code_node_id_fkey" FOREIGN KEY ("reason_code_node_id") REFERENCES "md_node"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "financial_document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "dispute"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_lab_org_id_fkey" FOREIGN KEY ("lab_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_released_by_user_id_fkey" FOREIGN KEY ("released_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_bank_account_id_lab_org_id_fkey" FOREIGN KEY ("bank_account_id", "lab_org_id") REFERENCES "bank_account"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_item" ADD CONSTRAINT "payout_item_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payout"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_item" ADD CONSTRAINT "payout_item_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_item" ADD CONSTRAINT "payout_item_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_hold" ADD CONSTRAINT "payout_hold_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "dispute"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_hold" ADD CONSTRAINT "payout_hold_placed_by_user_id_fkey" FOREIGN KEY ("placed_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_hold" ADD CONSTRAINT "payout_hold_released_by_user_id_fkey" FOREIGN KEY ("released_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_hold" ADD CONSTRAINT "payout_hold_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_hold" ADD CONSTRAINT "payout_hold_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_party_org_id_fkey" FOREIGN KEY ("party_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_journal" ADD CONSTRAINT "ledger_journal_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transaction"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_journal" ADD CONSTRAINT "ledger_journal_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refund"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_journal" ADD CONSTRAINT "ledger_journal_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payout"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_journal" ADD CONSTRAINT "ledger_journal_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_journal" ADD CONSTRAINT "ledger_journal_reverses_journal_id_fkey" FOREIGN KEY ("reverses_journal_id") REFERENCES "ledger_journal"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_journal" ADD CONSTRAINT "ledger_journal_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_journal" ADD CONSTRAINT "ledger_journal_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "ledger_journal"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_issuer_org_id_fkey" FOREIGN KEY ("issuer_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "financial_document" ADD CONSTRAINT "financial_document_document_series_id_fkey" FOREIGN KEY ("document_series_id") REFERENCES "document_series"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "financial_document" ADD CONSTRAINT "financial_document_issuer_org_id_fkey" FOREIGN KEY ("issuer_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "financial_document" ADD CONSTRAINT "financial_document_recipient_org_id_fkey" FOREIGN KEY ("recipient_org_id") REFERENCES "organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "financial_document" ADD CONSTRAINT "financial_document_related_document_id_fkey" FOREIGN KEY ("related_document_id") REFERENCES "financial_document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "financial_document" ADD CONSTRAINT "financial_document_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "financial_document" ADD CONSTRAINT "financial_document_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "financial_document" ADD CONSTRAINT "financial_document_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fee_rule" ADD CONSTRAINT "fee_rule_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_report_line" ADD CONSTRAINT "settlement_report_line_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_job"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_report_line" ADD CONSTRAINT "settlement_report_line_matched_transaction_id_fkey" FOREIGN KEY ("matched_transaction_id") REFERENCES "payment_transaction"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_report_line" ADD CONSTRAINT "settlement_report_line_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "config_parameter" ADD CONSTRAINT "config_parameter_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "holiday_calendar" ADD CONSTRAINT "holiday_calendar_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "timer" ADD CONSTRAINT "timer_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_lab_site_id_fkey" FOREIGN KEY ("lab_site_id") REFERENCES "lab_site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_current_released_version_id_fkey" FOREIGN KEY ("current_released_version_id") REFERENCES "report_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_original_file_id_fkey" FOREIGN KEY ("original_file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_stamped_file_id_fkey" FOREIGN KEY ("stamped_file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_bind_event_id_fkey" FOREIGN KEY ("bind_event_id") REFERENCES "custody_event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_maker_user_id_fkey" FOREIGN KEY ("maker_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_checker_user_id_fkey" FOREIGN KEY ("checker_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_signing_key_id_fkey" FOREIGN KEY ("signing_key_id") REFERENCES "qr_signing_key"("key_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_superseded_by_version_id_fkey" FOREIGN KEY ("superseded_by_version_id") REFERENCES "report_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_booking_id_customer_org_id_lab_org_id_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_report_id_booking_id_fkey" FOREIGN KEY ("report_id", "booking_id") REFERENCES "report"("id", "booking_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_version" ADD CONSTRAINT "report_version_bound_package_id_booking_id_fkey" FOREIGN KEY ("bound_package_id", "booking_id") REFERENCES "package"("id", "booking_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_parameter_result" ADD CONSTRAINT "report_parameter_result_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_parameter_result" ADD CONSTRAINT "report_parameter_result_booking_id_customer_org_id_lab_org_fkey" FOREIGN KEY ("booking_id", "customer_org_id", "lab_org_id") REFERENCES "booking"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_parameter_result" ADD CONSTRAINT "report_parameter_result_report_version_id_booking_id_fkey" FOREIGN KEY ("report_version_id", "booking_id") REFERENCES "report_version"("id", "booking_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_parameter_result" ADD CONSTRAINT "report_parameter_result_booking_line_id_booking_id_fkey" FOREIGN KEY ("booking_line_id", "booking_id") REFERENCES "booking_line"("id", "booking_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_report_version_id_customer_org_id_lab_or_fkey" FOREIGN KEY ("report_version_id", "customer_org_id", "lab_org_id") REFERENCES "report_version"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_access_log" ADD CONSTRAINT "report_access_log_accessor_user_id_fkey" FOREIGN KEY ("accessor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_access_log" ADD CONSTRAINT "report_access_log_share_link_id_fkey" FOREIGN KEY ("share_link_id") REFERENCES "report_share_link"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_access_log" ADD CONSTRAINT "report_access_log_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "break_glass_grant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_access_log" ADD CONSTRAINT "report_access_log_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "report_access_log" ADD CONSTRAINT "report_access_log_report_version_id_customer_org_id_lab_or_fkey" FOREIGN KEY ("report_version_id", "customer_org_id", "lab_org_id") REFERENCES "report_version"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "break_glass_grant" ADD CONSTRAINT "break_glass_grant_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "break_glass_grant" ADD CONSTRAINT "break_glass_grant_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "break_glass_grant" ADD CONSTRAINT "break_glass_grant_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "break_glass_grant" ADD CONSTRAINT "break_glass_grant_report_version_id_customer_org_id_lab_or_fkey" FOREIGN KEY ("report_version_id", "customer_org_id", "lab_org_id") REFERENCES "report_version"("id", "customer_org_id", "lab_org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

