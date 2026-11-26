# D-03 review of the design run (D-02)

**Status:** Review for human decision. It does not approve the designs and does not close D-03; the product owner approves.
**Date:** 25 Nov 2026. **Scope:** all 43 HTML boards in `designs/` (40 screens and sheets, the cover and the stage boards), `lc.css` and `canvas.json`, read in full.
**Method:** every file was read as static HTML. Small scripts kept outside the repo extracted text, counted classes and elements, and computed contrast ratios from the token values (WCAG relative-luminance formula). Nothing was rendered in a browser (the boards load a `support.js` runtime that is not in the repo). Whatever a screen's text says about its own behaviour is treated as data, not as fact.
**Standard checked against:** the documents ask for WCAG **2.1** AA (`DESIGN_BRIEF.md` §5, master prompt). The request for this review named 2.2 AA, so the extra 2.2 criteria are reported separately and marked "2.2 only" (see OQ-75).

**Decisions since the review (26 Nov 2026, product owner, for the MVP, can be reopened):** OQ-69 to OQ-75 are decided as their recorded defaults: open slots only with no counts (DR-06); the full desk number for the paying customer (DR-17); overall rating average and count only (DR-16); nothing beyond the result for a revoked report, with legal review of the wording still to come (DR-05); no booking-level short code and no "Send to my phone" (DR-18); sign-in screens for the MFA roles are added to the design scope (DR-39); WCAG 2.1 AA is the acceptance bar, with 2.2 items fixed where cheap (DR-30). The designs are corrected to match; the contract does not change. D-03 itself is not approved by this note.

## 1. Verdict

The run is fit to build from for the foundations: the token sheet, the control and booking components, the public search, lab and verification pages, the C3–C7 booking journey, the Maker scanner, receipt approval and the dashboards. It follows the scope rules (no excluded feature appears), keeps status as label plus icon plus tone, and shows Maker/Checker separation, the MFA step-up and the limited verification page in the way the documents ask. It is **not** fit to build from for the lab onboarding and catalogue flows (L1, L5, L8, L9, L10) and most of the admin console (A1, A3, A5–A7), where only one or two boards exist per flow, and eight booking states have no customer detail screen (five have no customer screen at all).

There are no Blockers and 13 Major findings. Fix first: (1) the screens that contradict the API contract or the permission matrix (DR-04 payout release under an Ops identity, DR-05 revoked page, DR-06 slot capacity counts); (2) the missing safety states at report publish (DR-01 to DR-03); (3) the 44 px touch targets (DR-12); and (4) before D-04 starts, replace the 400 hard-coded colour literals with tokens so the later brand swap is a one-place change (DR-13).

## 2. Findings

Severity: **Blocker** = would break a hard rule if built as drawn. **Major** = contradicts a requirement or contract, or a required screen or state is missing. **Minor** = polish or a decision to record. Each finding was checked by re-opening the file (Blocker/Major re-verified a second time at the end).

### Major

| ID | Severity | Screen file | What is wrong (evidence) | Contradicts | Suggested fix |
|---|---|---|---|---|---|
| DR-01 | Major | `D3-ReviewReport-1280.dc.html` | Report publish has no "blocked (self)" state. The page shows "Uploaded by Sanjay Kumar (Maker)" and viewer "Dr. Anita Mehta / Checker", and its script has only the modes `mfa`, `return`, `none`. `D2-ApproveReceipt` has the `viewerIsMaker` blocked variant; D3 does not. | CD-23; BOOKING_STATE_MACHINE T-21 (checker ≠ maker); UX_PRINCIPLES 8; COMPONENT_SPECIFICATION ApprovalPanel; ROLES note 6 | Add the same blocked variant to D3: disabled Publish plus the explanation, as in D2. Apply the OQ-59 decision to both. |
| DR-02 | Major | `D3-ReviewReport-1280.dc.html`, `F6-Lab-Report-Upload-1280.dc.html` | The stamp job has no states. L6 says submit shows "Preparing stamped copy for review"; that text is in no file. D3 shows a finished stamped preview and an enabled "Publish report" button. T-21 refuses publish until `stamped_file_id` is set, and R-12 says stamping can fail. | LAB_USER_FLOWS L6; BOOKING_STATE_MACHINE T-19, T-21; R-12 | Draw: submitted and stamping (F6), stamp pending (D3, Publish disabled with a reason), stamp failed (with the appended-page fallback wording). |
| DR-03 | Major | `D3-ReviewReport-1280.dc.html`, `A3-Booking-components.dc.html` | MFA step-up has only the happy path. D3 opens straight into the dialog with "48102_" typed. No wrong code, expired code, lock-out, "MFA not enrolled" or "step-up expired during publish" state exists in D3, A3 (MfaPrompt) or anywhere else. | COMPONENT_SPECIFICATION MfaPrompt; DESIGN_BRIEF §4 item 4 (error states); CD-25 | Add error, expired and not-enrolled variants of MfaPrompt and use them in D3, bank-detail change and payout release. |
| DR-04 | Major | `F9-Admin-Disputes-Payouts-1280.dc.html` | The session is "Rohit Verma / Platform Ops", yet the page carries the payout batch with a primary "Release 3 payouts…" button, a UTR column and "Release asks for your authenticator code". Release is `PLATFORM_FINANCE` only; Ops can only place holds. The button also says 3 payouts while only 2 rows are ticked (2 "Eligible" rows). | ROLES_AND_PERMISSIONS matrix ("Payout hold / release"), RR-5; OQ-57(a); ADMIN_USER_FLOWS A5 vs A6 | Split into an Ops dispute page and a Finance payouts page under a `PLATFORM_FINANCE` identity. Ops sees holds only. Fix the count. |
| DR-05 | Major | `B3-Verify-360-states.dc.html` (state 4 "Revoked") | The revoked page shows Report no. `NAS/R/26/0418`, Issued 18 Oct 2026 and Lab "Narmada, Faridabad". In the contract `ReportVerification.report` is `null` for `REVOKED` and `NOT_FOUND`, so none of these fields exist. | `packages/api-contract/.../public-reports.yaml` (`ReportVerification`); QR_AND_VERIFICATION §5 | Remove the three fields, or raise it (OQ-72) and change the contract first. |
| DR-06 | Major | `C3-Booking-360-strip.dc.html` (C3.5) | The slot step shows "4 places left", "7 places left", "2 places left" and a "Full" row. `PublicSlot` carries no capacity ("Capacity figures are not published; a slot is listed only while it is open and has capacity left"), and the public deny-list test forbids capacity counts. A full slot is never returned. | `public-lab-sites.yaml` (`PublicSlot`, file header); TENANT_ISOLATION public boundary | Show open slots only, without counts or a "Full" row. If scarcity is wanted, decide it as a contract change (OQ-69). |
| DR-07 | Major | `C4-C5-360-strip`, `C7-Detail-*`, `A1-Tokens` | Customer-side booking states without a screen. None at all: `EXPIRED`, `EXPIRED_UNPAID`, `NO_SHOW`, `CANCELLED`, `COMPLETED` (badges in A1, a count in E4 and a table badge in E1 only). Only a table badge or a hand-off, no detail view: `SAMPLE_RECORDED`, `REPORT_IN_REVIEW`, `DISPUTED`. Payment has no failed, cancelled-at-gateway or timed-out state (F3 shows only an "Attempt failed" table row). | BOOKING_STATE_MACHINE §1; CUSTOMER_USER_FLOWS C4, C5, C7; DESIGN_BRIEF §4 item 4 | Add a booking detail variant per state (reuse NextActionCard), a payment-failed return page, and the cancel dialog with the refund amount. |
| DR-08 | Major | `E4-Ops-1280`, `F8`, `F9`, `F10` | Admin flows are mostly undrawn. A1: tiles only; every tile links to `#`; no drill-down list, no booking detail with the metadata-only report section, no cancel-with-reason; "Bookings by state" lists 7 of 18 states. A2: no taxonomy browser, change-set inbox or version history. A3: no upload, mapping, progress or row-resolve screen. A4: KYC, bank, lab proposals and lab users are tab labels only. A5: no queue. A6: no refund approval, holds, reconciliation, exports or document search. A7: no notification templates, platform users, audit-log search or leads. | ADMIN_USER_FLOWS A1–A7 | Design the missing boards before D-04/I-phase work on admin. Order by the build order in TASK_TRACKER. |
| DR-09 | Major | `F4`, `F5`, `F6`, `F7`, `E2` | Lab flows are mostly undrawn. L1: KYC upload, bank account with step-up MFA, users invite, hours and closures, slot templates, retention, price-list import wizard and the "site is bookable" end state have no screen (F4 is the checklist only). L5: no Start-testing screen with the expected report date, no ETA change with reason, no per-line status update. L8: only a text note in F6. L9: scope-line toggle, closures, hours, instructions and retention are tab labels only; slots are a read-only grid. L10: no dispute response and no settlement list. | LAB_USER_FLOWS L1, L5, L8, L9, L10 | As DR-08. |
| DR-10 | Major | `D2`, `E3`, `C6-Handover-1280`, `A3` | Label reprint has no screen. D2 has a tab "Label reprints 1" and E3 a row "Reprint · Review" (link `#`), but no request or approval view exists. The Maker's counter label printing (CD-12) is only the QrLabelPreview component. C6 says "Lost one? Ask the lab for a reprint" with no way to ask. | QR_AND_VERIFICATION §2; EDGE_CASES EC-26; ROLES matrix "Approve label reprint"; CD-12; OQ-50 | Add the reprint request (customer and Maker), the Checker approval and the Maker print view. |
| DR-11 | Major | `F2`, `F3`, `E1-*` | Customer flows C8–C10 and the Admin role are only partly drawn. C8: no share-link create form (expiry, note), no amendment or superseded view for the customer, no 360 or 768 view. C9: no decision and refund outcome (the thread stops at "Awaiting lab"). C10: tabs "Invoices & receipts" and "Credit & refund notes" have no content. Dashboards: no Customer Admin variant (users, sites, the `requester_can_pay` setting) and no Finance dashboard. | CUSTOMER_USER_FLOWS C8, C9, C10, Dashboards | Add the missing boards and states. |
| DR-12 | Major | 360 boards (see §4.2) | Touch targets below the stated 44 × 44 px at 360: 7 buttons at 32 px (`btn-sm`: B1 map card "Book", C4.3 "Rebook here" ×2, C6.1 "Open in maps" and "Call desk", E1-360 "Download", **E2 Maker "Start"**) and 13 at 40 px (the default `.btn`: "Add another test", "Attach a file", "Decline", "Print labels", "Documents · custody trail", "Fix and resubmit", "Send invite", "Open in maps", "Only 2 arrived · continue"). The default `.btn` is 40 px in `lc.css`. | RESPONSIVE_DESIGN_GUIDELINES (touch targets ≥ 44 × 44); UX_PRINCIPLES 9 | Make 44 px the default at < 768 and drop `btn-sm` on mobile. |
| DR-13 | Major | all boards, `lc.css` | The brand swap is not confined to `--qci-*`. The README and cover say "change only the `--qci-*` primitives". In fact the HTML has **408** literal hex values in `style="…"` attributes (398 equal a token value) and only 44 `var()` uses (43 of them `--font-sans`, one `--qci-black`): none uses a semantic colour token. 100 of the literals are brand-blue values (`#1F6FA8` ×34, `#13476D` ×21, `#D6E8F5` ×19, `#EEF5FB` ×13, `#185A8A` ×4, `#1A1A1A` ×3 and others) in 29 of 43 files. In `lc.css`, 11 component rules use `--qci-*` primitives directly (e.g. `.chip.on`, `.nav a.on`, `.tabs span.on`, `.step.on`, `.b-brand`) and `.cluster` hard-codes `rgba(31,111,168,.18)`. | DESIGN_SYSTEM §Status ("semantic tokens only in components"); designs/README | D-04 must tokenise before copying. Add `--color-brand-primary-active`, `-on-tint` and `-tint-border` semantic tokens for the primitive uses. |

### Minor

| ID | Severity | Screen file | What is wrong (evidence) | Contradicts | Suggested fix |
|---|---|---|---|---|---|
| DR-14 | Minor | `E3-Checker-1280`, `D2-ApproveReceipt-1280` | The self-record case is built into the main flow. E3's queue has a row "From: **You** … Another Checker". In D2's blocked variant the header reads "Sanjay Kumar / Checker" while the record says "Sanjay Kumar (Maker)", i.e. one user holding both roles. A user holds exactly one lab role. | CD-22, RR-2; OQ-59 | Decide OQ-59. If the state stays, show it only as the "role changed after you recorded this" case, with copy that says so, and do not show the viewer as "Checker". |
| DR-15 | Minor | `F6-Lab-Report-Upload-1280` | ULR error: "This ULR is already used on LC-2611-0004633." ULR is unique across the platform, so the message could name another lab's booking. | BR-062; CLAUDE.md (never show another organisation's data); OQ-52 | Say only "This ULR is already used", and name the booking only when it belongs to the same organisation. |
| DR-16 | Minor | `B2-Lab-1280`, `B2-Lab-360`, `F2-Report-Dispute-1280` | Ratings. B2 shows "TAT 4.4 · Communication 4.7" for the public site; `PublicRating` has only `average` and `count`. F2 says the comment is "shown publicly without your name"; the contract says "Individual ratings are not public" and `isPublic` is set by the platform. | `public-lab-sites.yaml` (`PublicRating`); `bookings.yaml` (`BookingRating`) | Show the overall average and count only, and reword the F2 hint (OQ-71). |
| DR-17 | Minor | `C6-Handover-1280`, `C6-Handover-360-strip` | The desk phone is masked ("+91 124 ••• ••48") next to a "Call desk" button. The contract returns the full number to the paying customer. A masked number cannot be dialled. | UX_PRINCIPLES 11; `common.yaml` (`ContactPerson`) | Show the full number after payment (OQ-70). Keep masking for Ops and any in-app chat. |
| DR-18 | Minor | `C6-Handover-1280`, `C6-Handover-360-strip` | A booking-level short code "LC4821" is shown for the counter. Short codes exist per package only (6 characters, Crockford base32). "Send to my phone" has no endpoint and no channel (SMS is excluded). The sample package code "W3C-9LD" contains `L`, which Crockford base32 does not use. | QR_AND_VERIFICATION §2; SCHEMA_SPECIFICATION `short_code`; `BookingHandover` | Remove the booking short code or decide it (OQ-73). Remove "Send to my phone" unless email is meant. Fix the sample code. |
| DR-19 | Minor | `C7-Hold-1280.dc.html` | The "Proceed as is" option says "No refund." No document states a refund rule for proceed. EC-34 also allows "reduce lines", which is not offered. | EDGE_CASES EC-34; BUSINESS_RULES BR-046 to BR-047 | Remove "No refund" until a rule exists; confirm the option list with the API enum (`PROCEED/REPLACE/CANCEL`). |
| DR-20 | Minor | `F3-Finance-1280`, `C7-Detail-1280`, `F2-Report-Dispute-1280` | The tax invoice is shown as issued by the lab, with "CGST 9% + SGST 9%" and the line "Tax invoices are issued by the lab". Who issues it is open. | OQ-08; CD-16 | Keep the layout, but mark the issuer and tax split as provisional until OQ-08 closes. |
| DR-21 | Minor | `F3-Finance-1280.dc.html` | Text "LabConnect charges no platform fee." The README says "`platformFee` is never displayed" and platform fees are out of scope in the UI. | designs/README (Decisions); DESIGN_BRIEF §5 | Remove the sentence. |
| DR-22 | Minor | `C3-Review-1280.dc.html` | Checkbox "I accept the lab's terms of testing". No requirement defines lab terms; consent and terms text wait on legal review. | No requirement; OQ-04 (terms and consent text) | Replace with the terms/consent text that OQ-04 produces, or remove for now. |
| DR-23 | Minor | `E1-Customer-360/1280`, `F3`, `F5`, `E2-Maker-360`, `C4-C5-360-strip`, `D1`, `C7-Detail-1280` | Times without "IST": 43 of 114 times in the boards, e.g. "by 26 Nov, 4 PM", "Lab decides by 5:00 PM", "Due by 4:30 PM", "Slot Thu 26 Nov, 10 AM", custody "10:31 AM". E2 writes "10–12 AM". Money mixes "₹3,540" and "₹3,540.00" without a rule. | UX_PRINCIPLES 7; DESIGN_BRIEF §5 | Add "IST" to every deadline; state one money rule (decimals always, or only when non-zero). |
| DR-24 | Minor | `B1-Search-1280/768/360` | No `<h1>` on the search pages and no `<main>` landmark (the 1280 board has header, nav, footer only). 29 of 43 boards have no `<main>`. | WCAG 1.3.1, 2.4.1, 2.4.6 | Give the results page an h1 ("Labs for …") and a main landmark. |
| DR-25 | Minor | all boards | The markup is illustrative and must not be copied as the accessibility reference: all 73 `.input` elements are `div`s (no `input`, `select`, `textarea`); 51 `label for` attributes point at non-controls; `aria-invalid` is on 4 divs; 79 `th` have no `scope` and 20 tables no caption; tabs are `span`s (7 `role="tab"`, 2 `tablist`, 0 `tabpanel`); error text is tied to its field in 2 places only (`aria-describedby`); no skip link. | WCAG 1.3.1, 3.3.1, 4.1.2 | Build with real controls (shadcn/Radix). Add this to the D-04 acceptance list. |
| DR-26 | Minor | `lc.css` | Focus styling is defined for `.btn` and `.input` only. A1 says "every focusable element" gets the 3 px ring. Links, nav items, chips, tabs, segmented items, switches and checkbox rows have no rule (browser default would apply). | WCAG 2.4.7; DESIGN_SYSTEM (focus ring) | Define `:focus-visible` once on the base elements. |
| DR-27 | Minor | `lc.css` (`.switch`), `A2`, `C3-Booking-1280` | The switch OFF track is `gray-400` on white: **2.54:1**, below the 3:1 needed for a component boundary. | WCAG 1.4.11 | Use `--color-border-strong` (gray-500, 4.83:1) for the off track. |
| DR-28 | Minor | `lc.css` (`.btn`, `.badge`) | Fixed `height` with `white-space:nowrap` (button 40 px, badge 24 px). Text cannot wrap, so a 30–40 % longer Hindi label, 200 % zoom or text-spacing overrides will clip or overflow (e.g. "Counter-offer · your decision", "Accept and continue to payment"). | DESIGN_BRIEF §5; RESPONSIVE (200 % zoom); WCAG 1.4.4, 1.4.12 | Use `min-height` and allow wrapping at < 768. |
| DR-29 | Minor | all boards | Type is smaller than the system says. `t-sm` (14 px) is used 591 times and `t-xs` (12 px) 358 times against 76 for `t-base`; inputs are 15 px; there are 11 px, 10 px and 9 px labels (mobile bottom-nav labels, map attribution, report stamp preview). Instructions such as D1 "Tap each check…" and C5 "Don't close this page or pay again" are 14 px. | DESIGN_SYSTEM §2 ("Body is 16 px minimum"); iOS zooms inputs under 16 px | Body and instruction text at 16 px; keep 14 px for dense tables and captions; input text 16 px. |
| DR-30 | Minor | `F1-Signup-360-strip` (C2.5), `F10-Admin-Onboarding-Config-1280` | Drag-only interaction: "Drag the pin if it's not right." and "Drag B to adjust before approving." No single-pointer alternative (tap to place, or lat/long fields). **2.2 only** (SC 2.5.7). | WCAG 2.2 SC 2.5.7 | Add tap-to-place and a keyboard nudge. |
| DR-31 | Minor | `F10-Admin-Onboarding-Config-1280.dc.html` | The viewer is "Rohit Verma / Platform Ops", but the page shows the configuration table labelled "Platform Admin only" and the break-glass queue (approval is `PLATFORM_ADMIN`). | ROLES matrix (Configure SLAs; break-glass); DESIGN_BRIEF §5 ("never show data a role can't access") | Show these two cards only in a Platform Admin variant. |
| DR-32 | Minor | `F5-Lab-Inbox-1280.dc.html` | Only the Checker view. A Maker may view the inbox but not decide; no read-only or permission-denied variant exists. The file has no mention of the Maker. | ROLES matrix "View lab inbox"; LAB_USER_FLOWS L2 | Add the Maker variant (actions replaced by "Only a Checker can decide"). |
| DR-33 | Minor | `A3`, `C7-Hold-1280`, `E1-Customer-1280/360` | Status tones drift from the mapping. ON_HOLD is a warning badge inside a `nac danger` card (A3, C7-Hold, E1 ×2). A suspended accreditation is a neutral grey badge (A3 LabResultCard) although it makes a lab unbookable. Payment, dispute, report-version and accreditation statuses use tones that DESIGN_SYSTEM does not define. Map pins separate bookable from listed by fill colour only (no legend). | DESIGN_SYSTEM §1 status mapping | Add the other status groups to the mapping; use warning for a suspended accreditation; pick one tone for ON_HOLD cards. |
| DR-34 | Minor | several | Naming and sample-data drift. The same lab appears as "Vasundhara Testing Laboratories", "Vasundhara Testing Labs" and "Vasundhara, Gurugram"; D1's wrong-site address "Plot 6, Sector 24, Faridabad" is in the same sector and city as Narmada Analytical on B1; REQUESTED is "Requested" in A1 but "Waiting for lab" in C3.8; "Counter-offer" and "The lab proposed a change" both name one thing; the verification code is `K3X9-P7QM-2TRA` on B3 and `K3X9-P7QM` on the D3 stamp (QR doc example has 16 characters). | CONFIRMED_DECISIONS; GLOSSARY; DESIGN_SYSTEM §1 | Align labels to the A1 mapping and one lab name. |
| DR-35 | Minor | `A1`–`A4` vs screens | Components used on screens but in neither the component sheets nor COMPONENT_SPECIFICATION: tabs, stepper, side navigation, bottom navigation, breadcrumb, dialog and bottom sheet, radio card, onboarding checklist row, slot-grid calendar, dispute thread, star-rating input, stat tile, share-link table, selectable payout table. | COMPONENT_SPECIFICATION | Add them to the component specification before D-04. |
| DR-36 | Minor | several | Responsive and prototype items not drawn: the filter sheet (B1 note says filters move into one), the 768 map view, the "best on a larger screen" notice for admin < 1024, print stylesheets (labels, custody trail; C6.2 shows an A4 preview only), 768 or 1280 views of C2 and of the C3 item, report, slot and confirmation steps, and 360 views of L2, L4 and C8. The J1 prototype skips steps: C4-Counter "Accept and continue to payment" links to C6 (Handover), skipping pay. The brief also asks for i18n keys and validation messages per screen; `canvas.json` notes carry API fields only. | RESPONSIVE_DESIGN_GUIDELINES; DESIGN_BRIEF §4 items 3, 5, 6 | Add or schedule; record i18n keys in D-04. |
| DR-37 | Minor | `B3-Verify-*` | Verification page details. "NABL certificate TC-10482 · valid" does not say "as of the issue date" (the contract field is the status as of the issue date). No state for the 30/min rate limit, and none for a chosen file that is not a PDF or is too large. | QR_AND_VERIFICATION §5; `ReportVerification` | Label the date basis; add a rate-limit state and a bad-file message. |
| DR-38 | Minor | `D1`, `D2`, `F5`, `F10` | Reason capture is not drawn where required. D2 says "Hold and reject need a reason" but shows no reason form (D3 does for Return). F5 has "Reject…" with no reason-list dialog. D1 L3.6 has a "discrepancy" switch and no reason entry. D1 handles only the wrong-site rejection; the voided-label, already-received and wrong-state rejections, and a failed offline sync, have no state. | LAB_USER_FLOWS L2, L3, L4; QR_AND_VERIFICATION §3; COMPONENT_SPECIFICATION CameraScanner (rejected, reason) | Add the reason forms and the other scan outcomes. |
| DR-39 | Minor | none (flow gap) | There is no sign-in screen for roles that need MFA at sign-in (Lab Checker, Customer Finance, all platform roles): TOTP challenge, "enrol first", session expired, access denied after a role change. Only Finance enrolment (F1 C2.6) exists. | CD-25 | Add to the design scope (OQ-74). |

## 3. Flow coverage matrix

Legend: **C** covered, **P** partly, **M** missing. Breakpoints are those drawn: 3 = 360 / 768 / 1280; "360" and "1280" mean only that width exists. The flow documents ask for D and M on most customer flows, and desktop only for admin.

### 3.1 Customer

| Flow step | Design file(s) | Width | Result and what is missing |
|---|---|---|---|
| C1 Search home, typeahead, location | `B1-Search-*`, `A2` (combobox) | 3 | P. No separate home page. Location shows a pincode only (device and saved site absent). No search-error state. |
| C1 Results list and map, filters | `B1-Search-1280/768/360` | 3 | P. Split view at 1280 only. The 768 map view and the filter sheet are not drawn. Loading and no-results exist at 360 only (`B4`). |
| C1 Lab site page (accreditation, scope, prices, hours, map, ratings) | `B2-Lab-*` | 3 | C. Scope is a table with a breadcrumb path rather than the ScopeTree of A4. Ratings tab content at 360 only. |
| C1 Book / Request this lab; sign-in on booking | `B2`, `B4`, `F1` | 3 / 360 | P. "Request a lab" has no form or confirmation. |
| C1 Edge: no results, calibration, listed, loading | `B4-Public-edge-states-360`, `A3`, `A4` | 360 | C at 360 only. |
| C2 Email, OTP, org or individual, org details, site, invite, Finance MFA | `F1-Signup-360-strip` | 360 | P. 360 only; no individual path past C2.3; OTP boxes show 4 digits with a "didn't match" error. |
| C3 Select parameters | `C3-Booking-360-strip` (C3.1), `B2` | 360 | P. No 1280 view of this step. |
| C3 TRF step 1 (item, grade, batch, mfg date) | C3.2 | 360 | P. No 1280 view. |
| C3 TRF step 2 (quantities, packages, condition, standard, conformity, rule) | `C3-Booking-1280`, C3.3 | 1280 / 360 | C. The 360 view omits condition, standard, instructions, specification and decision rule. |
| C3 TRF step 3 (report name, address, GSTIN, attachments) | C3.4 | 360 | P. No 1280 view. |
| C3 Slot step | C3.5 | 360 | P. Shows capacity the contract does not return (DR-06). No 1280 view. |
| C3 Review and price summary | `C3-Review-1280`, C3.6 | 1280 / 360 | C. |
| C3 Submit confirmation | C3.8 | 360 | P. No 1280 view. |
| C3 Duplicate warning | C3.7 | 360 | C at 360. |
| C3 Errors (slot taken, site no longer bookable, open-booking limit) | none | – | M. |
| C4 Accepted, NextActionCard "Pay by …" | C4.1, `A3`, `E1` | 360 | P. No 1280 detail for ACCEPTED. |
| C4 Counter-offer compare, accept or decline | `C4-Counter-1280`, C4.2 | 1280 / 360 | C. |
| C4 Rejected, reason, alternatives, rebook | C4.3 | 360 | P. Two alternatives shown (flow says three). Expired (`EXPIRED`) missing. |
| C5 Pay hand-off, confirming, success, receipt | C4-C5 strip, `C6-Handover-1280` (banner) | 360 / 1280 | P. No payment failed or timed-out state; no `EXPIRED_UNPAID` (DR-07). |
| C6 Handover page (address, map, hours, contact, deadline, QRs) | `C6-Handover-1280`, C6.1 | 1280 / 360 | C. |
| C6 Print labels (A4, thermal); "At the lab? Show this QR" | C6.2, C6.3, `C6-Handover-1280` | 1280 / 360 | C. Booking short code unsupported (DR-18). No `NO_SHOW` view. |
| C7 Booking detail, timeline, expected date | `C7-Detail-1280`, C7.1 | 1280 / 360 | P. UNDER_TEST only (DR-07). |
| C7 ON_HOLD decision (J6) | `C7-Hold-1280`, C7.2, C7.3 | 1280 / 360 | C. |
| C8 Report download, share link, custody trail, rate, dispute with countdown | `F2-Report-Dispute-1280` | 1280 | P. No create-link form, no superseded or amendment view, no 360 view. |
| C9 Dispute type, text, evidence, thread, outcome | `F2` | 1280 | P. No decision or refund outcome. |
| C10 Payments, receipts, invoices, credit and refund notes | `F3-Finance-1280` | 1280 | P. Payments tab only. |
| C11 Verify a report | `B3-Verify-*`, `A4` | 3 | C. Rate-limit and bad-file states missing (DR-37). |
| Dashboard: Requester | `E1-Customer-1280/360` | 1280 / 360 | C. |
| Dashboard: Admin, Finance | none (`F3` partly) | – | M. |

### 3.2 Lab

| Flow step | Design file(s) | Width | Result and what is missing |
|---|---|---|---|
| L1 Claim by certificate, OTP to masked email, manual letterhead | `F4` (claim box, masked email) | 1280 | P. No OTP entry screen, no letterhead upload. |
| L1 Onboarding checklist with live reasons | `F4` | 1280 | C. |
| L1 KYC, bank (step-up MFA), users, hours, slot templates, retention, import wizard, "bookable" end state | `F4` (rows only), `F7` | 1280 | M for each step's own screen (DR-09). |
| L2 Inbox tabs with SLA countdown | `F5`, `E3` | 1280 | P. Tab 1 only; no 360 view; no Maker read-only view (DR-32). |
| L2 Request detail; accept, counter (no price) | `F5` | 1280 | C. |
| L2 Reject with reason list | `F5` ("Reject…") | 1280 | M (DR-38). |
| L3 Scan, booking card, n of N, checks, condition, photos, submit | `D1-Scanner-360-strip` | 360 | C. Discrepancy reason entry missing. No 768 view. |
| L3 Wrong-site, unreadable QR, offline | D1 L3.7, L3.8 | 360 | C. Other scan rejections missing (DR-38). |
| L4 Approvals queue, receipt record, approve, hold, reject | `D2`, `E3` | 1280 | P. Reason forms missing; no 360 view; blocked state present (OQ-59). |
| L4 Label reprint approval | `E3` row only | – | M (DR-10). |
| L5 Received list, start testing, ETA change, per-line status | `E2` (list), `F6` ("Change date") | 360 / 1280 | M for the start, ETA and per-line screens (DR-09). |
| L6 Upload, scan status, details, ULR check, conformity, bind | `F6` | 1280 | C. Phone bind scan has no screen. Stamp states missing (DR-02). |
| L7 Review side by side, publish with MFA, return | `D3` | 1280 | C. Self-publish and MFA error states missing (DR-01, DR-03). |
| L7 Amendment variant | none | – | M. |
| L8 Create amendment | `F6` (text note) | – | M. |
| L9 Price lists, versions, diff | `F7` | 1280 | C. |
| L9 Scope toggle, slots calendar edit, closures, hours, instructions, retention, users and sites, pin proposal | `F7` (grid read-only, tab labels) | 1280 | P / M (DR-09). |
| L10 Dispute response, settlement list | `E3` (count), nav item | – | M. |
| Dashboard: Maker | `E2-Maker-360` | 360 | C. |
| Dashboard: Checker | `E3-Checker-1280` | 1280 | C. No 360 view of approvals. |

### 3.3 Admin (desktop only, as the flows say)

| Flow step | Design file(s) | Result and what is missing |
|---|---|---|
| A1 Tiles by state, SLA breaches, escalations | `E4` | P. Tiles link to `#`; 7 of 18 states. |
| A1 Drill-down, booking detail (metadata only), cancel / override | none | M (DR-08). The metadata-only note is text. |
| A2 Taxonomy browser, change-set inbox, version history | none | M. |
| A2 Change-set review with diff, impact, different approver | `F8` | C. |
| A3 Upload, mapping, progress | none | M. |
| A3 Preview with counts, resolve inline, error CSV | `F8` (summary), `A4` (ImportPreview) | P. No row drill-down or inline resolve. |
| A4 Claim requests (OTP / manual), approve or reject | `F10` | C. Reject reason dialog missing. |
| A4 KYC, bank accounts, lab proposals, lab users | `F10` (tab labels) | M. |
| A4 Geocode pin queue | `F10` | P. Drag only (DR-30). |
| A5 Queue by SLA | none | M. |
| A5 Dispute detail, decide, break-glass link | `F9` | P. No refund amount field for "Partial refund"; no booking timeline. |
| A6 Refund approvals, holds, reconciliation, exports, document search | none | M. |
| A6 Payout batch with step-up MFA and UTR | `F9` | P. Wrong role (DR-04). |
| A7 Config parameters with effective date | `F10` | P. Four rows; no propose-change form. |
| A7 Templates, platform users and roles, audit-log search, leads | none | M. |
| A7 Break-glass approvals | `F10` | C (wrong role view, DR-31). |

### 3.4 Booking states a screen must be able to show

| State | Customer screen | Lab or admin screen |
|---|---|---|
| REQUESTED | A3 NextActionCard, C3.8, E1 table (no detail) | F5 |
| COUNTERED | C4 | F5 (counter form) |
| ACCEPTED | C4.1, A3, E1 | – |
| PAID (transient) | C5.3 | – |
| HANDOVER_SET | C6 | E2, F5 tab |
| SAMPLE_RECORDED | none (A1 badge) | D2, D1 |
| ON_HOLD | C7-Hold, C7.2 | E4 row |
| RECEIVED | C7.3 | – |
| UNDER_TEST | C7-Detail | F6, E2 |
| REPORT_IN_REVIEW | E1 table badge only | D3 |
| REPORT_RELEASED | F2 | – |
| DISPUTED | F2 (raising); no detail | F9, E4 |
| COMPLETED | E1 badge only | – |
| REJECTED | C4.3 | – |
| EXPIRED, EXPIRED_UNPAID, NO_SHOW, CANCELLED | none (A1 badges; E4 count for no-show) | – |

## 4. Accessibility results

### 4.1 Contrast (token values from `lc.css`; WCAG 2.1: 4.5:1 text, 3:1 UI)

Every text pair used by the components and by the inline overrides passes. Margins are thin for the brand-dependent pairs, so they must be re-run when the brand blue is replaced.

| Pair (foreground on background) | Ratio | Needs | Result |
|---|---|---|---|
| Body text gray-900 on white / on gray-50 | 17.74 / 16.98 | 4.5 | Pass |
| Muted text gray-600 on white / gray-50 / gray-100 | 7.56 / 7.23 / 6.87 | 4.5 | Pass |
| Muted gray-600 on warning, info, danger, success, brand-tint backgrounds | 7.29 / 6.94 / 6.91 / 7.22 / 6.87 | 4.5 | Pass |
| Placeholder gray-500 on white / gray-50 | 4.83 / 4.63 | 4.5 | Pass (thin) |
| Link and primary text blue-600 on white / gray-50 / brand-tint | 5.39 / 5.16 / 4.90 | 4.5 | Pass (brand-tint thin) |
| Primary button white on blue-600 / hover blue-700 | 5.39 / 7.32 | 4.5 | Pass |
| Count pill white on blue-600 (12 px) | 5.39 | 4.5 | Pass |
| Active nav, chip, tab blue-800 on brand-tint | 8.88 | 4.5 | Pass |
| Badge success `#15803D` on `#F0FDF4` | 4.79 | 4.5 | Pass (thin) |
| Badge warning `#B45309` on `#FFFBEB` | 4.84 | 4.5 | Pass (thin) |
| Badge danger `#B91C1C` on `#FEF2F2` | 5.91 | 4.5 | Pass |
| Badge info `#1D4ED8` on `#EFF6FF` | 6.16 | 4.5 | Pass |
| Badge neutral gray-600 on gray-100 | 6.87 | 4.5 | Pass |
| Alert text info / warning / success / danger / neutral | 9.52 / 8.75 / 8.70 / 9.16 / 9.37 | 4.5 | Pass |
| SLA warning `#B45309` on white / on `#FFFBEB` | 5.02 / 4.84 | 4.5 | Pass |
| SLA danger on `#FEF2F2`; error text on white | 5.91 / 6.47 | 4.5 | Pass |
| Destructive button white on `#B91C1C` / hover `#991B1B` | 6.47 / 8.31 | 4.5 | Pass |
| Provisional tag `#7C2D12` on `#FFEDD5` | 8.18 | 4.5 | Pass |
| Diff removed / added text on their backgrounds | 8.20 / 8.30 | 4.5 | Pass |
| White on the scanner screen `#0B0F14` / camera gradient `#3A4450` | 19.22 / 9.89 | 4.5 | Pass (live video behind text cannot be checked) |
| Input and control border gray-500 on white / gray-50 | 4.83 / 4.63 | 3 | Pass (the D-02 change from gray-400 holds) |
| Focus ring blue-600 on white / gray-50 / brand-tint / dark scanner | 5.39 / 5.16 / 4.90 / 3.57 | 3 | Pass |
| Progress fill blue-600 / warning on gray-200 track | 4.35 / 4.06 | 3 | Pass |
| **Switch OFF track gray-400 on white** | **2.54** | 3 | **Fail** (DR-27) |
| Disabled text gray-500 on gray-100 (button, input) | 4.39 | exempt | Exempt (inactive control) |
| Inline "Full" slot card gray-500 on gray-100 (C3.5) | 4.39 | exempt | Inactive option; removed by DR-06 |
| blue-400 on white (used as swatch only) | 3.27 | 3 | Pass for graphics; the sheet itself says "decor/large only" |

Pairs that carry information in colour plus something else (so no 1.4.11 requirement on the colour): incomplete step circles and pending timeline rings are `gray-300` on white (1.47:1) but carry a number or icon, and the card, table and badge edges (`gray-200`) are decorative because every badge has a label.

### 4.2 Touch targets at 360 (rule: ≥ 44 × 44, `RESPONSIVE_DESIGN_GUIDELINES`)

| Element | Size at 360 | Where | Result |
|---|---|---|---|
| Primary actions (`btn-lg`, `btn-xl`, full width) | 48 / 56 px | all strips | Pass |
| Icon buttons (Back, Menu, Notifications, Close, Torch) | 44 × 44 inline override | all 360 boards | Pass |
| Chips and segmented controls in B1, D1 checks | 44 / 52 px inline override | B1, D1 | Pass |
| Checkbox and radio rows | row min-height 56 px (B2-360, C3.1) | B2, C3 | Pass |
| `btn-sm` | 32 px | B1 map card, C4.3 ×2, C6.1 ×2, E1-360, E2-Maker | Fail (DR-12) |
| Default `.btn` | 40 px | 13 buttons (see DR-12) | Fail (DR-12) |
| Plain text links ("Edit", "All", "View full test request form") | about 20 px high | C3.6, E1-360, D1 | Below 44; also below the 24 px of WCAG 2.2 SC 2.5.8 unless inline in a sentence |
| Bottom navigation links (E1-360) | 11 px text | E1-360 | Text below the 12 px minimum of the type scale |

### 4.3 Other checks

| Check | Result |
|---|---|
| Focus styles | Defined for `.btn` and `.input` only (DR-26). Focus colour passes contrast on every surface including the dark scanner. |
| Status by more than colour | Pass. All 401 icons are `aria-hidden` and every badge, SLA and chip has text plus an icon; diff rows carry +/−; progress bars sit beside text. One gap: map pins separate bookable and listed by fill (DR-33). |
| Form labels and error text | Visible labels on the form pages. The search inputs on B1-360 and B4 and the table filter on A4 use `aria-label` or a placeholder only. Error text explains what, why and what to do (e.g. "GSTIN has 15 characters. You entered 11."). Error text is not programmatically tied to the field in 41 of 43 boards (DR-25). |
| Heading structure | No skipped levels. Search pages have no h1 (DR-24). The 360 strips repeat or omit h1 because several screens share one file; that is a presentation artefact. |
| Landmarks | `main` present on 14 of 43 boards, `nav` on 19, `footer` on one. Sheets and strips have none. |
| Tables | 20 tables, 79 `th`, none with `scope`, none with a caption (DR-25). Below `md` tables become card lists (A4, E1-360). |
| Language | `lang="en"` on all 43 boards. Hindi (Devanagari) glyph check on A1 renders text only; the fixed heights in DR-28 are the Hindi risk. |
| Icon-only buttons | All carry `aria-label`. |
| Live regions | `aria-live` or `role="status"/"alert"` in 6 places (search count, verification result, payment banner, scanner). Loading skeletons use `aria-busy`. Toasts and OTP errors have none. |
| 2.2-only items | SC 2.5.7 dragging (DR-30). SC 2.5.8 target size is covered by DR-12. SC 2.4.11 (focus not obscured): sticky footers 56 to 120 px on 360 forms could cover a focused field; cannot be judged here. SC 3.3.8 (accessible authentication): the six-box OTP and TOTP fields must accept paste and autofill (`autocomplete="one-time-code"`); the boards are silent. |

## 5. Scope check result

- **Exclusion list: clean.** No pickup, rider, logistics, tracking, subcontracting, negotiated price, purchase order, medical-lab, platform-fee or native-app feature is drawn. The cover lists them as "Never in the UI". Calibration labs appear only as "booking coming soon" (CD-03). There is no chat, compare-labs, saved search or cart (all deferred). Counter-offers have no price field (BR-017). The payment page is opaque (CLAUDE.md §5).
- **One mention of an excluded concept:** F3 prints "LabConnect charges no platform fee" (DR-21).
- **Drawn but not asked for by any requirement:** "Notify Checkers" and "Notify other Checkers (2)" (A3, D2), "Send to my phone" (C6), a lab-page "Share" button (B2-360), "I accept the lab's terms of testing" (C3-Review), public rating comments (F2), booking short code (C6). See DR-16, DR-18, DR-22.
- **Asked for but shown on no screen:** see §3 (Missing rows). The main ones are the stamp states, label reprint, cancellation with refund preview, the dispute decision outcome for the customer, Customer Admin and Finance dashboards, lab onboarding steps, amendments, and most of the admin console.

## 6. Brand-dependent tokens

All values below are provisional stand-ins (OQ-19). To swap the brand, change or re-derive these, and re-run the contrast table in §4.1.

| Where | Token or asset | Current value | Depends on OQ-19 because |
|---|---|---|---|
| `lc.css` `:root` | `--qci-blue-50, -100, -200, -400, -600, -700, -800, -900` | `#EEF5FB #D6E8F5 #A9CDE8 #4596C4 #1F6FA8 #185A8A #13476D #0E3450` | "Q Blue" has no code in the QCI PDF |
| `lc.css` `:root` | `--qci-black` | `#1A1A1A` | The secondary colour "black" has no code |
| `lc.css` `:root` | `--color-brand-primary`, `-hover`, `-contrast` | blue-600, blue-700, white | Derived from the blue; contrast must be re-run |
| `lc.css` `:root` | `--color-brand-secondary`, `--color-brand-tint`, `--color-focus-ring` | black, blue-50, blue-600 | Derived; the focus ring must stay ≥ 3:1 on white, gray-50, tint and the dark scanner |
| `lc.css` components | Primitives used directly: `.btn-primary.is-active`, `.chip.on`, `.b-brand`, `.prodname`, `.nav a.on`, `.sidenav a.on`, `.tabs span.on`, `.tlm.now`, `.step.on`, `.pin.sel`, `.cluster` | blue-800, blue-200, blue-100, black | Must become semantic tokens (DR-13) |
| `lc.css` | `rgba(31,111,168,.18)` in `.cluster` | hard-coded blue | Hard-coded copy of blue-600 |
| 29 HTML boards | Inline literals of the brand values | `#1F6FA8` ×34, `#13476D` ×21, `#D6E8F5` ×19, `#EEF5FB` ×13, `#185A8A` ×4, `#1A1A1A` ×3, others ×6 | Must be replaced by tokens (DR-13) |
| `lc.css`, `<helmet>` in every board | `--font-sans` and the Google Fonts `<link>` for Poppins (and Noto Sans Devanagari on A1) | Poppins, Noto Sans, system-ui | No web typeface is named by QCI. A public government page should self-host the font instead of calling a third-party CDN (OQ-13) |
| Every header | `../reference/Logos_QCI.png` beside the text "LabConnect" | supplied standard logo | Endorsement wording, product naming, clear space, minimum size and the logo bug are open (OQ-12, OQ-19) |
| Every 1280 board and the cover | `.prov` tag "Provisional brand" | label | Remove when the brand is approved |
| B1 footer | "operated under QCI branding (interim). Endorsement wording to be confirmed (OQ-19)" | text | Open |
| Status colours (`--color-success`, `-warning`, `-danger`, `-info`, `-neutral` and their `-bg` and `-border`) | green-700, amber-700, red-700, blue-700, gray-600 | Not brand values, but the QCI "no unapproved colours" rule may or may not cover functional colours (BRAND_GUIDELINES §4). `--color-info` is blue and must stay distinct from `--color-brand-primary` |

## 7. What this review could not check

- **Keyboard order, focus order, focus trapping in dialogs and sheets, and screen-reader announcements.** These need the running build.
- **Rendered layout.** Nothing was rendered. Overflow, wrapping, real line lengths, how fixed heights behave with longer text, 200 % zoom and 320 px reflow are not verified. Contrast was computed from the token values, not measured from pixels, so text over the live camera image, over the map and over photos is not checked.
- **Motion and `prefers-reduced-motion`.** `lc.css` has no transitions or animations; the A1 note is the only statement.
- **The interactive boards.** The `{{ }}` placeholders in `C7-Hold`, `D2` and `D3` were read as source; the Play prototype on the canvas was not run, so link order was judged from the `href` values only.
- **Hindi and 30–40 % longer strings.** Not tested.
- **Print stylesheets** for labels and the custody trail: none are in the files.
- **API contract.** Only the clear cases were checked: `enums.yaml` booking and payment statuses (all 18 booking states are in A1), `public-reports.yaml`, `public-lab-sites.yaml` (`PublicSlot`, `PublicRating`), `bookings.yaml` (counter, rating, handover, contact), `common.yaml` (`BookingNo`, `ContactPerson`) and `public-search.yaml`. Endpoint existence for every annotation in `canvas.json` was not walked line by line. `packages/shared/src/booking-state-machine.ts` was not opened; state names were compared with `enums.yaml` and the state-machine document.
- **Whether the sample data is plausible** (dates, amounts, GST split, ULR format) beyond the inconsistencies listed in DR-23 and DR-34.
- **The live canvas link** in the README (private) was not opened.
