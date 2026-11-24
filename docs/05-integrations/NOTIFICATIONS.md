# Notification architecture

**Status:** DRAFT. Matrix: `01-product/NOTIFICATIONS_MATRIX.md`.

## 1. Flow
Domain transition → `outbox_event` → relay → `lc-notifications.fifo` (group = booking id) → `NotificationConsumer`:
1. Resolve recipients by rule (event code → parties → roles → active users with site access).
2. For each recipient × channel: apply preferences (unless action-required), render the template (`event_code`, `channel`, `locale`, latest active version), and insert `notification` (unique per event × recipient × channel, which keeps it idempotent).
3. Dispatch through the channel adapter. Record the provider ID and status. Retry with backoff. Failures above the threshold alert.

## 2. Channels
| Channel | MVP | Adapter | Notes |
|---|---|---|---|
| In-app | ✔ | `InAppChannel` (DB row, polled or SSE) | Bell, unread count, deep link to the action |
| Email | ✔ | `SesEmailChannel` | SES ap-south-1. Verified domain with DKIM, SPF, DMARC. Bounce and complaint SNS → suppression. |
| SMS | Later | `SmsChannel` stub | Needs a DLT entity, headers and template registration (OQ-11) |
| WhatsApp | Later | `WhatsAppChannel` stub | Needs a BSP and pre-approved templates |

## 3. Template rules
- Variables are whitelisted per event (e.g. `bookingNo`, `labName`, `deadline`, `actionUrl`). No free-form HTML from data. Escape everything.
- Never include report content, OTPs (except the OTP email), bank details, or another party's personal contact details.
- Plain-text and HTML email variants. Footer per QCI communication guidelines (to be filled from the brand PDF).
- Templates are versioned. Changing a template is a `PLATFORM_ADMIN` action, previewed with sample data.

## 4. Local and test
Mailpit in docker-compose. Tests assert on `notification` rows, not on emails.
