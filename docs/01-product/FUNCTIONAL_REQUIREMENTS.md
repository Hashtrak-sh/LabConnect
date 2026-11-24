# Functional requirements

**Status:** DRAFT for review. FR IDs from the feature specification are kept as they are. New IDs (FR-MDM, FR-IAM, FR-ONB, FR-FIN, FR-NOT) cover requirements from the handoff summary.

**Priority:** M = Must, S = Should, C = Could (MoSCoW).
**MVP disposition:** `MVP` as written · `MVP*` in the MVP, modified by a decision (see the note) · `DEFERRED` · `EXCLUDED`.

---

## FR-MDM: Master data management (new)

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-MDM-01 | Administrators can define taxonomies (e.g. scope hierarchy, standards, units, rejection reasons), their levels (node types), and the attributes for each level, with data type, required flag and validation rules. | M | MVP |
| FR-MDM-02 | Master records support hierarchy (parent/child), active/inactive status, and effective-from/expiry dates where applicable. | M | MVP |
| FR-MDM-03 | Every change to a master record creates a new version. Earlier versions stay readable, and the change history shows who, when, what and why. | M | MVP |
| FR-MDM-04 | Imports accept CSV and Excel from multiple sources. Each import uses a saved, versioned mapping template that maps source columns to target fields. | M | MVP |
| FR-MDM-05 | Before anything is committed, an import produces a preview: per-row create, update, no-change, conflict or error, with validation messages. | M | MVP |
| FR-MDM-06 | Duplicate and inconsistency detection: same certificate number, same scope line, conflicting validity dates, unknown taxonomy values, low-confidence geocodes. | M | MVP |
| FR-MDM-07 | Changes are grouped into a change set that goes through Draft → In review → Approved → Published (or Rejected). The approver must be a different administrator from the preparer. | M | MVP |
| FR-MDM-08 | Publishing a change set is atomic and emits events that update search and notify affected labs or bookings. | M | MVP |
| FR-MDM-09 | Admins can edit single records manually through the same change-set workflow. | M | MVP |
| FR-MDM-10 | Automated NABL ingestion creates change sets with source `NABL_SYNC` for admin review. | S | DEFERRED |

## FR-DAT: NABL data ingestion and lab profiles

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-DAT-01 | Import the NABL dataset into staging and validate the mandatory fields: lab name, certificate number, accreditation standard, validity dates, address, discipline. | M | MVP* (ISO 15189 rows rejected at import, CD-03) |
| FR-DAT-02 | Normalise scopes: Discipline → Group → Product/Material → Parameter → Method/Standard → Range → Site type. | M | MVP |
| FR-DAT-03 | Geocode every lab address and flag low-confidence geocodes for manual pin correction by Ops. | M | MVP |
| FR-DAT-04 | De-duplicate labs. One lab organisation can own many lab sites, each with its own certificate and scope. | M | MVP |
| FR-DAT-05 | Every listing shows accreditation status and validity. Only Valid sites are bookable. | M | MVP |
| FR-DAT-06 | Unclaimed labs appear as "Listed" with a "Request this lab" action. Onboarded labs appear as "Bookable". | M | MVP |
| FR-DAT-07 | Claim flow: certificate number + OTP to the lab's NABL-registered email, with a fallback to Ops manual verification using letterhead authorisation. | M | MVP* (email OTP only, R-07) |
| FR-DAT-08 | A scheduled refresh compares the source with stored data and raises change events for review. | S | DEFERRED (FR-MDM-10) |
| FR-DAT-09 | Calibration lab sites are imported, listed and searchable, and marked "Booking not yet available". | M | MVP (R-01) |

## FR-DIS: Discovery and search

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-DIS-01 | Free-text search (product, parameter, standard, lab name) with typo tolerance and an admin-managed synonym list. | M | MVP |
| FR-DIS-02 | Location by device, pincode, city or a saved customer site. Radius 5/10/25/50/100 km. Sort by distance. | M | MVP |
| FR-DIS-03 | Filters: discipline, product group, parameter, method/standard, accreditation status, TAT, price range, rating, earliest slot, lab category. | M | MVP |
| FR-DIS-04 | Map and list views stay in sync, with clustering at low zoom. | M | MVP |
| FR-DIS-05 | Each result shows the matched scope lines, price from, TAT, distance, rating and next free slot. | M | MVP |
| FR-DIS-06 | The lab site page shows: certificate (with a link to NABL verification), scope tree with search inside it, price list, sample requirements, receiving hours, address with map, reviews. | M | MVP |
| FR-DIS-07 | When there are no results, suggest widening the radius or related parameters, or offer "Request a lab" (lead captured). | M | MVP |
| FR-DIS-08 | Compare up to 3 labs. | S | DEFERRED |
| FR-DIS-09 | Search works without login. Booking requires login. | M | MVP |

## FR-IAM: Identity and access (new)

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-IAM-01 | Passwordless sign-in with an email OTP. Rate limits, expiry and attempt limits apply. | M | MVP |
| FR-IAM-02 | Phone OTP sign-in. | S | DEFERRED (needs SMS) |
| FR-IAM-03 | TOTP MFA is mandatory for Lab Checker, Customer Finance and all platform roles, with recovery codes. | M | MVP |
| FR-IAM-04 | Step-up MFA (fresh within 5 minutes) is needed to publish a report, change bank details, approve a payout release, and make break-glass report access. | M | MVP |
| FR-IAM-05 | A user can belong to several organisations and switch between them. Permissions are evaluated per active membership. | M | MVP |
| FR-IAM-06 | When an organisation admin or Lab Checker deactivates a user, that user loses access immediately (session revocation). | M | MVP |
| FR-IAM-07 | A session and device list, with sign-out from all devices. | S | MVP |

## FR-ONB: Onboarding (new, consolidates FS §5.3 and FR-ADM-01)

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-ONB-01 | Customers sign up as an individual or as an organisation (business, industry, government), with GSTIN optional for individuals. | M | MVP |
| FR-ONB-02 | A Customer Admin invites users and assigns customer roles. An org setting controls whether Requesters may pay. | M | MVP |
| FR-ONB-03 | Customer sites (plants or offices) with geocoded address, for search and billing. | M | MVP |
| FR-ONB-04 | Lab onboarding checklist: claim approved, KYC documents verified, bank account verified, at least one Maker and one Checker, receiving hours, slots, price list published. Ops verifies KYC and bank details. | M | MVP |
| FR-ONB-05 | A Lab Checker can bulk-import a price list and sample requirements (CSV/Excel) against the site's scope lines, with preview and validation. | M | MVP |
| FR-ONB-06 | A Lab Checker manages lab users (Maker or Checker), and assigns users to sites. | M | MVP |
| FR-ONB-07 | A Lab Checker sets the retention period per discipline. | M | MVP (CD-13) |

## FR-BKG: Booking

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-BKG-01 | Select one lab site, one item and one or more parameters from that site's active scope. Out-of-scope parameters are blocked. | M | MVP |
| FR-BKG-02 | Digital TRF: item, grade/spec, batch/lot, manufacturing date, sample quantity, package count, sample condition, standard, special instructions, conformity statement required (+ decision rule), report name and address, GSTIN. | M | MVP |
| FR-BKG-03 | Show the required sample quantity and packaging per parameter before confirmation. | M | MVP |
| FR-BKG-04 | Choose a preferred drop date and slot. Only slots with capacity and inside receiving hours are offered. | M | MVP |
| FR-BKG-05 | Estimate = sum of parameter prices + sample-prep charges + GST. No transport charge. | M | MVP* (no platform fee, CD-05) |
| FR-BKG-06 | Submitting creates a REQUESTED booking with a booking number and a soft hold on the slot. | M | MVP |
| FR-BKG-07 | Free cancellation before payment. | M | MVP |
| FR-BKG-08 | Attachments up to 25 MB in total. | S | MVP |
| FR-BKG-09 | Duplicate warning for the same item + batch + parameters within 7 days. | S | MVP |
| FR-BKG-10 | The customer can edit while REQUESTED. The edit creates a new TRF version and resets the lab SLA. | M | MVP (EC-11) |
| FR-BKG-11 | Price and scope details are frozen on the booking when it's submitted (snapshot). | M | MVP (CD-39) |

## FR-LAB: Lab decision

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-LAB-01 | New bookings appear in the lab inbox (Maker sees them, Checker acts), with in-app and email notification. | M | MVP* (no SMS) |
| FR-LAB-02 | The Checker can Accept, Reject (mandatory reason code + text) or Counter. | M | MVP* (counter = slot and/or extra quantity only, CD-08) |
| FR-LAB-03 | The customer accepts or declines a counter within 24 h. | M | MVP |
| FR-LAB-04 | Decision SLA of 4 business hours (configurable), with reminders at 50% and 90% and auto-expiry at SLA + 4 h. | M | MVP |
| FR-LAB-05 | Acceptance confirms the final price and opens the payment window. | M | MVP |
| FR-LAB-06 | The Checker manages capacity: slots per day per discipline, receiving hours, holidays, cut-offs, max open jobs, submission instructions. | M | MVP |
| FR-LAB-07 | The Checker can mark a parameter as temporarily unavailable. | S | MVP |
| FR-LAB-08 | Exactly two lab login types. A site is bookable only with at least one active Maker and one active Checker who are different people. | M | MVP |
| FR-LAB-09 | Self-approval is blocked, and every approval is logged. | M | MVP |

## FR-PAY: Payment and settlement

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-PAY-01 | Pay within 24 h of acceptance (configurable). Otherwise the booking expires and the slot is released. | M | MVP |
| FR-PAY-02 | UPI, cards, net banking through ICICI. No card data stored. | M | MVP* (methods depend on ICICI, OQ-01) |
| FR-PAY-03 | On success, the lab sees "Payment received" and the booking becomes PAID. | M | MVP |
| FR-PAY-05 | Tax invoice for testing services, GST-compliant. No platform-fee invoice while the fee is zero. | M | MVP* (issuer to be decided, OQ-08) |
| FR-PAY-06 | Stage-based refunds to the original payment method, with the status visible to the customer. | M | MVP |
| FR-PAY-07 | Webhook-based reconciliation, idempotent, plus a polling backstop. | M | MVP |
| FR-PAY-08 | Supplementary payment requests. | S | DEFERRED (R-03) |
| FR-PAY-09 | Payout to the lab only after the 72-hour window with no open dispute. Payout hold when a dispute is raised. | M | MVP* (mechanism depends on ICICI, OQ-02) |

## FR-LOG: Sample handover (self-drop only)

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-LOG-01 | Customer self-drop only. | M | MVP |
| FR-LOG-02 | After payment, show the lab address, map, receiving hours, contact, instructions and drop deadline. | M | MVP |
| FR-LOG-03 | Generate one booking QR and one unique signed QR per declared package. | M | MVP |
| FR-LOG-04 | The customer can view, download and print the QR labels and instructions. | M | MVP |
| FR-LOG-05 | The customer presents a QR at the lab. | M | MVP |
| FR-LOG-06 | The Maker scans the QR, retrieves the booking and TRF, and verifies the sample. | M | MVP |
| FR-LOG-07 | The Maker records receipt time, count, condition and discrepancies. The Checker approves or confirms the discrepancy. | M | MVP |
| FR-LOG-08 | An auditable handover and receipt record. | M | MVP |
| FR-LOG-09 | The Maker can print a booking's labels at the counter. Reprints void the previous label. | M | MVP (CD-12) |

## FR-RPT: Receiving, testing and report

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-RPT-01 | The Maker scans the booking or package QR and sees the booking, item, batch, TRF and expected count. | M | MVP |
| FR-RPT-02 | The Maker records date and time, count, condition (intact / damaged / leaking / insufficient / seal broken), photos and discrepancy, then submits. The booking becomes SAMPLE_RECORDED. | M | MVP |
| FR-RPT-03 | The Checker approves (Lab Sample ID assigned, RECEIVED) or confirms the discrepancy (ON_HOLD). | M | MVP |
| FR-RPT-04 | The customer sees status updates and the expected report date. | M | MVP |
| FR-RPT-05 | The Maker uploads the report: PDF ≤ 20 MB, report number, ULR, issue date, conformity per parameter (optional). | M | MVP |
| FR-RPT-06 | The Maker binds the report to a scanned package. The system checks the booking, batch and parameters. The booking becomes REPORT_IN_REVIEW. | M | MVP |
| FR-RPT-07 | Only a Checker (not the Maker who submitted it) approves and publishes, with MFA, or returns the report with comments. | M | MVP |
| FR-RPT-08 | The platform stamps a verification QR onto a copy and records SHA-256 hashes. Verification shows the report number, lab, issue date, approving Checker (name and role) and whether the file is genuine and current. | M | MVP |
| FR-RPT-09 | Amendment: the Maker prepares a revised report with a reason and the Checker approves it. The old version shows as "Superseded". | M | MVP |
| FR-RPT-10 | Download, share through an expiring and revocable link, and raise a dispute within 72 h. | M | MVP |
| FR-RPT-11 | The custody trail can be downloaded with the report. | S | MVP |

## FR-SUP: Ratings, disputes and support

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-SUP-01 | Ratings 1–5 (TAT, communication, overall). The lab can rate the customer privately. | S | MVP |
| FR-SUP-02 | Dispute types: report delay, wrong parameter, sample lost or damaged, billing, result query, each with evidence and an Ops SLA. | M | MVP |
| FR-SUP-03 | Ops issues partial or full refunds and records the outcome and rationale. | M | MVP |
| FR-SUP-04 | In-booking chat. | S | DEFERRED |
| FR-SUP-05 | Ops can place, extend or release a payout hold on a booking, with a reason. | M | MVP (CD-14) |

## FR-FIN: Financial records (new)

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-FIN-01 | A double-entry ledger records every customer payment, lab payable, refund, credit and (zero) platform fee separately. | M | MVP |
| FR-FIN-02 | Financial documents: tax invoice, payment receipt, credit note, refund note, numbered gaplessly per issuer and financial year. Issued documents are immutable. | M | MVP |
| FR-FIN-03 | Daily reconciliation of gateway settlements against the ledger, with an exceptions report. | M | MVP |
| FR-FIN-04 | Payouts and reconciliation can be exported to CSV for accounting. | M | MVP |

## FR-NOT: Notifications (new)

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-NOT-01 | Notifications per `NOTIFICATIONS_MATRIX.md` via email and in-app. | M | MVP |
| FR-NOT-02 | Versioned templates per event, channel and locale. | M | MVP |
| FR-NOT-03 | Users can mute non-action notifications per channel. | S | MVP |
| FR-NOT-04 | SMS (DLT) and WhatsApp channels. | S | DEFERRED |

## FR-ADM: Admin console

| ID | Requirement | Pri | MVP |
|---|---|---|---|
| FR-ADM-01 | Manage labs, sites, scopes, accreditation status, claims, KYC, bank verification and lab users. | M | MVP |
| FR-ADM-02 | Live ops board: bookings by state, SLA breaches, overdue drops, pending approvals, unmatched samples. | M | MVP |
| FR-ADM-03 | Configure SLA timers, windows, grace periods, cancellation and no-show fees, and fee rules (zero). | M | MVP* (fees fixed at 0) |
| FR-ADM-04 | Payouts, reconciliation, accounting exports. | M | MVP |
| FR-ADM-05 | A full audit log of state changes, maker submissions and checker approvals. | M | MVP |
| FR-ADM-06 | Lead management for "Request a lab". | S | MVP |
| FR-ADM-07 | Ops can create a booking on behalf of a customer, recorded as such. | C | MVP |
