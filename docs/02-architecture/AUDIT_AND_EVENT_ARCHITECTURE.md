# Audit and event architecture

**Status:** Approved at gate G1 (2026-11-24).

## 1. Three records, three purposes

| Record | Table | Purpose | Mutability |
|---|---|---|---|
| Business history | `booking_status_history`, `custody_event`, `md_node_version`, `*_version`, `ledger_entry` | Domain truth, shown to users | Append-only |
| Audit log | `audit_log` | Who did what, from where, before and after, for accountability and investigations | Append-only, hash-chained |
| Domain events | `outbox_event` → SQS | Integration between modules (notifications, search, timers, analytics) | Append-only, with `published_at` updated by the relay |

## 2. Audit log
- Written by `AuditService.record()` inside the same transaction as the change.
- Fields: actor (user, membership, role), action code, entity type and id, `before`/`after` JSON diff (with sensitive fields redacted), request id, IP, user agent, `occurred_at`.
- **Hash chain.** The insert carries no hash, so transactions never wait on each other. A worker job seals new rows in (`occurred_at`, `id`) order, in batches, by appending to `audit_log_chain` (one chain per month): `hash = SHA-256(prev_hash || canonical_json(row))`. A nightly job verifies each chain against the audit rows and alerts on a break or on a row that stays unsealed for more than an hour.
- **As built (P3-01, `packages/core/src/platform/`).** The month of a chain is the UTC month of `occurred_at`. The sealer takes only rows older than a safety lag (default 30 s) and holds an advisory lock, so two workers cannot fork a chain. A row that commits after the lag is appended later with the next `seq`: the chain order is `seq`, not `occurred_at`, and the verifier follows `seq` (OQ-61). The verifier reports the first break (`SEQ_GAP`, `BROKEN_LINK`, `MISSING_ROW`, `HASH_MISMATCH`) and the rows unsealed for more than an hour. `canonical_json` sorts keys, writes a bigint as digits and a Date as an ISO UTC string. `before` and `after` are redacted by key name before the insert (OQ-68).
- The DB roles `app_rw` and `app_worker` have `INSERT, SELECT` only. `UPDATE`, `DELETE` and `TRUNCATE` are revoked, and a trigger raises an error on them. Only `app_worker` can insert into `audit_log_chain`.
- Mandatory audited actions include: every booking transition, Maker submission, Checker approval, role change, user (de)activation, price-list publish, change-set approve and publish, KYC and bank verification, refund, payout hold and release, dispute decision, break-glass access, config change, share-link create and revoke, label reprint.

## 3. Outbox and events
- `outbox_event(id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, published_at, attempts, last_error)`.
- Relay (worker): polls `WHERE published_at IS NULL ORDER BY occurred_at LIMIT 100 FOR UPDATE SKIP LOCKED`, publishes to SNS-less SQS queues by routing table, and sets `published_at`. The relay connects as `app_worker`, the only role that can read or update `outbox_event`; the API role can only insert. Delivery is at-least-once, so **consumers must be idempotent** (`processed_event(consumer, event_id)` table).
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
- **As built (P3-01).** `outbox_event.payload` holds `{ actor, data }`; the relay builds the envelope from the columns and the payload (OQ-63). The routing table is `packages/core/src/platform/routes.ts` (OQ-64): matrix codes go to `lc-notifications.fifo` and every event to `lc-analytics`. FIFO messages carry `MessageGroupId` = aggregate id and `MessageDeduplicationId` = event id. Only one relay runs at a time (an advisory lock), so that two workers cannot publish one aggregate's events out of order. A failing event does not stop the batch, but later events of the same aggregate wait for the next pass so their order is kept. After 50 failed attempts a row is parked (OQ-66). Consumers call `processOnce(tx, consumer, eventId, work)`. **As built (P3-10):** `lc-search-sync` now has routes for the seven search events of SEARCH.md section 2 (OQ-158). Its consumer does not use `processOnce`: it re-reads current state, so a duplicate or out-of-order event is harmless, and it needs no system context.

## 4. Timers (ADR-008)
- `timer(id, timer_type, aggregate_type, aggregate_id, due_at, status PENDING|FIRED|CANCELLED|FAILED, payload, attempts, fired_at, last_error)`.
- The worker loop runs every 15 s: `SELECT … WHERE status='PENDING' AND due_at <= now() FOR UPDATE SKIP LOCKED LIMIT 50`. It runs the handler in a transaction, and the handler re-checks the aggregate state.
- Timer types: `LAB_DECISION_REMINDER_50`, `LAB_DECISION_REMINDER_90`, `LAB_DECISION_DUE`, `COUNTER_RESPONSE_DUE`, `PAYMENT_REMINDER`, `PAYMENT_DUE`, `DROP_REMINDER`, `DROP_DEADLINE`, `NO_SHOW_DUE`, `RECEIPT_APPROVAL_REMINDER`, `HOLD_DECISION_DUE`, `REPORT_DUE`, `REPORT_APPROVAL_REMINDER`, `DISPUTE_WINDOW_END`, `PAYMENT_RECONCILE`.
- Business-hour durations are converted to an absolute `due_at` at scheduling time using `BusinessCalendar`. If the lab changes its hours, open timers aren't recalculated (documented behaviour).
- Tests use the injectable `Clock` and call `TimerService.runDue(now)` directly.
- **As built (P3-02, `packages/core/src/platform/business-calendar.ts` and `timers.ts`).** `BusinessCalendar` is pure and works in IST (a fixed UTC+05:30), with results as UTC instants. It is built from a weekly working-hours definition and a set of closed dates; the labs module reads `receiving_hours` and `site_closure` (its own tables) and passes them in, and `BusinessCalendarLoader.forSite` adds the platform holidays from `holiday_calendar`. It offers `addBusinessMinutes` (BR-012), `addWorkingDays` (BR-048, BR-081), `nextOpening`, `isWithinBusinessHours` and `businessMinutesBetween`/`fractionElapsed` (the 50 % and 90 % reminders, BR-013). The exact definitions are in OQ-80. `TimerService.schedule` and `scheduleAfterBusinessTime` insert in the caller's transaction (no `RETURNING`, because the API has no SELECT on `timer`); `cancel` and `cancelForAggregate` call two SECURITY DEFINER functions that can only move PENDING to CANCELLED, because the UPDATE policy is system-only (OQ-84). `runDueTimers` uses one transaction per timer in the system context: `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` (the lock is the claim), a savepoint around the handler, FIRED in the same transaction on success, and on failure `ROLLBACK TO SAVEPOINT` followed by `attempts + 1` and `last_error` in the same transaction. A failed timer stays PENDING and is tried again on the next pass; after 10 attempts it is FAILED (OQ-83). A timer type with no registered handler is never selected and is reported. No business handlers are registered yet: the worker module exposes an empty `TIMER_HANDLERS` registry for the modules that arrive with P3-07 and later. The worker job `timers` runs every 15 s (`TIMER_POLL_INTERVAL_MS`, `TIMER_BATCH_SIZE`).
