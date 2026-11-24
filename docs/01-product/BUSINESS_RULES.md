# Business rules

**Status:** Approved at gate G1 (2026-11-24). Configurable values come from `config_parameter` (see `03-database/SCHEMA_SPECIFICATION.md` §12). The defaults shown are proposals.

## Discovery and lab eligibility
| ID | Rule |
|---|---|
| BR-001 | A lab site is **bookable** only if all of these hold: the organisation is claimed; KYC is verified; bank is verified; an accreditation is `VALID` and in date; the category is `TESTING`; a published price list is in effect; there's at least one active `LAB_MAKER` and one active `LAB_CHECKER` assigned to the site, and they're different users. The computed flag `lab_site.is_bookable` is recalculated on every relevant change. |
| BR-002 | Sites with a `SUSPENDED`, `WITHDRAWN` or `EXPIRED` accreditation are removed from search results immediately (EC-01). |
| BR-003 | A booking may only include scope lines that are active, on the selected site, under a valid accreditation, and priced in the effective price list. |
| BR-004 | Distance filters use only the Ops-approved geo point (EC-04). |
| BR-005 | Medical (ISO 15189) records are rejected at import. |

## Booking
| ID | Rule | Default |
|---|---|---|
| BR-010 | Slot soft hold on submit lasts for the lab decision window | SLA + 4 h |
| BR-011 | Concurrent bookings for the last slot capacity: the first to commit wins (row lock on slot) | — |
| BR-012 | Lab decision SLA, counted in business hours of the lab site | 4 business hours |
| BR-013 | Reminders to Checkers at 50% and 90% of the SLA. Ops is alerted at 90%. | — |
| BR-014 | Auto-expire at SLA + grace | +4 h |
| BR-015 | Maximum open REQUESTED bookings per customer org | 10 |
| BR-016 | Duplicate warning: same customer org + item + batch + parameter set within N days, any lab | 7 days |
| BR-017 | A counter-offer may change only the slot and/or add sample-quantity requirements | — |
| BR-018 | Customer response window for a counter-offer | 24 h |
| BR-019 | The estimate total is the sum of line prices + sample-prep charges + GST. The platform fee is 0. | — |
| BR-020 | The booking freezes line prices, the GST rate, scope line versions, method and accreditation details at submission. An edit in REQUESTED re-snapshots against the price list in effect at that moment. | — |
| BR-021 | Attachments total ≤ 25 MB. Allowed types: PDF, PNG, JPG, XLSX, DOCX (scanned). | — |

## Payment
| ID | Rule | Default |
|---|---|---|
| BR-030 | Payment window after acceptance | 24 h |
| BR-031 | A reminder is sent when 2 h of the window remain | — |
| BR-032 | If a payment is pending at window expiry, the window extends while reconciliation runs. Reconciliation polls every 5 min for up to 2 h. | — |
| BR-033 | Only one successful capture per booking. Any further capture is refunded automatically. | — |
| BR-034 | Amounts are integer paise. GST rate is stored per line in basis points. | — |

## Handover and receipt
| ID | Rule | Default |
|---|---|---|
| BR-040 | Drop deadline = end of the chosen slot's date, plus the lab-configured allowance | end of slot day |
| BR-041 | Grace period after the drop deadline before NO_SHOW | 48 h |
| BR-042 | No-show fee, as a percentage of the test value | 10% (OQ-07) |
| BR-043 | A package QR is valid only for its booking's lab site. Scans at any other site are refused, and the correct site is shown. | — |
| BR-044 | A package can't be received twice. A reprint voids the earlier label version. | — |
| BR-045 | Missing packages: the booking waits up to 48 h for the rest before a hold decision | 48 h |
| BR-046 | Customer decision window when ON_HOLD | 24 h |
| BR-047 | No customer decision within the window: escalate to Ops. No automatic cancellation. | OQ-07 |
| BR-048 | Checker approval SLA for receipts and reports | 1 business day |
| BR-049 | Retention: `retain_until = receipt_approved_at + retention_days` for the site and discipline | per lab |

## Testing and report
| ID | Rule |
|---|---|
| BR-060 | Report PDF ≤ 20 MB, must be a PDF, not encrypted, and must pass the malware scan. |
| BR-061 | Report parameters must be a subset of the booking's active (non-cancelled) lines. |
| BR-062 | The ULR number is unique across all released report versions on the platform. |
| BR-063 | The bound package must belong to the booking and be in `RECEIVED` status. |
| BR-064 | Publishing needs a Checker who isn't the version's Maker, plus MFA within the last 5 minutes. |
| BR-065 | An amendment creates a new version. The previous released version becomes `SUPERSEDED`, and its verification shows "Superseded by vN". |
| BR-066 | Share links expire after 7 days by default (maximum 30) and can be revoked. Download URLs expire after 15 minutes. |

## Cancellation, refunds and payouts
| ID | Stage | Refund to customer | Lab amount | Default |
|---|---|---|---|---|
| BR-070 | Before payment | n/a | n/a | free |
| BR-071 | Customer cancels after payment, before handover | total − cancellation fee | cancellation fee (configurable split) | 10% fee (OQ-07) |
| BR-072 | NO_SHOW | total − no-show fee | no-show fee | 10% |
| BR-073 | Customer cancels after receipt | lines `NOT_STARTED` refunded | lines in progress or done | — |
| BR-074 | Lab cancels after payment | 100% | 0. Lab penalty recorded. | — |
| BR-075 | Accreditation lapses before receipt | 100% or transfer | 0 | — |
| BR-076 | Sample unfit (checker rejects) | total − handling fee | handling fee | OQ-07 |
| BR-077 | Payout eligibility: report released + 72 h, with no open dispute and no payout hold | — | — | 72 h |
| BR-078 | Raising a dispute within the window places an automatic payout hold | — | — | — |
| BR-079 | Lab penalties are recorded for scoring only in the MVP. No monetary deductions until a policy exists (OQ-07). | — | — | — |

## Disputes
| ID | Rule | Default |
|---|---|---|
| BR-080 | A dispute can be raised within 72 h of report release, or at any time for billing disputes on open bookings | 72 h |
| BR-081 | Lab response SLA on a dispute | 2 business days |
| BR-082 | Technical result disputes are referred to the lab's own ISO/IEC 17025 complaint process. Ops decides only the commercial outcome. | — |
| BR-083 | Every dispute decision records the decider, rationale, outcome and refund amount, and is immutable once closed | — |

## Calendar
| ID | Rule |
|---|---|
| BR-090 | Business hours and holidays come from the lab site's receiving hours and closures, plus a platform holiday calendar (national gazetted holidays). |
| BR-091 | All times are stored in UTC and calculated in `Asia/Kolkata`. |
