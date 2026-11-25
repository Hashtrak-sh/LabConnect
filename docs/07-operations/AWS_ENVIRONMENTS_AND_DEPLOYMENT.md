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

## 7. As built (P3-11)
**Code and tests only. Nothing is deployed, no AWS account was used, and no AWS call was made.** The code is `infrastructure/` (AWS CDK v2 in TypeScript, ADR-015, still marked as a default awaiting confirmation) with the parameters, the first-deployment steps and the cost drivers in `infrastructure/README.md`. The root `Dockerfile` builds the images. There is **no production stage** in the code: asking for it stops with an error until a person adds it (CLAUDE.md section 5).

**What exists, as stacks** (ids `Delivery`, `Network`, `Data`, `Messaging`, `Edge`, `Compute`, `Observability`; CloudFormation names `LabConnect-uat-<part>`):
- *Delivery:* three ECR repositories (`labconnect/api`, `worker`, `migrate`; immutable tags, scan on push); the IAM OIDC provider for GitHub Actions and the role `uat-deployer`, which only `repo:Hashtrak-sh/LabConnect:environment:uat` can assume (exact match, no wildcard). No access keys anywhere.
- *Network:* VPC in 2 AZ with public, private and isolated subnets, one NAT gateway, an S3 gateway endpoint, interface endpoints for ECR (two), SQS, KMS, Secrets Manager and CloudWatch Logs, flow logs for rejected traffic, the default security group restricted. Security groups: only the load balancer is open to the internet.
- *Data:* KMS keys (data, files; rotation on), three KMS HMAC keys for the QR purposes (the reference seed requires them, OQ-177), RDS PostgreSQL 16 (db.t4g.medium, single-AZ, encrypted, isolated subnets, not public, deletion protection, 7 days of automated backups, TLS forced, statement logging off), the files bucket (versioned, SSE-KMS, block public access, TLS only, 30-day lifecycle for `quarantine/`, CORS from the web origin only when there is a domain), every application secret in Secrets Manager, optional OpenSearch.
- *Messaging:* `lc-notifications.fifo`, `lc-search-sync`, `lc-files`, `lc-timers`, `lc-analytics`, each with a dead-letter queue and max receive count 5 (KMS, TLS only); the EventBridge rule `lc-guardduty-scan-results` with the pattern of FILES_AND_REPORTS section 6 and no input transformer; the queue policy for that rule only; the GuardDuty Malware Protection plan for the `quarantine/` prefix of the bucket (the CloudFormation resource exists in the installed library) and its role; the SES configuration set `labconnect-uat`.
- *Edge:* a regional web ACL (AWS managed common, known-bad-inputs and IP-reputation sets; rate limits per address per five minutes of 300 for `/v1/webhooks/`, 100 for `/v1/auth/`, 2000 overall); the ACM certificate when there is a domain. It is attached to the load balancer in the compute stack.
- *Compute:* ECS Fargate cluster; the `api` service behind the load balancer (health `/v1/health`), the `worker` service, the one-off `migrate` task definition (migrate, login users, reference seed); circuit-breaker rollback; log groups with retention; separate task and execution roles; the DNS alias when a hosted zone is given.
- *Observability:* an encrypted SNS topic (with the alarm e-mail when given), 20 alarms (five dead-letter queues, queue age, EventBridge delivery, API 5xx rate, running tasks, database CPU, storage and memory, SES reputation, and five worker log signals), an optional AWS Budget.

**Environment variables.** Every variable of `.env.example` is either set on a task definition (below) or listed with a reason in `infrastructure/lib/env-allowlist.ts`; `infrastructure/test/runtime-env.test.ts` fails when `.env.example` gains one that is neither. "Secret" means the container receives it from Secrets Manager at start; the values are never in a template.

| Variable | Process | Source |
|---|---|---|
| `NODE_ENV=production`, `APP_ENV=uat`, `NO_COLOR=1` | api, worker, migrate (`NO_COLOR` keeps the logs plain text for the metric filters) | constants; `APP_ENV=uat` lets the fake gateway run (OQ-133) |
| `AWS_REGION` | api, worker | the stack's region |
| `PORT` | api | constant 3001 |
| `API_TRUST_PROXY_HOPS=1` | api | constant: the load balancer (OQ-89) |
| `AUTH_ALLOWED_ORIGINS` | api | web origin: `https://<domainName>`, or `http://<load balancer name>` without a domain |
| `AUTH_JWT_KEY_ID=k1` | api | constant |
| `API_DATABASE_URL` | api | secret `labconnect/uat/api-database-url` (login `labconnect_api`) |
| `AUTH_JWT_PRIVATE_KEY` | api | secret `labconnect/uat/auth-jwt-private-key`: **a placeholder until a person stores the real key** |
| `AUTH_HASH_SECRET`, `AUTH_ENCRYPTION_KEY` | api | secrets, generated (32 bytes as hex). The AES key stays until the KMS adapter exists (OQ-94). |
| `PAYMENT_GATEWAY=fake` | api, worker | constant |
| `PAYMENT_PAYLOAD_ENCRYPTION_KEY`, `PAYMENT_FAKE_WEBHOOK_SECRET` | api, worker | secrets, generated |
| `MAIL_FROM` | api, worker | parameter `sesFromAddress` |
| `FILES_BUCKET` | api, worker | the bucket's name (resource attribute) |
| `FILES_QUARANTINE_PREFIX`, `FILES_CLEAN_PREFIX` | api, worker | constants `quarantine`, `clean` |
| `FILES_KMS_KEY_ID` | worker | the files key's ARN |
| `FILES_SCANNER=guardduty` | worker | constant |
| `QUEUE_URL_LC_NOTIFICATIONS_FIFO`, `QUEUE_URL_LC_SEARCH_SYNC`, `QUEUE_URL_LC_FILES`, `QUEUE_URL_LC_TIMERS`, `QUEUE_URL_LC_ANALYTICS` | worker | the queues' URLs (resource attributes) |
| `WORKER_DATABASE_URL` | worker | secret `labconnect/uat/worker-database-url` (login `labconnect_worker`) |
| `EMAIL_TRANSPORT=ses`, `SES_FROM_ADDRESS`, `SES_CONFIGURATION_SET=labconnect-uat` | api (sign-in code), worker (notifications) | constants; parameter `sesFromAddress`. The API fails at start-up without them (OQ-172). |
| `WEB_BASE_URL` | worker | the web origin, as above |
| `NOTIFICATIONS_CONTEXT_SOURCE=booking` | worker | constant (the queue is consumed) |
| `OPENSEARCH_URL`, `OPENSEARCH_AUTH_MODE=basic`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`, `SEARCH_REINDEX_ON_START` | api and worker (the last, worker only) | only with `-c enableOpenSearch=true`: the domain's endpoint and a secret |
| `DATABASE_URL` | migrate | secret `labconnect/uat/owner-database-url` (the RDS master user `app_owner`, the schema owner) |
| `API_DB_USER`, `API_DB_PASSWORD`, `WORKER_DB_USER`, `WORKER_DB_PASSWORD` | migrate | secrets `labconnect/uat/db-login-api` and `db-login-worker` (read by `create-login-users.mjs`) |
| `QR_KMS_KEY_ARN_BOOKING`, `_PACKAGE`, `_REPORT` | migrate | the three HMAC keys' ARNs (read by the reference seed; not in `.env.example`) |

**Roles.** The API's task role can put objects under `quarantine/*` and get them under `clean/*` (to presign), and use the files key through S3: nothing on queues, secrets or the quarantine contents, and mail only as `ses:SendEmail` on the same three resources as the worker (sender address, sender domain, configuration set), for the sign-in code (OQ-172). The worker's task role can send to the five queues, receive from three (`lc-files`, `lc-notifications.fifo`, `lc-search-sync`), read and delete `quarantine/*`, write `clean/*`, list the bucket (so a missing object answers 404, not 403), use the files key through S3, and send mail from the configured sender with the configuration set. Each execution role reads exactly the secrets of its own task definition. No role has a wildcard action; tests assert it, and that the API role cannot reach the worker's resources.

**Differs from, or not built compared with, the text above.**
- *No CloudFront and no `web` service* (section 2 lists both): `apps/web` is a skeleton. The firewall is regional on the load balancer. No security headers (they belong to the web app).
- *No ElastiCache:* nothing reads `REDIS_URL` (OQ-176). *OpenSearch is off by default* (OQ-156, OQ-176).
- *No AWS Backup plan, restore drill, cross-region copy or replication, Object Lock* (OQ-119), nor the night-time scale-down; backups are the automated RDS ones (7 days, point-in-time).
- *No X-Ray/ADOT collector, no dashboards, no Synthetics canaries.* Alarms exist for what the code logs or AWS measures; **not built** because the application emits no signal: outbox lag, timer backlog, stuck bookings, reconciliation exceptions, webhook signature failures, malware detections, certificate or key expiry.
- *Secrets in Secrets Manager only* (no SSM parameters: configuration is plain environment variables). TOTP secrets are encrypted with a key from Secrets Manager, not KMS, until the adapter exists (OQ-94).
- *Traffic from the load balancer to the tasks is plain HTTP* inside the VPC: the API has no TLS listener (SECURITY_AND_PRIVACY section 1 says "where supported").
- *One AWS account per environment is not forced:* resource names are prefixed `labconnect-uat`, and the account is a parameter (OQ-18, OQ-170).
- *Disaster recovery in ap-south-2* is not built (section 5): the code is parameterised by region, which is the starting point for "IaC to recreate the stack".

**Where the code is stricter than the text.** The database is in isolated subnets with no route out; every security group lists its egress (tasks may reach the internet on 443 only); the load balancer is closed until `domainName` or `ingressCidrs` is given, and without a domain it is reachable only from the listed CIDRs; no ALB access logs, no firewall logs and no sampled requests, because they would keep query strings (OQ-40); the OIDC trust is one repository and one environment, and the deploy role cannot create IAM objects or assume any other role (P3-12: it deploys the application only; infrastructure is applied by a person, so the CDK bootstrap roles are out of its reach); tasks have no `ecs exec`; images are immutable and scanned; queues and the alarm topic are KMS-encrypted and queues refuse non-TLS requests; keys, the database, bucket, repositories and log groups are retained on deletion and the data and delivery stacks have termination protection; the database refuses non-TLS connections and does not log statements.

**Deployment after the first one (P3-12).** `.github/workflows/deploy-uat.yml` builds and pushes the images, runs the migration task and rolls the `api` and `worker` services; it never runs CDK. It is written and tested offline, has never run, and does nothing until a person sets the repository variable `UAT_DEPLOY_ENABLED`. What it does, the variables, and the image-tag drift that a later `cdk deploy Compute` must account for are in `CI_CD.md` "As built (P3-12)" and `infrastructure/README.md`.

**Manual or outside the code:** the account and its CDK bootstrap, the first image push, the signing key, SES sender verification and the sandbox exit, DNS without a hosted zone, the alarm e-mail confirmation, the platform administrator seed, the GitHub environment, the staging check of GuardDuty (OQ-168, OQ-169), and every item of OQ-170 to OQ-179. **One application gap blocks sign-in:** the API's e-mail code goes over SMTP only (OQ-172).
