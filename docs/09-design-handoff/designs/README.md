# Design run D-02 (draft for review)

**Status:** Draft, produced 25 Nov 2026 from [`../DESIGN_MASTER_PROMPT.md`](../DESIGN_MASTER_PROMPT.md), stages A–F in one pass. **Not yet reviewed (D-03).** Don't implement feature screens from these files until D-03 approves them (CLAUDE.md §2).

**Brand:** provisional. The blue `#1F6FA8` and the Poppins typeface are stand-ins chosen for this draft. They are not QCI-approved values: QCI's guidelines name "Q Blue" and black but give no colour codes and no web typeface (OQ-19). The cover, component sheets and 1280 boards carry a "Provisional brand" tag; the 360 and 768 device boards don't, to keep the device frames clean. When QCI sends official values, change only the `--qci-*` primitives in [`lc.css`](lc.css); components read semantic tokens only.

**Live canvas:** https://claude.ai/artifact/6EYBdgD1kMbZ6e7mMqXDo3 (private; the owner shares it from the canvas's Share menu). The files here are the canvas's source, kept in the repo so implementation doesn't depend on the canvas.

## What's in this folder

| File | What it is |
|---|---|
| [`lc.css`](lc.css) | **The token sheet in code.** Brand primitives (`--qci-*`), semantic tokens (`--color-*`, radius, shadow, font), and the component classes every board uses. This is the input for D-04 (`packages/ui`). |
| [`canvas.json`](canvas.json) | Canvas index: pages, board positions and sizes, and the **API-field annotation** for each screen (the `notes` entries). |
| `*.dc.html` | One file per board. Plain HTML with inline layout styles. A board is either one screen, a strip of phone steps side by side, or a component sheet. |

The board files are written for the canvas editor: `<script src="./support.js">` loads its runtime, `<x-dc>` and `<helmet>` are its wrapper elements, and `{{ … }}` placeholders are filled by the small script at the bottom of three interactive boards (C7-Hold, D2, D3). To open one in a plain browser, serve this folder and treat `x-dc` and `helmet` as `display: contents`. Everything except those placeholders renders as designed.

The logo is the supplied `../reference/Logos_QCI.png`, unaltered.

## Boards by stage

| Stage | Board | Flow | Widths |
|---|---|---|---|
| A | `Main` | Cover: assumptions, exclusions, how to read the canvas | — |
| A | `A1-Tokens` | Token sheet, status mapping, type, spacing, radius, density | — |
| A | `A2-Controls` | Buttons, inputs, select, combobox, date picker, checkbox/radio/switch, chips, formatting primitives, file upload, all states | — |
| A | `A3-Booking-components` | NextActionCard, SlaCountdown, BookingTimeline, PriceSummary, LabResultCard, ApprovalPanel, MfaPrompt, CameraScanner, QrLabelPreview, PhotoCapture | — |
| A | `A4-Feedback-data` | VerificationResult, DataTable (desktop + mobile cards), empty/error/permission states, banners, toast, notifications, ScopeTree, DiffViewer, ImportPreview | — |
| B | `B1-Search-*` | C1 search results | 1280 · 768 · 360 |
| B | `B2-Lab-*` | C1 lab site page | 1280 · 768 · 360 |
| B | `B3-Verify-*` | C11 report verification (1280 genuine, 768 superseded, 360 all four results) | 1280 · 768 · 360 |
| B | `B4-Public-edge-states-360` | No results, listed lab, calibration lab, loading | 360 |
| C | `C3-Booking-1280`, `C3-Review-1280`, `C3-Booking-360-strip` | C3 booking form, review, duplicate warning, confirmation | 1280 · 360 |
| C | `C4-Counter-1280`, `C4-C5-360-strip` | C4 accepted / counter-offer / rejected, C5 pay and return | 1280 · 360 |
| C | `C6-Handover-1280`, `C6-Handover-360-strip` | C6 handover, labels, "show this QR" | 1280 · 360 |
| C | `C7-Detail-1280`, `C7-Hold-1280`, `C7-Detail-360-strip` | C7 booking detail and ON_HOLD decision (J6) | 1280 · 360 |
| D | `D1-Scanner-360-strip` | L3 Maker counter scanner, 8 steps incl. wrong lab and offline | 360 |
| D | `D2-ApproveReceipt-1280` | L4 receipt approval; `viewerIsMaker` setting shows the blocked state | 1280 |
| D | `D3-ReviewReport-1280` | L7 report review, MFA step-up, return (J7) | 1280 |
| E | `E1-Customer-*`, `E2-Maker-360`, `E3-Checker-1280`, `E4-Ops-1280` | Dashboards | as named |
| F | `F1-Signup-360-strip` | C2 sign-up and organisation | 360 |
| F | `F2-Report-Dispute-1280` | C8 report, share links, rating; C9 dispute | 1280 |
| F | `F3-Finance-1280` | C10 finance views | 1280 |
| F | `F4-Lab-Onboarding-1280` | L1 claim and onboarding checklist | 1280 |
| F | `F5-Lab-Inbox-1280` | L2 inbox, accept / reject / counter | 1280 |
| F | `F6-Lab-Report-Upload-1280` | L5–L6 testing and report upload, L8 note | 1280 |
| F | `F7-Lab-Catalogue-1280` | L9 price lists (draft vs published diff) and slots | 1280 |
| F | `F8-Admin-MasterData-1280` | A2–A3 change-set review and import summary | 1280 |
| F | `F9-Admin-Disputes-Payouts-1280` | A5 dispute decision, A6 payout batch | 1280 |
| F | `F10-Admin-Onboarding-Config-1280` | A4 claims and pin review, A7 configuration and break-glass | 1280 |

Clickable prototype for J1: on the canvas, open `B1-Search-1280` and press Play; primary buttons link through to booking detail.

## Decisions taken in the draft

- **Status shown by label + icon + tone**, using the five groups in `DESIGN_SYSTEM.md` §1 (icons: clock = waiting on lab, alert = waiting on customer, tick = done, triangle = problem, minus = closed).
- **`--color-border-strong` is gray-500**, not gray-400: gray-400 gives 2.5:1 on white and fails WCAG 1.4.11 for input borders.
- **`platformFee` is never displayed.** The contract keeps it at zero (CD-05), and platform fees are out of scope.
- **Lab staff appear by role in customer timelines.** The timeline gives `actorName` only to the caller's own organisation (OQ-29), so the UX_PRINCIPLES §5 example with names applies to lab-side views only. See OQ-60.
- **Verification shows the approving Checker's name and designation** (OQ-15 default).
- **Lab decision deadline** uses BR-012 (4 business hours of the lab site). Payment 24 h, hold decision 24 h and dispute 72 h follow the state machine.
- **Email only** for customer notifications (OQ-11 interim).
- **Payment page is opaque.** No ICICI fields, methods or UTR formats are shown (CLAUDE.md §5).

## Open questions raised by this run

Recorded in [`../../08-project/RISKS_AND_OPEN_QUESTIONS.md`](../../08-project/RISKS_AND_OPEN_QUESTIONS.md): OQ-59 (self-approval blocked state vs one lab role per user) and OQ-60 (UX example names vs OQ-29 redaction). Brand values remain OQ-19.

## For D-03 review

Check each board against its flow file and the accessibility constraints in `DESIGN_BRIEF.md` §5. Comment on the canvas, or open issues that reference the board's file name.
