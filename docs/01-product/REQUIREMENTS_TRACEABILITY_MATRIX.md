# Requirements traceability matrix

**Status:** Living document. Generated from `FUNCTIONAL_REQUIREMENTS.md` at creation. Developers update the **Tests** and **Status** columns in the same PR that implements a requirement. (Status: ☐ not started · ◐ in progress · ☑ done with tests · ⊘ deferred/excluded.)

| FR | Pri | MVP | Module | Design doc | API | Tables | Acceptance | Increment | Tests (file/ID) | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| FR-MDM-01 | M | MVP | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ☐ |
| FR-MDM-02 | M | MVP | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ☐ |
| FR-MDM-03 | M | MVP | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ☐ |
| FR-MDM-04 | M | MVP | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ☐ |
| FR-MDM-05 | M | MVP | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ☐ |
| FR-MDM-06 | M | MVP | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ☐ |
| FR-MDM-07 | M | MVP | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ☐ |
| FR-MDM-08 | M | MVP | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ☐ |
| FR-MDM-09 | M | MVP | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ☐ |
| FR-MDM-10 | S | DEFERRED | masterdata | MASTER_DATA_MANAGEMENT | API §10 change-sets/imports | md_*, import_* | AC-MDM | I1 | | ⊘ |
| FR-DAT-01 | M | MVP* | masterdata, labs | MASTER_DATA_MANAGEMENT | API §6 claims, §10 | lab_site, accreditation, scope_line, lab_claim_request | AC-MDM, AC-DIS | I1 | | ☐ |
| FR-DAT-02 | M | MVP | masterdata, labs | MASTER_DATA_MANAGEMENT | API §6 claims, §10 | lab_site, accreditation, scope_line, lab_claim_request | AC-MDM, AC-DIS | I1 | | ☐ |
| FR-DAT-03 | M | MVP | masterdata, labs | MASTER_DATA_MANAGEMENT | API §6 claims, §10 | lab_site, accreditation, scope_line, lab_claim_request | AC-MDM, AC-DIS | I1 | | ☐ |
| FR-DAT-04 | M | MVP | masterdata, labs | MASTER_DATA_MANAGEMENT | API §6 claims, §10 | lab_site, accreditation, scope_line, lab_claim_request | AC-MDM, AC-DIS | I1 | | ☐ |
| FR-DAT-05 | M | MVP | masterdata, labs | MASTER_DATA_MANAGEMENT | API §6 claims, §10 | lab_site, accreditation, scope_line, lab_claim_request | AC-MDM, AC-DIS | I1 | | ☐ |
| FR-DAT-06 | M | MVP | masterdata, labs | MASTER_DATA_MANAGEMENT | API §6 claims, §10 | lab_site, accreditation, scope_line, lab_claim_request | AC-MDM, AC-DIS | I1 | | ☐ |
| FR-DAT-07 | M | MVP* | masterdata, labs | MASTER_DATA_MANAGEMENT | API §6 claims, §10 | lab_site, accreditation, scope_line, lab_claim_request | AC-MDM, AC-DIS | I1 | | ☐ |
| FR-DAT-08 | S | DEFERRED | masterdata, labs | MASTER_DATA_MANAGEMENT | API §6 claims, §10 | lab_site, accreditation, scope_line, lab_claim_request | AC-MDM, AC-DIS | I1 | | ⊘ |
| FR-DAT-09 | M | MVP | masterdata, labs | MASTER_DATA_MANAGEMENT | API §6 claims, §10 | lab_site, accreditation, scope_line, lab_claim_request | AC-MDM, AC-DIS | I1 | | ☐ |
| FR-DIS-01 | M | MVP | search, labs | SEARCH | API §2 public | (OpenSearch), lab_site, scope_line, price_item, slot, lead_request | AC-DIS | I1 | | ☐ |
| FR-DIS-02 | M | MVP | search, labs | SEARCH | API §2 public | (OpenSearch), lab_site, scope_line, price_item, slot, lead_request | AC-DIS | I1 | | ☐ |
| FR-DIS-03 | M | MVP | search, labs | SEARCH | API §2 public | (OpenSearch), lab_site, scope_line, price_item, slot, lead_request | AC-DIS | I1 | | ☐ |
| FR-DIS-04 | M | MVP | search, labs | SEARCH | API §2 public | (OpenSearch), lab_site, scope_line, price_item, slot, lead_request | AC-DIS | I1 | | ☐ |
| FR-DIS-05 | M | MVP | search, labs | SEARCH | API §2 public | (OpenSearch), lab_site, scope_line, price_item, slot, lead_request | AC-DIS | I1 | | ☐ |
| FR-DIS-06 | M | MVP | search, labs | SEARCH | API §2 public | (OpenSearch), lab_site, scope_line, price_item, slot, lead_request | AC-DIS | I1 | | ☐ |
| FR-DIS-07 | M | MVP | search, labs | SEARCH | API §2 public | (OpenSearch), lab_site, scope_line, price_item, slot, lead_request | AC-DIS | I1 | | ☐ |
| FR-DIS-08 | S | DEFERRED | search, labs | SEARCH | API §2 public | (OpenSearch), lab_site, scope_line, price_item, slot, lead_request | AC-DIS | I1 | | ⊘ |
| FR-DIS-09 | M | MVP | search, labs | SEARCH | API §2 public | (OpenSearch), lab_site, scope_line, price_item, slot, lead_request | AC-DIS | I1 | | ☐ |
| FR-IAM-01 | M | MVP | identity | AUTHENTICATION_AND_AUTHORISATION | API §1 auth | app_user, membership*, otp_challenge, mfa_factor, user_session | AC-SEC | P3 | | ☐ |
| FR-IAM-02 | S | DEFERRED | identity | AUTHENTICATION_AND_AUTHORISATION | API §1 auth | app_user, membership*, otp_challenge, mfa_factor, user_session | AC-SEC | P3 | | ⊘ |
| FR-IAM-03 | M | MVP | identity | AUTHENTICATION_AND_AUTHORISATION | API §1 auth | app_user, membership*, otp_challenge, mfa_factor, user_session | AC-SEC | P3 | | ☐ |
| FR-IAM-04 | M | MVP | identity | AUTHENTICATION_AND_AUTHORISATION | API §1 auth | app_user, membership*, otp_challenge, mfa_factor, user_session | AC-SEC | P3 | | ☐ |
| FR-IAM-05 | M | MVP | identity | AUTHENTICATION_AND_AUTHORISATION | API §1 auth | app_user, membership*, otp_challenge, mfa_factor, user_session | AC-SEC | P3 | | ☐ |
| FR-IAM-06 | M | MVP | identity | AUTHENTICATION_AND_AUTHORISATION | API §1 auth | app_user, membership*, otp_challenge, mfa_factor, user_session | AC-SEC | P3 | | ☐ |
| FR-IAM-07 | S | MVP | identity | AUTHENTICATION_AND_AUTHORISATION | API §1 auth | app_user, membership*, otp_challenge, mfa_factor, user_session | AC-SEC | P3 | | ☐ |
| FR-ONB-01 | M | MVP | identity, customers, labs | ROLES_AND_PERMISSIONS | API §3, §6 | organisation, customer_site, kyc_document, bank_account, price_list, retention_rule | AC-SEC | I2 | | ☐ |
| FR-ONB-02 | M | MVP | identity, customers, labs | ROLES_AND_PERMISSIONS | API §3, §6 | organisation, customer_site, kyc_document, bank_account, price_list, retention_rule | AC-SEC | I2 | | ☐ |
| FR-ONB-03 | M | MVP | identity, customers, labs | ROLES_AND_PERMISSIONS | API §3, §6 | organisation, customer_site, kyc_document, bank_account, price_list, retention_rule | AC-SEC | I2 | | ☐ |
| FR-ONB-04 | M | MVP | identity, customers, labs | ROLES_AND_PERMISSIONS | API §3, §6 | organisation, customer_site, kyc_document, bank_account, price_list, retention_rule | AC-SEC | I2 | | ☐ |
| FR-ONB-05 | M | MVP | identity, customers, labs | ROLES_AND_PERMISSIONS | API §3, §6 | organisation, customer_site, kyc_document, bank_account, price_list, retention_rule | AC-SEC | I2 | | ☐ |
| FR-ONB-06 | M | MVP | identity, customers, labs | ROLES_AND_PERMISSIONS | API §3, §6 | organisation, customer_site, kyc_document, bank_account, price_list, retention_rule | AC-SEC | I2 | | ☐ |
| FR-ONB-07 | M | MVP | identity, customers, labs | ROLES_AND_PERMISSIONS | API §3, §6 | organisation, customer_site, kyc_document, bank_account, price_list, retention_rule | AC-SEC | I2 | | ☐ |
| FR-BKG-01 | M | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-02 | M | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-03 | M | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-04 | M | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-05 | M | MVP* | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-06 | M | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-07 | M | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-08 | S | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-09 | S | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-10 | M | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-BKG-11 | M | MVP | booking | BOOKING_STATE_MACHINE | API §4 bookings | booking, booking_line, trf, slot_hold | AC-BKG | I3 | | ☐ |
| FR-LAB-01 | M | MVP* | booking, labs | BOOKING_STATE_MACHINE | API §4 accept/reject/counter, §6 | booking, counter_offer, slot, membership_role | AC-LAB | I3 | | ☐ |
| FR-LAB-02 | M | MVP* | booking, labs | BOOKING_STATE_MACHINE | API §4 accept/reject/counter, §6 | booking, counter_offer, slot, membership_role | AC-LAB | I3 | | ☐ |
| FR-LAB-03 | M | MVP | booking, labs | BOOKING_STATE_MACHINE | API §4 accept/reject/counter, §6 | booking, counter_offer, slot, membership_role | AC-LAB | I3 | | ☐ |
| FR-LAB-04 | M | MVP | booking, labs | BOOKING_STATE_MACHINE | API §4 accept/reject/counter, §6 | booking, counter_offer, slot, membership_role | AC-LAB | I3 | | ☐ |
| FR-LAB-05 | M | MVP | booking, labs | BOOKING_STATE_MACHINE | API §4 accept/reject/counter, §6 | booking, counter_offer, slot, membership_role | AC-LAB | I3 | | ☐ |
| FR-LAB-06 | M | MVP | booking, labs | BOOKING_STATE_MACHINE | API §4 accept/reject/counter, §6 | booking, counter_offer, slot, membership_role | AC-LAB | I3 | | ☐ |
| FR-LAB-07 | S | MVP | booking, labs | BOOKING_STATE_MACHINE | API §4 accept/reject/counter, §6 | booking, counter_offer, slot, membership_role | AC-LAB | I3 | | ☐ |
| FR-LAB-08 | M | MVP | booking, labs | BOOKING_STATE_MACHINE | API §4 accept/reject/counter, §6 | booking, counter_offer, slot, membership_role | AC-LAB | I3 | | ☐ |
| FR-LAB-09 | M | MVP | booking, labs | BOOKING_STATE_MACHINE | API §4 accept/reject/counter, §6 | booking, counter_offer, slot, membership_role | AC-LAB | I3 | | ☐ |
| FR-PAY-01 | M | MVP | payments | PAYMENTS_AND_LEDGER, ICICI_PAYMENT_INTEGRATION | API §5 | payment_order, payment_transaction, gateway_webhook_event, refund, payout* | AC-PAY | I4 | | ☐ |
| FR-PAY-02 | M | MVP* | payments | PAYMENTS_AND_LEDGER, ICICI_PAYMENT_INTEGRATION | API §5 | payment_order, payment_transaction, gateway_webhook_event, refund, payout* | AC-PAY | I4 | | ☐ |
| FR-PAY-03 | M | MVP | payments | PAYMENTS_AND_LEDGER, ICICI_PAYMENT_INTEGRATION | API §5 | payment_order, payment_transaction, gateway_webhook_event, refund, payout* | AC-PAY | I4 | | ☐ |
| FR-PAY-05 | M | MVP* | payments | PAYMENTS_AND_LEDGER, ICICI_PAYMENT_INTEGRATION | API §5 | payment_order, payment_transaction, gateway_webhook_event, refund, payout* | AC-PAY | I4 | | ☐ |
| FR-PAY-06 | M | MVP | payments | PAYMENTS_AND_LEDGER, ICICI_PAYMENT_INTEGRATION | API §5 | payment_order, payment_transaction, gateway_webhook_event, refund, payout* | AC-PAY | I4 | | ☐ |
| FR-PAY-07 | M | MVP | payments | PAYMENTS_AND_LEDGER, ICICI_PAYMENT_INTEGRATION | API §5 | payment_order, payment_transaction, gateway_webhook_event, refund, payout* | AC-PAY | I4 | | ☐ |
| FR-PAY-08 | S | DEFERRED | payments | PAYMENTS_AND_LEDGER, ICICI_PAYMENT_INTEGRATION | API §5 | payment_order, payment_transaction, gateway_webhook_event, refund, payout* | AC-PAY | I4 | | ⊘ |
| FR-PAY-09 | M | MVP* | payments | PAYMENTS_AND_LEDGER, ICICI_PAYMENT_INTEGRATION | API §5 | payment_order, payment_transaction, gateway_webhook_event, refund, payout* | AC-PAY | I4 | | ☐ |
| FR-LOG-01 | M | MVP | custody | QR_AND_VERIFICATION | API §4 handover/labels, §7 | package, custody_event, label_print, receipt_record | AC-LOG | I4/I5 | | ☐ |
| FR-LOG-02 | M | MVP | custody | QR_AND_VERIFICATION | API §4 handover/labels, §7 | package, custody_event, label_print, receipt_record | AC-LOG | I4/I5 | | ☐ |
| FR-LOG-03 | M | MVP | custody | QR_AND_VERIFICATION | API §4 handover/labels, §7 | package, custody_event, label_print, receipt_record | AC-LOG | I4/I5 | | ☐ |
| FR-LOG-04 | M | MVP | custody | QR_AND_VERIFICATION | API §4 handover/labels, §7 | package, custody_event, label_print, receipt_record | AC-LOG | I4/I5 | | ☐ |
| FR-LOG-05 | M | MVP | custody | QR_AND_VERIFICATION | API §4 handover/labels, §7 | package, custody_event, label_print, receipt_record | AC-LOG | I4/I5 | | ☐ |
| FR-LOG-06 | M | MVP | custody | QR_AND_VERIFICATION | API §4 handover/labels, §7 | package, custody_event, label_print, receipt_record | AC-LOG | I4/I5 | | ☐ |
| FR-LOG-07 | M | MVP | custody | QR_AND_VERIFICATION | API §4 handover/labels, §7 | package, custody_event, label_print, receipt_record | AC-LOG | I4/I5 | | ☐ |
| FR-LOG-08 | M | MVP | custody | QR_AND_VERIFICATION | API §4 handover/labels, §7 | package, custody_event, label_print, receipt_record | AC-LOG | I4/I5 | | ☐ |
| FR-LOG-09 | M | MVP | custody | QR_AND_VERIFICATION | API §4 handover/labels, §7 | package, custody_event, label_print, receipt_record | AC-LOG | I4/I5 | | ☐ |
| FR-RPT-01 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-02 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-03 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-04 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-05 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-06 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-07 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-08 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-09 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-10 | M | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-RPT-11 | S | MVP | custody, reports | FILES_AND_REPORTS, QR_AND_VERIFICATION | API §7, §8 | receipt_record, report, report_version, report_share_link | AC-RPT | I5 | | ☐ |
| FR-SUP-01 | S | MVP | disputes | BUSINESS_RULES BR-080..083 | API §9, §10 disputes | dispute*, rating, payout_hold | AC-SUP | I6 | | ☐ |
| FR-SUP-02 | M | MVP | disputes | BUSINESS_RULES BR-080..083 | API §9, §10 disputes | dispute*, rating, payout_hold | AC-SUP | I6 | | ☐ |
| FR-SUP-03 | M | MVP | disputes | BUSINESS_RULES BR-080..083 | API §9, §10 disputes | dispute*, rating, payout_hold | AC-SUP | I6 | | ☐ |
| FR-SUP-04 | S | DEFERRED | disputes | BUSINESS_RULES BR-080..083 | API §9, §10 disputes | dispute*, rating, payout_hold | AC-SUP | I6 | | ⊘ |
| FR-SUP-05 | M | MVP | disputes | BUSINESS_RULES BR-080..083 | API §9, §10 disputes | dispute*, rating, payout_hold | AC-SUP | I6 | | ☐ |
| FR-FIN-01 | M | MVP | payments | PAYMENTS_AND_LEDGER | API §5 documents, §10 finance | ledger_*, financial_document, document_series, settlement_report_line | AC-PAY | I4/I6 | | ☐ |
| FR-FIN-02 | M | MVP | payments | PAYMENTS_AND_LEDGER | API §5 documents, §10 finance | ledger_*, financial_document, document_series, settlement_report_line | AC-PAY | I4/I6 | | ☐ |
| FR-FIN-03 | M | MVP | payments | PAYMENTS_AND_LEDGER | API §5 documents, §10 finance | ledger_*, financial_document, document_series, settlement_report_line | AC-PAY | I4/I6 | | ☐ |
| FR-FIN-04 | M | MVP | payments | PAYMENTS_AND_LEDGER | API §5 documents, §10 finance | ledger_*, financial_document, document_series, settlement_report_line | AC-PAY | I4/I6 | | ☐ |
| FR-NOT-01 | M | MVP | notifications | NOTIFICATIONS | API §1 me/notifications | notification*, outbox_event | — | P3 | | ☐ |
| FR-NOT-02 | M | MVP | notifications | NOTIFICATIONS | API §1 me/notifications | notification*, outbox_event | — | P3 | | ☐ |
| FR-NOT-03 | S | MVP | notifications | NOTIFICATIONS | API §1 me/notifications | notification*, outbox_event | — | P3 | | ☐ |
| FR-NOT-04 | S | DEFERRED | notifications | NOTIFICATIONS | API §1 me/notifications | notification*, outbox_event | — | P3 | | ⊘ |
| FR-ADM-01 | M | MVP | admin + owners | ROLES_AND_PERMISSIONS | API §10 | config_parameter, audit_log, lead_request | AC-SEC | I1–I6 | | ☐ |
| FR-ADM-02 | M | MVP | admin + owners | ROLES_AND_PERMISSIONS | API §10 | config_parameter, audit_log, lead_request | AC-SEC | I1–I6 | | ☐ |
| FR-ADM-03 | M | MVP* | admin + owners | ROLES_AND_PERMISSIONS | API §10 | config_parameter, audit_log, lead_request | AC-SEC | I1–I6 | | ☐ |
| FR-ADM-04 | M | MVP | admin + owners | ROLES_AND_PERMISSIONS | API §10 | config_parameter, audit_log, lead_request | AC-SEC | I1–I6 | | ☐ |
| FR-ADM-05 | M | MVP | admin + owners | ROLES_AND_PERMISSIONS | API §10 | config_parameter, audit_log, lead_request | AC-SEC | I1–I6 | | ☐ |
| FR-ADM-06 | S | MVP | admin + owners | ROLES_AND_PERMISSIONS | API §10 | config_parameter, audit_log, lead_request | AC-SEC | I1–I6 | | ☐ |
| FR-ADM-07 | C | MVP | admin + owners | ROLES_AND_PERMISSIONS | API §10 | config_parameter, audit_log, lead_request | AC-SEC | I1–I6 | | ☐ |

## Non-functional and edge-case traceability

| Item | Verified by | Status |
|---|---|---|
| NFR-01..18 | See the Verification column in `NON_FUNCTIONAL_REQUIREMENTS.md` | ☐ |
| EC-01..EC-58 | One automated test each (workflow or integration), named `EC-xx …` | ☐ |
| BR-001..BR-091 | Unit tests on rule functions, named `BR-xxx …` | ☐ |
| CD-23 (no self-approval) | Mandatory suite 1 (TESTING_STRATEGY §2) | ☐ |
| Tenant isolation | Mandatory suite 3 | ☐ |

_Total functional requirements: 110._
