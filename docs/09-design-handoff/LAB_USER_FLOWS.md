# Lab user flows (Maker and Checker)

## L1. Claim and onboard (Checker): D
Find the lab by certificate no. → OTP to the NABL-registered email (masked) → or a manual letterhead upload → claim pending/approved → **Onboarding checklist** (bookability reasons shown live): KYC docs → bank account (step-up MFA) → users (invite at least one Maker; Checkers ≠ Makers) → receiving hours and closures → slot templates → retention per discipline → price list (bulk import wizard: upload → map → preview → publish) → "Your site is bookable" 🎉.

## L2. Inbox and decisions (Checker decides, Maker views): D, M
Inbox tabs: **New requests** (SLA countdown) · Waiting for customer · Paid, expecting drop · Overdue drops. Request detail: TRF, lines, sample requirements, slot → **Accept** / **Reject** (reason list + text) / **Counter** (new slot and/or extra quantity, **no price field**).

## L3. Receive a sample (Maker at the counter): **M first**
Scan (camera) → booking card (customer org, item, batch, expected package count, TRF) → scan each package (n of N progress) → for each check: item, batch, quantity, seal (toggle chips) → condition → photos → discrepancy? (reason) → submit for approval. Wrong-site QR: blocking error with the intended lab's name and address. Unreadable QR: short-code entry + photo. Offline: queue indicator, "will sync".

## L4. Approve receipt (Checker): D, M
Approvals queue → receipt record (scans, photos, flags, maker name) → **Approve** (enter or auto Lab Sample ID) / **Confirm discrepancy → hold** (reason + notes) / **Reject as unfit**. Blocked state if the viewer is the Maker ("You recorded this receipt. Another Checker must approve it.").

## L5. Testing (Maker): D
Received list → Start testing (set the expected report date) → update the ETA with a reason → per-line status (for partial cancellations).

## L6. Upload a report (Maker): D (M for the bind scan)
Upload PDF (scan status) → enter report no., ULR, issue date → per-parameter conformity (optional) → **bind**: scan the package QR (or pick from the matched list) → validation (parameters ⊆ booked, ULR unique) → submit → "Preparing stamped copy for review".

## L7. Review and publish a report (Checker): D
Review queue → side by side: stamped PDF preview + booking lines + bound sample → **Publish** (MFA step-up dialog) / **Return** (comments required). Amendment variant: shows the previous version and the reason.

## L8. Amendment (Maker → Checker): D
Released report → "Create amendment" → reason → upload → bind → submit → Checker publishes → the customer is notified. The old version shows as superseded.

## L9. Catalogue and capacity (Checker): D
Price lists (draft/published/history, diff), scope lines (temporarily unavailable toggle), slots calendar (close or adjust), closures, hours, instructions, retention, users and sites, map-pin correction proposal.

## L10. Disputes and settlements (Checker): D
Dispute inbox → respond with evidence. Settlement advice list (payout status).

## Dashboards
**Maker:** Drops expected today · Scan now (big CTA) · Returned reports · Tests in progress with due dates.
**Checker:** Needs your approval (receipts, reports, reprints) with SLA · New requests · Onboarding gaps · Disputes.
