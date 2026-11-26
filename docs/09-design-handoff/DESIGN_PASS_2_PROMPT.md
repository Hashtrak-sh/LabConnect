# Design pass 2 prompt (Claude Design)

**Status:** Ready to run. Written 26 Nov 2026 after the D-03 review ([`DESIGN_REVIEW_D-03.md`](DESIGN_REVIEW_D-03.md)) and the product owner's partial approval of the first run (task D-02, [`DESIGN_MASTER_PROMPT.md`](DESIGN_MASTER_PROMPT.md)).
**How to use it:** open Claude Design, attach the files listed in section 2, and paste everything from the line "PROMPT STARTS HERE" to the end. The prompt is Markdown, not one code block, because it contains tables that the tool must read as tables. The person who runs it should read sections 7 and 8 first: they say what to expect back and what the tool must not decide.
**Brand:** still provisional (OQ-19). This run must keep using the existing tokens and must not introduce a new brand value.

---

PROMPT STARTS HERE

You are continuing the design of LabConnect, a government-operated marketplace (QCI branding) for finding and booking NABL-accredited (National Accreditation Board for Testing and Calibration Laboratories) industrial testing laboratories in India. A first design run produced 43 HTML boards. A written review of that run found what is wrong and what is missing. This is the second run. It corrects some boards and adds the missing ones. It does not start again.

Read, in this order:

1. `docs/09-design-handoff/DESIGN_REVIEW_D-03.md`: the review. Its finding ids (DR-01 to DR-39) are used below. Read all of it.
2. `docs/09-design-handoff/DESIGN_BRIEF.md`, `UX_PRINCIPLES.md`, `DESIGN_SYSTEM.md`, `COMPONENT_SPECIFICATION.md`, `RESPONSIVE_DESIGN_GUIDELINES.md`.
3. `docs/09-design-handoff/BRAND_GUIDELINES.md`: the brand values are provisional. Use only the tokens in `designs/lc.css`.
4. `docs/09-design-handoff/CUSTOMER_USER_FLOWS.md`, `LAB_USER_FLOWS.md`, `ADMIN_USER_FLOWS.md`.
5. `docs/01-product/SCOPE_AND_EXCLUSIONS.md`, `ROLES_AND_PERMISSIONS.md`, `GLOSSARY.md`, `EDGE_CASES.md`.
6. `docs/02-architecture/BOOKING_STATE_MACHINE.md`.
7. The API contract in `packages/api-contract/openapi/` (`paths/*.yaml` and `components/schemas/*.yaml`). It is the only source for field names.

## 1. Purpose, and what not to redo

The product owner approved the first run **in part** on 26 Nov 2026, for the minimum viable product (MVP).

**Approved to build from, each with the corrections in Part A:** the token sheet, the control and booking components, the public search, lab and verification pages, the C3 to C7 customer booking journey, the Maker scanner, receipt approval, and the dashboards.

**Not approved, and the subject of this run:**

- lab onboarding and the catalogue flows (L1, L5, L8, L9, L10),
- the admin console (A1, A3, A5, A6, A7),
- the customer states and screens that were not drawn (DR-07 to DR-11),
- the sign-in screens for roles that need multi-factor authentication (MFA) at sign-in (DR-39).

**Rules for this run:**

- The approved boards change **only** where a Part A entry names them. Do not restyle, re-lay-out or "improve" anything else on them.
- New boards must look like the first run: same `lc.css`, same components, same header, same density, same sample data. A reader must not be able to tell which run drew a board.
- Use the existing tokens. Do not add a brand colour, typeface or logo treatment. The only new tokens allowed are the three semantic ones in A-01, and they are derived from existing values.
- Where this prompt or the documents leave a product decision open, do not decide it. Section 8 lists those items and the placeholder to draw, if any.

Decisions taken after the review, which are binding on this run:

| Id | Decision | Settles |
|---|---|---|
| OQ-69 | Slots show open slots only. No "places left" count and no "Full" row. | DR-06 |
| OQ-70 | The handover page shows the full lab desk phone number to the paying customer. Masking stays for Ops views. | DR-17 |
| OQ-71 | Public ratings are the overall average and the count only. Rating comments go to the lab and to Ops, never public. | DR-16 |
| OQ-72 | The verification page for a revoked report shows the result and a contact hint only, no report fields. Legal review of the wording is still to come. | DR-05 |
| OQ-73 | No booking-level short code and no "Send to my phone". The Maker uses package short codes. | DR-18 |
| OQ-74 | Sign-in screens for the roles that need MFA at sign-in are in the design scope: authenticator-code (TOTP) challenge, enrol first, session expired, access denied after a role change. | DR-39 |
| OQ-75 | WCAG 2.1 AA is the acceptance bar. WCAG 2.2 AA items are fixed where cheap. | DR-30 and the "2.2 only" items |

## 2. Attachments to give the tool

Attach these files from the repository. The first four groups are the visual and structural reference; the rest are the sources of truth.

| Group | Path | Why |
|---|---|---|
| Review | `docs/09-design-handoff/DESIGN_REVIEW_D-03.md` | Finding ids, coverage matrix, accessibility results |
| Token sheet in code | `docs/09-design-handoff/designs/lc.css` | The only stylesheet. This run issues a corrected copy (A-01) |
| First-run index | `docs/09-design-handoff/designs/README.md`, `canvas.json`, `Main.dc.html` | Naming, canvas pages, annotation format, the cover to update |
| Sheets | `designs/A1-Tokens.dc.html`, `A2-Controls.dc.html`, `A3-Booking-components.dc.html`, `A4-Feedback-data.dc.html` | Components and states to reuse |
| Boards to match (customer) | `designs/B1-Search-1280.dc.html`, `B2-Lab-360.dc.html`, `C3-Booking-1280.dc.html`, `C3-Booking-360-strip.dc.html`, `C4-C5-360-strip.dc.html`, `C6-Handover-1280.dc.html`, `C7-Detail-1280.dc.html`, `C7-Hold-1280.dc.html`, `E1-Customer-1280.dc.html`, `E1-Customer-360.dc.html`, `F1-Signup-360-strip.dc.html`, `F2-Report-Dispute-1280.dc.html`, `F3-Finance-1280.dc.html` | Layout, header, cards, NextActionCard, strips |
| Boards to match (lab) | `designs/D1-Scanner-360-strip.dc.html`, `D2-ApproveReceipt-1280.dc.html`, `D3-ReviewReport-1280.dc.html`, `E2-Maker-360.dc.html`, `E3-Checker-1280.dc.html`, `F4-Lab-Onboarding-1280.dc.html`, `F5-Lab-Inbox-1280.dc.html`, `F6-Lab-Report-Upload-1280.dc.html`, `F7-Lab-Catalogue-1280.dc.html` | Lab shell, queues, ApprovalPanel, dense tables |
| Boards to match (admin) | `designs/E4-Ops-1280.dc.html`, `F8-Admin-MasterData-1280.dc.html`, `F9-Admin-Disputes-Payouts-1280.dc.html`, `F10-Admin-Onboarding-Config-1280.dc.html` | Admin shell, tables, change-set review |
| Logo | `docs/09-design-handoff/reference/Logos_QCI.png` | Used unaltered in every header, as in the first run |
| Design documents | `DESIGN_BRIEF.md`, `DESIGN_SYSTEM.md`, `COMPONENT_SPECIFICATION.md`, `UX_PRINCIPLES.md`, `RESPONSIVE_DESIGN_GUIDELINES.md`, `BRAND_GUIDELINES.md` (all in `docs/09-design-handoff/`) | Rules |
| Flows | `CUSTOMER_USER_FLOWS.md`, `LAB_USER_FLOWS.md`, `ADMIN_USER_FLOWS.md` (same folder) | The screens to draw |
| Product | `docs/01-product/SCOPE_AND_EXCLUSIONS.md`, `ROLES_AND_PERMISSIONS.md`, `GLOSSARY.md`, `EDGE_CASES.md`, `BUSINESS_RULES.md` | Scope, who sees what, wording |
| States | `docs/02-architecture/BOOKING_STATE_MACHINE.md` | The 18 booking states and transitions |
| Behaviour | `docs/05-integrations/QR_AND_VERIFICATION.md`, `docs/04-api/ERROR_HANDLING.md`, `docs/04-api/AUTHENTICATION_AND_AUTHORISATION.md` | Scan outcomes, error messages, MFA rules |
| Contract | `packages/api-contract/openapi/openapi.yaml`, `openapi/paths/*.yaml`, `openapi/components/schemas/*.yaml` | Field names, enums, error codes |

The boards load a `support.js` runtime and use `<x-dc>` and `<helmet>` wrappers. Keep that file structure exactly as the first run's boards have it, so the files open the same way on the canvas.

## 3. Part A: corrections to existing boards

Issue each board named below again, **under the same file name**, in the output folder (section 7). Change only what the entry says. An entry reads: file, change, rule. Rules are written as finding id, then the source.

The corrections in A-01 apply to `lc.css` and so to every board. Boards not named in A-02 to A-39 keep their current markup; the mechanical colour clean-up of those boards is A-40 and is done last.

### 3.1 Shared stylesheet and component sheets

| No. | File | Change | Rule |
|---|---|---|---|
| A-01 | `lc.css` | (a) Replace every use of a `--qci-*` primitive inside component rules (`.btn-primary.is-active`, `.chip.on`, `.b-brand`, `.prodname`, `.nav a.on`, `.sidenav a.on`, `.tabs span.on`, `.tlm.now`, `.step.on`, `.pin.sel`, `.cluster`) with a semantic token. Add exactly three: `--color-brand-primary-active`, `--color-brand-on-tint`, `--color-brand-tint-border`, each pointing at the existing blue values the rules use today. Replace the hard-coded `rgba(31,111,168,.18)` in `.cluster` with a token. (b) Define `:focus-visible` once, on links, nav items, chips, tabs, segmented items, switches, checkbox and radio rows, as well as `.btn` and `.input` (3 px ring, `--color-focus-ring`). (c) The switch OFF track uses `--color-border-strong`, not gray-400. (d) `.btn` and `.badge` use `min-height`, not `height`, and may wrap below 768. (e) Below 768 the default `.btn` is 44 px high and `btn-sm` is not used. (f) Input, select and textarea text is 16 px. | DR-13, DR-26, DR-27, DR-28, DR-12, DR-29; DESIGN_SYSTEM §Status, §2; RESPONSIVE_DESIGN_GUIDELINES |
| A-02 | `A1-Tokens.dc.html` | Add the three new tokens of A-01 to the semantic list. Extend the status mapping beyond bookings with the groups that the boards already use: payment order (`PaymentOrderStatus`), dispute (`DisputeStatus`), report version (`ReportVersionStatus`), accreditation (`AccreditationStatus`), payout, refund, claim and verification statuses. Use only the five existing tones. Mark every tone you assign to a new group "Proposed, for review". A suspended accreditation is **warning**, not neutral. An ON_HOLD card uses **warning** (DESIGN_SYSTEM puts ON_HOLD in "Waiting on customer: warning"); the badge and the card must match. Add a map-pin legend that says what a bookable pin and a listed pin look like and does not rely on fill colour alone. Add the money and time rules of section 5. | DR-33, DR-23 |
| A-03 | `A2-Controls.dc.html` | Show the switch with the new OFF track. State the money format rule under the Money primitive. Show that a time is always followed by "IST". | DR-27, DR-23 |
| A-04 | `A3-Booking-components.dc.html` | **MfaPrompt:** add the variants *wrong code* (`OTP_INVALID`), *code expired* (a step-up is valid for 5 minutes; the dialog asks again), *locked* (`OTP_LOCKED`, with the time to wait), *too many tries* (`RATE_LIMITED`) and *not enrolled* (`MFA_ENROLMENT_REQUIRED`, with a link to enrol). Error text is tied to the field (`aria-describedby`) and announced (`role="alert"`). The field accepts paste and autofill (`autocomplete="one-time-code"`). **LabResultCard:** a suspended accreditation badge is warning (A-02). **NextActionCard:** an ON_HOLD card is warning (A-02). | DR-03, DR-33, DR-25 |

### 3.2 Public pages (B)

| No. | File | Change | Rule |
|---|---|---|---|
| A-05 | `B1-Search-1280`, `B1-Search-768`, `B1-Search-360` | Add an `<h1>` ("Labs for …", built from the query) and a `<main>` landmark. Give the search inputs a visible label. The map card "Book" button at 360 is 44 px high (no `btn-sm`). Add the pin legend of A-02 to the map. | DR-24, DR-12, DR-25, DR-33 |
| A-06 | `B2-Lab-1280`, `B2-Lab-360` | Public rating shows the overall average and the count only. Remove "TAT 4.4 · Communication 4.7". `PublicRating` has `average` and `count`, nothing else. | DR-16, OQ-71; `public-lab-sites.yaml` `PublicRating` |
| A-07 | `B3-Verify-1280`, `B3-Verify-768`, `B3-Verify-360-states` | (a) The accreditation line says the status is **as of the issue date** (`VerifiedReport.accreditation`). (b) The sample verification code has 16 characters, the format of `VerificationCode` (the contract example is `7GQ2X9KD4M1TRV8B`); if you group it for reading, group in fours and say so in the note. | DR-37, DR-34; `public-reports.yaml` |
| A-08 | `B3-Verify-360-states` (state 4, Revoked) | Remove Report number, Issued date and Lab. The page shows the REVOKED result, one sentence on what it means, and a contact hint. `ReportVerification.report` is `null` for `REVOKED` and `NOT_FOUND`. Tag the wording "Provisional wording, legal review pending" (section 8). | DR-05, OQ-72 |
| A-09 | `B3-Verify-360-states` and `B3-Verify-1280` | Add two states: *rate limited* (`RATE_LIMITED`; the contract rate is 30 requests a minute; say when to try again) and *the chosen file is not a PDF or is too large* (on the "Compare a copy" control). | DR-37; QR_AND_VERIFICATION §5 |
| A-10 | `B4-Public-edge-states-360` | The search input has a visible label. | DR-25 |

### 3.3 Customer booking journey (C)

| No. | File | Change | Rule |
|---|---|---|---|
| A-11 | `C3-Booking-360-strip` (C3.5, slot step) | List open slots only, with no counts ("4 places left" and similar) and no "Full" row. `PublicSlot` carries no capacity. | DR-06, OQ-69; `PublicSlot` |
| A-12 | `C3-Booking-360-strip` | The submit confirmation (C3.8) badge reads **Requested**, the label of the A1 mapping. "Waiting for lab (decides by … IST)" stays as the NextActionCard text, never as a badge. | DR-34; CUSTOMER_USER_FLOWS C3 |
| A-13 | `C3-Booking-360-strip`, `C4-C5-360-strip`, `C6-Handover-360-strip`, `C7-Detail-360-strip`, `E1-Customer-360`, `E2-Maker-360`, `D1-Scanner-360-strip`, `F1-Signup-360-strip`, `B1-Search-360` | Every control at 360 is at least 44 × 44 px: "Rebook here" (×2), "Open in maps", "Call desk", "Download", "Start", "Add another test", "Attach a file", "Decline", "Print labels", "Documents · custody trail", "Fix and resubmit", "Send invite", "Only 2 arrived · continue". Plain text links that act as buttons ("Edit", "All", "View full test request form") get a 44 px tap area. Bottom-navigation labels are 12 px or larger. | DR-12; RESPONSIVE_DESIGN_GUIDELINES; review §4.2 |
| A-14 | `C3-Review-1280` | Remove the checkbox "I accept the lab's terms of testing". Draw no replacement (section 8). | DR-22, OQ-04 |
| A-15 | `C3-Booking-1280` | The switch uses the new OFF track (A-01). | DR-27 |
| A-16 | `C4-Counter-1280` | "Accept and continue to payment" links to the payment board L1 (section 4.5), not to the handover page. The J1 prototype must pass through payment. | DR-36 |
| A-17 | `C4-C5-360-strip` | Times carry "IST" (C4.1 "Pay by …", C4.2, C5). C4.3 (rejected): keep the alternatives block as drawn and annotate that the alternatives have no field in the contract (section 8). | DR-23; section 8 |
| A-18 | `C6-Handover-1280`, `C6-Handover-360-strip` | (a) Show the full desk phone number next to "Call desk" (as a `tel:` link). (b) Remove the booking short code (`LC4821`) and the "Send to my phone" control. The "show this QR" view keeps the booking QR (`bookingQrPayload`) and no short code. (c) Package short codes are 6 characters from the Crockford base32 alphabet (digits and letters except I, L, O, U); replace `W3C-9LD`. (d) Replace "Lost one? Ask the lab for a reprint" with a line that tells the customer to call or visit the desk. Only the lab's Maker can request a reprint (section 8). | DR-17, OQ-70, DR-18, OQ-73, DR-10; `BookingHandover`, `ContactPerson`, `PackageShortCode`, `requestLabelReprint` |
| A-19 | `C7-Detail-1280` | The tax invoice row keeps its layout; mark the issuer and the tax split "Provisional". Remove any wording that says the lab issues it. Times carry "IST". | DR-20, OQ-08, DR-23 |
| A-20 | `C7-Hold-1280` and the C7.2, C7.3 panels of `C7-Detail-360-strip` | (a) Remove "No refund" from "Proceed as is". (b) Offer exactly three options: Proceed, Replace, Cancel (`HoldDecision`: `PROCEED`, `REPLACE`, `CANCEL`). (c) The card is warning (A-02). (d) A line says that if the customer does not decide within 24 h, Ops is told (BR-046, BR-047); it does not say the booking is cancelled. | DR-19, DR-33; BUSINESS_RULES BR-046, BR-047; EDGE_CASES EC-34 |

### 3.4 Lab boards (D, E2, E3, F4 to F7)

| No. | File | Change | Rule |
|---|---|---|---|
| A-21 | `D1-Scanner-360-strip` | Times carry "IST". Instruction text is 16 px ("Tap each check…"). The wrong-site address is in a different sector and a different city from any lab on `B1`. The manual-entry fallback takes a **package** short code. | DR-23, DR-29, DR-34, OQ-73 |
| A-22 | `D2-ApproveReceipt-1280` | (a) The blocked state: the viewer's role label is not "Checker" while the record names the same person as Maker. Draw it only as "Your role changed after you recorded this. Another Checker must approve it." and tag it "Provisional (OQ-59)" (section 8). The API answer is `SELF_APPROVAL_FORBIDDEN`. (b) The tab "Label reprints 1" opens the Checker reprint view L3. | DR-14, OQ-59; CD-22, CD-23, RR-2 |
| A-23 | `D3-ReviewReport-1280` | (a) Add the blocked state, drawn as in A-22(a): Publish disabled, the reason beside it. (b) Add the stamp states: *stamp pending* (Publish disabled, reason "The stamped copy is not ready"), *stamp failed* (with the fallback wording: the stamp is appended as a separate page). T-21 refuses publish until `stamped_file_id` is set. (c) The MfaPrompt shows the variants of A-04 in context: wrong code, step-up expired during publish, not enrolled. (d) The verification code on the stamp preview has 16 characters (A-07). | DR-01, DR-02, DR-03, DR-34; BOOKING_STATE_MACHINE T-19, T-21, R-12; `publishReportVersion` |
| A-24 | `E2-Maker-360` | "Start" is 44 px. "10–12 AM" is written "10 AM–12 PM IST". Times carry "IST". | DR-12, DR-23 |
| A-25 | `E3-Checker-1280` | The queue row "From: **You** … Another Checker" is removed from the normal queue. The self-record case appears only as the provisional case of A-22. The row "Reprint · Review" links to the reprint view L3, not `#`. Times carry "IST". | DR-14, DR-10, DR-23 |
| A-26 | `F5-Lab-Inbox-1280` | Times carry "IST". "Reject…" opens the reason dialog of K9 and the Maker variant is K8. No other change. | DR-23, DR-38, DR-32 |
| A-27 | `F6-Lab-Report-Upload-1280` | (a) Add the states *submitted, preparing stamped copy* ("Preparing stamped copy for review", the text in LAB_USER_FLOWS L6), *stamp pending* and *stamp failed*. (b) The ULR error reads "This ULR is already used." It names a booking only when the booking belongs to the viewer's organisation. | DR-02, DR-15; BR-062; `ULR_NOT_UNIQUE` |

### 3.5 Dashboards (E1, E4)

| No. | File | Change | Rule |
|---|---|---|---|
| A-28 | `E1-Customer-1280`, `E1-Customer-360` | Times carry "IST". The ON_HOLD cards are warning (A-02). Bottom-navigation labels are 12 px or larger; "Download" is 44 px. | DR-23, DR-33, DR-12 |
| A-29 | `E4-Ops-1280` | "Bookings by state" lists all 18 booking states, in state-machine order, with the A1 labels. Every tile links to a drill-down list on K10, not to `#`. Draw only what `AdminOpsBoard` returns: `bookingsByStatus` and `overdue` (a count per `timerType`). Do not draw escalation or stuck-booking tiles that have no field behind them. | DR-08; `AdminOpsBoard`, `AdminStatusCount`, `AdminOverdueCount`; BOOKING_STATE_MACHINE §1 |

### 3.6 Remaining flows (F)

| No. | File | Change | Rule |
|---|---|---|---|
| A-30 | `F1-Signup-360-strip` | (a) C2.5: the map pin can be placed by tap, moved by the arrow keys, and set by latitude and longitude fields. The text "Drag the pin if it's not right." goes. (b) The one-time-code field has 6 boxes (`OtpCode` is six digits), accepts paste and autofill, and ties its error text to the field. | DR-30, OQ-75, review §3.1 (C2 row), §4.3; `OtpCode` |
| A-31 | `F2-Report-Dispute-1280` | The rating hint says the comment goes to the lab and to LabConnect Ops and is not shown publicly. The tax invoice mention is provisional (A-19). | DR-16, OQ-71, DR-20 |
| A-32 | `F3-Finance-1280` | Remove "LabConnect charges no platform fee." The tax invoice issuer and "CGST 9% + SGST 9%" are marked "Provisional" (A-19). Times carry "IST". Money follows section 5. | DR-21, DR-20, DR-23 |
| A-33 | `F9-Admin-Disputes-Payouts-1280` | **Do not re-issue.** It is replaced by two boards: N6 (Ops dispute decision) and N7 (Finance payout release). The page mixed an Ops identity with a Finance-only action; it also said "Release 3 payouts" with two rows ticked. | DR-04; ROLES matrix "Payout hold / release"; OQ-57(a) |
| A-34 | `F10-Admin-Onboarding-Config-1280` | (a) The pin review has a tap-to-place alternative and latitude and longitude fields; the text "Drag B to adjust before approving." goes. (b) Show the configuration table ("Platform Admin only") and the break-glass approval queue **only** in a Platform Admin variant. The Ops variant omits both. (c) "Reject…" on a claim opens the reason dialog of J9. | DR-30, DR-31, DR-38; ROLES matrix (Configure SLAs; break-glass note 7) |
| A-35 | `Main.dc.html` | Updated cover: see section 7. | DR-13 and the index rule |

### 3.7 Rules that touch many boards

| No. | Scope | Change | Rule |
|---|---|---|---|
| A-36 | `E1-Customer-1280`, `E1-Customer-360`, `F3-Finance-1280`, `F5-Lab-Inbox-1280`, `E2-Maker-360`, `C4-C5-360-strip`, `D1-Scanner-360-strip`, `C7-Detail-1280` | Every time and deadline ends with "IST": "by 26 Nov, 4 PM IST", "Lab decides by 5:00 PM IST", "Due by 4:30 PM IST", "Slot Thu 26 Nov, 10 AM IST", custody "10:31 AM IST". | DR-23; UX_PRINCIPLES 7 |
| A-37 | boards that show the sample lab | One name: "Vasundhara Testing Laboratories" on first use on a board, then "Vasundhara" in tight places. Remove "Vasundhara Testing Labs" and "Vasundhara, Gurugram". Booking badge labels follow the A1 mapping; "Counter-offer" is the one term for what the lab proposes ("The lab proposed a change" is removed). | DR-34; GLOSSARY "Counter-offer" |
| A-38 | every re-issued board | Body and instruction text is 16 px. Use 14 px only for dense table cells and captions, and 12 px only for captions and badges. No text below 12 px. | DR-29; DESIGN_SYSTEM §2 |
| A-39 | every re-issued board | Real form controls (`input`, `select`, `textarea`, `button`), labels bound with `for`/`id`, error text tied to the field, `<main>`, headings in order, `th scope`, a `caption` on each table, tabs with `role="tablist"`, `tab`, `tabpanel`, and a skip link. See section 5. | DR-24, DR-25 |

### 3.8 Last: the mechanical clean-up

| No. | Scope | Change | Rule |
|---|---|---|---|
| A-40 | All first-run boards not named above | After everything else is done, replace each literal hex colour in `style="…"` with the semantic token that has the same value (408 literals, 398 of which equal a token value). The rendering must be unchanged except for the switch track (A-01c). Do this last. If the run runs out of room, stop and say so on the cover: the clean-up can also be done at build time. | DR-13 |

### 3.9 Findings handled in Part B, not here

| Finding | Where |
|---|---|
| DR-07 | K4 to K7, L1, L2, M1, N1 |
| DR-08 | H5, H6, H7, J9, K10, K11, L5, L6, M10, N6 to N9 |
| DR-09 | H4, J3 to J10, K9, M4, M7, M8, N5 |
| DR-10 | L3, L4 |
| DR-11 | M9, N1, N3, N4, J2 |
| DR-32 | K8 |
| DR-35 | G4 |
| DR-36 | H2, J1, K1, K2, K8, M3, M9, G4, L4 |
| DR-38 | K9, M2, M3, J9 |
| DR-39 | G1 to G3 |

## 4. Part B: new boards

### 4.1 How to read the tables

- **File names** follow the first run: a stage letter, a number, a name, then the width, with `-360-strip` for a row of phone steps side by side and `-states` for a sheet of states. `{360-strip,1280}` means one file per width.
- **Stage letters** follow the build order of the breadth-first increments in `docs/08-project/ROADMAP.md`. The letter I is skipped because it reads as an increment id.

| Letter | Increment | Theme |
|---|---|---|
| G | before I1 | Cross-cutting: sign-in and shared components (needed from the first admin screen) |
| H | I1 | Directory |
| J | I2 | Onboarding |
| K | I3 | Request and decide |
| L | I4 | Pay and hand over |
| M | I5 | Receive, test, report |
| N | I6 | Close the loop |

- **Design in this order**: G, then H, J, K, L, M, N. Pause for review after each letter.
- **Widths:** the flow documents ask for desktop and mobile on most customer flows, mobile first for the Maker's counter, desktop only for lab configuration and for the admin console. A board lists the widths it needs. 360, 768 and 1280 are the design widths. Where a board is desktop only, it still follows the first run's rule: admin below 1024 shows a "best on a larger screen" notice (drawn once, in G4).
- **Flow step** is the flow document and its heading (C, L or A number). The flow files have no step ids below that, so the step is named in words.
- **States:** every board draws, where they apply, *loading* (skeleton, `aria-busy`), *empty*, *error* (with what happened, why and what to do, using the codes of `docs/04-api/ERROR_HANDLING.md`), *permission denied* (a role that must not see the screen) and the booking states of `BOOKING_STATE_MACHINE.md` that the screen can show. A state that cannot happen on a board is not drawn.
- **Contract:** operation ids and schema names from `packages/api-contract/openapi/`. Take field names from the schema. A field that is not in the schema is not drawn (section 5).
- **Roles** use the role codes of `ROLES_AND_PERMISSIONS.md`. Show a role only what its row in the permission matrix allows.
- **Sample data:** reuse the first run's names and values as they appear in its boards. Do not invent a real person, e-mail address or phone number. Use the formats of the contract: booking number `LC-YYMM-NNNNNNN`, package short code of 6 Crockford base32 characters, verification code of 16 characters.
- **Annotation:** each board gets a note on the canvas, as in `canvas.json`, listing the operations and fields used, the validation messages, and a proposed i18n key for each string (`area.screen.element`). The keys are proposals; D-04 confirms them.

### 4.2 Stage G: cross-cutting (before I1)

| File | Flow step | Role | Widths | States to draw | Contract |
|---|---|---|---|---|---|
| `G1-Signin-{360-strip,1280}` | CD-25; C1 "sign-in prompt only when booking"; OQ-74 | Every user; the TOTP step is for `LAB_CHECKER`, `CUSTOMER_FINANCE` and all platform roles | 360, 1280 | Step 1 e-mail; step 2 one-time code (6 boxes, paste and autofill, wrong code, expired, locked, rate limited); step 3 authenticator-code challenge for roles that need MFA (wrong code, locked); "signed in" lands on the page the user came from; loading; offline | `requestOtp`, `verifyOtp` (`OtpVerifyResult`, `MfaChallenge`), `verifyMfa`; `OtpCode`; errors `OTP_INVALID`, `OTP_EXPIRED`, `OTP_LOCKED`, `RATE_LIMITED` |
| `G2-Mfa-Enrol-{360-strip,1280}` | CD-25; OQ-74 "enrol first" | A role with required MFA and no verified factor | 360, 1280 | Explain why; show the QR and the setup key (from `otpauthUri` and `secret`); confirm with a code (wrong code); recovery codes shown once, with "I saved them"; done. The existing Finance enrolment in `F1` C2.6 is the reference and is not changed | `startMfaEnrolment` (`MfaEnrolment`), `confirmMfaEnrolment` (`MfaRecoveryCodes`); error `MFA_ENROLMENT_REQUIRED` |
| `G3-Session-Access-states` | OQ-74 "session expired", "access denied after a role change" | Every user | 360, 1280 | Session expired ("Sign in again", returns to the same page, no personal data in the URL); access denied after a role change (the user's role or membership changed while the page was open; says what changed and who can restore access); permission denied page for a URL the role may not open | `refreshSession`, `getMe` (`Me`, `MembershipSummary`); errors `UNAUTHENTICATED`, `FORBIDDEN` |
| `G4-Components-added-states` | DR-35, DR-36 | Design reference | sheet (1440) | The components the screens used that neither sheet nor COMPONENT_SPECIFICATION lists: tabs, stepper, side navigation, bottom navigation, breadcrumb, dialog, bottom sheet, radio card, onboarding checklist row, slot-grid calendar, dispute thread, star-rating input, stat tile, share-link table, selectable payout table. Each with default, hover, focus, selected, disabled and error where they apply, at 360 and 1280. Also the "best on a larger screen" notice for admin below 1024 | none (design only) |

### 4.3 Stage H: I1 Directory

| File | Flow step | Role | Widths | States to draw | Contract |
|---|---|---|---|---|---|
| `H1-Search-Home-{360,768,1280}` | C1 home and search | Anyone, no login | 360, 768, 1280 | Home with the test search (typeahead of parameter, product, standard, lab); location by device, pincode, or the saved site of a signed-in user; radius; device location denied; search error; loading; no suggestion | `suggestSearch` (`SearchSuggestion`), `searchLabs`; `Pincode`, `GeoPoint`, `SearchRadiusKm` |
| `H2-Search-Filters-Map-{360,768}` | C1 results, filters; RESPONSIVE (below lg a list and map toggle) | Anyone | 360, 768 | The filter sheet (bottom sheet at 360, side sheet at 768) with applied-filter chips and "show N labs"; the 768 map view and the list or map toggle; loading, empty (no results, with the actions of B4) and error at 768 and 1280 (they exist at 360 only) | `searchLabs`, `listTaxonomyNodes` (`PublicTaxonomyNode`); `LabSearchResult`, `LabSearchMatchedLine`, `TatDays` |
| `H3-Request-A-Lab-{360,1280}` | C1 "Request this lab", no-results action | Anyone, no login | 360, 1280 | Form (what you were looking for, contact e-mail), validation, sending, confirmation, error (rate limited); entry from a listed lab page and from the no-results page | `createLead` (`LeadCreate`: `kind`, `labSiteId`, `query`, `contactEmail`); `LeadKind`; `RATE_LIMITED` |
| `H4-Lab-Claim-1280` | L1 claim by certificate, OTP, manual letterhead | `LAB_CHECKER` (first user of the lab) | 1280 | Find the lab by certificate number (found, not found, already claimed); OTP sent to the masked NABL e-mail; code entry (wrong, expired, locked); manual path with letterhead upload (scan status); claim pending; approved; rejected with the Ops decision notes; loading; error | `startLabClaim` (`LabClaimCreate`), `verifyLabClaimOtp`, `createLabClaimLetterheadUploadUrl`, `submitLabClaimLetterhead` (`LabClaimManual`); `LabClaim` (`status`, `method`, `otpSentTo`, `decisionNotes`); `CertificateNo`, `ScanStatus` |
| `H5-Admin-Import-1280` | A3 import wizard | `PLATFORM_DATA_STEWARD` | 1280 | Upload (CSV or XLSX, scan status); choose or create a mapping template with a column mapper and preview; parsing progress; preview with counts by action (create, update, no change, conflict, error); row drill-down with the raw and mapped values and the match result; download the error CSV; commit; discard; failed import; empty; permission denied for other roles. **Resolve inline:** draw only the unknown values the preview lists, with a link into the change set. The contract has no row-edit operation (section 8) | `listAdminMappingTemplates`, `createAdminMappingTemplate`, `getAdminMappingTemplate`, `updateAdminMappingTemplate`, `createAdminImportUploadUrl`, `createAdminImport`, `getAdminImport`, `listAdminImportRows`, `commitAdminImport`, `discardAdminImport`; `AdminImportJob`, `AdminImportRow` (`raw`, `mapped`, `matchResult`, `action`, `messages`); `ImportStatus`, `ImportRowAction` |
| `H6-Admin-MasterData-1280` | A2 taxonomy browser, change-set inbox, version history | `PLATFORM_DATA_STEWARD` prepares; a different steward or a `PLATFORM_ADMIN` approves and publishes | 1280 | Taxonomy browser (tree, node types, attribute definitions); change-set inbox with the tabs *Mine* and *To review*; change-set detail (draft, submitted, sent back, approved, rejected, published, cancelled); the approver is the preparer (`FOUR_EYES_REQUIRED`, explained, not hidden); version history of one record; impact panel with the affected open bookings. The diff review of `F8` is the reference and is not redrawn | `listAdminTaxonomies`, `getAdminTaxonomy`, `listAdminNodeTypes`, `listAdminAttributeDefinitions`, `listAdminChangeSets`, `getAdminChangeSet`, `listAdminChangeItems`, `submitAdminChangeSet`, `sendBackAdminChangeSet`, `approveAdminChangeSet`, `rejectAdminChangeSet`, `publishAdminChangeSet`, `cancelAdminChangeSet`, `getAdminChangeSetImpact`, `listAdminRecordVersions`; `ChangeSetStatus`, `AdminChangeSetImpact` |
| `H7-Admin-Geocode-Queue-1280` | A4 geocode pin queue | `PLATFORM_OPS` | 1280 | Queue; one site with the proposed pin on a map; tap to place, arrow-key nudge, latitude and longitude fields; approve; the lab's own pin proposal is shown as a proposal; empty; error | `listAdminGeocodeQueue` (`AdminLabSiteGeocode`), `approveAdminLabSitePin` (`AdminPinApproval`); `GeocodeStatus`, `GeoPoint` |

### 4.4 Stage J: I2 Onboarding

| File | Flow step | Role | Widths | States to draw | Contract |
|---|---|---|---|---|---|
| `J1-Signup-{768,1280}` and `J1-Signup-Individual-360-strip` | C2 sign-up and organisation | New customer | 360, 768, 1280 | The individual path after "Booking as an individual or an organisation?" (individual details, default site, done); every step of the existing `F1` flow at 768 and 1280; one-time-code states as in G1 | `createCustomerOrganisation` (`CustomerOrganisationCreate`), `createCustomerSite`; `CustomerSegment`, `Gstin` |
| `J2-Customer-Admin-{360,1280}` | C2 invite users and roles; Dashboards "Admin" | `CUSTOMER_ADMIN` | 360, 1280 | Users with roles and status; invitations (send, revoke, expired); sites (list, add, edit); the setting `requester_can_pay` as a switch with its effect explained; the Customer Admin **dashboard**: the Requester dashboard for the whole organisation plus users and sites; deactivate a user; a Requester who opens this page (permission denied) | `listCustomerUsers`, `deactivateCustomerUser`, `listCustomerInvitations`, `createCustomerInvitation`, `revokeCustomerInvitation`, `listCustomerSites`, `getCustomerSettings`, `updateCustomerSettings`, `listBookings`; `CustomerUser`, `CustomerInvitation`, `CustomerSettings`, `CustomerRoleCode` |
| `J3-Lab-Kyc-1280` | L1 KYC documents | `LAB_CHECKER` | 1280 | Document list by type; upload (uploading, scanning, clean, infected, invalid); verification status per document (pending, verified, rejected, with the Ops reason); all verified; loading; error | `createLabKycUploadUrl`, `createLabKycDocument`, `getLabOnboarding`; `LabKycDocument`, `VerificationStatus`, `ScanStatus` |
| `J4-Lab-Bank-1280` | L1 bank account (step-up MFA); CD-25 | `LAB_CHECKER` | 1280 | Add the account; the step-up dialog (all MfaPrompt variants of A-04); saved account shown masked (last four digits only, never the full number); verification pending, verified, rejected by Finance; change of an existing account (step-up again) | `createLabBankAccount` (`LabBankAccountCreate`, `LabBankAccount`), `verifyMfa`; `VerificationStatus`; errors `STEP_UP_REQUIRED`, `MFA_ENROLMENT_REQUIRED` |
| `J5-Lab-Users-1280` | L1 users (a Maker, and a Checker different from the Maker) | `LAB_CHECKER` | 1280 | Users and roles; invite a Maker or a Checker (a person cannot hold both: say so before sending); invitations (pending, expired, revoked); change a user's role (logged, not retroactive for pending items: say so); "no Maker yet" warning; a Maker who opens the page (permission denied) | `listLabUsers`, `updateLabUser`, `listLabInvitations`, `createLabInvitation`, `revokeLabInvitation`; `LabUser`, `LabInvitation`, `LabRoleCode`; ROLES RR-2 |
| `J6-Lab-Hours-Slots-1280` | L1 receiving hours and closures, slot templates; L9 slots calendar | `LAB_CHECKER` | 1280 | Receiving hours by weekday; closures (add with dates and reason, delete, bookings affected); slot templates; the slot calendar with close or adjust of a slot (editable, replacing the read-only grid of `F7`); saved; validation (overlapping hours); error | `setLabReceivingHours`, `listLabSiteClosures`, `createLabSiteClosure`, `deleteLabSiteClosure`, `getLabSlotTemplates`, `setLabSlotTemplates`, `listLabSlots`, `updateLabSlot`; `LabSlot`, `LabSlotTemplate`, `SlotStatus` |
| `J7-Lab-Scope-Retention-1280` | L1 retention; L9 scope toggle, instructions, pin proposal | `LAB_CHECKER` | 1280 | Scope lines with the "temporarily unavailable" toggle (the effect on search is explained); submission instructions; retention rule per discipline; propose a map-pin correction (shows "pending Ops review"); saved; error | `listLabScopeLines`, `setLabScopeLineAvailability`, `updateLabSite`, `getLabRetentionRules`, `setLabRetentionRules`, `createLabProposal` (`LabPinProposalCreate`); `LabScopeLine`, `LabRetentionRule` |
| `J8-Lab-PriceList-Import-1280` | L1 price-list import wizard; L9 price lists | `LAB_CHECKER` | 1280 | Wizard: upload, map columns, preview (counts, row messages), publish; discard; the published price list is immutable and a change makes a new draft; the diff against the published version stays as in `F7`; failed import; empty | `createLabPriceListImportUploadUrl`, `createLabPriceListImport`, `getLabPriceListImport`, `listLabPriceListImportRows`, `commitLabPriceListImport`, `discardLabPriceListImport`, `createLabPriceListDraft`, `listLabPriceListItems`, `updateLabPriceListItems`, `publishLabPriceList`, `discardLabPriceList`; `LabPriceListImport`, `LabPriceListImportRow`, `PriceListStatus` |
| `J9-Admin-Claims-Kyc-Bank-1280` | A4 claim requests, KYC review, bank verification | `PLATFORM_OPS` for claims and KYC; `PLATFORM_FINANCE` for bank accounts | 1280 | Claim queue (OTP-verified, manual with letterhead); approve; **reject with the reason dialog** (reason list plus notes); KYC document review (verify or reject); bank account verification, shown only under a Finance identity (an Ops user sees "Bank verification needs Finance"); empty; permission denied | `listAdminLabClaims`, `approveAdminLabClaim`, `rejectAdminLabClaim`, `verifyAdminKycDocument`, `verifyAdminBankAccount`; `AdminLabClaim`, `AdminKycDocument`, `AdminBankAccount`, `AdminVerificationDecision` |
| `J10-Lab-Bookable-{360,1280}` | L1 onboarding checklist and "Your site is bookable" | `LAB_CHECKER` | 360, 1280 | The `F4` checklist with live reasons, each row linking to J3 to J8; the end state "Your site is bookable" (every item done); a **regression** state when a requirement stops being true (for example the accreditation is no longer valid): the site is not bookable and the reason is shown | `getLabOnboarding` (`LabOnboardingChecklist`: `claimApproved`, `kycVerified`, `bankAccountVerified`, `accreditationValid`, `testingCategory`, `makerAssigned`, `checkerAssigned`, `receivingHoursSet`, `slotTemplatesActive`, `retentionRuleSet`, `priceListPublished`); CD-24 |

### 4.5 Stage K: I3 Request and decide

| File | Flow step | Role | Widths | States to draw | Contract |
|---|---|---|---|---|---|
| `K1-Booking-Steps-{768,1280}` | C3 select parameters; TRF steps 1 and 3; slot; submit confirmation | `CUSTOMER_ADMIN`, `CUSTOMER_REQUESTER` | 768, 1280 | Parameter selection; TRF step 1 (item, grade, batch, manufacturing date); TRF step 3 (report name, address, GSTIN, attachments with scan status); the slot step with **open slots only** (A-11); submit confirmation with the booking number, state **Requested** and "decides by … IST"; duplicate warning; loading; autosave draft | `estimateBooking` (`BookingEstimate`), `checkBookingDuplicates`, `createBooking` (`BookingCreate`, `BookingTrfInput`), `createBookingAttachmentUploadUrl`, `listPublicSlots` (`PublicSlot`) |
| `K2-Booking-Step2-Full-360-strip` | C3 TRF step 2 | Same | 360 | The full step: quantity per parameter, package count (suggested), condition, standard, special instructions, specification, conformity and decision rule, with progressive disclosure; validation messages | `BookingTrfInput`, `BookingEstimateLine` |
| `K3-Booking-Errors-{360,1280}` | C3 errors (slot taken, site no longer bookable, open-booking limit) | Same | 360, 1280 | `SLOT_UNAVAILABLE` (pick another slot, the form keeps its data); `SITE_NOT_BOOKABLE`; `SCOPE_LINE_NOT_BOOKABLE`; `OPEN_BOOKING_LIMIT`; `CONCURRENT_MODIFICATION` on edit ("refresh") | `createBooking`, `updateBooking`; `ErrorCode`; `docs/04-api/ERROR_HANDLING.md` |
| `K4-Booking-Requested-{360,1280}` | C3 edit while REQUESTED; C7 detail for REQUESTED | Booking owner, `CUSTOMER_ADMIN` | 360, 1280 | **Detail for REQUESTED** (NextActionCard "Waiting for lab", `labDecisionDueAt`); edit the request (the decision timer restarts: say so); withdraw (opens K5); the lab missed the deadline (moves to EXPIRED, K6) | `getBooking` (`BookingView`), `updateBooking` (`BookingUpdate`, `If-Match`); T-02 |
| `K5-Booking-Cancel-{360,1280}` | C4 cancel; DESIGN review DR-07 "cancel dialog" | Owner, `CUSTOMER_ADMIN` | 360, 1280 | The cancel dialog by state: free (REQUESTED, COUNTERED, ACCEPTED; T-25) and after payment (HANDOVER_SET to UNDER_TEST; T-26, T-27), with a reason from the cancellation list and notes; **the refund row is a placeholder** (section 8); confirm; the **CANCELLED detail view** (who cancelled, reason, notes) | `cancelBooking` (`BookingCancelRequest`: `reasonCode`, `notes`), `listTaxonomyNodes`; `BookingCancellation` (`reason`, `byParty`, `notes`) |
| `K6-Booking-Closed-{360,1280}` | C4 rejected or expired | Booking owner | 360, 1280 | The REJECTED detail (reason, rebook with the TRF copied); the **EXPIRED detail** (the lab did not decide in time, or the counter was declined or not answered in time); alternatives block annotated as in A-17 | `BookingRejection`, `BookingView`; T-05, T-06, T-08 |
| `K7-Booking-Accepted-{768,1280}` | C4 accepted | Owner, `CUSTOMER_ADMIN`, payer | 768, 1280 | The **ACCEPTED detail** (NextActionCard "Pay ₹X by … IST", `paymentDueAt`); the final price; counter-offer decline confirmation and the resulting EXPIRED state; permission variant for a Requester when `requester_can_pay` is false (explains who can pay) | `getBooking`, `acceptBookingCounter`, `declineBookingCounter`, `getCustomerSettings` |
| `K8-Lab-Inbox-Tabs-{360,1280}` | L2 inbox tabs (all four) and Maker view | `LAB_CHECKER` decides; `LAB_MAKER` views | 360, 1280 | The four tabs (*New requests* with the SLA countdown, *Waiting for customer*, *Paid, expecting drop*, *Overdue drops*); **Maker read-only variant**: actions replaced by "Only a Checker can decide"; the `viewerWasMaker` item; empty tabs; loading; error; the 360 view | `getLabInbox` (`LabInboxItem`: `booking`, `pendingApproval`, `viewerWasMaker`); `TimerType` |
| `K9-Lab-Decision-Dialogs-{360,1280}` | L2 accept, reject with reason list, counter | `LAB_CHECKER` | 360, 1280 | Accept confirmation; **reject with a reason list and a text** (the list is the rejection reasons; label it "sample list"); counter form for a new slot and/or extra quantity, **no price field** (`COUNTER_FIELD_NOT_ALLOWED` shown if someone tries); `SITE_NOT_BOOKABLE` on accept; SLA warning (50 %) and danger (90 %) states of SlaCountdown | `acceptBooking`, `rejectBooking` (`BookingRejectRequest`: `reasonCode`, `notes`), `counterBooking` (`BookingCounterCreate`); BR-012, BR-017 |
| `K10-Admin-Ops-Drilldown-1280` | A1 tiles, drill-down | `PLATFORM_OPS` | 1280 | The board of A-29; a drill-down list from a tile (filters by state, site, overdue timer; cursor paging); empty; error; a non-Ops user (permission denied) | `getAdminOpsBoard`, `listAdminBookings` (`AdminBookingSummary`) |
| `K11-Admin-Booking-Detail-1280` | A1 booking detail (metadata-only report section), cancel with a reason | `PLATFORM_OPS` | 1280 | Booking detail with the timeline and the report **metadata only** (no file; a link to request break-glass, M10); **cancel with a reason**, available up to UNDER_TEST only; a booking in a later state shows why cancel is unavailable. **Do not draw "override a decision"** (section 8) | `getAdminBooking` (`AdminBooking`, `AdminReportMetadata`), `cancelAdminBooking` (`AdminBookingCancelRequest`); ROLES notes 2, 4, 7 |

### 4.6 Stage L: I4 Pay and hand over

| File | Flow step | Role | Widths | States to draw | Contract |
|---|---|---|---|---|---|
| `L1-Pay-States-{360-strip,1280}` | C5 pay, return page, success, failure | `CUSTOMER_ADMIN`, `CUSTOMER_FINANCE`, `CUSTOMER_REQUESTER` if allowed | 360, 1280 | Pay summary and the hand-off screen (a neutral "taking you to the secure payment page"; **no bank or gateway screen, name or logo**); "Confirming payment…" with polling; success with the receipt download and the handover link; **failed** (`FAILED`); **not completed** (the person came back without paying); **timed out** (`EXPIRED`, or still pending when polling ends); a second payment attempt; the payment window ran out (EXPIRED_UNPAID, L2); gateway unavailable (`GATEWAY_UNAVAILABLE`) | `createPaymentOrder` (`PaymentCheckout`), `getPaymentReturnStatus`, `listFinancialDocuments`, `getFinancialDocumentDownloadUrl`; `PaymentOrder` (`status`, `attemptNo`, `checkoutExpiresAt`); `PaymentOrderStatus`; `PAYMENT_AMOUNT_MISMATCH` |
| `L2-Booking-Unpaid-NoShow-{360,1280}` | C5, C6 lapse states | Booking owner | 360, 1280 | **EXPIRED_UNPAID** detail; **NO_SHOW** detail; what the customer can do next (rebook with the TRF copied). **No amounts**: the fee or refund is not drawn (section 8) | `getBooking`; T-10 and T-12 of BOOKING_STATE_MACHINE |
| `L3-Label-Reprint-{360,1280}` | L4 label reprint approval; EC-26; DR-10 | `LAB_MAKER` requests; `LAB_CHECKER` approves | 360, 1280 | Maker: request a reprint for one package, with a reason (pending); Checker: reprint approvals list and detail, approve (the old label is voided, a new version is issued; the caller must not be the user who made the request, ROLES note 6); approved; the Maker print view after approval. **No decline button** (the contract has none, section 8) | `requestLabelReprint` (`LabelReprintRequestCreate`: `reason`), `approveLabelReprint`; `LabelReprintRequest`, `LabelReprintRequestStatus` (`PENDING`, `APPROVED`); `PACKAGE_VOIDED` |
| `L4-Label-Print-{1280,A4,thermal}` | C6 print labels; CD-12; RESPONSIVE "print stylesheets" | Customer (own bookings), `LAB_MAKER`, `LAB_CHECKER` | 1280, print | The print preview and the **print stylesheet** for the A4 label sheet and the thermal label (what prints, what hides, page breaks); the Maker's counter print action; the label shows the booking number, the package QR and the package short code, **no booking short code** | `getBookingLabels`, `getBookingHandover` (`BookingHandoverPackage`); `PackageShortCode`, `QrPayload` |
| `L5-Admin-Refunds-1280` | A6 refund approvals | `PLATFORM_FINANCE` (any amount); `PLATFORM_OPS` (up to the threshold only) | 1280 | The refund list (requested, approved, submitted, succeeded, failed) with the amount, the booking and the cause; approve, with the step-up MFA dialog (A-04) for a refund above the threshold; an Ops user sees the same list and can approve only up to the threshold (say so on a refund above it; do not draw the threshold value, it is not set, OQ-31); empty; error | `listAdminRefunds` (`AdminRefund`, `AdminRefundList`), `approveAdminRefund`; `RefundStatus`; ROLES "Approve refund" |
| `L6-Admin-Reconciliation-1280` | A6 reconciliation | `PLATFORM_FINANCE` | 1280 | Import the settlement file (upload, scan, parse); settlement lines with the match status; exceptions; resolve an exception; the accounting export (CSV) action; empty; error | `createAdminSettlementUploadUrl`, `importAdminSettlementReport`, `listAdminSettlementLines`, `listAdminReconciliationExceptions`, `exportAdminAccountingCsv`; `AdminSettlementLine`, `SettlementMatchStatus`, `AdminExportKind` |

### 4.7 Stage M: I5 Receive, test, report

| File | Flow step | Role | Widths | States to draw | Contract |
|---|---|---|---|---|---|
| `M1-Booking-Detail-States-{360,1280}` | C7 track | Booking owner | 360, 1280 | Customer detail for **SAMPLE_RECORDED** ("The lab recorded your sample; a second person approves it"), **REPORT_IN_REVIEW**, and UNDER_TEST with a changed expected date and **per-line status** (a cancelled or unfinished line); the timeline shows lab staff **by role** ("Lab Maker", "Lab Checker"), not by name (OQ-60 default) | `getBooking`, `getBookingTimeline` (`BookingTimelineEntry`: `actorRole`, `actorName` only for the caller's own organisation); `BookingLine`, `BookingLineStatus` |
| `M2-Scanner-Outcomes-{360-strip,768}` | L3 scan rejections, discrepancy reason, offline | `LAB_MAKER` | 360, 768 | Rejections with their reason: voided label (`PACKAGE_VOIDED`), already received (`PACKAGE_ALREADY_RECEIVED`), invalid signature (`QR_INVALID_SIGNATURE`), booking in the wrong state (`INVALID_STATE_TRANSITION`); the **discrepancy reason entry** on the check step; a **failed offline sync** (which scans were refused and why); the scanner at 768 (tablet at the counter). The wrong-site and unreadable-QR states of `D1` are not redrawn | `scanCustodyCode` (`CustodyScanResult`), `syncCustodyScanBatch` (`CustodyScanBatchItemResult`, `CustodyScanBatchError`), `submitReceipt`; `ErrorCode`; QR_AND_VERIFICATION §3 |
| `M3-Receipt-Reasons-{360,1280}` | L4 approvals, hold, reject | `LAB_CHECKER` | 360, 1280 | The approvals queue at 360; the **hold** form (reason and notes); the **reject as unfit** form (reason); approve with the lab sample ID (entered or automatic); the blocked state as in A-22; loading; error | `approveReceipt` (`ReceiptApprove`, `LabSampleId`), `confirmReceiptDiscrepancy` (`ReceiptConfirmDiscrepancy`), `rejectUnfitSample` (`ReceiptRejectUnfit`); `ReceiptDecision`; `SELF_APPROVAL_FORBIDDEN` |
| `M4-Testing-Start-Eta-1280` | L5 testing | `LAB_MAKER` | 1280 | Received list; **Start testing** with the expected report date; **change the expected date** with a reason; **per-line status** update (for partial cancellation); not yet allowed (booking not RECEIVED); loading; error | `startBookingTesting` (`BookingStartTestingRequest`), `updateBookingExpectedReportDate`, `setBookingLineStatus` (`BookingLineStatusChange`, `BookingLineTargetStatus`) |
| `M5-Report-Upload-Errors-1280` | L6 upload, validation | `LAB_MAKER` | 1280 | File states (uploading, scanning, clean, infected, rejected); report number or ULR errors (**without another organisation's data**, A-27); a parameter not in the booking (`REPORT_PARAMETER_NOT_BOOKED`); a package not received; one open draft already exists | `createReportUploadUrl`, `createReportVersion` (`ReportVersionCreate`), `submitReportVersion`; `ReportVersion`; `ULR_NOT_UNIQUE`, `FILE_NOT_CLEAN`, `VALIDATION_FAILED` |
| `M6-Report-Bind-Scan-360-strip` | L6 bind (mobile) | `LAB_MAKER` | 360 | Scan the package QR to bind (or pick from the matched list); wrong package; success; offline | `createReportVersion` (binding fields), `scanCustodyCode`; `ReportVersion` |
| `M7-Report-Review-Amendment-1280` | L7 amendment variant, return | `LAB_CHECKER` | 1280 | The review screen for an **amendment**: the previous version beside the new one, with the amendment reason; **return** with comments required (an amendment is returned with no booking transition); publish with the MFA step-up | `getBookingReport` (`LabReportView`), `returnReportVersion` (`ReportReturn`), `publishReportVersion`; T-21 |
| `M8-Report-Amendment-Create-1280` | L8 amendment | `LAB_MAKER` | 1280 | From a released report: create the amendment with a **reason** (required), upload, bind, submit; only one draft per report; the old version shows **Superseded**; the Checker sees it in the queue | `createReportVersion` (`amendmentReason`), `submitReportVersion`; `INVALID_STATE_TRANSITION` |
| `M9-Customer-Report-{360,768,1280}` | C8 report, share links, custody trail | `CUSTOMER_ADMIN`, `CUSTOMER_FINANCE`, `CUSTOMER_REQUESTER` (own) | 360, 768, 1280 | Report released (download); **create a share link** (expiry in days, 1 to 30, and a note, max 500 characters); the link list with copy and revoke; the **superseded or amended** view for the customer (a newer version exists; the old version cannot be newly shared); the custody trail download and its **print stylesheet**; the dispute countdown | `getBookingReport` (`CustomerReportView`, `CustomerReportVersion`), `createReportDownloadUrl`, `createReportShareLink` (`ReportShareLinkCreate`: `expiresInDays`, `recipientNote`), `revokeReportShareLink`, `getBookingCustodyTrail`; `ReportShareLink`; `INVALID_STATE_TRANSITION` |
| `M10-Admin-BreakGlass-Audit-1280` | A7 break-glass, audit log; ROLES note 7 | `PLATFORM_OPS` requests; a different `PLATFORM_ADMIN` approves; Ops, Data Steward, Finance and Admin read the audit log | 1280 | Request access (reason, scope, time box); approval by a different Admin (the requester sees "waiting for another administrator"); active grant with its end time and the download action (the requester only, with a step-up MFA dialog); revoke; every access logged; **audit log search** by entity, actor and date; empty; permission denied | `requestBreakGlassAccess` (`AdminBreakGlassRequestCreate`), `listBreakGlassGrants`, `getBreakGlassGrant`, `approveBreakGlassGrant`, `rejectBreakGlassGrant`, `revokeBreakGlassGrant`, `createBreakGlassDownloadUrl`, `searchAdminAuditLog` (`AdminAuditLogEntry`); `FOUR_EYES_REQUIRED` |

### 4.8 Stage N: I6 Close the loop

| File | Flow step | Role | Widths | States to draw | Contract |
|---|---|---|---|---|---|
| `N1-Dispute-Customer-{360,1280}` | C9 disputes; states DISPUTED, COMPLETED | Raiser (`CUSTOMER_ADMIN`, `CUSTOMER_FINANCE`, `CUSTOMER_REQUESTER` own) | 360, 1280 | Raise (type, description, evidence upload states); window countdown and **closed window** (`DISPUTE_WINDOW_CLOSED`); the thread (status, messages from both parties); **the decision and refund outcome** (outcome, refund amount, rationale); withdraw; the **DISPUTED detail** and the **COMPLETED detail** of the booking | `raiseDispute` (`DisputeCreate`), `getDispute` (`Dispute`, `DisputeMessage`, `DisputeEvidence`), `addDisputeMessage`, `createDisputeEvidenceUploadUrl`, `addDisputeEvidence`, `withdrawDispute`; `DisputeStatus`, `DisputeOutcome`; BR-080 to BR-083 |
| `N2-Rating-{360,1280}` | C8 rate the lab | Customer | 360, 1280 | Star input for overall, turnaround and communication (1 to 5) and a comment (max 2,000 characters); the hint that the comment goes to the lab and Ops (OQ-71); submitted; already rated; error | `rateBooking` (`BookingRatingCreate`: `scoreOverall`, `scoreTat`, `scoreCommunication`, `comment`); `BookingRating` |
| `N3-Finance-Documents-{360,1280}` | C10 finance views | `CUSTOMER_ADMIN`, `CUSTOMER_FINANCE` | 360, 1280 | The tabs **Invoices & receipts** and **Credit & refund notes** with content, filters by type, booking and date, download; the payments tab of `F3` is not redrawn; empty; error. No customer export control (section 8) | `listFinancialDocuments` (`FinancialDocument`), `getFinancialDocumentDownloadUrl`, `listPaymentOrders`; `FinDocType` |
| `N4-Dashboard-Finance-{360,1280}` | Dashboards "Finance" | `CUSTOMER_FINANCE` | 360, 1280 | Payments due; recent invoices and receipts; refunds (shown from refund notes); empty; the MFA-required state at sign-in is G1 | `listBookings`, `listPaymentOrders`, `listFinancialDocuments`; `BookingSummary` |
| `N5-Lab-Dispute-Response-1280` | L10 dispute response | `LAB_CHECKER` | 1280 | The disputes of the lab from the inbox filter DISPUTED; the dispute detail; respond with a message and evidence (the lab must respond within 2 business days, BR-081); decided; no dispute. **The settlement advice list is not drawn** (section 8) | `getLabInbox` (status `DISPUTED`), `getDispute`, `addDisputeMessage`, `addDisputeEvidence`; `DisputeStatus` |
| `N6-Admin-Disputes-1280` | A5 disputes | `PLATFORM_OPS` | 1280 | The queue by SLA, with assign; the dispute detail with the thread, evidence and the booking timeline; **decide** (outcome from `DisputeOutcome`, **refund amount** for a refund outcome, rationale); decided; ops can place a payout hold but not release it (a note points to Finance); permission denied for others | `listAdminDisputes` (`AdminDispute`), `assignAdminDispute`, `decideAdminDispute` (`AdminDisputeDecisionRequest`: `outcome`, `rationale`, `refundAmount`), `getDispute`, `placeAdminPayoutHold`; `AdminPayoutHoldPlaceReason` |
| `N7-Admin-Payouts-Holds-1280` | A6 payout batches, holds, exports | `PLATFORM_FINANCE` | 1280 | Payout list by status; select **only the rows that are eligible**; the count on the button matches the number of ticked rows; release with the step-up MFA dialog (A-04) and the external reference (`externalRef`, 1 to 100 characters); a held payout and **release hold** (Finance only); failed payout with its reason; exports; empty; permission denied for Ops (who can place a hold, N6) | `listAdminPayouts` (`AdminPayout`), `releaseAdminPayout` (`AdminPayoutRelease`), `releaseAdminPayoutHold`, `exportAdminAccountingCsv`; `PayoutStatus`, `PayoutHoldReason` |
| `N8-Admin-Config-Templates-1280` | A7 configuration, notification templates | `PLATFORM_ADMIN` | 1280 | Configuration keys with value, effective date and reason; the **propose-change form** (new value, effective date, reason); validation; platform-fee keys are not drawn as editable (the contract refuses to enable them); saved; notification templates (list, edit, create); a template shows the text and its variables (a live preview has no operation, section 8); permission denied for others | `getAdminConfigValue`, `setAdminConfigValue` (`AdminConfigValueUpdate`), `listAdminNotificationTemplates`, `createAdminNotificationTemplate`, `getAdminNotificationTemplate`, `updateAdminNotificationTemplate`; `AdminConfigKey`, `ConfigScope` |
| `N9-Admin-Platform-Users-Leads-1280` | A7 platform users and roles, leads | `PLATFORM_ADMIN` for users; `PLATFORM_OPS` for leads | 1280 | Platform users with roles, status and MFA enrolment date; create, change roles and deactivate (each with the step-up MFA dialog; users are never deleted); a platform user cannot also hold a customer or lab membership (RR-5, shown as an explanation); leads list with status and update; empty; permission denied | `listAdminPlatformUsers`, `createAdminPlatformUser`, `getAdminPlatformUser`, `updateAdminPlatformUser`, `setAdminPlatformUserRoles`, `listAdminLeads`, `updateAdminLead`; `AdminPlatformUser` (`mfaEnrolledAt`), `AdminLead`, `LeadStatus` |

### 4.9 Coverage check: every booking state has a customer screen

Draw nothing new for this table. It is the reviewer's cross-check, from review §3.4.

| State | Customer screen after this run |
|---|---|
| REQUESTED | K4 |
| COUNTERED | `C4-Counter-1280` |
| ACCEPTED | K7 |
| PAID (transient) | L1 success |
| HANDOVER_SET | `C6-Handover-*` |
| SAMPLE_RECORDED | M1 |
| ON_HOLD | `C7-Hold-1280`, C7.2 |
| RECEIVED | C7.3 |
| UNDER_TEST | `C7-Detail-*`, M1 |
| REPORT_IN_REVIEW | M1 |
| REPORT_RELEASED | M9 |
| DISPUTED | N1 |
| COMPLETED | N1 |
| REJECTED | K6 |
| EXPIRED | K6 |
| EXPIRED_UNPAID | L2 |
| NO_SHOW | L2 |
| CANCELLED | K5 |

## 5. Rules that apply to every board in this run

These come from the review. Each exists because the first run broke it.

1. **Colour.** Semantic tokens only (`--color-*`). No hex literal in markup or in `lc.css` component rules. Brand primitives (`--qci-*`) are used only in the `:root` block. (DR-13)
2. **Touch targets.** Below 768, every control is at least 44 × 44 px, including text links that act as buttons. (DR-12)
3. **Type.** Body, instruction and input text is 16 px. Dense table cells and captions may be 14 px. Nothing is below 12 px. (DR-29)
4. **Sizing.** Buttons and badges use `min-height` and may wrap below 768. Copy must survive strings 30 to 40 percent longer (Hindi later) and 200 percent zoom. (DR-28)
5. **Time and money.** Every time and deadline is followed by "IST" and shows the absolute time and the relative time ("in 3 h"). Dates are `DD MMM YYYY`. Money is `₹1,00,000.00`: Indian digit grouping and always two decimals, from integer paise. This is the rule the first run's Money primitive states; it is a proposal for the reviewer to confirm (section 8). One format on every board. (DR-23)
6. **Controls and structure.** Real `input`, `select`, `textarea`, `button`; each with a visible label bound by `for` and `id`; error text tied to its field with `aria-describedby` and announced with `role="alert"` or `aria-live`; one `<h1>` and headings in order; a `<main>` landmark and `<nav>` where there is navigation; `th scope` and a `caption` on every table; tabs with `role="tablist"`, `tab` and `tabpanel`; a skip link; a one-time-code field accepts paste and autofill. Boards that are strips or sheets may carry the landmarks on each screen. (DR-24, DR-25; WCAG 2.2 SC 3.3.8)
7. **Focus.** Every focusable element has a visible focus style (the 3 px ring), including on the dark scanner. A sticky footer must not cover a focused field. (DR-26; WCAG 2.2 SC 2.4.11)
8. **Pointer alternatives.** Nothing is drag-only. A map pin has tap to place, arrow keys, and latitude and longitude fields. (DR-30, OQ-75)
9. **Status.** Every status is label plus icon plus tone, following the mapping on `A1-Tokens` (corrected in A-02). Badge labels come from that mapping. (DR-33, DR-34)
10. **One name per thing.** One lab name, one term for a counter-offer, one verification-code format, one label per booking state. (DR-34)
11. **The contract is the source of fields.** Never draw a field the contract does not return, and never draw an operation it does not have. If a screen seems to need one, draw the screen without it and list the gap in the board's note. The first run showed capacity counts, report fields on a revoked page, rating sub-scores and a payout release under the wrong role. (DR-05, DR-06, DR-15, DR-16)
12. **Tenant isolation.** Never show another organisation's data: not a booking number, a user name, a price or a name in an error message. A customer sees lab staff by role only. (DR-15; CLAUDE.md; OQ-60 default)
13. **Roles.** Never show a capability the role does not have. The viewer's role is written on the board. If the matrix allows only a Checker to act, the Maker sees the screen read-only with the reason. (DR-04, DR-31, DR-32; ROLES_AND_PERMISSIONS)
14. **Maker and Checker are different people.** A user holds one lab role. Never show one person as both. Self-approval appears only in the provisional case of A-22. (DR-14, CD-22, CD-23)
15. **Privacy.** No personal data in a URL or query string. Phones and bank accounts are masked except the one number OQ-70 allows. (UX_PRINCIPLES 11)
16. **Notes.** Each board has its canvas note: operations, fields, validation messages, proposed i18n keys.
17. **Contrast.** Any new colour pair must meet 4.5:1 for text and 3:1 for interface components. Do not rely on a pair that the review marked "thin" for new text; state the ratio on the sheet.

## 6. Scope guard

Do not draw, name or hint at any of the following. They are excluded from the MVP in `SCOPE_AND_EXCLUSIONS.md` §3:

- platform-arranged pickup, delivery, riders, logistics, dispatch, GPS or tracking, transit states, transport charges, cold-chain services;
- subcontracting tests to another lab;
- negotiated price quotations, price revisions in a counter-offer, purchase orders, credit terms;
- medical laboratories and any patient data;
- calibration booking (calibration labs are listed with "booking coming soon", as the first run does);
- native mobile apps;
- platform fees, commissions or any `platformFee` value (the sentence "no platform fee" is also not drawn, DR-21).

Also not drawn, because they are deferred: chat, compare labs, saved searches, a cart, SMS, WhatsApp, phone OTP, a Hindi interface.

**The payment gateway is opaque.** The documents do not choose a gateway. Draw no gateway screen, field, payment method, logo, brand colour or name, and do not imitate any bank. The hand-off and return screens are LabConnect's own screens (L1).

## 7. Deliverables and acceptance

**Output folder:** `docs/09-design-handoff/designs-pass-2/`. Do not overwrite `designs/`. The first run is the approved reference and the baseline of the review; a separate folder lets the reviewer compare a corrected board with its first-run version by file name, and keeps the approved set intact until a person merges the second run.

**Files:**

| Group | Files |
|---|---|
| Stylesheet | `lc.css` (corrected, A-01) |
| Index | `canvas.json` (new pages G to N and the notes of section 5, rule 16), `README.md` (what is new, what changed, the open list of section 8), `Main.dc.html` (updated cover) |
| Corrected boards | The boards named in Part A, with their first-run file names |
| New boards | The files of sections 4.2 to 4.8: 57 boards, one file per width as listed |
| Mechanical clean-up | The remaining first-run boards after A-40, if done |

**The cover (`Main.dc.html`)** lists, in one table, every board of this run with its stage, widths and status (*new*, *corrected*, *unchanged*), repeats the exclusion list, carries the open list of section 8, and keeps the "Provisional brand" tag.

**Checklist the reviewer will use.** The review's method was to read every file as static HTML and to compute counts and contrast from the token values. The same method is used on this run. A board passes only if all of these hold:

| Check | Pass condition |
|---|---|
| Part A done | Each entry A-01 to A-39 is visible on its named board; A-40 is done or declared not done on the cover |
| Nothing else changed | A corrected board differs from its first-run version only where an entry says so |
| Colour literals | No hex literal in markup; component rules use semantic tokens only (DR-13) |
| Focus | A `:focus-visible` rule covers every focusable element type (DR-26) |
| Touch targets | At 360, every control is at least 44 × 44 px (DR-12) |
| Type | No instruction or input text under 16 px; nothing under 12 px (DR-29) |
| Controls | Zero `div` or `span` standing in for an input; every `label for` points at a real control; every error is tied to its field; tabs have the full role set; `th scope` and `caption` present (DR-24, DR-25) |
| Structure | One `<h1>`, no skipped heading level, `<main>` on full pages, `lang="en"` |
| Time and money | Every time has "IST"; one money format (DR-23) |
| Status | Every status is label plus icon plus tone, with the label from the mapping; one name per thing (DR-33, DR-34) |
| Contract | Each field and operation in a board's note exists in `packages/api-contract/openapi/`; no field outside it is drawn (DR-05, DR-06, DR-15, DR-16) |
| Roles | No capability on a board outside its role's row in the permission matrix; the Maker and Checker rules hold (DR-04, DR-14, DR-31, DR-32) |
| Tenant data | No other organisation's data on any board (DR-15) |
| States | Each new board shows its loading, empty, error and permission-denied states, and the booking states of section 4.9 are all covered |
| Live regions | Toasts and one-time-code errors are announced (`aria-live` or `role="alert"`) |
| Contrast | The contrast table of review §4.1 is re-run for every new pair and still passes; the switch OFF track is at least 3:1 |
| WCAG 2.2 only | No drag-only action; the one-time-code fields accept paste and autofill; a sticky footer does not hide a focused field |
| Scope | No excluded feature, no gateway name or screen, no platform-fee text |
| Open items | Each item of section 8 is drawn only as its placeholder says, with the "Provisional" or "Placeholder" tag |
| Not checkable | As in review §7: keyboard order, focus trapping, screen-reader output, real wrapping, 200 percent zoom and Hindi stay for the running build |

## 8. Open, do not design yet

Do not decide any of these. Draw the placeholder named, or nothing.

| Item | What is open | What to draw |
|---|---|---|
| Refund or fee amounts before they are booked | The cancel dialog needs the refund amount, but the contract has no preview. `cancelBooking` computes it by state (BR-070 to BR-075); the no-show fee (BR-042, OQ-07) and the cancellation fee have no field either | A labelled empty row "Refund amount: shown once confirmed" tagged "Placeholder". No figure, no formula, no percentage. The same for NO_SHOW and EXPIRED_UNPAID |
| Tax invoice issuer and tax split | Who issues the tax invoice and the GST treatment (OQ-08, CD-16) | Keep the layout. Tag the issuer and the "CGST + SGST" lines "Provisional". Do not write "issued by the lab" |
| Terms and consent text | The text and the consent fields wait on legal review (OQ-04) | Nothing. The terms checkbox is removed (A-14). Leave no empty box |
| Self-approval blocked state | OQ-59 is open: a user holds one lab role, so the blocked state exists only if a role changes after the user records something. DR-01 asks for it on report publish; DR-14 says to decide first | Draw it in D2 and D3 only as "Your role changed after you recorded this. Another Checker must approve it." tagged "Provisional (OQ-59)". Remove it if OQ-59 drops the state |
| Revoked report wording | OQ-72 fixes what fields show; the wording needs legal review | One sentence and a contact hint, tagged "Provisional wording, legal review pending" |
| Brand | Colours, typeface, logo rules, endorsement wording (OQ-19, OQ-12) | The existing provisional tokens, the "Provisional brand" tag as in the first run |
| Money format | The brief writes `₹1,00,000`, the first run's primitive writes `₹1,00,000.00`, and the review asks for one rule | Always two decimals (section 5, rule 5). Mark it "Proposed" on A2 for the reviewer to confirm or change |
| Alternatives on a rejected or expired booking | CUSTOMER_USER_FLOWS C4 says "top 3 alternatives". No contract field returns them (T-05 raises an "Alternatives event" only). The first run drew two | Keep the block as drawn, annotate "Source not in the contract". Do not add a third |
| Customer-side reprint request | DR-10 asks for a request by the customer and the Maker. The contract lets only the `LAB_MAKER` request a reprint, and has no decline or withdraw (OQ-50) | Customer: "call or visit the desk" (A-18). Maker request and Checker approval only. No decline button |
| Hold option "reduce lines" | EDGE_CASES EC-34 allows it; `HoldDecision` has `PROCEED`, `REPLACE`, `CANCEL` | Three options only |
| Gateway cancel versus failure | The payment documents are not supplied (CLAUDE.md §5). `PaymentOrderStatus` has `FAILED` and `EXPIRED` and no "cancelled" | One "not completed" state next to "failed". No gateway wording |
| Lab settlement advice list (L10) | No lab-side operation lists payouts or settlements | Not drawn. Draw only the dispute response (N5) |
| Dispute list for labs | No lab operation lists disputes; `getLabInbox` can filter on the DISPUTED state | Use the inbox filter. Do not draw a separate lab dispute API list |
| Dispute sub-states | The dispute status machine is not fully stated (OQ-38) | Show only the values of `DisputeStatus`; draw no transitions between them |
| Ops "request information from a party" (A5) | `addDisputeMessage` is for the parties; no Ops operation writes a message | Not drawn |
| Ops override of a decision, Ops cancel after UNDER_TEST | ROLES notes 2 and 4, OQ-24: not in the transition table, not built until decided | Do not draw an override. Cancel is drawn up to UNDER_TEST only (K11) |
| Admin operations with no contract | Deactivating a lab user in an emergency (A4), review of lab proposals other than pin proposals (A4), a financial-document search for platform users (A6), a customer export of financial documents (C10), a template preview (A7), a row-edit in the import preview (A3) | Not drawn. Each is listed in the board's note as "no operation" |
| Hold payouts | OQ-57(a): Ops places a hold, only Finance releases it; "extend" has no meaning | Ops places, Finance releases. No "extend" |
| Customers see roles, not names | OQ-60 default, still open | Roles only, in customer views |
| Controls the review marks "not asked for" | Review §5: "Notify Checkers" and "Notify other Checkers (2)" (A3, D2), the lab-page "Share" button (B2-360). The review gives no finding for them | Leave them as the first run has them. The product owner decides |
| Language and government web standards | Hindi at launch, GIGW 3.0 (OQ-13) | Nothing. Keep layouts that survive longer strings |

END OF PROMPT
