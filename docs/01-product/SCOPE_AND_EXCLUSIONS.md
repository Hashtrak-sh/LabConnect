# Scope and exclusions

**Status:** Approved baseline.

## 1. In scope for the MVP

| Capability | MVP scope |
|---|---|
| Master data | Configurable taxonomies. Manual import (CSV/Excel) of NABL lab, accreditation and scope data with mapping, preview, duplicate detection, review, approval, publication and versioning. |
| Lab directory and search | Public search by text, location radius, discipline, product, parameter, method/standard, TAT, price, accreditation status. Map and list. Lab site profile pages. "Request a lab" lead capture. |
| Lab onboarding | Claim (certificate no. + OTP to the NABL-registered email; manual fallback), KYC documents, bank details, Maker and Checker users, receiving hours, closures, slots, submission instructions, retention periods, price-list bulk import and publication. |
| Customer onboarding | Sign-up via email OTP, organisation creation (individual or organisation), customer sites, user invitations, roles. |
| Booking | One lab site, one item, one or more parameters from that site's scope, digital TRF, preferred slot, estimate, attachments, duplicate warning. |
| Lab decision | The Checker accepts, rejects (with reason) or counters (slot and/or quantity only). Decision SLA timers and expiry. |
| Payment | Online payment through ICICI (methods to be confirmed), webhook verification, reconciliation, refunds, payment receipts. |
| Handover | Self-drop instructions, booking QR, package QRs, label printing (customer and lab), drop deadline, NO_SHOW. |
| Receipt | Maker scans and records count, condition, photos and discrepancies. The Checker approves or puts it on hold. Customer decision on hold. Label reprint with approval. |
| Testing and report | Status updates, expected report date, the Maker uploads a PDF and binds it to the package, the Checker approves with MFA or returns it, QR stamping, amendments and superseded versions. |
| Verification | Public verification page (authenticity and limited metadata), in-browser hash comparison, time-limited revocable share links. |
| Post-release | 72-hour dispute window, disputes with evidence, Ops decisions, refunds, payout holds, ratings (Should). |
| Finance | Ledger, refunds, payouts (mechanism to be decided), financial documents (invoice, receipt, credit note, refund note), reconciliation exports. |
| Admin | Ops board, lab and user management, master data, configuration (SLAs, windows, fees set to zero, policies), audit log viewer, dispute management. |
| Notifications | Email and in-app, with preferences for non-action notifications. |
| Platform | Audit log, outbox and events, timers, file handling with malware scanning, observability. |

## 2. Deferred (designed for, not built)

| Item | Earliest phase | Design hook |
|---|---|---|
| Booking calibration labs | Phase 2 | `accreditation.lab_category`, bookable rule |
| SMS, WhatsApp, phone OTP | Phase 2 | `NotificationChannel` interface, `app_user.phone_verified_at` |
| Hindi UI | Phase 2 | i18n keys from day one |
| Automated NABL ingestion | Phase 2 | `md_change_set.source = NABL_SYNC` |
| Saved searches, compare 3 labs (FR-DIS-08) | Phase 2 | — |
| Multi-item cart, recurring bookings | Phase 2 | `booking` stays single-item |
| Structured results entry, ULR auto-numbering | Phase 2 | `report_parameter_result` |
| Lab group (multi-site) dashboards | Phase 3 | `lab_site.organisation_id` |
| Supplementary payments (FR-PAY-08) | Later | — |
| In-booking chat (FR-SUP-04) | Phase 2 | — |
| Lab Android app | Phase 2 | — |
| LIMS integration | Phase 3 | — |
| Platform fee or commission | Policy decision | `fee_rule`, ledger account `PLATFORM_FEE_REVENUE` |

## 3. Excluded from the MVP (do not build)

- Platform-arranged pickup, delivery, riders, logistics partners, dispatch, pickup OTP, GPS tracking, transit states (`IN_TRANSIT`), logistics webhooks, transport charges, cold-chain services.
- Medical laboratories (ISO 15189) and any patient data.
- Subcontracting tests to another lab.
- Negotiated quotations, price revisions in counter-offers, purchase orders, credit terms, bank transfer against PO.
- Lab roles other than Maker and Checker.
- Hazardous, radioactive or Dangerous Goods samples.
- On-site testing at the customer's premises.
- Native mobile apps.
- Interpreting results or giving compliance advice.
- Any change to report content by the platform.
