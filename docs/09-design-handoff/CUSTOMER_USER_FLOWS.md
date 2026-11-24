# Customer user flows

Roles: Customer Admin, Requester, Finance (and an individual = single-member org). Device: D = desktop, M = mobile.

## C1. Discover (public, no login): D, M
Home/search → enter test (typeahead: parameter, product, standard, lab) + location (device, pincode, saved site) + radius → results (list + map synced) with filters → **Lab site page** (accreditation card with as-of date and NABL link, scope tree with search, prices, sample requirements, receiving hours, map, ratings) → *Book* (if bookable) or *Request this lab* (if listed) → sign-in prompt only when booking.
Edge screens: no results (widen radius, related parameters, request a lab), calibration lab ("booking coming soon").

## C2. Sign up and organisation setup: D, M
Email → OTP → "Booking as an individual or an organisation?" → org details (legal name, segment, GSTIN optional for individuals) → default site (address, geocode) → (Admin) invite users with roles → (Finance) MFA enrolment.

## C3. Create a booking: D, M
Select parameters from the scope (pre-selected matches) → TRF step 1: item, grade, batch/lot, mfg date → step 2: sample quantity per parameter (shown from the price list), package count (suggested), condition, standard, special instructions, conformity + decision rule → step 3: report name and address, GSTIN, attachments → step 4: drop date and slot (only valid slots) → review: price summary (estimate), lab decision SLA → submit → confirmation with the booking number and "Waiting for lab (decides by …)".
Duplicate warning modal if the same item, batch and parameters were booked in the last 7 days.

## C4. Respond to the lab: D, M
Accepted → NextActionCard "Pay ₹X by …". Countered → compare original vs proposed slot or quantity → accept or decline. Rejected or expired → reason + top 3 alternatives → one-tap rebook (TRF copied).

## C5. Pay: D, M
Pay (Admin or Finance, or Requester if allowed) → gateway checkout (opaque) → return page "Confirming payment…" (polls) → success: receipt download + **handover page**.

## C6. Hand over (self-drop): D, M
Handover page: lab address + map + "Open in maps", receiving hours, contact, instructions, drop deadline, booking QR, package QRs → print labels (A4 / thermal) → "At the lab? Show this QR" mobile view (large QR, brightness hint).

## C7. Track: D, M
Booking detail: status badge, NextActionCard, timeline (received by Maker → approved by Checker…), expected report date. ON_HOLD: reason + photos → choose **Proceed as-is** (deviation noted on the report) / **Bring replacement** / **Cancel** within 24 h.

## C8. Report: D, M
Report released → download (stamped PDF) → share link (expiry, revoke) → custody trail download → rate the lab → raise a dispute (within 72 h, countdown shown).

## C9. Disputes: D, M
Type → description → evidence upload → status thread → decision and refund outcome.

## C10. Finance views: D
Payments, receipts, invoices, credit and refund notes per booking and org-wide, with filters and exports.

## C11. Verify a report (anyone): M
Scan the QR → `/v/<code>` → result state + metadata → "Compare a copy" (local hash).

## Dashboards
**Requester:** Needs your action (pay, respond to counter, hold decision, drop due) · In progress · Recent reports.
**Admin:** the above for the whole org + users and sites.
**Finance:** Payments due · Recent invoices and receipts · Refunds.
