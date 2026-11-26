# Design pass 2 (draft for review)

**Status:** Draft, produced 26 Nov 2026 from `DESIGN_PASS_2_PROMPT.md` (Part A corrections, then stages G to N in one run). **Reviewed on 26 Nov 2026:** see [`../DESIGN_REVIEW_PASS_2.md`](../DESIGN_REVIEW_PASS_2.md) (no Blocker, 6 Major, 25 Minor findings). The product owner decided that there is no third pass: build from these boards with the corrections of that review, and follow the contract and the permission matrix where a board disagrees with them (`M10`, `N9`). The first run in [`../designs/`](../designs/) is kept for comparison.

**Brand:** still provisional (OQ-19). This run adds no brand value. It adds exactly three semantic tokens (A-01), and they point at existing blue values.

**Live canvas:** https://claude.ai/artifact/LFXNBR381MqJhfgrZhXg87 (private; the owner shares it from the canvas's Share menu). The files here are the canvas's source. On the canvas the logo is served as an uploaded copy of `../reference/Logos_QCI.png`. In this folder the boards point at the repo file.

## What's in this folder

| File | What it is |
|---|---|
| [`lc.css`](lc.css) | The corrected token sheet (A-01) plus the pass-2 component classes (G4). |
| [`canvas.json`](canvas.json) | Canvas index: 13 pages (A–F corrected, G–N new), 131 boards, and one note per board listing operations, fields, validation messages and proposed i18n keys. |
| [`Main.dc.html`](Main.dc.html) | The cover: every board with its stage, widths and status, the exclusion list and the open list. |
| `*.dc.html` | One file per board, in the same format as the first run. |

## Counts

| Status | Boards |
|---|---|
| New | 89 (stages G to N, one file per width as listed in the prompt) |
| Corrected | 37 first-run boards plus `lc.css` (Part A, A-01 to A-39) |
| Unchanged apart from the token clean-up (A-40) | 5: `A4`, `B2-Lab-768`, `F4`, `F7`, `F8` |
| Not re-issued | `F9-Admin-Disputes-Payouts-1280`, replaced by `N6` (Ops disputes) and `N7` (Finance payouts), A-33 |

## What changed on the corrected boards

- **Tokens (A-01, A-40):** every literal hex colour in `style="…"` now uses the token with the same value. Component rules in `lc.css` use semantic tokens only. One `:focus-visible` rule covers every focusable element type. The switch OFF track is `--color-border-strong` (4.8:1). `.btn` and `.badge` use `min-height` and wrap below 768. Controls are 44 px below 768 and inside the 360 frames (`.phone`, `.m360`). Input text is 16 px. Nothing is under 12 px.
- **Rendering differences from A-40:** the switch track (A-01c); avatars sit on `--color-brand-tint` (blue-100 has no semantic token); strip backgrounds use `--color-neutral-bg` (#EEF0F3 had no token); the current-step ring uses `--color-brand-tint-border`.
- **Accessibility (A-38, A-39):** `div` inputs are now real `input`, `select` and `textarea` elements carrying the `id` their label points at. Checkbox, radio and switch rows are real controls. `th scope` and a `caption` are on every table. Tabs use `tablist`, `tab` and `tabpanel`. Full pages have a `<main>` landmark and a skip link; strips have a `<main>` per phone screen. Paragraph and alert text is 16 px.
- **Board fixes:** each Part A entry is applied on its named board (see the prompt's Part A table). Highlights: open slots only (A-11), Requested badge (A-12), terms checkbox removed (A-14), counter-offer goes through payment L1 (A-16), full desk phone and no booking short code (A-18), hold options and warning tone (A-20), D2/D3 blocked state as "role changed" (Provisional, OQ-59), D3 and F6 stamp states, MFA variants (A-04, A-23), E4 shows all 18 states and links every tile to K10 (A-29), F10 Ops and Admin variants (A-34).
- **Naming (A-37):** one lab name ("Vasundhara Testing Laboratories", then "Vasundhara"), "Counter-offer" as the one term, and 16-character verification codes in groups of four.
- **Time and money (A-36, section 5):** every time ends with "IST". Money is `₹1,00,000.00`, always two decimals. The money rule is marked "Proposed" on A1 and A2.

## Open: not designed yet (prompt section 8)

| Item | What is drawn | Tag |
|---|---|---|
| Refund or fee amounts before booking | "Refund amount: shown once confirmed" (K5, L2, M1) | Placeholder |
| Tax invoice issuer and tax split (OQ-08) | Layout kept; issuer and CGST + SGST lines tagged | Provisional |
| Terms and consent text (OQ-04) | Nothing; the checkbox is removed | — |
| Self-approval blocked state (OQ-59) | D2, D3, M3 only, as "Your role changed after you recorded this…" | Provisional (OQ-59) |
| Revoked report wording (OQ-72) | One sentence and a contact hint (B3) | Provisional wording |
| Money format | ₹1,00,000.00, always two decimals | Proposed |
| Alternatives on a rejected or expired booking | Block kept (two labs) | Source not in the contract |
| Customer-side reprint (OQ-50) | Customer calls or visits the desk; Maker requests, Checker approves; no decline | — |
| Hold option "reduce lines" (EC-34) | Proceed, Replace, Cancel only | — |
| Gateway cancel versus failure | One "Not completed" state beside "Failed" | — |
| Lab settlement advice list (L10), lab dispute list | Not drawn; lab disputes come from the inbox DISPUTED filter (N5) | — |
| Dispute sub-states (OQ-38) | `DisputeStatus` values only | — |
| Ops "request information", override, cancel after UNDER_TEST (OQ-24) | Not drawn; Ops cancel up to UNDER_TEST (K11) | — |
| Payout holds (OQ-57a) | Ops places, Finance releases, no "extend" | — |
| Customers see roles, not names (OQ-60) | Roles only in customer views | — |
| "Notify Checkers", B2-360 "Share" (review §5) | Left as the first run drew them | Product owner decides |
| Hindi, GIGW 3.0 (OQ-13) | Nothing; layouts leave room for longer strings | — |

## Contract gaps found while drawing

Each one is drawn without the missing piece and listed in the board's canvas note. None was decided here.

1. **J9:** the claim reject dialog asks for a reason list plus notes; `AdminClaimRejection` has `decisionNotes` only. The chosen reason is shown as written at the start of the notes and tagged Provisional.
2. **J8:** the prompt asks for a "map columns" step; lab price-list imports have no mapping operation (fixed template).
3. **H5:** no row-edit operation in the import preview; the error CSV has no export operation (built from the ERROR rows).
4. **L6:** no "resolve exception" operation.
5. **N8:** no template preview operation. **N3:** no customer export of financial documents.
6. **Admin lists** return ids (`labSiteId`, `customerOrgId`); the boards show names, which assumes a name lookup.
7. **N6 → L5:** a refund decided on a dispute is drawn as going to the refund approval list; the contract links them by `AdminRefund.disputeId`.
8. **L5:** the Ops refund limit is not set (OQ-31), so no value is drawn.

## Not tokenised (for review)

No existing token holds these values, and this run may add only the three tokens of A-01: the alert text colours (#1E3A8A, #78350F, #14532D, #7F1D1D), the danger hover (#991B1B), the `.prov` tag, the dark scanner background, the map, QR and camera placeholders, and the diff colours. Where no semantic token has the value, gray primitives (`--gray-300`, `--gray-400`, `--gray-700`) are used. A-40 is otherwise complete.

## Sample people

Reused from the first run: Priya Sharma (Customer Admin), Sanjay Kumar and Meera Iyer (Maker), Dr. Anita Mehta (Checker), Rohit Verma (Platform Ops). Added for roles the first run didn't draw: Vikram Kohli (Requester), Neha Gupta (Customer Finance), Kavita Rao (Platform Admin), Arjun Nair (Platform Finance), Farah Khan and Imran Shaikh (Data Stewards). All are illustrative. Emails use `example.com` and `example.gov.in`, and the desk phone `+91 124 000 0048` is a sample number.

## What this draft could not check

As in review §7: keyboard order, focus trapping, screen-reader output, real wrapping, 200 % zoom and Hindi belong to the running build. The boards were not rendered or screenshot-checked during this run.
