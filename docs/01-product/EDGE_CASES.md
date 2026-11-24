# Edge cases and exception handling

**Status:** DRAFT. These are the edge cases from the feature specification (§9 and amendment A.8), with their MVP disposition. Each one needs at least one automated test, and the RTM links them.

| ID | Scenario | MVP behaviour | Disposition |
|---|---|---|---|
| EC-01 | Accreditation suspended, withdrawn or expired with open bookings | Removed from search. REQUESTED → auto-cancelled. PAID or HANDOVER_SET → frozen, and the customer is offered a full refund (transfer is a manual Ops rebook). UNDER_TEST continues only if the Checker confirms the scope was valid on the receipt date. Ops is alerted. | MVP |
| EC-02 | Parameter removed from scope after booking | As EC-01, applied per line. The line is cancelled with a partial refund. | MVP |
| EC-03 | Duplicate lab in dataset | De-duplicate by certificate number in the import preview. Ops review queue. | MVP |
| EC-04 | Wrong geocode | The Checker proposes a pin move and Ops approves it. Only approved pins are used. | MVP |
| EC-05 | No nearby lab offers the test | Widen-radius suggestion, show labs further away, capture a lead | MVP |
| EC-06 | Only an unclaimed lab matches | "Listed, not yet on LabConnect". The request is captured, and the customer is notified when the lab becomes bookable. | MVP |
| EC-07 | Two customers race for the last slot | Row lock and capacity check. The loser gets `409 SLOT_UNAVAILABLE` and the next slots. | MVP |
| EC-08 | Lab misses the decision SLA | Reminders, then EXPIRED. Top 3 alternatives offered, with one-tap rebook (TRF copied). Responsiveness score updated. | MVP |
| EC-09 | Lab rejects | Mandatory reason code. Customer sees the reason and alternatives. | MVP |
| EC-10 | Lab counters | 24 h for the customer to respond. Silence means expired. | MVP* (slot and quantity only) |
| EC-11 | Customer edits after submission | Allowed in REQUESTED only (new TRF version, SLA restarts). After acceptance, cancel and rebook. | MVP |
| EC-12 | Parameters need different quantities | The TRF shows per-parameter quantity. Package count is suggested. The lab can counter with extra quantity. | MVP |
| EC-13 | Holiday or outside hours | Those slots are never generated. A lab ad hoc closure cancels affected slots and notifies the holders. | MVP |
| EC-14 | Abandoned bookings | Limit on open REQUESTED bookings per org. A no-pay counter feeds a trust flag (no prepayment fee in the MVP). | MVP* |
| EC-15 | Debited but no webhook | Payment order PENDING. Poll every 5 min for 2 h. Mark PAID or rely on the gateway's auto-refund. Customer informed. | MVP (depends on ICICI status API) |
| EC-16 | Duplicate payment | Idempotency per booking attempt. The second capture is auto-refunded. | MVP |
| EC-17 | Payment window expires | EXPIRED_UNPAID, slot released, lab notified | MVP |
| EC-18 | Cancel after payment, before handover | Refund minus the cancellation fee | MVP |
| EC-19 | Cancel after receipt | Refund lines not started | MVP |
| EC-20 | Lab cancels after payment | Full refund, lab penalty (scoring), Ops assists | MVP |
| EC-21 | Extra work found | Supplementary payment is deferred. Cancel the untested lines and rebook. | DEFERRED |
| EC-22 | Bank transfer against PO | Excluded | EXCLUDED |
| EC-23 | No drop by deadline | Reminders, then NO_SHOW after grace, refund minus the no-show fee | MVP |
| EC-24 | Arrives outside hours | Hours shown everywhere. No platform action. | MVP |
| EC-25 | Fewer packages than declared | Record the actual count. ON_HOLD if needed. 48 h to bring the rest or reduce lines. | MVP |
| EC-26 | QR missing or unreadable | Short-code lookup with photo. The Checker approves a reprint. Never accept an unlabelled package. | MVP |
| EC-27 | Wrong lab | Scan refused. Customer shown the correct site. | MVP |
| EC-28 | Lab closed during hours | Customer reports in the booking. Ops contacts the lab. Rebook or cancel with a full refund. | MVP |
| EC-29 | Damaged or unsuitable sample | Record and photo, Checker confirms, ON_HOLD | MVP |
| EC-30 | Perishable arrives late or warm | The lab publishes a max sampling-to-receipt time per category. The Checker may hold as "condition compromised". | MVP |
| EC-33 | Batch mismatch | ON_HOLD. If the customer chooses "proceed", the report carries the observed batch (deviation flag). | MVP |
| EC-34 | Insufficient quantity | ON_HOLD. Top-up package (new package QR) or reduce lines. | MVP |
| EC-35 | Sample unfit | The Checker rejects the sample. Cancelled with a refund minus the handling fee. Customer collects the sample, or it's disposed of. | MVP |
| EC-36 | Equipment breakdown | The Maker updates the ETA with a reason. The customer can cancel untested lines. **No subcontracting.** | MVP* |
| EC-37 | Report overdue | Auto-flag, new date. A delay of more than 3 days lets the customer raise a delay dispute. | MVP |
| EC-38 | Result fails specification | Published normally. The platform never edits results. Re-test is a new booking. | MVP |
| EC-39 | Retained sample | `retain_until` is shown. Collection is arranged directly with the lab. | MVP |
| EC-40 | Report uploaded to the wrong booking | Prevented by binding checks. If released anyway: amendment, access revoked, incident logged. | MVP |
| EC-41 | Correction after release | Amendment, new version, new QR. The old QR shows "Superseded by vN". | MVP |
| EC-42 | Corrupt, encrypted or non-PDF upload | Rejected with a clear error. Malware scan. | MVP |
| EC-43 | Customer disputes the result | Dispute. Lab responds within 2 business days. Technical matters go to the lab's complaint process. | MVP |
| EC-44 | Forged report circulated | Verification shows not-found or a hash mismatch | MVP |
| EC-45 | Customer account closed | Reports retained. The org admin can request them. | MVP |
| EC-46 | Requester leaves | The admin reassigns open bookings. Access is revoked immediately. | MVP |
| EC-47 | Maker or Checker leaves | Removed. Pending items wait for another Checker. Below the minimum, the site becomes non-bookable. | MVP |
| EC-48 | Credential stuffing or hijack | OTP rate limits, MFA, session anomaly alerts | MVP |
| EC-49 | Partner outage | Circuit breaker, queued retries, status banner | MVP |
| EC-50 | Offline scanner or clock drift | Offline queue with device time and a monotonic counter. The server reconciles and flags gaps over 15 minutes. | MVP |
| EC-51 | Both lab roles on one user | Blocked by the DB trigger and the API | MVP |
| EC-52 | Report returned | Back to UNDER_TEST with comments. Versions are kept. | MVP |
| EC-53 | Approval waits too long | Reminders at 50% and 90%. Ops alerted on breach. | MVP |
| EC-54 | Only Checker is the Maker, or is on leave | Blocked. The item waits. The lab is warned. Ops can extend due dates but can't approve. | MVP |
| EC-55 | ON_HOLD with no customer response (new) | Reminder at 50%. Escalate to Ops at expiry. Ops contacts the customer and may cancel. | MVP (OQ-07) |
| EC-56 | Price list changes while a booking is REQUESTED (new) | The booking keeps its snapshot price. The Checker's acceptance confirms the snapshot price. | MVP |
| EC-57 | Webhook arrives for an expired or cancelled booking (new) | Record the payment, then auto-refund. Finance exception raised. | MVP |
| EC-58 | Master-data change set retires a scope line used by open bookings (new) | Publication warns and lists affected bookings. EC-02 handling applies after publication. | MVP |

(EC-31 and EC-32 aren't used in the source specification.)
