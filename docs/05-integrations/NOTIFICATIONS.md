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

## 5. As built (P3-08)

Code: `packages/core/src/notifications/` (framework-free), `apps/worker/src/modules/notifications/`, `apps/api/src/modules/notifications/`. Open questions OQ-140 to OQ-149.

**Pipeline.**
1. The consumer (`consumeNotificationsQueue`) reads `lc-notifications.fifo`. A message group is the aggregate id, so a group's messages are handled in the order received and, once one fails, the rest of that group in the pass are left on the queue (other groups go on). A message that is not an envelope, or whose subject the context port cannot find, fails and ends in the dead-letter queue.
2. `handleNotificationEvent(deps, envelope)` ignores a code that is not a notification event, asks the **context port** (`NotificationContextPort`) who is involved, and in one system transaction guarded by `processOnce('notifications', event id)` resolves the recipients, reads the mute settings and inserts the `notification` rows (`createMany`, `skipDuplicates`). A second delivery changes nothing.
3. In-app rows are `SENT` at once. Email rows are `QUEUED`. A muted optional pair is stored as `SUPPRESSED` with an empty payload and never shows in the inbox. An action-required pair ignores the mute. The payload holds only the whitelisted template variables and the booking id (ids, names, IST dates, INR amounts); never report content, an OTP, a token, bank details or an email address.
4. The delivery pass (`runEmailDeliveries`, every few seconds) sends the queued emails, outside any database transaction: claim (`FOR UPDATE SKIP LOCKED`, count the attempt, set a 10-minute lease in `next_attempt_at`, read the address, render), send through `EmailSender`, mark `SENT` or schedule a retry (backoff 2, 4, 8, ... minutes, at most an hour) or `FAILED` (5 attempts, or a permanent refusal). The row stores the kind of error only. **At-least-once edge:** a crash (or a send slower than the lease) between a successful send and the mark leaves the row `QUEUED`, so it is sent again after the lease. A row marked `SENT` is never sent again.

**Recipients.** `NOTIFICATION_RULES` (`rules.ts`) is the matrix as data: per event, the parties (`CUSTOMER`, `LAB_MAKER`, `LAB_CHECKER`, `OPS`, `INVITEE`), channels, whether a cell is bold (action-required) and the condition of a conditional cell. A test parses `NOTIFICATIONS_MATRIX.md` and compares every cell. People come from identity (`findRoleHolders`: active user, active membership, active organisation, role not revoked, and for a lab site an unrevoked `membership_site`), never from another module's tables. What the event does not carry (booking number, the customer's requester, the lab organisation and site, the lab's name) comes from the context port, which the booking and labs modules implement; until an adapter is registered in the worker the consumer does not start (OQ-140).

**Templates.** Code templates (`templates.ts`) are typed functions per event and channel, in a registry by locale (only `en`). `EVENT_VARIABLES` is the allow-list per event. A newer ACTIVE row in `notification_template` (`en-IN`) replaces the code template when its text uses only simple `{{name}}` placeholders of the event (`stored-templates.ts`); otherwise the code template is used. The version used is recorded in `notification.template_version` (0 = code). The email is rendered at send time from the stored payload and that version. HTML is built from escaped parts.

**Senders.** `EMAIL_TRANSPORT=ses|smtp|memory`. Unset: SMTP if `SMTP_HOST` is set (Mailpit), else in memory, on a developer machine only. In a deployed environment (`NODE_ENV=production`, `APP_ENV=production` or `uat`) an unset or `memory` value stops the worker from starting, and `smtp` is refused in production. SES settings: `SES_FROM_ADDRESS` (or `MAIL_FROM`), optional `SES_CONFIGURATION_SET`; region and credentials from the AWS SDK. The OTP email does not use this path (OQ-65).

**API.** `GET /v1/me/notifications`, `POST /v1/me/notifications/{id}/read`, `GET` and `PATCH /v1/me/notification-preferences`, all `noPermissionRequired`, all run as the user alone (`TenantScope.runAsUser`). The admin template operations are not built.

**Schema.** Migration `20261125120000_notification_delivery`: `delivery_attempts` and `next_attempt_at` on `notification`; a user may update only `read_at` of their own rows (policy `read_own` and a column grant). Links in emails are `WEB_BASE_URL` plus a path of ids.

**Not built.** SMS and WhatsApp; bounce and complaint handling (SNS suppression); Hindi; the admin template endpoints and their preview; the booking, labs, custody, disputes and payments adapters of the context port; the QCI footer wording (OQ-19).
