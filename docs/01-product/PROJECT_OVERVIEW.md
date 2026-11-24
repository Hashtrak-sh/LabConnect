# Project overview

**Status:** Approved baseline · **Owner:** @Hashtrak-sh

## 1. Vision

LabConnect is a government-operated, trusted marketplace that turns finding and booking an accredited testing laboratory from days of phone calls and emails into a tracked digital transaction with a verifiable result.

## 2. The problem

- NABL directory data is hard to search by product, parameter and location, and scope documents are long PDFs.
- Quotations, slots, payment and invoices are handled informally over phone and email.
- Samples arrive at labs with handwritten forms, mix-ups happen, and there's often no recorded second check before a report goes out.
- It's hard for a customer's customer or an auditor to prove a report is genuine and belongs to a specific batch.

## 3. Who it serves

| Segment | Examples | Primary need |
|---|---|---|
| Individuals | Small traders, consumers testing a product | A simple search and booking |
| Businesses and industries | QA managers and purchase teams at manufacturers | Scope-accurate search, GST invoices, a traceable report |
| Government organisations | Procurement and inspection agencies | Verified accredited labs, audit trail |
| Laboratories | NABL-accredited testing labs (Makers and Checkers) | Clean digital intake, maker-checker control, new demand, guaranteed payment |
| Platform Operations | The operating authority's staff | Clean data, dispute resolution, SLA oversight |

## 4. MVP in one line

Discover → select a lab site → submit a test request (TRF) → the lab Checker accepts, rejects or proposes a new slot → the customer pays online → the customer self-drops the QR-labelled sample → the lab Maker scans and records receipt → the Checker approves → testing → the Maker uploads the report → the Checker approves and publishes it with MFA → QR-verifiable report → 72-hour dispute window → payout.

## 5. What makes it more than a directory

1. **Scope-accurate data.** Labs are mapped to discipline → group → product → parameter → method → range, with accreditation status and validity.
2. **A digital chain of custody with Maker/Checker control.** A QR is scanned at receipt and again when the report is bound. Two different people sign off both the receipt and the report.
3. **Verifiable reports.** A public QR or URL confirms authenticity without exposing the PDF.
4. **Government trust.** It's operated by a public authority and doesn't take a commission in the MVP.

## 6. Goals (hypotheses, baseline in the first 60 days)

| Metric | Target (6 months post-launch) |
|---|---|
| Search-to-booking conversion | 4% |
| Lab decision within 4 business hours | 90% |
| Acceptance rate | 75% |
| Payment completion within window | 85% |
| Self-drop on time | 90% |
| QR match on first scan | 98% |
| Checker approvals within 1 business day | 90% |
| Report TAT adherence | 90% |
| Repeat customers (2+ bookings in 90 days) | 40% |
| Dispute rate | < 2% |

## 7. Non-goals

These are permanent non-goals:
- Replacing a lab's LIMS.
- Granting or validating accreditation. NABL remains the authority.
- Interpreting results or giving compliance advice.
- Editing report content. The platform only stamps a verification QR onto a copy.

Arranging sample transport isn't a permanent non-goal; it's out of scope for the MVP.

## 8. Launch assumptions (to be confirmed, see OQ-05)

- Launch cluster: Delhi NCR (Noida, Greater Noida, Ghaziabad, Gurugram, Faridabad).
- 30–50 onboarded labs covering mechanical, chemical, electrical and food disciplines.
- A closed beta with about 20 invited customers, with manual Ops support on every booking.
- English only at launch, with the UI built ready for Hindi.
