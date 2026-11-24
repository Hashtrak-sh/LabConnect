# AWS environments and deployment

**Status:** DRAFT. Sizing needs confirmation (OQ-06). Infrastructure as code: AWS CDK (TypeScript) proposed (ADR-015).

## 1. Accounts and environments
Recommended: separate AWS accounts for UAT and Production under AWS Organizations (from the existing account as the management or tooling account). If that isn't possible, at minimum use separate VPCs, KMS keys, IAM roles and resource-name prefixes in one account (OQ-18).

| | Local | UAT | Production |
|---|---|---|---|
| Source | developer machine | `main` | `production` |
| Region | — | ap-south-1 | ap-south-1 (DR: ap-south-2, OQ-06) |
| Data | seed:demo | demo + sample of real NABL data | real |
| Payments | FakePaymentGateway | Fake → ICICI sandbox | ICICI live |
| Email | Mailpit | SES (sandbox or limited) | SES production |

## 2. Services
| Concern | Service | UAT sizing (initial) | Prod sizing (initial, to validate with load tests) |
|---|---|---|---|
| Network | VPC across 3 AZs, private subnets for compute and data, NAT, VPC endpoints (S3, ECR, SQS, KMS, Secrets Manager, CloudWatch) | 2 AZ | 3 AZ |
| Edge | CloudFront + AWS WAF (managed rules, rate rules) → ALB | ✔ | ✔ |
| Compute | ECS Fargate: `web`, `api`, `worker`, plus a one-off `migrate` task | 1 task each | web 2–6, api 2–8, worker 2–4 (autoscaling) |
| Database | RDS PostgreSQL 16 + PostGIS | db.t4g.medium, single-AZ | db.r6g.large Multi-AZ, PITR 7 days (+ read replica later) |
| Search | Amazon OpenSearch Service | 1 × small | 3 × r6g.large.search (2 AZ) |
| Cache | ElastiCache (Redis/Valkey) | 1 × t4g.small | 2 nodes, Multi-AZ |
| Queues | SQS standard + FIFO, with DLQs | ✔ | ✔ |
| Files | S3 (uploads, reports, financial docs, labels, imports), versioning, SSE-KMS, Object Lock on report and finance prefixes | ✔ | ✔ + cross-region replication to ap-south-2 |
| Malware scan | GuardDuty Malware Protection for S3 (verify, ADR-010) | ✔ | ✔ |
| Keys | KMS: data keys per data class, HMAC keys per QR purpose | ✔ | ✔ |
| Secrets | Secrets Manager + SSM | ✔ | ✔ |
| Email | SES (domain verification, DKIM) | ✔ | ✔ |
| Observability | CloudWatch Logs, X-Ray/ADOT collector, CloudWatch dashboards and alarms | ✔ | ✔ |
| Backups | RDS automated + AWS Backup plan, S3 versioning | daily | daily + PITR, cross-region copy |

## 3. Deployment
See `06-engineering/CI_CD.md`. Images go to ECR with immutable tags and are scanned on push. Prod promotes the exact UAT digests.

## 4. Domains (OQ-12)
Placeholders: `labconnect.<gov-domain>` (web), `api.labconnect.<gov-domain>`, `verify.labconnect.<gov-domain>` (or `/v` path on web). TLS via ACM. TLS 1.2+ only (CloudFront and ALB security policies).

## 5. Backup and disaster recovery (NFR-12)
| Target | Mechanism |
|---|---|
| RPO 15 min | RDS PITR (continuous), S3 versioning + replication |
| RTO 4 h | IaC to recreate the stack in ap-south-2. RDS snapshot copy to DR. Runbook §8. |
| Restore testing | Weekly automated restore of the UAT snapshot into a scratch instance plus a schema check. A full DR drill before go-live and every 6 months. |

## 6. Cost guardrails
AWS Budgets with alerts per environment. UAT scales to zero at night (web, api, worker) on a schedule, if acceptable.
