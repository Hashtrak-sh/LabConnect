# Acceptance criteria

**Status:** DRAFT. These criteria become Playwright (E2E) and API test cases. IDs: `AC-<module>-nn`. The FS amendment's A.10 criteria are covered by AC-LOG and AC-RPT.

## MVP release criteria (summary)
The MVP is functionally complete when every AC below passes in UAT, plus:
- The end-to-end happy path (AC-E2E-01) passes with real ICICI sandbox payments.
- The permission-matrix suite and the tenant-isolation suite are 100% green.
- No open Critical or High security findings.
- NFR load targets are met on UAT-sized data.

## AC-E2E: End-to-end
**AC-E2E-01 Happy path.** *Given* a bookable lab site with a Maker M and Checker C, and a customer with Requester R and Finance F, *when* R searches, books 2 parameters, C accepts, F pays, R downloads the labels, M scans both packages and records receipt, C approves, M starts testing, M uploads and binds the report, and C publishes it with MFA, *then* the booking is REPORT_RELEASED, R can download the stamped PDF, the public verification shows "Genuine, current", and 72 h later (simulated clock) with no dispute, the booking is COMPLETED and a payout record is ELIGIBLE or RELEASED.

## AC-MDM: Master data
- **AC-MDM-01.** *Given* a CSV with 100 rows, including 3 duplicate certificates and 2 unknown disciplines, *when* a Data Steward uploads it with a mapping template, *then* the preview shows 3 conflicts and 2 errors, and nothing is written to published tables.
- **AC-MDM-02.** *Given* a change set prepared by steward S1, *when* S1 tries to approve it, *then* the API returns `403 FOUR_EYES_REQUIRED`.
- **AC-MDM-03.** *Given* an approved change set, *when* it's published, *then* all changes become effective atomically, a new version exists for each changed record, and the search index reflects them within 60 s.
- **AC-MDM-04.** *Given* a published change that alters a scope line's method, *when* an existing booking that used that line is viewed, *then* the booking still shows the original method (snapshot).

## AC-DIS: Discovery
- **AC-DIS-01.** An anonymous user searching "tensile" near pincode 201310, radius 25 km, sees only sites within 25 km, sorted by distance, each with matched scope lines.
- **AC-DIS-02.** "TS" returns the same top results as "tensile strength" (synonyms).
- **AC-DIS-03.** A calibration lab appears with the badge "Booking not yet available" and has no Book button.
- **AC-DIS-04.** An unclaimed lab shows "Listed" and the "Request this lab" action, which creates a lead.
- **AC-DIS-05.** A site whose accreditation is set to SUSPENDED disappears from results within 60 s of publication.

## AC-BKG: Booking
- **AC-BKG-01.** Selecting a parameter that isn't in the site's active scope is impossible in the UI and rejected by the API (`422 SCOPE_LINE_NOT_BOOKABLE`).
- **AC-BKG-02.** Two simultaneous bookings for a slot with 1 remaining capacity: exactly one succeeds. The other gets `409 SLOT_UNAVAILABLE`.
- **AC-BKG-03.** The estimate equals the sum of the line prices plus prep plus GST, computed in paise, with no platform fee.
- **AC-BKG-04.** Changing the lab's price list after submission doesn't change the booking's lines or total.
- **AC-BKG-05.** An 11th open REQUESTED booking for the same org is rejected (`429 OPEN_BOOKING_LIMIT`).

## AC-LAB: Lab decision
- **AC-LAB-01.** A Maker calling the decision endpoint gets `403`.
- **AC-LAB-02.** Rejecting without a reason code gets `422`.
- **AC-LAB-03.** A counter containing a price change is rejected (`422 COUNTER_FIELD_NOT_ALLOWED`).
- **AC-LAB-04.** With no decision, reminders fire at 50% and 90%, and the booking is EXPIRED at SLA + 4 h (simulated clock).
- **AC-LAB-05.** A site whose only Checker is deactivated becomes non-bookable, and existing REQUESTED bookings stay visible to Ops.

## AC-PAY: Payment
- **AC-PAY-01.** A webhook with an invalid signature is rejected and recorded, and the booking isn't changed.
- **AC-PAY-02.** The same webhook event delivered twice is processed once.
- **AC-PAY-03.** A second successful capture for a PAID booking creates an automatic refund.
- **AC-PAY-04.** An unpaid booking becomes EXPIRED_UNPAID at 24 h, and the slot capacity is released.
- **AC-PAY-05.** Each successful payment produces balanced ledger journals (debits = credits) and a payment receipt document.

## AC-LOG: Handover
- **AC-LOG-01.** After payment, the customer sees the address, hours, contact, instructions, deadline, one booking QR, and N package QRs, where N is the declared count.
- **AC-LOG-02.** The labels PDF can be downloaded by the customer and by the lab Maker.
- **AC-LOG-03.** A package QR scanned at a different lab site is refused, and the response names the intended site.
- **AC-LOG-04.** A QR with a tampered signature is refused, and a custody event `SCAN_REJECTED` is written.
- **AC-LOG-05.** With no drop by deadline + grace, the booking is NO_SHOW and the refund minus the no-show fee is initiated.

## AC-RPT: Receipt and report
- **AC-RPT-01.** A Checker approving a receipt record they created is impossible: API `403 SELF_APPROVAL_FORBIDDEN`, and the DB check fails.
- **AC-RPT-02.** Approving a receipt sets the Lab Sample ID on each package, `retain_until`, and RECEIVED.
- **AC-RPT-03.** Confirming a discrepancy moves the booking to ON_HOLD, and the customer can choose proceed, replace or cancel.
- **AC-RPT-04.** A report with a parameter that isn't booked can't be submitted.
- **AC-RPT-05.** A duplicate ULR is rejected.
- **AC-RPT-06.** Publishing without MFA in the last 5 minutes returns `401 STEP_UP_REQUIRED`.
- **AC-RPT-07.** The released report has a stamped copy with a QR. The public verification page shows the report number, lab, issue date and status, and never exposes a download.
- **AC-RPT-08.** A PDF that has been altered by one byte shows "Does not match" in the browser hash comparison.
- **AC-RPT-09.** After an amendment, the v1 QR shows "Superseded by v2".
- **AC-RPT-10.** A share link stops working after it's revoked or expires.
- **AC-RPT-11.** An infected upload is quarantined and can't be submitted.

## AC-SUP: Disputes
- **AC-SUP-01.** A dispute raised within 72 h places a payout hold. One raised at 73 h is rejected unless its type is billing.
- **AC-SUP-02.** An Ops decision with a partial refund creates a refund, a credit note, ledger entries and an immutable decision record.

## AC-SEC: Security and isolation
- **AC-SEC-01.** A user of customer org A requesting booking B of org B gets `404` (no existence leak).
- **AC-SEC-02.** Every endpoint × role combination matches `ROLES_AND_PERMISSIONS.md` (generated suite).
- **AC-SEC-03.** The audit log can't be updated or deleted by the application DB role.
- **AC-SEC-04.** OTP verification locks out after 5 failed attempts, and requesting an OTP is rate-limited.
