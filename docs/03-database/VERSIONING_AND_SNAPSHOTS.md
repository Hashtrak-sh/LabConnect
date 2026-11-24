# Versioning and historical snapshots

**Status:** DRAFT for gate G1.

## 1. Three versioning patterns

| Pattern | Used for | How |
|---|---|---|
| **A. Current row + append-only version table** | `md_node`, `lab_site`, `accreditation`, `scope_line`, `organisation` (lab organisations), `search_synonym` | The current row holds the live values and `current_version_no`. Every publish appends a full `snapshot` to `*_version`. Readers who need history (bookings, audits) reference the version row. |
| **B. Versioned document, immutable when published** | `price_list` + `price_item`, `report_version`, `trf`, `receipt_record`, `financial_document` | A new version is a new row (or row set). Published or decided rows are frozen by triggers. |
| **C. Append-only event log** | `booking_status_history`, `custody_event`, `ledger_*`, `audit_log`, `verification_event` | Never updated. State is derived or denormalised onto the aggregate. |

## 2. Effective dating
- Master data has `effective_from` and `effective_to` where they apply (`md_node`, `scope_line`, `accreditation.valid_from/valid_to`, `config_parameter`, `fee_rule`).
- "Active" means `status='ACTIVE'` **and** `now()` (or the booking date) falls in the effective window.
- Future-dated changes: a change set can be published with a future `effective_from`. The current row keeps its live values until a timer applies the pending version (MVP: Data Stewards publish on the day. Future dating is a Should, see OQ-16).

## 3. Booking snapshots (CD-39)
When a booking is submitted (T-01) or edited (T-02), the engine copies:

| Source | Into | Fields |
|---|---|---|
| `lab_site` + `accreditation` (current) | `booking.lab_snapshot` | Site name, address, certificate no., standard, category, valid_from/to, status, status_as_of, NABL verification URL |
| `scope_line_version` (current version id) | `booking_line.scope_line_version_id` + `snapshot` | Discipline, group, product, parameter (codes and names), method, range, site type |
| `price_item` (effective published list) | `booking_line` price columns + `snapshot` | Unit price, prep charge, GST rate, sample quantity and unit, packaging, TAT |
| TRF form | `trf` v1..n | Whole form + schema version |

Once the booking status is no longer REQUESTED, line price columns can't be changed (C-11) and neither can the booking totals (C-43). **Totals are never restated**: when a line is cancelled later (EC-02, BR-073), the line gets status CANCELLED and the money moves through a refund; `booking.total_paise` still shows what was sold. If an accepted counter-offer changed a sample quantity, T-07 writes it to `booking_line.required_sample_qty`; the snapshot keeps the original. Financial documents copy their own `line_snapshot` at issue, so they never depend on mutable rows.

## 4. What changes after a booking, and what doesn't

| Change | Effect on an existing booking |
|---|---|
| The lab publishes a new price list | None. The booking keeps its snapshot price (EC-56). |
| A method or parameter name is corrected in master data | None on the booking display (snapshot). The search index updates. |
| A scope line is deactivated (EC-02) | Snapshot unchanged. An event flags affected open bookings for line cancellation and refund. |
| Accreditation is suspended (EC-01) | Snapshot unchanged (it shows what was valid at booking). The event triggers the EC-01 workflow. |
| The lab changes receiving hours | Open timers aren't recalculated. New instructions are shown live (operational data, not a snapshot). |

## 5. Report versions
- v1..vn per report. Only one version can be DRAFT or IN_REVIEW at a time, and only one can be RELEASED.
- A version returned by the Checker stays RETURNED for the record. The Maker's resubmission is a new version; it is **not** an amendment. An amendment is a version created while an earlier one is RELEASED (`is_amendment`), and needs `amendment_reason`.
- The report number and ULR belong to the report, not to a version, so every version carries the same ones.
- The verification code and the stamped copy are produced at submission (ADR-014). The code resolves only once the version is RELEASED.
- On release, the new version is RELEASED and the previous RELEASED version becomes SUPERSEDED with `superseded_by_version_id`. Both stay verifiable.
- The original upload is never modified. Stamping creates a separate file object.
