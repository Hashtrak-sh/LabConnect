# Notifications matrix

**Status:** DRAFT. MVP channels are **email (E)** and **in-app (I)**. Rows that used SMS or WhatsApp in the spec now fall back to E+I (R-06). The "Later" column shows where SMS (S) or WhatsApp (W) will be added.

Party who must act: at least two channels (E+I). Party who only needs to know: in-app, plus email where noted.

| Event code | Trigger | Customer | Lab Maker | Lab Checker | Ops | MVP | Later |
|---|---|---|---|---|---|---|---|
| `booking.requested` | REQUESTED | Confirmation (I,E) | New request (I) | **Decide** (I,E) | — | E,I | S,W to lab |
| `booking.sla_reminder` | 50% / 90% of SLA | — | — | **Decide** (I,E) | at 90% (I) | E,I | S |
| `booking.accepted` | ACCEPTED | **Pay now** (I,E) | — | — | — | E,I | W |
| `booking.rejected` | REJECTED | Reason + alternatives (I,E) | — | — | — | E,I | — |
| `booking.expired` | EXPIRED | Alternatives (I,E) | — | Info (I) | Info (I) | E,I | — |
| `booking.countered` | COUNTERED | **Respond** (I,E) | — | — | — | E,I | W |
| `booking.counter_response` | Counter accepted or declined | — | Info (I) | Info (I,E) | — | E,I | — |
| `payment.window_ending` | 2 h left | **Pay** (I,E) | — | — | — | E,I | W |
| `payment.succeeded` | PAID → HANDOVER_SET | Receipt, instructions, QR (I,E) | Expected drop (I) | Payment received (I,E) | — | E,I | — |
| `payment.expired` | EXPIRED_UNPAID | Info (I,E) | — | Info (I) | — | E,I | — |
| `handover.deadline_approaching` | 24 h before the deadline | **Drop sample** (I,E) | — | — | — | E,I | W |
| `handover.overdue` | Deadline passed | Reminder (I,E) | Overdue (I) | — | Overdue list | E,I | W |
| `booking.no_show` | NO_SHOW | Notice + refund (I,E) | Info (I) | Info (I) | — | E,I | — |
| `receipt.recorded` | SAMPLE_RECORDED | Under check (I) | — | **Approve receipt** (I,E) | — | E,I | — |
| `receipt.approved` | RECEIVED | Received, ETA (I,E) | Start testing (I) | — | — | E,I | — |
| `receipt.on_hold` | ON_HOLD | **Decide within 24 h** (I,E) | — | — | Info (I) | E,I | S,W |
| `hold.reminder` / `hold.escalated` | 50% / expiry | **Decide** (I,E) | — | — | **Contact** (I,E) at expiry | E,I | S |
| `approval.sla_reminder` | 50% / 90% (receipt or report) | — | — | **Approve** (I,E) | at breach (I) | E,I | — |
| `testing.started` | UNDER_TEST | Info (I) | — | — | — | I | — |
| `report.eta_revised` | ETA change | New date + reason (I,E) | — | — | if > 3 days (I) | E,I | — |
| `report.submitted` | REPORT_IN_REVIEW | — | — | **Approve or return** (I,E) | — | E,I | — |
| `report.returned` | Returned | — | **Correct** (I,E) | — | — | E,I | — |
| `report.released` | REPORT_RELEASED | **Download** (I,E) | Published (I) | Info (I) | — | E,I | W |
| `report.amended` | New version released | Updated report (I,E) | Info (I) | Info (I) | — | E,I | — |
| `label.reprint_requested` | Maker requests | — | — | **Approve** (I) | — | I | — |
| `booking.cancelled` | CANCELLED | Info + refund (I,E) | Info (I) | Info (I,E) | if lab-cancelled | E,I | — |
| `refund.processed` | Refund success | Info (I,E) | — | — | — | E,I | — |
| `payout.released` | Payout | — | — | Settlement advice (E) | — | E | — |
| `dispute.opened` | Dispute | Ack (I,E) | — | **Respond** (I,E) | **Assign** (I,E) | E,I | — |
| `dispute.updated` / `dispute.decided` | Update or decision | Info (I,E) | — | Info (I,E) | — | E,I | — |
| `accreditation.changed` | Change set published affecting the site | Affected bookings (I,E) | — | Alert (I,E) | **Review** (I) | E,I | — |
| `lab.became_bookable` | Lead's lab onboarded | Notify the requester (E) | — | — | — | E | — |
| `auth.otp` | Sign-in | OTP (E) | OTP (E) | OTP (E) | OTP (E) | E | S |
| `user.invited` | Invitation | Invite (E) | Invite (E) | Invite (E) | — | E | — |

**Rules.** Users may mute non-action rows per channel. Action rows (bold) can't be muted. OTP emails are never batched or delayed. Each notification carries the booking number, and never report content.
