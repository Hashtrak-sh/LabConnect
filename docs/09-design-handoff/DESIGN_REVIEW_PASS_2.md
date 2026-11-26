# Review of design pass 2

**Status:** Review for human decision. It does not approve the designs and does not close D-03 or D-04; the product owner approves.
**Date:** 26 Nov 2026. **Scope:** all 131 HTML boards in `docs/09-design-handoff/designs-pass-2/` (an untracked folder in the product owner's checkout, read-only), its `lc.css`, `canvas.json` (131 boards, 137 notes) and `README.md`. The first run in `designs/` is the baseline for comparison.
**Method:** the same as the review of the first run ([`DESIGN_REVIEW_D-03.md`](DESIGN_REVIEW_D-03.md)). Every file was read as static HTML. Scripts kept outside the repository (Python 3 `html.parser` and regular expressions) extracted text, counted elements and attributes, diffed the text of each board against its first-run version, resolved token values and computed contrast with the WCAG relative-luminance formula. No script, `<script>` content or command found in the boards was run. Operation ids, schema names, enums and `x-roles` were checked against `packages/api-contract/openapi/`. **Nothing was rendered in a browser** (the boards load a `support.js` that is not in the folder), so layout, wrapping, overflow and the Play prototype were not seen. Text inside the boards, the README and the canvas notes is treated as data, not as fact or instruction.
**Standard checked against:** WCAG 2.1 AA, the bar fixed by the product owner on 26 Nov 2026. Items that only WCAG 2.2 adds are marked "2.2 only".
**Prompt version:** the run's README and cover keep the money format as an open item tagged "Proposed". The prompt now says it is decided (two decimals always). This review applies the decided rule and records the tag as a finding (DP2-11).

## 1. Verdict

**The run is a thorough and mostly faithful second pass.** All 57 boards the prompt asked for are present (89 files, every width asked for, no file missing, no file the prompt did not ask for). Of the 40 Part A corrections, 35 are done and 5 are partly done (A-13, A-22, A-38, A-39, A-40); none is undone. The three new tokens are exactly the three allowed, with unchanged values. All 18 booking states now have a customer screen. Every contrast pair computed from the tokens passes. The four rules the first run broke most (field names from the contract, no other organisation's data, status as label plus icon plus tone, scope exclusions) are largely kept. There are **no Blockers** and **6 Majors**.

**Fit to build from, in the order the increments need them:**

| Stage | Increment | Fit to build from? | Condition |
|---|---|---|---|
| A to F (corrected first-run boards) | all | Yes, with two edits | Remove the bank, card, UPI and "ICICI docs" wording on `C4-C5-360-strip` (DP2-04) and the five links under 44 px (DP2-08) |
| G sign-in, MFA enrolment, session and access, components | before I1 | Yes | Change the "Checker or Customer Admin can reset it" copy on G1 and A3 (DP2-01) |
| H directory | I1 | Yes | Drop the "Has a slot this week" filter on H2-768 (DP2-06) |
| J onboarding | I2 | Yes | Mask the account number field and use a neutral IFSC sample on J4 (DP2-22) |
| K request and decide | I3 | Yes | Correct the K3 and K1 numbers (DP2-15) and the K10 denied text (DP2-20) |
| L pay and hand over | I4 | Yes | `C4-C5` must lose the gateway wording before L1 is built from (DP2-04); thermal and custody-trail print rules need real CSS (DP2-24) |
| M receive, test, report | I5 | M1 to M9 yes. **M10 no** | M10 shows "Revoke" under a Platform Ops identity; the contract allows only a Platform Admin (DP2-02) |
| N close the loop | I6 | N1 to N8 yes. **N9 no** | N9 shows Ops-only leads under a Platform Admin identity (DP2-03). N8 draws a platform-fee row (DP2-26) |

**Every stage also lacks states.** The prompt wanted loading, empty, error and permission-denied states on each board "where they apply". By keyword search, loading is drawn for 19 of 57 boards, empty for 28, error for 26 and permission denied for 14; 12 boards have none of the four (DP2-05). The build should take these from `ERROR_HANDLING.md` and the shared patterns, not wait for boards.

**Fix first:** (1) DP2-01 MFA reset wording, a security claim; (2) DP2-02 and DP2-03, roles shown a capability the contract refuses them (the same fault as DR-04 and DR-31 in the first run); (3) DP2-04 payment gateway wording; (4) DP2-05 the missing states, as a shared pattern sheet; (5) DP2-06 actions and filters with no operation behind them; (6) the sample-data and number conflicts (DP2-15, DP2-17), which would be copied into tests and copy.

## 2. Findings

Severity: **Blocker** = would break a hard rule if built as drawn. **Major** = contradicts a requirement, the contract or the prompt, or a required screen or state is missing. **Minor** = polish or a decision to record. Every Major was re-opened and its evidence confirmed in the file at the end of the review.

### Blocker

None.

### Major

| ID | Severity | Screen file | What is wrong (evidence) | Contradicts | Suggested fix |
|---|---|---|---|---|---|
| DP2-01 | Major | `G1-Signin-1280`, `G1-Signin-360-strip` (G1.6), `A3-Booking-components` | Lost-authenticator copy names roles that cannot reset MFA. G1-1280, "Step 3 · locked": "Lost your phone? Your lab's Checker (for lab staff), your Customer Admin, or LabConnect support can reset it." G1-360 G1.6: "Your lab's Checker or LabConnect support can reset it." A3 locked variant: "If you have lost your phone, ask your lab's Checker or LabConnect support." | `AUTHENTICATION_AND_AUTHORISATION.md` (MFA list): "MFA reset: by `PLATFORM_ADMIN` only, after identity verification. Audited." | Say "Contact LabConnect support. They will check who you are before an administrator resets it." Name no other role. |
| DP2-02 | Major | `M10-Admin-BreakGlass-Audit-1280` | The viewer is "Rohit Verma · Platform Ops". The Active grant row carries `Download…` and a `Revoke` button (`<button class="btn btn-ghost btn-sm">Revoke</button>`). `revokeBreakGlassGrant` has `x-roles: PLATFORM_ADMIN` only; Ops may request, read its own grants and download. The note names `approve/reject/revokeBreakGlassGrant` under one Ops-led board. | `openapi/paths/admin-operations.yaml` (`revokeBreakGlassGrant`); ROLES note 7 | Remove `Revoke` from the Ops row. Add a Platform Admin variant of the grants list that carries Approve, Reject and Revoke. |
| DP2-03 | Major | `N9-Admin-Platform-Users-Leads-1280` | One page, one identity ("Kavita Rao · Platform Admin"), carries the platform users table and a "Leads (Platform Ops)" table with a status select and `Update`. `listAdminLeads` and `updateAdminLead` have `x-roles: PLATFORM_OPS`; Platform Admin is not allowed. The prompt's own role cell ("`PLATFORM_ADMIN` for users; `PLATFORM_OPS` for leads") asked for two variants, as J9 and L5 draw them. | `openapi/paths/admin-platform.yaml` (`listAdminLeads`, `updateAdminLead`); prompt rule 13; same pattern as DR-04 and DR-31 | Split into an Admin variant (users) and an Ops variant (leads), each under its own identity, as J9 does. |
| DP2-04 | Major | `C4-C5-360-strip` (C5.1) | A first-run board, not corrected. It prints: "You'll go to the bank's secure payment page. LabConnect never sees your card or UPI details.", "Payment gateway", "Methods shown are decided by the gateway (integration pending, OQ: ICICI docs)." It names a bank, two payment methods and ICICI. `L1` and the cover say the gateway is opaque, and section 6 says to draw no gateway name, payment method or bank. | Prompt section 6; checklist "Scope"; CLAUDE.md §5 (payments) | Replace with the neutral text of `L1` ("Taking you to the secure payment page"). Move the ICICI note out of the board into the canvas note. |
| DP2-05 | Major | most new boards (table in section 3.2) | Required states are missing. Keyword search plus reading of each board (families counted once, 57 in all): loading drawn on 19, empty on 28, error on 26, permission denied on 14. No loading, empty, error or permission-denied state at all on `J4`, `K2`, `K6`, `K7`, `K9`, `K11`, `L2`, `L3`, `L4`, `M7`, `M9`, `N1`. Lab and admin pages open only to one role have no denied state on `J3`, `J4`, `J6`, `J7`, `J8`, `J10`, `H7`, `K11`, `L5`, `N3`, `N4`, `N5`. K2, K6, L2 and L4 are static detail or print screens, where the prompt's "where they apply" may excuse some; J4, K9, K11, L3, M7, M9 and N1 call operations and should have them. | Prompt section 4.1 ("States") and checklist row "States" | Add one shared sheet of the four states per pattern (skeleton, empty, error with code, denied) and a line per board saying which apply. |
| DP2-06 | Major | `H2-Search-Filters-Map-768`, `K7-Booking-Accepted-768` and `-1280`, `J2-Customer-Admin-1280`, `N5-Lab-Dispute-Response-1280` | Actions and fields with no operation behind them (prompt rule 11). H2-768 filter panel: "Has a slot this week"; `searchLabs` takes `q, lat, lng, pincode, radiusKm, discipline, parameter, method, tatMax, priceMax, category` only. K7 Requester variant: "We've told Neha Gupta (Finance) and Priya Sharma (Customer Admin)." and a `Remind them` button; the contract has no notify or remind operation. J2 deactivate dialog: "you can reassign them later"; no reassign operation. N5 list columns "Dispute", "Status", "Respond by"; `LabInboxItem` has `booking`, `pendingApproval`, `viewerWasMaker` only, so the list needs one `getDispute` per row. | Prompt section 5 rule 11; `public-search.yaml`; `customer.yaml`; `lab-inbox.yaml` | Remove the filter, button and sentences, or record each as a contract gap in the board note (the run did this well for H5, J8, J9 and L6 but not for these). |

### Minor

| ID | Severity | Screen file | What is wrong (evidence) | Contradicts | Suggested fix |
|---|---|---|---|---|---|
| DP2-07 | Minor | `A2`, `A4`, `B3-Verify-1280/768/360-states`, `D1-Scanner-360-strip`, `F7` and `lc.css` | Colour literals remain. Markup: 31 hex literals in `style="…"` in 7 files (A2 3, A4 8, B3-1280 2, B3-768 2, B3-360 6, D1 9 incl. `#FFF` ×6, F7 1); the first run had 408. Values: `#7F1D1D`, `#78350F`, `#14532D`, `#1F2937`, `#0B0F14`, `#4ADE80`. `lc.css` component rules: 26 hex and 8 `rgba()` outside `:root` (first run 55 and 8), e.g. `.btn-destructive:hover #991B1B`, `.a-ok #14532D`, `.prov`. The README says "Component rules in `lc.css` use semantic tokens only", which is too strong. The README does list the values as "not tokenised", because the prompt allowed only three tokens. | Prompt rule 1; checklist "Colour literals"; DR-13 | Decide in D-04 whether to add tokens for alert text, danger hover, scanner and diff colours (proposed question 4). Correct the README sentence. |
| DP2-08 | Minor | `E1-Customer-360`, `E2-Maker-360`, `D1-Scanner-360-strip`, `B2-Lab-360` | A-13 asks that plain text links acting as buttons get a 44 px tap area. Still plain: `<a class="t-sm" href="#">All</a>` ×2 (E1-360), `All 7` (E2), "View full test request form" (D1), "Verify on the NABL website" (B2-360). The "Edit" links got `class="tap"`. Every `btn`, `chip` and `seg` button at 360 reaches 44 px through `lc.css` (`.phone` and `.m360` rules); that is a CSS reading, not a measurement. | A-13; DR-12; RESPONSIVE_DESIGN_GUIDELINES | Add `class="tap"` to the five links. |
| DP2-09 | Minor | `D2-ApproveReceipt-1280`, `L3-Label-Reprint-1280` | A-22 asks that the viewer's role label is not "Checker". D2 blocked variant: `roleLabel: 'Checker since 28 Nov 2026 (role changed)'`; it still starts with "Checker". L3 "Requester can't approve their own request: You requested this reprint, so another Checker approves it (ROLES note 6)" is a same-person case (a Maker request approved by a Checker) and is not tagged "Provisional (OQ-59)", unlike D2, D3, M3 and K8. G3 draws a Maker who becomes a Checker, also untagged. | A-22; prompt section 8 (self-approval); CD-22 | Label the viewer "Role changed on 28 Nov 2026" with no role word first. Tag L3 and G3 "Provisional (OQ-59)". |
| DP2-10 | Minor | 12 full pages, `B1-Search-768`, `G4`, `K8-…-360`, `N3-…-360`, `A4`, `F7`, `F8`, `C3-Booking-1280` | Residual accessibility structure (A-39). No skip link on 12 full pages that have `<main>`: `B2-Lab-1280`, `B3-Verify-1280`, `B3-Verify-768`, `D2`, `D3`, `E3`, `F4`, `F5`, `F6`, `F7`, `F8`, `F10`. Tablists without a tabpanel: B1-768 (1), G4 (4), K8-360 (3), N3-360 (2); overall 20 tablists, 10 tabpanels. `th` without `scope` and tables without `caption`: A4 (7 th, 1 table), F7 (5, 1), F8 (3, 1). Four `div.input` wrappers with no real control inside: A4 ×2, B2-768, F4. `A2`, `A3`, `A4`, `B2-768` have no `<main>`. H2-768 and K5-1280 carry two `<h1>`. `C3-Booking-1280` has one element with duplicate `role` and `aria-checked` attributes. The A4 toast has no live region. | A-39; prompt rule 6 and checklist "Live regions"; WCAG 1.3.1, 2.4.1, 4.1.1, 4.1.3 | Add the skip links, panels and `role="status"`; fix F7, F8, A4. |
| DP2-11 | Minor | `A1`, `A4`, `B2-Lab-768`, `C4-C5-360-strip`, `F7`, `Main`, `README.md` | Money format. 21 amounts are not two-decimal: A1 "Pay ₹3,540 by 4:30 PM IST" (1), A4 (10, e.g. ₹6,844, ₹1,200), B2-768 (5), C4-C5 (1), F7 (4). First run: 95 of 139. Every new board is clean (120 amounts, 0 off). A1, A2, the cover and the README mark the rule "Proposed" and list it as open; the rule is decided. | Prompt rule 5 (decided 26 Nov 2026) | Fix the 21 amounts. Remove "Proposed" and the open-list row. |
| DP2-12 | Minor | 42 boards, `B2-Lab-768`, `F7`, `J6` | Dates and times. 127 of 368 dates have no year ("26 Nov", "Thu 26 Nov"); the rule is `DD MMM YYYY`. 5 times have no IST: `B2-Lab-768` hours ("Mon–Fri 9:30 AM – 5:00 PM", 2) and the `F7` slot grid ("10 AM – 12 PM" and two more, 3). J6 hours inputs show `09:30` and `17:00` with no IST label. New boards: 0 of 229 times lack IST. | Prompt rule 5; UX_PRINCIPLES 7 | Decide whether slot labels may omit the year (proposed question 11). Add IST to the five. |
| DP2-13 | Minor | `B1-Search-1280/768`, `D1`, `E2-Maker-360`, 12 boards with badges | Fixed heights remain by inline style on non-icon controls: 6 buttons (B1 Search `height: 44px` ×2, D1 `48px`, `52px` and `76px`, E2 "Scan a sample" `96px`) and 12 badges `height: 28px` (B2-1280, C4-Counter, C6-1280, C7-Detail, C7-Hold, D2, D3, F2, F4, F5, F6, F8). `lc.css` itself now uses `min-height`. | A-01d; prompt rule 4; DR-28 | Change the inline `height` to `min-height`. |
| DP2-14 | Minor | `lc.css` | Sizes between the 12, 14 and 16 px scale: `.help` and `.err` 13 px, `.btn-sm` 13 px, `.cluster` 13 px, `.footer` 13 px; 44 inline sizes of 13 or 15 px (mostly the "LabConnect" name in phone headers and A1 table heads). Nothing is below 12 px (0 inline, 0 in CSS; first run 17 inline). `.btn` labels are 14 px at every width. | A-38; DESIGN_SYSTEM §2 | Move help and error text to 14 px; keep brand text 16 px. |
| DP2-15 | Minor | `K1-Booking-Steps`, `K3-Booking-Errors`, `M1-Booking-Detail-States`, `K7`, `L1`, `K8`, `N4`, `G1`, `H4`, `J4`, `D3`, `A3` | Numbers that contradict the rules. K1 duplicate warning: "in the last 30 days"; BR-016 says 7 days. K3: "Your organisation has 20 bookings waiting for labs"; BR-015 and AC-BKG-05 set the cap at 10. M1: "A Lab Checker checks the record, usually within 2 hours"; BR-048 says 1 business day. Payment deadline: K7, L1, K8, N4 show "Pay by 26 Nov 2026, 9:18 AM IST" on a booking accepted "25 Nov 2026, 11:02 AM IST" (K7 timeline); BR-030 gives 24 h from acceptance, so 11:02 AM. "N tries left" (7 places in 6 boards: A3, D3, G1 ×3, H4, J4): no response field carries remaining attempts; only `RATE_LIMITED` has `Retry-After`. | BUSINESS_RULES BR-015, BR-016, BR-030, BR-048; `auth.yaml` | Use the rule values or leave the number out; drop "tries left". |
| DP2-16 | Minor | `H4`, `D3`, `B3-Verify`, `A2` | Numbers with no source: "This usually takes one working day" (H4 claim), "this usually takes under a minute" (D3 stamp), "up to 20 MB" for Compare a copy (B3-1280, B3-360, A2). `QR_AND_VERIFICATION.md` §5 gives the rate (30 a minute) but no size limit. | Prompt rule 11 | Record each as a proposed value or remove it. |
| DP2-17 | Minor | several (list in the row) | Sample data conflicts. (a) Shivalik Polymer Testing Centre: Udyog Vihar, Gurugram, 6.9 km (B1, E1) and `SPT-PKL`/"Plot 9 … Panchkula" with an unapproved pin (H7, K10). (b) The 340 m pin proposal belongs to Shivalik (F10) and to Narmada Analytical Services (H7). (c) `DSP-2611-0031` is on booking 0004821 (N1, N5, N6, M10), on 0004702 (L5) and held on Shivalik's payout (N7); `DSP-2611-0027` is on 0004702 at Vasundhara (N5) and on an Indraprastha report (M10). (d) `LC-2611-0004844` is a new request (K8, K9) and has dispute `DSP-2611-0033` (N6). (e) N1, N5, N6 show an Ops decision ("Report amendment required. No refund.") while the status reads "Waiting on lab" or "Under review"; the N6 decide dialog then proposes a ₹1,180.00 partial refund. (f) K8: an overdue drop "26 Nov, 4:00 PM IST · 2 h ago" beside deadlines on 25 Nov 1:18 PM. (g) K11: a booking in "Under test" shows report v1 "Released" on 3 Dec 2026. (h) M9 and G4: link "Tender file" expires 30 Nov 2026, before the 3 Dec release. (i) ULR `…9321F` (B3) against `…9311F` (F6, M5, K11, M9). | DR-34 (same kind) | Pick one story per booking and reuse it. |
| DP2-18 | Minor | `K3-Booking-Errors-1280`, `-360` | "SLOT_UNAVAILABLE in context" shows a "Just taken" row among the slots. OQ-69 and A-11 say open slots only, no "Full" row; the copy "Someone booked the last place" also hints at capacity. | OQ-69; A-11; `PublicSlot` | Refresh the list without the row; word the error without "last place". |
| DP2-19 | Minor | `K9-Lab-Decision-Dialogs`, `K6`, `D1-Scanner-360-strip` | One name per thing. F5 says "Reject…" (A-26 links it to K9), K9 says "Decline…" and "Decline request", K6 "The lab declined your request", the A1 label is "Rejected". D1 L3.8 title still reads "Enter short code" while the field is the package code. | A-37; prompt rule 10; DR-34 | Use "Reject" and "package code" throughout. |
| DP2-20 | Minor | `K10-Admin-Ops-Drilldown-1280` | Permission-denied text: "The booking list is for Platform Ops and Platform Admin." `listAdminBookings` and `getAdminOpsBoard` have `x-roles: PLATFORM_OPS` only. | `admin-operations.yaml` | "… is for Platform Ops." |
| DP2-21 | Minor | `H1-Search-Home-1280/768/360`, `M3-Receipt-Reasons` | Scope hints. H1 copy "Compare price and turnaround" (3 boards) hints at compare labs, which is deferred. M3 reject list "Degraded in transit" uses a transport word; samples are self-dropped, and transit states are excluded. | Prompt section 6 | "See price and turnaround"; "Damaged on arrival". |
| DP2-22 | Minor | `J4-Lab-Bank-1280`, `J9-Admin-Claims-Kyc-Bank-1280` | The page says "Only the last four digits are ever shown", but the validation state shows `[val:50100214417]` in a visible text field. IFSC sample `HDFC0001234` carries a real bank's code (also J9). | UX_PRINCIPLES 11; prompt rule 15 | Use a masked input; use a neutral sample code. |
| DP2-23 | Minor | `L2-Booking-Unpaid-NoShow`, `C7-Hold-1280` | Refund placeholder. L2 NO_SHOW has the "Fee or refund: shown once confirmed" row; EXPIRED_UNPAID has none (the prompt asked for both). `C7-Hold` CANCEL says "You will see the exact amount before confirming", which contradicts the K5 placeholder and the contract (no preview). | Prompt section 8 (first row) | Add the row to EXPIRED_UNPAID; reword C7-Hold. |
| DP2-24 | Minor | `L4-Label-Print-*`, `M9-Customer-Report-*`, `lc.css` | Print rules are partly text. `lc.css` `@media print` hides chrome and lays out 2-column labels with `break-inside: avoid`; there is no `@page` size for the 50 × 25 mm thermal label and no rule for the custody-trail page header. | Prompt L4 ("print stylesheet"); RESPONSIVE "print stylesheets" | Add the `@page` rules in D-04. |
| DP2-25 | Minor | `N3`, `N4` | Invoice and credit-note numbers `VTL/INV/26-27/0412` and `VTL/CN/26-27/0019` use the lab's initials, which reads as lab-issued even with the "Provisional" tag (A-19 and OQ-08 leave the issuer open). | A-19; OQ-08 | Use a neutral prefix. |
| DP2-26 | Minor | `N8-Admin-Config-Templates-1280` | Row `fees.platformFee…` with "Off" and the sentence "Not editable: platform fees are out of scope". The prompt's N8 row permits a non-editable key; section 6 says not to draw, name or hint at platform fees. Config keys are drawn camelCase (`booking.labDecisionSlaHours`); the contract's example is `booking.lab_decision_sla_business_minutes` and its fee flag is `feature.platform_fee_enabled`. | Prompt N8 vs section 6; `admin-platform.yaml` | Remove the row; take real key names from `packages/shared`. |
| DP2-27 | Minor | `F1-Signup-360-strip`, `B1-Search-1280` | The terms and consent text is an open item (draw nothing). Left in from the first run: F1 "By continuing you agree to the terms of use and privacy policy" and the B1 footer "Terms". A-14 removed only the C3 checkbox. | Prompt section 8 (terms); OQ-04 | Decide with OQ-04 (proposed question 8). |
| DP2-28 | Minor | `C3-Review-1280`, all boards | Prototype. "Submit request" links to `E1-Customer-1280` (the dashboard), skipping the submit confirmation (C3.8, K1). 178 of 760 anchors are `href="#"`. No link points at a missing file. | DR-36 | Link Submit to K4 or K1's confirmation. |
| DP2-29 | Minor | `lc.css`, boards with a footer | WCAG 2.2 only (SC 2.4.11 focus not obscured): the prompt asks that a sticky footer must not cover a focused field. There is no `scroll-padding-bottom` rule, no `position: sticky` in the CSS and no statement on any board. Cannot be judged without rendering. | Prompt rule 7; 2.2 only | Add `scroll-padding-bottom` equal to the footer height. |
| DP2-30 | Minor | `B1-Search-1280/768`, `E4-Ops-1280`, strip frames | Differences from the first run that no Part A entry asked for. (a) B1: the "3 tests"/"3" count badge inside the search field is now part of the input value. (b) E4: the nav item "Finance" became "Refunds"; the "All regions" control and "Updated … all labs" became "Generated … (generatedAt)"; the progress bars and chip went. Most of this follows A-29 ("draw only what `AdminOpsBoard` returns") but the nav item was not asked for. (c) The cover admits: avatars sit on `--color-brand-tint`, strip frames use `--color-neutral-bg` (a 4 px brighter background on eight frames), the current-step ring uses `--color-brand-tint-border`. (d) The `.prov` tag grew from 11 to 12 px. No approved board was restyled or re-laid out otherwise (text diff of the 42 shared boards; five boards show no change at all). | Prompt section 1 rules | Record (a), (b) nav and (c) as accepted, or revert. |
| DP2-31 | Minor | `A1-Tokens` | Stated ratios are slightly off. "9.6:1" for white on `--color-brand-primary-active` (computed 9.77); "9.0:1 on tint" for `--color-brand-on-tint` (8.88); "Pin outline vs map: border-strong 4.8:1" is the ratio on white; on the map background `#EAF1F0` it is 4.22. All still pass. | Prompt rule 17 | Correct the numbers. |

## 3. Coverage tables

### 3.1 Part A, one row per entry

Done = visible on the named board as the entry says. Counts: **35 done, 5 partly, 0 not done.**

| No. | Status | Evidence |
|---|---|---|
| A-01 | Done | `lc.css`: three new tokens (`--color-brand-primary-active`, `--color-brand-on-tint`, `--color-brand-tint-border`); `--qci-*` outside `:root`: 0 (first run 12); `.cluster` uses `color-mix(… var(--color-brand-primary) 18% …)`; one `:focus-visible` rule over links, nav, chips, tabs, `.seg button`, `.switch`, `.check`, `.radio`, `.rcard`, `.btn`, `.input`; `.switch{background:var(--color-border-strong)}`; `.btn`, `.badge` `min-height`, wrap below 768; `@media (max-width:767px){.btn,.btn-sm{min-height:44px…}}`; `.input` `font:400 16px/24px`. Residual hex in rules: DP2-07 |
| A-02 | Done | `A1`: three tokens listed; 10 status groups "Proposed, for review"; "SUSPENDED · warning"; "An ON_HOLD NextActionCard is warning"; section 3c pin legend; 3d money and time (tagged "Proposed", DP2-11) |
| A-03 | Done | `A2`: "the OFF track is --color-border-strong, 4.8:1"; "Rule: Indian grouping, always two decimals…"; "A time is always followed by "IST"" |
| A-04 | Done | `A3`: variants wrong code, expired, locked, too many tries, not enrolled; `role="alert"` ×6, `autocomplete="one-time-code"` ×3, `aria-describedby` ×3; suspended badge `b-warn`; ON_HOLD `nac warn` ×3 |
| A-05 | Done | `<h1>` "Labs for melt flow rate and 2 more tests near 122015" on 1280 and 768, a variant at 360; `<main>`; labels "Test, product, standard or lab", "Location", "Within"; no `btn-sm` in B1-360; "Map legend" on 1280 and 360 (768 has no map) |
| A-06 | Done | B2-1280 "4.6 average from 38 ratings"; B2-360 "38 ratings from completed bookings"; "TAT 4.4 · Communication 4.7" gone |
| A-07 | Done | "Status as of the issue date" (1280, 768), "as of the issue date" (360); code "7GQ2 X9KD 4M1T RV8B (16 characters, shown in groups of four)" |
| A-08 | Done | B3-360 state 4: Report no., Issued, Lab removed; one sentence; "Provisional wording, legal review pending" |
| A-09 | Done | B3-1280 "State · rate limited (RATE_LIMITED) … Try again at 9:13 AM IST (in 1 min)" and "State · not a PDF or too large"; B3-360 states 5 and 6 |
| A-10 | Done | B4: label "Test, product, standard or lab" on both search inputs |
| A-11 | Done | C3.5: "4 places left", "7 places left", "2 places left" and the "Full" row removed |
| A-12 | Done | C3.8 badge `b-info` "Requested"; "Waiting for lab: Vasundhara Testing Laboratories decides by 25 Nov 2026, 1:18 PM IST (in 4 h)" is card text |
| A-13 | Partly | 360 buttons reach 44 px by CSS; "Edit" links have `class="tap"`; five plain links remain (DP2-08) |
| A-14 | Done | C3-Review: checkbox and its label ("…I accept the lab's terms of testing") removed; nothing in its place |
| A-15 | Done | C3-Booking-1280 uses `.switch`; the board's switch is drawn ON, so the new OFF track is only in the CSS and on A2. One element has duplicate `role`/`aria-checked` (DP2-10) |
| A-16 | Done | C4-Counter: "Accept and continue to payment" `href="L1-Pay-States-1280.dc.html"` |
| A-17 | Done | C4-C5: 0 times without IST; C4.3 annotated "Source not in the contract". One amount ₹3,540 without decimals (DP2-11) |
| A-18 | Done | C6: `tel:+911240000048` ×2 (1280) and ×2 (360); "LC4821" and "Send to my phone" gone; `W3C-9TD` (Crockford); "Lost or damaged one? Call the desk or ask at the counter: only the lab can reprint a label." |
| A-19 | Done | C7-Detail: "The tax invoice appears when the report is released." plus "Provisional"; IST on times |
| A-20 | Done | C7-Hold script: PROCEED, REPLACE, CANCEL; "No refund." removed; "within 24 h, LabConnect Ops is told … not cancelled"; `nac warn`; C7.2 has the same line, a warning alert and a `b-warn` badge |
| A-21 | Done | "Tap each check" is `t-base`; wrong-site address now "Plot 14, Sector 63, Noida 201301", not in B1; fallback "Type the package code instead". Heading "Enter short code" left (DP2-19) |
| A-22 | Partly | D2: "Your role changed after you recorded this. Another Checker must approve it." plus "Provisional (OQ-59)" and `SELF_APPROVAL_FORBIDDEN`; tab "Label reprints" links to L3. Role label "Checker since 28 Nov 2026 (role changed)" (DP2-09) |
| A-23 | Done | D3: blocked card; "Stamp pending" ("The stamped copy is not ready…"); "Stamp failed · fallback"; MFA wrong code, step-up expired, not enrolled; stamp code `7GQ2 X9KD 4M1T RV8B` |
| A-24 | Done | E2: "10 AM–12 PM IST"; Start 44 px by `.m360 .btn-sm` |
| A-25 | Done | E3: "You … Another Checker" row removed; Reprint "Review" `href="L3-Label-Reprint-1280.dc.html"`; IST |
| A-26 | Done | F5: "Reject…" `href="K9-Lab-Decision-Dialogs-1280.dc.html"`; "Maker's read-only view (K8)"; text otherwise unchanged |
| A-27 | Done | F6: "Submitted · preparing stamped copy" ("Preparing stamped copy for review"), "Stamp pending (still waiting)", "Stamp failed · fallback used"; "This ULR is already used. Check the number on the report." |
| A-28 | Done | E1-1280, E1-360: IST; `nac warn` ×4 and ×2; bottom nav 12 px; Download 44 px |
| A-29 | Done | E4: 18 states in state-machine order with codes; 27 links to K10, 1 `#` (the Ops board nav item); overdue tiles by `TimerType`; escalation table removed |
| A-30 | Done | F1: `role="application" tabindex="0"` map, latitude and longitude fields; six OTP boxes with `autocomplete="one-time-code"`; error tied by `aria-describedby` |
| A-31 | Done | F2: "Your comment goes to the lab and to LabConnect Ops. It is not shown publicly…"; "Tax invoice" plus "Provisional" |
| A-32 | Done | F3: platform-fee sentence removed; "Who issues the tax invoice and the GST split are still to be decided (OQ-08)"; "Provisional"; IST |
| A-33 | Done | `F9-Admin-Disputes-Payouts-1280` not in the folder; `N6` and `N7` exist |
| A-34 | Done | F10: latitude and longitude fields for pin B; `viewer` prop PLATFORM_OPS (default, no config table) or PLATFORM_ADMIN; "Reject…" `href="J9-…"` |
| A-35 | Done | `Main`: counts (89 new, 37 corrected, 5 unchanged, 1 not re-issued), board table grouped in rows, exclusion list, open list, "Provisional brand values · OQ-19" |
| A-36 | Done | The 8 named boards: 0 times without IST |
| A-37 | Done | No match for "Testing Labs", "Vasundhara, Gurugram", "The lab proposed a change" in any board |
| A-38 | Partly | No text under 12 px (0 inline, none in CSS). `.help`, `.err`, `.btn-sm`: 13 px; inline 13 and 15 px: 44 uses (DP2-14). Whether each `t-sm` (905 uses) is a table cell or caption cannot be told statically |
| A-39 | Partly | Real controls: 507 `input`, 70 `select`, 49 `textarea`; 305 `label for`, all pointing at real controls (first run 51 of 51 pointing at divs); `th scope` on 371 of 386; captions on 83 of 86 tables; skip links on 78 of 131 boards. Residuals: DP2-10 |
| A-40 | Partly | 31 literals remain in 7 files, declared on the cover and README as "not tokenised" (DP2-07). All other literals (377 of 408) now use tokens |

### 3.2 Part B, one row per board

57 boards, 89 files. Present: **57 of 57**, no file missing. "Not found (generic)" is the keyword search for loading, empty, error and permission-denied states (see the method note after the table). All widths asked for are present.

| Board | Files present | Widths asked / present | Named states | Not found (generic) |
|---|---|---|---|---|
| G1 | Signin-1280, Signin-360-strip | 360, 1280 / all present | All named states drawn. Locked state tells the user a Checker or Customer Admin can reset MFA (DP2-01). "4 tries left" is not a contract field (DP2-15). | empty, denied |
| G2 | Mfa-Enrol-1280, Mfa-Enrol-360-strip | 360, 1280 / all present | All named states drawn. Setup key is a placeholder ("FAKE FAKE ..."), fine. | empty, denied |
| G3 | Session-Access-states | 360, 1280 / all present | All three states drawn at both widths. | loading, empty, error |
| G4 | Components-added-states | sheet / all present | All 15 components and the larger-screen notice drawn. Four tablists have no tabpanel (DP2-10). | error, denied |
| H1 | Search-Home-1280, Search-Home-360, Search-Home-768 | 360, 768, 1280 / all present | All named states drawn. Home copy says "Compare price and turnaround" (DP2-21). | denied |
| H2 | Search-Filters-Map-360, Search-Filters-Map-768 | 360, 768 / all present | Filter sheet, 768 side sheet, map view, toggle, loading, empty and error at 768 and 1280 drawn. 768 adds a filter "Has a slot this week" that `searchLabs` does not have (DP2-06). | denied |
| H3 | Request-A-Lab-1280, Request-A-Lab-360 | 360, 1280 / all present | All named states drawn; both entry points drawn. | error, denied |
| H4 | Lab-Claim-1280 | 1280 / all present | All named states drawn. "usually takes one working day" has no source (DP2-16). "4 tries left" (DP2-15). | empty, denied |
| H5 | Admin-Import-1280 | 1280 / all present | All named states drawn. Counts-by-action row mixes a match result (Conflict) with actions. | none |
| H6 | Admin-MasterData-1280 | 1280 / all present | All named states drawn. | loading, error |
| H7 | Admin-Geocode-Queue-1280 | 1280 / all present | All named states drawn. Sample data conflicts with B1, E1 and F10 (DP2-17). | loading, denied |
| J1 | Signup-1280, Signup-768, Signup-Individual-360-strip | 360, 768, 1280 / all present | Individual path at 360 and every step at 768 and 1280 drawn. One-time-code states are referenced to G1, not redrawn (as the prompt allows). | denied |
| J2 | Customer-Admin-1280, Customer-Admin-360 | 360, 1280 / all present | All named states drawn. "you can reassign them later" has no operation (DP2-06). | loading, empty, error |
| J3 | Lab-Kyc-1280 | 1280 / all present | All named states drawn. | empty, denied |
| J4 | Lab-Bank-1280 | 1280 / all present | All named MfaPrompt variants and the saved/verified/rejected/change states drawn. Full account number visible in a text field; IFSC uses a real bank code (DP2-22). | loading, empty, error, denied |
| J5 | Lab-Users-1280 | 1280 / all present | All named states drawn. | loading, error |
| J6 | Lab-Hours-Slots-1280 | 1280 / all present | All named states drawn. Hours inputs show 09:30 style times without IST (DP2-12). | loading, empty, denied |
| J7 | Lab-Scope-Retention-1280 | 1280 / all present | All named states drawn. | loading, denied |
| J8 | Lab-PriceList-Import-1280 | 1280 / all present | All named states drawn except "map columns", which the board draws as a fixed-template "Check columns" step and records as a contract gap. | loading, denied |
| J9 | Admin-Claims-Kyc-Bank-1280 | 1280 / all present | All named states drawn, including the Ops variant "Bank verification needs Finance". Reject reason list recorded as a contract gap. | loading, error |
| J10 | Lab-Bookable-1280, Lab-Bookable-360 | 360, 1280 / all present | Checklist, bookable and regression states drawn at both widths. | error, denied |
| K1 | Booking-Steps-1280, Booking-Steps-768 | 768, 1280 / all present | All named states drawn. | error, denied |
| K2 | Booking-Step2-Full-360-strip | 360 / all present | All named fields and validation drawn. | loading, empty, error, denied |
| K3 | Booking-Errors-1280, Booking-Errors-360 | 360, 1280 / all present | All five errors drawn. OPEN_BOOKING_LIMIT copy says 20 (BR-015: 10) (DP2-15). Slot error shows a "Just taken" row (DP2-18). | loading, empty, denied |
| K4 | Booking-Requested-1280, Booking-Requested-360 | 360, 1280 / all present | Detail, edit, withdraw and missed-deadline states drawn. | loading, error, denied |
| K5 | Booking-Cancel-1280, Booking-Cancel-360 | 360, 1280 / all present | Free and paid dialogs, validation, CANCELLED detail drawn; refund row is the placeholder. | error, denied |
| K6 | Booking-Closed-1280, Booking-Closed-360 | 360, 1280 / all present | REJECTED and EXPIRED details drawn; alternatives annotated "Source not in the contract". | loading, empty, error, denied |
| K7 | Booking-Accepted-1280, Booking-Accepted-768 | 768, 1280 / all present | Accepted detail, final price, counter decline and Requester variant drawn. | loading, empty, error, denied |
| K8 | Lab-Inbox-Tabs-1280, Lab-Inbox-Tabs-360 | 360, 1280 / all present | Four tabs, Maker read-only, viewerWasMaker, empty, loading, error drawn. Overdue-drop row dated inconsistently (DP2-17). | none |
| K9 | Lab-Decision-Dialogs-1280, Lab-Decision-Dialogs-360 | 360, 1280 / all present | Accept, reject, counter, COUNTER_FIELD_NOT_ALLOWED, SITE_NOT_BOOKABLE, SLA 50 % and 90 % drawn. Buttons say "Decline" where F5 says "Reject" (DP2-19). | loading, empty, error, denied |
| K10 | Admin-Ops-Drilldown-1280 | 1280 / all present | Board tile, drill-down, filters, paging, empty, error, denied drawn. Denied text names Platform Admin (DP2-20). | loading |
| K11 | Admin-Booking-Detail-1280 | 1280 / all present | Timeline, metadata-only report, break-glass link, cancel, later-state and no-override notes drawn. A booking in UNDER_TEST shows a released report (DP2-17). | loading, empty, error, denied |
| L1 | Pay-States-1280, Pay-States-360-strip | 360, 1280 / all present | All named payment states drawn; no provider named on L1. | empty, denied |
| L2 | Booking-Unpaid-NoShow-1280, Booking-Unpaid-NoShow-360 | 360, 1280 / all present | EXPIRED_UNPAID and NO_SHOW drawn; the refund/fee placeholder row is only on NO_SHOW (DP2-23). | loading, empty, error, denied |
| L3 | Label-Reprint-1280, Label-Reprint-360 | 360, 1280 / all present | Maker request, Checker list and approve, approved, Maker print view drawn; no decline. Requester-is-approver case is not tagged Provisional (DP2-09). | loading, empty, error, denied |
| L4 | Label-Print-1280, Label-Print-A4, Label-Print-thermal | 1280, A4, thermal / all present | Preview and print layouts drawn; thermal page size and custody-trail print are described, not coded (DP2-24). | loading, empty, error, denied |
| L5 | Admin-Refunds-1280 | 1280 / all present | Finance and Ops variants, step-up, empty, error drawn. No denied state for other roles. | loading, denied |
| L6 | Admin-Reconciliation-1280 | 1280 / all present | All named states drawn; "resolve exception" recorded as a contract gap. | none |
| M1 | Booking-Detail-States-1280, Booking-Detail-States-360 | 360, 1280 / all present | SAMPLE_RECORDED, REPORT_IN_REVIEW, UNDER_TEST with moved date and per-line status drawn; roles not names. "usually within 2 h" contradicts BR-048 (DP2-15). | loading, error, denied |
| M2 | Scanner-Outcomes-360-strip, Scanner-Outcomes-768 | 360, 768 / all present | Four rejections, discrepancy reason, failed offline sync drawn at 360 and 768. | loading, empty, denied |
| M3 | Receipt-Reasons-1280, Receipt-Reasons-360 | 360, 1280 / all present | Queue at 360, hold, reject, approve with sample ID, blocked drawn. Reject list includes "Degraded in transit" (DP2-21). | empty, denied |
| M4 | Testing-Start-Eta-1280 | 1280 / all present | All named states drawn. | empty, denied |
| M5 | Report-Upload-Errors-1280 | 1280 / all present | All named file and validation states drawn. | empty, denied |
| M6 | Report-Bind-Scan-360-strip | 360 / all present | Scan, matched list, wrong package, success, offline drawn. | loading, empty, denied |
| M7 | Report-Review-Amendment-1280 | 1280 / all present | v1 beside v2, amendment reason, return with comments, publish step-up drawn. | loading, empty, error, denied |
| M8 | Report-Amendment-Create-1280 | 1280 / all present | Create with reason, upload, bind, submit, one draft, Superseded, queue note drawn. | loading, empty, denied |
| M9 | Customer-Report-1280, Customer-Report-360, Customer-Report-768 | 360, 768, 1280 / all present | Released, share-link create and list, superseded view, custody trail, dispute countdown drawn at 360, 768, 1280. Share-link dates predate the release (DP2-17). | loading, empty, error, denied |
| M10 | Admin-BreakGlass-Audit-1280 | 1280 / all present | Request, waiting, approval, active grant, download, revoke, audit search, empty, denied drawn. Revoke is shown under an Ops identity (DP2-02). | loading, error |
| N1 | Dispute-Customer-1280, Dispute-Customer-360 | 360, 1280 / all present | Raise, window, closed window, thread, decision and refund outcome, withdraw, DISPUTED and COMPLETED details drawn. Decision posted while status reads "Waiting on lab" (DP2-17). | loading, empty, error, denied |
| N2 | Rating-1280, Rating-360 | 360, 1280 / all present | All named states drawn. | loading, empty, denied |
| N3 | Finance-Documents-1280, Finance-Documents-360 | 360, 1280 / all present | Both tabs, filters, download, empty, error drawn; no export control. Invoice numbers prefixed VTL (DP2-25). | loading, denied |
| N4 | Dashboard-Finance-1280, Dashboard-Finance-360 | 360, 1280 / all present | Payments due, recent documents, refunds, empty, MFA state drawn. | loading, error, denied |
| N5 | Lab-Dispute-Response-1280 | 1280 / all present | List from the DISPUTED inbox filter, detail, respond, decided, no dispute drawn. List columns (dispute id, status, respond-by) are not in `LabInboxItem` (DP2-06). | loading, error, denied |
| N6 | Admin-Disputes-1280 | 1280 / all present | Queue, assign, detail, decide with refund amount, decided, hold note, denied drawn. | loading, error |
| N7 | Admin-Payouts-Holds-1280 | 1280 / all present | All named states drawn; only eligible rows selectable; count equals ticked rows. | loading, error |
| N8 | Admin-Config-Templates-1280 | 1280 / all present | Keys, propose form, validation, saved, templates, denied drawn. A platform-fee row and sentence are drawn (DP2-26). | loading, empty, error |
| N9 | Admin-Platform-Users-Leads-1280 | 1280 / all present | Users and leads drawn under a Platform Admin identity; leads are Ops-only in the contract (DP2-03). | loading, error |

Method note: the generic search looks for words such as "Loading", `aria-busy`, "No … yet", "We couldn't", `INTERNAL_ERROR`, "You don't have access". It was checked against my reading of every board, and corrected by hand once (M8 draws an `INVALID_STATE_TRANSITION` error). A state drawn without those words would be missed.

### 3.3 Files in the folder that the prompt did not ask for

None. The folder holds 131 `.dc.html` boards: the 89 new files, the 42 corrected or unchanged first-run files (43 minus `F9`), plus `lc.css`, `canvas.json`, `README.md`. `canvas.json` lists all 131 boards on 13 pages, with no two boards overlapping on a page and 137 notes (13 page titles, 124 board notes); each new board family has a note, and the two L4 print-sheet notes carry no i18n keys.

### 3.4 Booking states: every one has a customer screen

| State | Customer screen | Present |
|---|---|---|
| REQUESTED | `K4-Booking-Requested-*`, C3.8 confirmation | Yes |
| COUNTERED | `C4-Counter-1280`, C4.2 | Yes |
| ACCEPTED | `K7-Booking-Accepted-*` | Yes |
| PAID (transient) | `L1-Pay-States-*`, "Paid (CAPTURED)" | Yes |
| HANDOVER_SET | `C6-Handover-*` | Yes |
| SAMPLE_RECORDED | `M1-Booking-Detail-States-*` | Yes |
| ON_HOLD | `C7-Hold-1280`, C7.2 | Yes |
| RECEIVED | C7.3 in `C7-Detail-360-strip` | Yes |
| UNDER_TEST | `C7-Detail-*`, `M1` (moved date, per-line status) | Yes |
| REPORT_IN_REVIEW | `M1` | Yes |
| REPORT_RELEASED | `M9-Customer-Report-*` | Yes |
| DISPUTED | `N1-Dispute-Customer-*` (thread, decision) | Yes |
| COMPLETED | `N1` "COMPLETED detail" | Yes |
| REJECTED | `K6-Booking-Closed-*` | Yes |
| EXPIRED | `K6` | Yes |
| EXPIRED_UNPAID | `L2-Booking-Unpaid-NoShow-*` | Yes |
| NO_SHOW | `L2` | Yes |
| CANCELLED | `K5-Booking-Cancel-*` "CANCELLED detail" | Yes |

18 of 18. The E4 board lists the same 18 in state-machine order.

## 4. Accessibility results

Standard: WCAG 2.1 AA. Contrast is computed from the token values in the new `lc.css` (2.1: 4.5:1 text, 3:1 interface components). It is a calculation, not a measurement of pixels.

### 4.1 Contrast

Every text-on-background pair defined in `lc.css` rules (48 rules with both a `color` and a `background`) and every foreground and background pair set together in inline styles (11 distinct pairs) passes. The lowest ratio among pairs actually used is 4.79 (success badge); the lowest in the whole token matrix is 4.56 (success or warning text on the brand tint or neutral background), a pair that no rule or inline style combines. Text placed on a surface by the parent element's class, not by its own rule, is covered only by the matrix.

| Pair (foreground on background) | Ratio | Needs | Result |
|---|---|---|---|
| Body gray-900 on white / gray-50 | 17.74 / 16.98 | 4.5 | Pass |
| Muted gray-600 on white / gray-50 / brand tint / neutral-bg | 7.56 / 7.23 / 6.87 / 6.87 | 4.5 | Pass |
| Muted on warning / info / danger / success backgrounds | 7.29 / 6.94 / 6.91 / 7.22 | 4.5 | Pass |
| Link and primary text blue-600 on white / gray-50 / brand tint | 5.39 / 5.16 / 4.90 | 4.5 | Pass (tint thin) |
| Primary button white on blue-600 / hover blue-700 / pressed blue-800 | 5.39 / 7.32 / 9.77 | 4.5 | Pass |
| `--color-brand-on-tint` blue-800 on brand tint (chip, nav, tab, step, brand badge) | 8.88 | 4.5 | Pass |
| Badge success on its background / warning / danger / info / neutral | 4.79 / 4.84 / 5.91 / 6.16 / 6.87 | 4.5 | Pass (success and warning thin) |
| Alert text `#14532D` on success-bg / `#78350F` on warning-bg / `#7F1D1D` on danger-bg / `#1E3A8A` on info-bg | 8.70 / 8.75 / 9.16 / 9.52 | 4.5 | Pass |
| Destructive white on `#B91C1C` / hover `#991B1B` | 6.47 / 8.31 | 4.5 | Pass |
| Provisional tag `#7C2D12` on `#FFEDD5` | 8.18 | 4.5 | Pass |
| Diff removed `#7F1D1D` on `#FEE2E2` / added `#14532D` on `#DCFCE7` | 8.20 / 8.30 | 4.5 | Pass |
| White on step and timeline "done" success / warning fill | 5.02 / 5.02 | 4.5 | Pass |
| Success, warning text on white (stars, ticks) | 5.02 / 5.02 | 4.5 | Pass |
| White on scanner `#0B0F14` / camera `#3A4450` / button `#1F2937` | 19.22 / 9.89 / 14.68 | 4.5 | Pass (video behind text not checkable) |
| Placeholder gray-500 on white / gray-50 | 4.83 / 4.63 | 4.5 | Pass (thin) |
| Disabled text gray-500 on gray-100 | 4.39 | exempt | Exempt (inactive) |
| Error text 13 px danger on white | 6.47 | 4.5 | Pass |
| **Switch OFF track `--color-border-strong` on white / gray-50** | **4.83 / 4.63** | 3 | **Pass (first run 2.54, fail)** |
| White knob on the OFF track | 4.83 | 3 | Pass |
| Input and control border gray-500 on white / gray-50 / brand tint | 4.83 / 4.63 / 4.39 | 3 | Pass |
| Focus ring blue-600 on white / gray-50 / brand tint | 5.39 / 5.16 / 4.90 | 3 | Pass |
| Focus ring white on dark scanner / camera `#3A4450` | 19.22 / 9.89 | 3 | Pass (the first run's ring on the dark scanner was 3.57) |
| Map pin outline gray-500 on map `#EAF1F0` / bookable fill blue-600 on map | 4.22 / 4.71 | 3 | Pass |
| Cluster label blue-800 on 18 % blue over the map | 6.75 | 4.5 | Pass |
| gray-400 outline on dark `#0B0F14` / on `#3A4450` (D1 secondary button) | 7.57 / 3.90 | 3 | Pass |
| Decorative only: blue-200 ring on white / blue-100 halo / gray-300 step circle on white | 1.67 / 1.26 / 1.47 | none | Not a requirement; each carries a number, tick or label |

### 4.2 Touch targets at 360 and below 768

Reading of `lc.css` and the markup (not measured). Rules: `.btn`, `.btn-sm` 44 px under 768 and inside `.phone` and `.m360`; `.chip` and `.seg button` 44 px there; `.tabs [role="tab"]` 44 px; `.check`, `.radio` 44 px rows; `.slot` 44 px; `.tap` and `.btn-link` 44 px; icon buttons 44 × 44 px; bottom nav items 56 px. `btn-sm` appears in 0 of the 40 phone-width files (39 named `-360` plus `M2-Scanner-Outcomes-768`, which uses `.m360`); it has 114 uses in other boards. Failures: the five plain links of DP2-08. Inline `height` under 44 px on an interactive element: 0 (the radios of 20 px sit inside 44 px label rows). 2.2 only (SC 2.5.8, 24 px minimum): no failure.

### 4.3 Other checks

| Check | Result |
|---|---|
| Focus styles | One rule covers a, button, input, select, textarea, summary, `[tabindex]`, tabs, radios, switches, `.chip`, `.seg button`, `.check`, `.radio`, `.rcard`, `.input:focus-within`; dark scanner uses a white ring. Pass in CSS. Focus order, trapping in dialogs and sheets: not checkable |
| Status by more than colour | Pass. Badge, SLA, chip and alert text carry an icon and a label; map pins are told apart by fill, outline style (solid or dashed), a tick or "i", and a legend (A1 3c) |
| Labels and error text | Visible `label for` on 305 labels, all bound to real controls. `aria-describedby` 101 (first run 2); `role="alert"` or `aria-live` 156 (first run 6). OTP groups: all have `autocomplete="one-time-code"` |
| Headings, landmarks | `lang="en"` on 131 of 131. `<main>` on 127 of 131 (not on A2, A3, A4, B2-768; first run 14 of 43). Boards drawn as strips repeat `<h1>` and `<main>` once per phone screen (222 `<h1>` in 131 boards); H2-768 and K5-1280 have two on a full page. Skip link on 78 of 131 |
| Tables | 86 tables, 83 captions, 371 of 386 `th` with `scope` (first run 20 tables, 0 captions, 0 of 79 scopes). Missing on A4, F7, F8 |
| Tabs | `role="tab"` 71, `tablist` 20, `tabpanel` 10 (first run 7, 2, 0). Four boards have tabs with no panel (DP2-10) |
| Live regions and toasts | Present on the OTP, MfaPrompt, payment return, scan and error states. The one toast (`A4`, "Labels sent to printer") is a plain `div` with no `role="status"` or `aria-live`; the checklist asks that toasts are announced (DP2-10) |
| 2.2 only | SC 2.5.7 dragging: met. Pins on F1, F10, H7, J1, J7 have tap, arrow keys and latitude and longitude fields, and no board says "drag". SC 3.3.8 accessible authentication: met in markup (paste and autofill on every OTP group). SC 2.4.11 focus not obscured: not addressed (DP2-29). SC 2.5.8: met |
| Not checkable | Keyboard order, focus trapping, screen-reader output, real wrapping, 200 % zoom, Hindi, reduced motion (the CSS has no animation) |

## 5. Scope and hard-rule check result

| Rule | Result |
|---|---|
| Exclusion list (pickup, riders, logistics, GPS, subcontracting, negotiated quotations, purchase orders, medical labs, calibration booking, native apps, platform fees) | Clean in the new boards except DP2-26 (a platform-fee row in N8). Calibration appears only as "booking coming soon" (H1). One transport word in a reject-reason sample (DP2-21). The cover repeats the exclusion list |
| Deferred items (chat, compare labs, saved searches, cart, SMS, WhatsApp, phone OTP, Hindi) | None drawn. "Compare price and turnaround" (H1, DP2-21) is copy, not a feature |
| No gateway or bank named, drawn or imitated | New boards: clean (`L1` shows only "secure payment page" and the codes `GATEWAY_UNAVAILABLE`, `PAYMENT_AMOUNT_MISMATCH`). **First-run board `C4-C5-360-strip` names a bank, UPI, cards and "ICICI docs" (DP2-04).** `HDFC0001234` is an IFSC sample (DP2-22) |
| Maker and Checker are different people; one lab role per user | Held. Same-person cases appear only as role-changed cases: D2, D3, M3 (A-22), K8 `viewerWasMaker` (tagged), L3 and G3 (untagged, DP2-09). J5 refuses a second role in words and in an example. A Maker cannot approve in any board |
| Capabilities shown only to roles that have them | Three faults: DP2-01 (MFA reset), DP2-02 (revoke), DP2-03 (leads). Role cells otherwise match `x-roles` for every operation named in the notes (the 73 operations that carry `x-roles`, all admin and platform ones, were read; the Ops-versus-Finance split on J9, L5, N6, N7 is correct) |
| No other organisation's data to a tenant user | Held. ULR errors name no booking (F6, M5); customer views show lab staff by role ("Lab Maker", "Lab Checker"); K1's duplicate list shows the same organisation's bookings; lab pages show only that lab's customers. Ops and Finance views show several organisations, as the matrix allows |
| No personal data in a URL | Held. G1 and G3 say so; the only URLs drawn are `labconnect.example/r/FAKE-SHARE-TOKEN` and `tel:` for the desk phone OQ-70 allows |
| Contract fields | Operation ids in every note that lists operations exist in `openapi/` (205 operations; two non-matches, `sendBack` and `disputeWindow`, are i18n key parts). Schema, enum and field names in the notes all appear in the contract text (a token search, not a per-schema check). Enums checked against `enums.yaml`: `ImportRowAction`, `ImportStatus`, `BookingLineStatus`, `TimerType`, `DisputeStatus`, `DisputeOutcome`, `AdminPayoutHoldPlaceReason`, `PaymentOrderStatus`, `RefundStatus`, `PayoutStatus`, `VerificationStatus`, `ScanStatus`. Faults: DP2-06 |
| Money, time, IST | New boards: 0 of 229 times without IST, 0 of 120 amounts off format. Residuals: DP2-11, DP2-12 |

## 6. Token changes between the runs

| Token | First run | Pass 2 | Allowed? |
|---|---|---|---|
| `--color-brand-primary-active` | not defined | `var(--qci-blue-800)` (`#13476D`) | Yes (A-01) |
| `--color-brand-on-tint` | not defined | `var(--qci-blue-800)` (`#13476D`) | Yes (A-01) |
| `--color-brand-tint-border` | not defined | `var(--qci-blue-200)` (`#A9CDE8`) | Yes (A-01) |
| The 54 first-run tokens | as before | unchanged (every value compared) | n/a |

Tokens: 54 before, 57 after. No brand value added or changed. Rule changes in `lc.css` (it grew from 195 to 297 lines; about 66 rules differ): `.btn`, `.btn-sm/lg/xl`, `.chip`, `.badge`, `.input`, `.topbar`, `.mhdr` use `min-height` instead of `height`; `.input` text 15 px to 16 px; `.switch` OFF track gray-400 to `--color-border-strong`; `.prov` 11 to 12 px; map labels and `.spec` 10 and 11 px to 12 px; `.pin.listed` gets a dashed border; `.cluster` fill uses `color-mix`; white literals replaced by `--color-surface-raised` or `--color-text-inverse`; one `:focus-visible` rule replaces the `.btn` and `.input` rules; 27 new classes (`.bare`, `.bnav`, `.bsheet`, `.check`, `.radio`, `.rcard`, `.dialog`, `.slot`, `.stars`, `.stat`, `.skip`, `.tap`, `.m360`, `.label-sheet`, `.noprint`, `.pbreak` and others) support the G4 components. Brand-dependent values to re-derive when OQ-19 closes: the same list as review §6 of the first run, now including the three new tokens, which move with `--qci-blue-800` and `--qci-blue-200`.

## 7. The "Open, do not design yet" items

| # | Item | What was drawn | Result |
|---|---|---|---|
| 1 | Refund or fee amounts | "Refund amount: shown once confirmed", tagged "Placeholder", on K5 (two dialogs and the CANCELLED detail), L2 NO_SHOW, M1 cancelled line. No figure, formula or percentage | Done, with gaps: EXPIRED_UNPAID has no row; `C7-Hold` says the amount is seen before confirming (DP2-23) |
| 2 | Tax invoice issuer and split | Layout kept; "Provisional" on C7-Detail, F2, F3, N3 | Done; invoice numbers use the lab's initials (DP2-25) |
| 3 | Terms and consent text | C3 checkbox removed, nothing else drawn | Partly: F1 sentence and B1 footer remain (DP2-27) |
| 4 | Self-approval blocked state | D2, D3, M3 with "Provisional (OQ-59)"; also K8 (tagged), L3 and G3 (untagged) | Partly: untagged uses (DP2-09); the prompt said D2 and D3 only |
| 5 | Revoked report wording | One sentence and a contact hint, tagged "Provisional wording, legal review pending". The sentence says "The lab that issued this report has withdrawn it", which names the lab as the actor; revocation may be by Ops | Done; record the actor question for legal review |
| 6 | Brand | Existing tokens; "Provisional brand" tag on the 1280 boards, as in the first run | Done |
| 7 | Alternatives on a rejected or expired booking | Two labs, "Source not in the contract" (C4.3, K6 ×2); no third | Done |
| 8 | Customer-side reprint | C6: "Call the desk or ask at the counter: only the lab can reprint a label". L3: Maker requests, Checker approves, no decline | Done |
| 9 | Hold option "reduce lines" | Three options (C7-Hold, C7.2, G4) | Done |
| 10 | Gateway cancel versus failure | L1: "Failed" and "Not completed", no gateway wording | Done on L1; not on C4-C5 (DP2-04) |
| 11 | Lab settlement advice list | Not drawn; N5 note says so | Done |
| 12 | Dispute list for labs | N5 uses the DISPUTED inbox filter | Done; list columns need `getDispute` (DP2-06) |
| 13 | Dispute sub-states | `DisputeStatus` values only (N1, G4); no transitions | Done |
| 14 | Ops "request information" | Not drawn; N6 says "no Ops operation writes a message" | Done |
| 15 | Ops override and cancel after UNDER_TEST | Not drawn; K11 cancel up to UNDER_TEST, "Overriding … is not available (OQ-24)" | Done |
| 16 | Admin operations with no contract | Not drawn; listed as "no operation" in notes and on H5, N3, N8 | Done |
| 17 | Hold payouts | N6 Ops places, N7 Finance releases, "There is no extend" | Done |
| 18 | Customers see roles, not names | M1, N1, K7, G4 show "Lab Maker", "Lab Checker" | Done |
| 19 | "Notify Checkers", B2-360 "Share" | Left as drawn (D2, D3, B2-360) | Done |
| 20 | Language and GIGW | Nothing drawn | Done |

No item was decided by the run on its own. Two of its own tags are stale: "Money format … Proposed" is an open-list row on the cover and README though the format is decided (DP2-11).

## 8. Proposed open questions for the product owner

| # | Question | Recommended default |
|---|---|---|
| 1 | Who may reset a lost authenticator for lab and customer users? The boards say a Checker or Customer Admin can | `PLATFORM_ADMIN` only, as `AUTHENTICATION_AND_AUTHORISATION.md` says. Screens say "contact LabConnect support" |
| 2 | Who may revoke a break-glass grant? M10 shows it to the Ops requester | `PLATFORM_ADMIN` only, as the contract says. Ops requests and downloads |
| 3 | Should a Platform Admin see the Ops booking list, Ops board and leads? K10 and N9 suggest so | No: `PLATFORM_OPS` only, as `x-roles` says. Add Admin access by contract change first if wanted |
| 4 | Add semantic tokens for the values still literal (alert text colours, danger hover, scanner and diff colours), or accept literals in `lc.css`? | Add them in D-04 as `--color-*-strong` and scanner tokens; leave the boards as they are |
| 5 | The numbers in the copy: duplicate window 7 or 30 days, open-booking cap 10 or 20, Checker receipt approval 2 hours or 1 business day | The values of BR-016, BR-015 and BR-048 (7 days, 10, 1 business day); copy reads them from configuration |
| 6 | Should a wrong OTP show "N tries left"? The contract returns no count | No: "That code didn't match." and the lock message when `OTP_LOCKED` arrives |
| 7 | Show a locked platform-fee row on N8? | No. Draw no platform-fee row or sentence (section 6) |
| 8 | Keep "By continuing you agree to the terms of use and privacy policy" on sign-up and "Terms" in the footer while OQ-04 is open? | Remove the sentence until the legal text exists; keep a footer link only if the page exists |
| 9 | Show a "Just taken" row after `SLOT_UNAVAILABLE`? | No. Reload the open slots and show the error text only |
| 10 | Should every date carry the year, including slot labels such as "Thu 26 Nov"? | Full `DD MMM YYYY` everywhere except slot chips inside the next 14 days, which may drop the year |
| 11 | Where may the role-changed (self-approval) case appear? | Only where the prompt says (D2, D3, M3, K8), each tagged "Provisional (OQ-59)"; remove G3's example and L3's case or tag them |
| 12 | K7 offers "Decline the counter-offer" on the ACCEPTED page; `declineBookingCounter` applies in COUNTERED | Offer it only on the COUNTERED page (`C4-Counter`); K7 keeps Pay and Cancel |
| 13 | N5 lists disputes with id, status and respond-by; `LabInboxItem` has none of them | Draw the list with the booking only and open the dispute for the rest, or add the fields to the contract |
| 14 | A reminder button for a Requester who cannot pay (K7) and a "reassign bookings" step (J2) | Draw neither until an operation exists; keep the sentence "Ask your Finance team to pay" |
| 15 | Who made the revocation on a revoked report page: the lab, Ops or either? | Say "This report has been withdrawn" with no actor until legal review finishes |

## 9. What this review could not check

- **Rendering.** Nothing was opened in a browser. Overflow, wrapping, line lengths, the 44 px targets as laid out, 200 % zoom, 320 px reflow, and the Play prototype are unverified. Contrast was computed from token values, not measured; text over the camera, map and photos is not checked.
- **Keyboard and assistive technology.** Focus order, focus trapping in dialogs and sheets, screen-reader announcements, `aria-live` timing.
- **Part B state coverage by keyword search.** Loading, empty, error and denied states were found by words and by reading; a state drawn without those words is missed, and a board that shows a state in a way I misread is not counted. I did not read every `<script>` data block: only `C7-Hold` and `D3` carry interactive scripts, which I read for their option and mode text.
- **Contract depth.** I checked every operation id in the notes, `x-roles` for the operations the notes name, and the enums and schemas listed in section 5. I did not walk every field of every schema against every board. Admin lists that return ids (`labSiteId`, `customerOrgId`) are drawn with names; the README states the name-lookup assumption.
- **`packages/shared`.** Config key names and the exact `roleRequiresMfa` code were not opened; I used the documents.
- **`support.js`, the live canvas link and the uploaded logo.** Not in the folder or not opened.
- **Hindi and strings 30 to 40 percent longer.** Not tested.
- **Plausibility of sample data** (amounts, GST, ULR format) beyond the conflicts listed in DP2-15, DP2-16 and DP2-17.
- **`pnpm format:check`.** See the report; `docs/` and `*.md` are in `.prettierignore`, so the check does not read this file.
