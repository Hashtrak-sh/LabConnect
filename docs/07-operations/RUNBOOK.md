# Runbook

**Status:** DRAFT. Expand before go-live (task H-06).

## 1. Contacts and escalation
| Role | Who | Contact |
|---|---|---|
| Technical owner | @Hashtrak-sh | _tbd_ |
| Developer | @akshit-anand | _tbd_ |
| Platform Ops lead | _tbd_ (operating authority) | _tbd_ |
| Finance | _tbd_ | _tbd_ |
| ICICI support | _tbd_ | _tbd_ |

## 2. Daily checks
Ops board (SLA breaches, holds, overdue drops) · reconciliation exceptions · DLQs empty · stuck-booking alert list · new lab claims and KYC queue · geocode pin queue.

## 3. Common procedures
- **Payment debited, booking not PAID:** check `payment_order` status and the webhook events → run `reconcile --order <id>` → if captured, the system transitions the booking. If not, confirm the gateway auto-refund. Never set the status manually.
- **Lab can't log in or the Checker is unavailable:** verify membership. If the lab has no other Checker, contact the lab to add one (EC-54). Ops can't approve on the lab's behalf.
- **Wrong site scan reported:** check `custody_event` SCAN_REJECTED details and guide the customer to the intended site.
- **Report issued to the wrong booking (EC-40):** revoke share links → the lab creates an amendment → incident record → notify the affected parties.
- **DLQ replay:** inspect the message → fix the cause → `worker replay-dlq <queue> --dry-run` then run it for real. Consumers are idempotent.

## 4. Deployments
Follow `GIT_WORKFLOW.md` §3. Before approving a production deploy: UAT sign-off, migration review (expand-only?), backup snapshot confirmed, rollback plan noted in the release PR.

## 5. Rollback
App: redeploy the previous task definition (automatic on smoke failure). DB: forward-fix only. Restore from PITR only for data corruption, with an incident commander's decision.

## 6. QR key rotation (quarterly)
1. Create a new KMS HMAC key and register it in `qr_signing_key` as ACTIVE. Set the old key to VERIFY_ONLY with `verify_until = now + 90 days`.
2. Deploy (no code change needed). New labels use the new key.
3. After `verify_until`, set RETIRED and schedule KMS key deletion after a further 30 days.

## 7. Master data import (production)
Upload → preview → resolve errors → change set → second-person approval → publish → verify search freshness → spot-check 10 labs.

## 8. Disaster recovery
Declare the incident → decide on failover to ap-south-2 → deploy the stack with IaC → restore RDS from the latest cross-region snapshot or PITR → point DNS → verify → communicate. Target RTO 4 h.

## 9. Security incident and data breach
Contain (revoke sessions or keys, block via WAF) → preserve evidence (logs, audit) → assess personal-data impact → notify per the legal requirements (DPDP, CERT-In timelines, to be confirmed in legal review) → remediate → post-incident review.
