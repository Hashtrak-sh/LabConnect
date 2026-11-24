# Entity relationship diagrams

**Status:** DRAFT for gate G1. The diagrams are split by area so they stay readable. Only key columns are shown. The full definitions are in `SCHEMA_SPECIFICATION.md`. GitHub renders Mermaid natively.

## 1. Overview

```mermaid
erDiagram
  ORGANISATION ||--o{ MEMBERSHIP : has
  APP_USER ||--o{ MEMBERSHIP : holds
  ORGANISATION ||--o{ LAB_SITE : "owns (LAB)"
  LAB_SITE ||--o{ ACCREDITATION : has
  ACCREDITATION ||--o{ SCOPE_LINE : covers
  LAB_SITE ||--o{ PRICE_LIST : publishes
  PRICE_LIST ||--o{ PRICE_ITEM : contains
  SCOPE_LINE ||--o{ PRICE_ITEM : priced_by
  ORGANISATION ||--o{ BOOKING : "places (CUSTOMER)"
  LAB_SITE ||--o{ BOOKING : receives
  BOOKING ||--|{ BOOKING_LINE : has
  BOOKING ||--|{ TRF : versions
  BOOKING ||--o{ PACKAGE : labels
  BOOKING ||--o{ RECEIPT_RECORD : records
  BOOKING ||--o| REPORT : produces
  REPORT ||--|{ REPORT_VERSION : versions
  BOOKING ||--o{ PAYMENT_ORDER : paid_by
  BOOKING ||--o{ DISPUTE : disputed_by
  BOOKING ||--o{ PAYOUT_ITEM : settled_in
```

## 2. Identity

```mermaid
erDiagram
  ORGANISATION {
    uuid id PK
    org_type org_type
    customer_segment customer_segment
    text legal_name
    varchar gstin
    claim_status claim_status
    verification_status kyc_status
  }
  APP_USER {
    uuid id PK
    citext email UK
    varchar phone_e164 UK
    user_status status
    bool is_platform_staff
  }
  MEMBERSHIP {
    uuid id PK
    uuid user_id FK
    uuid organisation_id FK
    membership_status status
  }
  MEMBERSHIP_ROLE {
    uuid id PK
    uuid membership_id FK
    role_code role
    timestamptz revoked_at
  }
  MEMBERSHIP_SITE {
    uuid id PK
    uuid membership_id FK
    uuid lab_site_id FK
  }
  USER_SESSION {
    uuid id PK
    uuid user_id FK
    uuid active_membership_id FK
    timestamptz mfa_verified_at
  }
  MFA_FACTOR {
    uuid id PK
    uuid user_id FK
    bytea secret_ciphertext
  }
  ORGANISATION ||--o{ MEMBERSHIP : ""
  APP_USER ||--o{ MEMBERSHIP : ""
  MEMBERSHIP ||--|{ MEMBERSHIP_ROLE : ""
  MEMBERSHIP ||--o{ MEMBERSHIP_SITE : ""
  APP_USER ||--o{ USER_SESSION : ""
  APP_USER ||--o{ MFA_FACTOR : ""
  ORGANISATION ||--o{ INVITATION : ""
```

## 3. Master data and labs

```mermaid
erDiagram
  MD_TAXONOMY ||--|{ MD_NODE_TYPE : levels
  MD_NODE_TYPE ||--o{ MD_ATTRIBUTE_DEFINITION : defines
  MD_TAXONOMY ||--o{ MD_NODE : contains
  MD_NODE ||--o{ MD_NODE : parent_of
  MD_NODE ||--|{ MD_NODE_VERSION : history
  MD_CHANGE_SET ||--|{ MD_CHANGE_ITEM : groups
  IMPORT_JOB ||--|{ IMPORT_ROW : stages
  IMPORT_JOB }o--|| IMPORT_MAPPING_TEMPLATE : uses
  IMPORT_JOB |o--o| MD_CHANGE_SET : produces
  ACCREDITATION_STANDARD ||--o{ ACCREDITATION : classifies
  LAB_SITE ||--o{ ACCREDITATION : ""
  LAB_SITE ||--|{ LAB_SITE_VERSION : history
  ACCREDITATION ||--|{ ACCREDITATION_VERSION : history
  ACCREDITATION ||--o{ SCOPE_LINE : ""
  SCOPE_LINE ||--|{ SCOPE_LINE_VERSION : history
  MD_NODE ||--o{ SCOPE_LINE : "discipline/group/product/parameter/method"
  LAB_SITE ||--o{ PRICE_LIST : ""
  PRICE_LIST ||--o{ PRICE_ITEM : ""
  SCOPE_LINE ||--o{ PRICE_ITEM : ""
  LAB_SITE ||--o{ RECEIVING_HOURS : ""
  LAB_SITE ||--o{ SITE_CLOSURE : ""
  LAB_SITE ||--o{ RETENTION_RULE : ""
  LAB_SITE ||--o{ SLOT_TEMPLATE : ""
  LAB_SITE ||--o{ SLOT : ""
  ORGANISATION ||--o{ LAB_CLAIM_REQUEST : ""
  ORGANISATION ||--o{ KYC_DOCUMENT : ""
  ORGANISATION ||--o{ BANK_ACCOUNT : ""
```

## 4. Booking, custody and reports

```mermaid
erDiagram
  BOOKING {
    uuid id PK
    varchar booking_no UK
    uuid customer_org_id FK
    uuid lab_site_id FK
    uuid lab_org_id FK
    booking_status status
    bigint total_paise
    jsonb lab_snapshot
    int lock_version
  }
  BOOKING_LINE {
    uuid id PK
    uuid booking_id FK
    uuid scope_line_version_id FK
    uuid price_item_id FK
    bigint unit_price_paise
    int gst_rate_bp
    booking_line_status status
  }
  RECEIPT_RECORD {
    uuid id PK
    uuid booking_id FK
    uuid maker_user_id FK
    uuid checker_user_id FK
    receipt_decision decision
  }
  REPORT_VERSION {
    uuid id PK
    uuid report_id FK
    int version_no
    uuid maker_user_id FK
    uuid checker_user_id FK
    bytea stamped_sha256
    varchar verification_code UK
  }
  BOOKING ||--|{ BOOKING_LINE : ""
  BOOKING ||--|{ TRF : ""
  BOOKING ||--|{ BOOKING_STATUS_HISTORY : ""
  BOOKING ||--o{ COUNTER_OFFER : ""
  BOOKING ||--o{ SLOT_HOLD : ""
  SLOT ||--o{ SLOT_HOLD : ""
  BOOKING_LINE }o--|| SCOPE_LINE_VERSION : snapshot
  BOOKING_LINE }o--|| PRICE_ITEM : priced_at
  BOOKING ||--o{ PACKAGE : ""
  PACKAGE ||--o{ CUSTODY_EVENT : ""
  BOOKING ||--o{ RECEIPT_RECORD : ""
  RECEIPT_RECORD ||--|{ RECEIPT_PACKAGE : ""
  PACKAGE ||--o{ RECEIPT_PACKAGE : ""
  RECEIPT_RECORD ||--o| HOLD_CASE : ""
  BOOKING ||--o| REPORT : ""
  REPORT ||--|{ REPORT_VERSION : ""
  REPORT_VERSION }o--|| PACKAGE : bound_to
  REPORT_VERSION ||--o{ REPORT_PARAMETER_RESULT : ""
  BOOKING_LINE ||--o{ REPORT_PARAMETER_RESULT : ""
  REPORT_VERSION ||--o{ REPORT_SHARE_LINK : ""
  REPORT_VERSION }o--|| FILE_OBJECT : "original/stamped"
```

## 5. Payments, ledger and disputes

```mermaid
erDiagram
  BOOKING ||--o{ PAYMENT_ORDER : ""
  PAYMENT_ORDER ||--o{ PAYMENT_TRANSACTION : ""
  GATEWAY_WEBHOOK_EVENT |o--o{ PAYMENT_TRANSACTION : evidences
  BOOKING ||--o{ REFUND : ""
  PAYMENT_ORDER ||--o{ REFUND : ""
  PAYOUT ||--|{ PAYOUT_ITEM : ""
  BOOKING ||--o{ PAYOUT_ITEM : ""
  BOOKING ||--o{ PAYOUT_HOLD : ""
  BANK_ACCOUNT ||--o{ PAYOUT : ""
  LEDGER_JOURNAL ||--|{ LEDGER_ENTRY : ""
  LEDGER_ACCOUNT ||--o{ LEDGER_ENTRY : ""
  BOOKING ||--o{ LEDGER_JOURNAL : ""
  BOOKING ||--o{ FINANCIAL_DOCUMENT : ""
  DOCUMENT_SERIES ||--o{ FINANCIAL_DOCUMENT : numbers
  BOOKING ||--o{ DISPUTE : ""
  DISPUTE ||--o{ DISPUTE_MESSAGE : ""
  DISPUTE ||--o{ DISPUTE_EVIDENCE : ""
  DISPUTE ||--o| PAYOUT_HOLD : ""
  DISPUTE ||--o{ REFUND : ""
  BOOKING ||--o{ RATING : ""
```

## 6. Platform

```mermaid
erDiagram
  OUTBOX_EVENT ||--o{ PROCESSED_EVENT : consumed_as
  OUTBOX_EVENT ||--o{ NOTIFICATION : triggers
  NOTIFICATION_TEMPLATE ||--o{ NOTIFICATION : renders
  APP_USER ||--o{ NOTIFICATION : receives
  APP_USER ||--o{ NOTIFICATION_PREFERENCE : sets
  TIMER }o--|| BOOKING : "aggregate (polymorphic)"
  AUDIT_LOG }o--|| APP_USER : actor
  FILE_OBJECT ||--o{ FILE_LINK : attached
```

## 7. Tables added by the P1-01 review, and tables not drawn above

```mermaid
erDiagram
  AUDIT_LOG ||--o| AUDIT_LOG_CHAIN : sealed_by
  ORGANISATION ||--|| ORGANISATION_PRIVATE : ""
  ORGANISATION ||--o{ ORGANISATION_VERSION : history
  INVITATION ||--o{ INVITATION_SITE : ""
  LAB_SITE ||--o{ INVITATION_SITE : ""
  LAB_SITE ||--|| LAB_SITE_PRIVATE : ""
  ORGANISATION ||--o{ LAB_PENALTY : ""
  SEARCH_SYNONYM ||--o{ SEARCH_SYNONYM_VERSION : history
  BOOKING_TRANSITION }o--|| BOOKING : "guards status of"
  CUSTODY_EVENT ||--o{ CUSTODY_EVENT_PHOTO : ""
  FILE_OBJECT ||--o{ CUSTODY_EVENT_PHOTO : ""
  REPORT_VERSION ||--o{ BREAK_GLASS_GRANT : ""
  BREAK_GLASS_GRANT ||--o{ REPORT_ACCESS_LOG : ""
  REPORT_VERSION ||--o{ REPORT_ACCESS_LOG : ""
  BOOKING ||--o{ LABEL_PRINT : ""
  QR_SIGNING_KEY ||--o{ PACKAGE : signs
  ORGANISATION ||--o{ CUSTOMER_SITE : "owns (CUSTOMER)"
  ORGANISATION ||--o| CUSTOMER_SETTINGS : ""
  ACCREDITATION_BODY ||--o{ ACCREDITATION : issues
  APP_USER ||--o{ MFA_RECOVERY_CODE : ""
```

Standalone tables with no drawn relationship: `config_parameter`, `holiday_calendar`, `idempotency_record`, `otp_challenge`, `fee_rule`, `lead_request`, `settlement_report_line`, `verification_event`.
