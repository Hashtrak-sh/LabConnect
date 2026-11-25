# LabConnect infrastructure (AWS CDK, TypeScript)

Infrastructure as code for the **UAT** environment (task P3-11, ADR-015). **Code and tests only: nothing in this
package has been deployed.** It needs no AWS account or credentials to synthesise or test. The design is in
`docs/07-operations/AWS_ENVIRONMENTS_AND_DEPLOYMENT.md` ("As built (P3-11)" is the section that says what exists and what
differs from the text).

There is **no production stage**. Passing `-c stage=production` stops with an error. A person adds production, its
account and its sizing to `lib/config.ts`; production deployment stays a human-approved step (CLAUDE.md section 5).

## Stacks

Deployed in this order (each uses the ones before it). The ids are what you pass to `cdk deploy`.

| Id | CloudFormation name | Holds |
|---|---|---|
| `Delivery` | `LabConnect-uat-delivery` | ECR repositories (`labconnect/api`, `worker`, `migrate`: immutable tags, scan on push), the GitHub OIDC identity provider, the `uat-deployer` role |
| `Network` | `LabConnect-uat-network` | VPC (public, private, isolated subnets), security groups, S3 gateway endpoint, interface endpoints (ECR, SQS, KMS, Secrets Manager, CloudWatch Logs), flow logs (rejected traffic) |
| `Data` | `LabConnect-uat-data` | KMS keys (data, files), RDS PostgreSQL 16, files bucket, all application secrets, optional OpenSearch |
| `Messaging` | `LabConnect-uat-messaging` | KMS key, five queues and dead-letter queues, EventBridge rule and GuardDuty Malware Protection plan, SES configuration set |
| `Edge` | `LabConnect-uat-edge` | Web application firewall (managed rules, rate limits), ACM certificate (with a domain) |
| `Compute` | `LabConnect-uat-compute` | ECS cluster, API and worker services, migration task definition, load balancer, DNS alias, firewall association, log groups |
| `Observability` | `LabConnect-uat-observability` | SNS alarm topic, alarms, log metric filters, optional budget |

`Data` and `Delivery` have termination protection on, and the database, bucket, keys, repositories and log groups are
retained when a stack is deleted.

## Parameters

Nothing organisational is in the code. Parameters are CDK context: `-c key=value` on the command line, or `cdk.json` /
`cdk.context.json` (the latter is git-ignored). All are optional for synthesis.

| Context key | Default | Meaning |
|---|---|---|
| `stage` | `uat` | Only `uat` exists. `production` is refused. |
| `account` | none | 12-digit account id. Unset: stacks are environment-agnostic (enough to synth and test). `cdk deploy` also takes it from your credentials. |
| `region` | `ap-south-1` | Region (the docs name ap-south-1; OQ-171). |
| `domainName` | none | Base domain, e.g. `uat.labconnect.example`. The API is `api.<domainName>`. With it: HTTPS listener with an ACM certificate, port 80 redirects. Without it: plain HTTP on the load balancer's own name, open only to `ingressCidrs`. |
| `hostedZoneId`, `hostedZoneName` | none | Route 53 zone of the domain: creates the certificate validation record and the alias record. Without them both are manual. |
| `ingressCidrs` | none | Comma-separated IPv4 CIDRs allowed to reach the load balancer. **Required to reach a deployment that has no domain**; empty means nobody can. `/0` is refused. |
| `alarmEmail` | none | Subscribed to the alarm topic (and to the budget). The address must confirm the e-mail AWS sends. |
| `sesFromAddress` | `LabConnect <no-reply@labconnect.invalid>` (or `no-reply@<domainName>`) | Sender of all mail. The default under the reserved `.invalid` domain can never send: set a real, verified one. |
| `imageTag`, `apiImageTag`, `workerImageTag`, `migrateImageTag` | `bootstrap` | Image tags in ECR (tags are immutable: use the commit SHA). |
| `apiDesiredCount`, `workerDesiredCount` | 1, 1 | Task counts. Use 0 for the first deploy (see below). |
| `apiCpu`, `apiMemoryMiB`, `workerCpu`, `workerMemoryMiB` | 512 / 1024 | Fargate sizes. |
| `dbInstanceClass`, `dbAllocatedStorageGiB` | `db.t4g.medium`, 50 | Database size (docs: UAT db.t4g.medium single-AZ). |
| `azCount`, `natGateways` | 2, 1 | Availability zones and NAT gateways (UAT: 2 AZ, one NAT). |
| `logRetentionDays` | 30 | One of 7, 14, 30, 60, 90, 180, 365, 400, 545, 731, 1827, 3653. |
| `enableOpenSearch` | `false` | Adds an OpenSearch domain with basic authentication (OQ-156). Off: public search runs on PostgreSQL alone. |
| `budgetMonthlyUsd` | none | Creates an AWS Budgets alert at 80 and 100 percent (needs `alarmEmail`). |
| `githubRepository` | `Hashtrak-sh/LabConnect` | Repository whose workflows may assume the deploy role. |
| `githubOidcProviderArn` | none | Reuse an existing GitHub OIDC provider (the account may have only one). |
| `cdkQualifier` | `hnb659fds` | The qualifier of the CDK bootstrap stack. |

## Commands

```sh
pnpm --filter @labconnect/infrastructure build        # compile (tsc) to dist/
pnpm --filter @labconnect/infrastructure test         # assertion tests (offline)
pnpm --filter @labconnect/infrastructure typecheck
pnpm --filter @labconnect/infrastructure synth        # build, then `cdk synth`: templates in infrastructure/cdk.out/
# with a domain:
pnpm --filter @labconnect/infrastructure exec cdk synth -c domainName=uat.labconnect.example \
  -c hostedZoneId=<id> -c hostedZoneName=labconnect.example
```

`cdk synth` runs the compiled app (`node dist/bin/app.js`), so build first. TypeScript is compiled with `tsc` and the CDK
CLI runs plain Node: no extra tooling. The package is an ES module project like the rest of the repository; `aws-cdk-lib`
is CommonJS and its named imports work under Node's ESM loader (checked), so no exception to the repository's
lint or tsconfig rules was needed.

## First deployment, step by step (a person does this; nothing here has been run)

You need an AWS account for UAT (OQ-18, OQ-170), credentials with enough rights to bootstrap, and Docker.

1. **Bootstrap CDK once** per account and region: `cdk bootstrap aws://<account>/<region>`. The bootstrap creates the
   roles `cdk deploy` uses. By default its CloudFormation execution role is `AdministratorAccess`: that is the real reach
   of the `uat-deployer` role (it can only hand over to the bootstrap roles), so the GitHub environment `uat` should
   have required reviewers. To narrow it, bootstrap with `--cloudformation-execution-policies` (a decision for P3-12).
2. **Deploy the repositories and the GitHub role:** `cdk deploy Delivery -c account=<account>`. Note the outputs
   (`DeployRoleArn`, repository URIs).
3. **Build and push the images** (tag = the commit SHA; the repositories are immutable, so a tag is pushed once):
   `aws ecr get-login-password | docker login ...`, then `docker build --target api|worker|migrate -t <repository-uri>:<tag> .`
   from the repository root and `docker push`. (P3-12 automates this.)
4. **Deploy everything else with no tasks running:**
   `cdk deploy Network Data Messaging Edge Compute Observability -c imageTag=<tag> -c apiDesiredCount=0 -c workerDesiredCount=0 [other context]`.
   With a domain and no hosted zone, the certificate stays `Pending validation` until you add the CNAME shown in the
   ACM console; the Edge stack waits for it.
5. **Create the signing key** (the placeholder in the secret is random text, not a key). Generate an Ed25519 key and
   store it; nothing is written to disk in the repository:
   ```sh
   node -e "console.log(require('node:crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).trim())" > /tmp/jwt.pem
   aws secretsmanager put-secret-value --secret-id labconnect/uat/auth-jwt-private-key --secret-string file:///tmp/jwt.pem
   shred -u /tmp/jwt.pem
   ```
   The hash secret, TOTP encryption key and payment keys are generated by Secrets Manager (64 hex characters = 32 bytes
   where the application wants 32 bytes). The TOTP key stays in Secrets Manager until the KMS adapter exists (OQ-94).
6. **Run the migration task** (migrations as the schema owner, the two login users, reference data). Subnets and
   security group are in the `Compute` outputs:
   ```sh
   aws ecs run-task --cluster labconnect-uat --launch-type FARGATE --task-definition labconnect-uat-migrate \
     --network-configuration "awsvpcConfiguration={subnets=[<PrivateSubnetIds>],securityGroups=[<MigrateSecurityGroupId>],assignPublicIp=DISABLED}"
   ```
   Its output is in the log group `/labconnect/uat/migrate`. Repeating it is safe (it is the same step CI runs on every
   deploy: `prisma migrate deploy`, `create-login-users.mjs`, `seed reference`). Re-running it after rotating a
   `labconnect/uat/db-login-*` secret applies the new password to the database; then redeploy the services.
7. **First platform administrator:** run the same task definition with a command and environment override
   (`node dist/seed/cli.js platform-admin`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`, optional `PLATFORM_ORG_NAME`
   in `--overrides`). The e-mail address is personal data: keep it out of shell history shared with others.
8. **Start the services:** redeploy `Compute` without the two `...DesiredCount=0` overrides (or `aws ecs update-service --desired-count 1`
   for each). After any later change to a secret, force a new deployment (`aws ecs update-service --force-new-deployment`):
   ECS reads secrets when a task starts.
9. **Mail (SES):** verify the sender identity (domain with DKIM, or one address) and leave the sandbox if real recipients
   need mail. The stack creates the configuration set `labconnect-uat` and lets the worker send as the address in
   `sesFromAddress`; it does not create the identity (that needs DNS you control).
10. **DNS** (if no hosted zone was given): the alias record `api.<domainName>` to the load balancer (`LoadBalancerDnsName` output),
    and the certificate validation record. Confirm the alarm e-mail subscription.
11. **Staging check of the scan path** (OQ-168, OQ-169): upload a harmless file and the standard EICAR test string under
    `quarantine/` of the files bucket and watch `lc-files` and the worker log: the first should arrive as a
    `NO_THREATS_FOUND` result, the second as `THREATS_FOUND`. Nothing in this package has proved the real events yet.
12. **GitHub (P3-12):** create the GitHub environment `uat` (the role trusts only that environment of
    `Hashtrak-sh/LabConnect`), add required reviewers, and give the workflow the role ARN as a variable.

## What is manual or outside the code

AWS account and its CDK bootstrap; the first image push; the JWT signing key; SES sender verification and leaving the
sandbox; DNS when there is no hosted zone; the alarm e-mail confirmation; the platform administrator seed; the GitHub
environment; GuardDuty (the Malware Protection plan is created by the stack, but its IAM statements follow the AWS
documentation and have not been exercised: check the plan's status in the console after the first deploy);
SES-to-bounce handling (no destination is configured); the weekly restore drill and the dashboards of OBSERVABILITY.md
(not built, see "As built" in the AWS document).

## Known gaps a person should know about before relying on UAT

- **Sign-in codes cannot be sent.** The API sends the e-mail OTP with an SMTP adapter that has no TLS and no login
  (`apps/api/src/modules/identity/smtp-otp-mailer.ts`); UAT has no SMTP server and the API's role does not (and should not
  need to) send through SES. Until the API's OTP mailer uses the SES sender the worker already has, nobody can sign in on UAT.
  This is an application change outside this task (OQ-172).
- **Database TLS verification is untested against RDS.** The images trust the RDS CA bundle (downloaded at image build) and
  the URLs say `sslmode=require`. `pg` and Prisma should both verify; confirm on the first migration run.
- **No web application** is deployed: `apps/web` is a skeleton. No CloudFront either (OQ-173).
- **The signals the application does not emit yet** (outbox lag, due-timer backlog, stuck bookings, webhook signature failures)
  have no alarm; only what the worker logs today is alarmed.

## Cost drivers (no prices given: look them up for your region)

Always on, in rough order of weight: the **NAT gateway** (hours and data), the **interface endpoints** (six, in each AZ),
the **RDS instance** and its storage and backups, the **load balancer**, the **Fargate tasks** (API and worker, vCPU and memory
hours), the **web application firewall** (web ACL, six rules and requests), **KMS keys** (three, plus requests), **Secrets
Manager** (about a dozen secrets), **CloudWatch** (logs, 20 alarms, metric filters). Usage-based: S3 and
GuardDuty Malware Protection (per object and per gigabyte scanned), SQS, SES (per message), ECR storage, data transfer. Optional:
OpenSearch (instance and storage) and the budget. The docs allow stopping UAT at night; that schedule is not built.

## Rotating the signing key

The application supports a rotation (`AUTH_JWT_PREVIOUS_PUBLIC_KEY`, `AUTH_JWT_PREVIOUS_KEY_ID`, a new `AUTH_JWT_KEY_ID`; see
`.env.example`), but this package provides only the secret of the current key: the previous-key variables are not wired
into the task definition. The rotation procedure is a decision still open (OQ-94), to be built with it.
