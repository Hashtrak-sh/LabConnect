# Observability and operations

**Status:** DRAFT.

## 1. Signals
- **Logs:** pino JSON → CloudWatch Logs. Fields: `ts, level, service, env, requestId, traceId, actorId, orgId, bookingId, route, status, durationMs`. Redaction list enforced in the logger config.
- **Traces:** OpenTelemetry SDK in api, worker and web (server) → ADOT collector → AWS X-Ray (or a managed alternative). The span attribute `booking.id` lets you trace a booking end to end (NFR-11).
- **Metrics:** OTel metrics + CloudWatch embedded metric format. Business metrics come from domain events.

## 2. Dashboards
| Dashboard | Contents |
|---|---|
| Service health | RPS, p50/p95/p99 latency per route group, 5xx rate, task count, CPU and memory, DB connections, queue depth and age, DLQ counts |
| Booking funnel | Search → booking → accepted → paid → received → released → completed (FS §14.1 events) |
| SLA board | Lab decisions pending (by age vs SLA), approvals pending (receipt and report), holds awaiting the customer, overdue drops, overdue reports |
| Payments | Orders created, captured, failed, pending, reconciliation exceptions, refunds, payouts eligible and released |
| Integrity | Audit chain verification status, rejected QR scans by reason, self-approval attempts, verification lookups (not-found rate) |

## 3. Alerts (initial)
| Alert | Condition | Severity |
|---|---|---|
| API 5xx | > 2% for 5 min | High |
| Webhook endpoint failures | any 5xx, or signature failures > 5 in 10 min | High |
| Outbox lag | oldest unpublished > 2 min | High |
| DLQ messages | > 0 | Medium |
| Timer backlog | due timers not fired > 5 min | High |
| Stuck bookings | state age beyond the SLA × 2 (per state) | Medium |
| Reconciliation exceptions | any unmatched after the daily run | Medium |
| Audit chain break | any | Critical |
| Malware detected | any | Medium |
| Cert, KMS key or secret expiry | 30 days before | Low |

## 4. SLOs
Availability SLOs per NFR-01/02, with error budgets reviewed monthly. Synthetic canaries (CloudWatch Synthetics): home and search, lab page, verification page, webhook health endpoint.
