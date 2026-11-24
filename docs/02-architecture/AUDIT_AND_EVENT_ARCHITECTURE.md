# Audit and event architecture

**Status:** DRAFT for gate G1.

## 1. Three records, three purposes

| Record | Table | Purpose | Mutability |
|---|---|---|---|
| Business history | `booking_status_history`, `custody_event`, `md_node_version`, `*_version`, `ledger_entry` | Domain truth, shown to users | Append-only |
| Audit log | `audit_log` | Who did what, from where, before and after, for accountability and investigations | Append-only, hash-chained |
| Domain events | `outbox_event` → SQS | Integration between modules (notifications, search, timers, analytics) | Append-only, with `published_at` updated by the relay |

## 2. Audit log
- Written by `AuditService.record()` inside the same transaction as the change.
- Fields: actor (user, membership, role), action code, entity type and id, `before`/`after` JSON diff (with sensitive fields redacted), request id, IP, user agent, `occurred_at`, `prev_hash`, `hash`.
- `hash = SHA-256(prev_hash || canonical_json(row))` is computed per partition (monthly). A nightly job verifies the chain and alerts on a break.
- The DB role `app_rw` has `INSERT, SELECT` only. `UPDATE` and `DELETE` are revoked, and a trigger raises an error on them.
- Mandatory audited actions include: every booking transition, Maker submission, Checker approval, role change, user (de)activation, price-list publish, change-set approve and publish, KYC and bank verification, refund, payout hold and release, dispute decision, break-glass access, config change, share-link create and revoke, label reprint.

## 3. Outbox and events
- `outbox_event(id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, published_at, attempts, last_error)`.
- Relay (worker): polls `WHERE published_at IS NULL ORDER BY occurred_at LIMIT 100 FOR UPDATE SKIP LOCKED`, publishes to SNS-less SQS queues by routing table, and sets `published_at`. Delivery is at-least-once, so **consumers must be idempotent** (`processed_event(consumer, event_id)` table).
- Queues (each with a DLQ and a max receive count of 5):

| Queue | Consumers | Notes |
|---|---|---|
| `lc-notifications.fifo` | notifications | `MessageGroupId = booking_id` keeps per-booking order |
| `lc-search-sync` | search | Upserts site or scope documents |
| `lc-files` | files, reports | Scan results, PDF validation, stamping |
| `lc-timers` | (optional fan-out) | Timers are DB-polled (below) |
| `lc-analytics` | analytics sink (later) | Event stream per FS §14.1 |

- Event envelope: `{ id, type, version, occurredAt, aggregate: {type, id}, actor: {userId, role, orgId} | 'SYSTEM', data }`.
- Event names follow `NOTIFICATIONS_MATRIX.md` codes plus the analytics events in FS §14.1.

## 4. Timers (ADR-008)
- `timer(id, timer_type, aggregate_type, aggregate_id, due_at, status PENDING|FIRED|CANCELLED, payload, attempts, fired_at)`.
- The worker loop runs every 15 s: `SELECT … WHERE status='PENDING' AND due_at <= now() FOR UPDATE SKIP LOCKED LIMIT 50`. It runs the handler in a transaction, and the handler re-checks the aggregate state.
- Timer types: `LAB_DECISION_REMINDER_50`, `LAB_DECISION_REMINDER_90`, `LAB_DECISION_DUE`, `COUNTER_RESPONSE_DUE`, `PAYMENT_REMINDER`, `PAYMENT_DUE`, `DROP_REMINDER`, `DROP_DEADLINE`, `NO_SHOW_DUE`, `RECEIPT_APPROVAL_REMINDER`, `HOLD_DECISION_DUE`, `REPORT_DUE`, `REPORT_APPROVAL_REMINDER`, `DISPUTE_WINDOW_END`, `PAYMENT_RECONCILE`.
- Business-hour durations are converted to an absolute `due_at` at scheduling time using `BusinessCalendar`. If the lab changes its hours, open timers aren't recalculated (documented behaviour).
- Tests use the injectable `Clock` and call `TimerService.runDue(now)` directly.
