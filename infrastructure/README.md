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
| `Delivery` | `LabConnect-uat-delivery` | ECR repositories (`labconnect/api`, `worker`, `migrate`, `web`: immutable tags, scan on push), the GitHub OIDC identity provider, the `uat-deployer` role |
| `Network` | `LabConnect-uat-network` | VPC (public, private, isolated subnets), security groups (load balancer, API, web, worker, migration, database, search), S3 gateway endpoint, interface endpoints (ECR, SQS, KMS, Secrets Manager, CloudWatch Logs), flow logs (rejected traffic) |
| `Data` | `LabConnect-uat-data` | KMS keys (data, files), RDS PostgreSQL 16, files bucket, all application secrets, optional OpenSearch |
| `Messaging` | `LabConnect-uat-messaging` | KMS key, five queues and dead-letter queues, EventBridge rule and GuardDuty Malware Protection plan, SES configuration set |
| `Edge` | `LabConnect-uat-edge` | Web application firewall (managed rules, rate limits), ACM certificate for both names, `<domainName>` and `api.<domainName>` (with a domain) |
| `Compute` | `LabConnect-uat-compute` | ECS cluster, API, web and worker services, migration task definition, load balancer and its routing, private DNS namespace (the API's private name), DNS aliases, firewall association, log groups |
| `Observability` | `LabConnect-uat-observability` | SNS alarm topic, 22 alarms, log metric filters, optional budget |

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
| `domainName` | none | Base domain, e.g. `uat.labconnect.example`. The **web app is `<domainName>`, the API is `api.<domainName>`**. With it: HTTPS listener with one ACM certificate for both names, port 80 redirects. Without it: plain HTTP on the load balancer's own name (web on every path except `/v1/*`, the API under `/v1/*`), open only to `ingressCidrs`. |
| `hostedZoneId`, `hostedZoneName` | none | Route 53 zone of the domain: creates the certificate validation records (two names, so two records) and the two alias records. Without them all four are manual. |
| `ingressCidrs` | none | Comma-separated IPv4 CIDRs allowed to reach the load balancer. **Required to reach a deployment that has no domain**; empty means nobody can. `/0` is refused. |
| `alarmEmail` | none | Subscribed to the alarm topic (and to the budget). The address must confirm the e-mail AWS sends. |
| `sesFromAddress` | `LabConnect <no-reply@labconnect.invalid>` (or `no-reply@<domainName>`) | Sender of all mail. The default under the reserved `.invalid` domain can never send: set a real, verified one. |
| `imageTag`, `apiImageTag`, `workerImageTag`, `migrateImageTag`, `webImageTag` | `bootstrap` | Image tags in ECR (tags are immutable: use the commit SHA). |
| `apiDesiredCount`, `workerDesiredCount`, `webDesiredCount` | 1, 1, 1 | Task counts. Use 0 for the first deploy (see below). |
| `apiCpu`, `apiMemoryMiB`, `workerCpu`, `workerMemoryMiB`, `webCpu`, `webMemoryMiB` | 512 / 1024 | Fargate sizes. |
| `dbInstanceClass`, `dbAllocatedStorageGiB` | `db.t4g.medium`, 50 | Database size (docs: UAT db.t4g.medium single-AZ). |
| `azCount`, `natGateways` | 2, 1 | Availability zones and NAT gateways (UAT: 2 AZ, one NAT). |
| `logRetentionDays` | 30 | One of 7, 14, 30, 60, 90, 180, 365, 400, 545, 731, 1827, 3653. |
| `enableOpenSearch` | `false` | Adds an OpenSearch domain with basic authentication (OQ-156). Off: public search runs on PostgreSQL alone. |
| `budgetMonthlyUsd` | none | Creates an AWS Budgets alert at 80 and 100 percent (needs `alarmEmail`). |
| `demoOtpCode` | none | Six digits. Only for a demonstration: sets `DEMO_OTP_CODE` and `DEMO_OTP_EMAIL_DOMAIN` (`demo.labconnect.test`) on the **API** task definition, and nowhere else. Unset (the default) sets nothing, so the template does not contain the variables. See "Demo one-time codes" below. |
| `githubRepository` | `Hashtrak-sh/LabConnect` | Repository whose workflows may assume the deploy role. |
| `githubOidcProviderArn` | none | Reuse an existing GitHub OIDC provider (the account may have only one). |

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
   roles `cdk deploy` uses. By default its CloudFormation execution role is `AdministratorAccess`. Only the people who run
   `cdk deploy` with their own credentials reach it: the `uat-deployer` role of GitHub Actions cannot assume the bootstrap
   roles (see "The deploy role" below). To narrow the execution role, bootstrap with
   `--cloudformation-execution-policies` (OQ-179).
2. **Deploy the repositories and the GitHub role:** `cdk deploy Delivery -c account=<account>`. Note the outputs
   (`DeployRoleArn`, repository URIs).
3. **Build and push the four images** (tag = the commit SHA; the repositories are immutable, so a tag is pushed once):
   `aws ecr get-login-password | docker login ...`, then `docker build --target api|worker|migrate|web -t <repository-uri>:<tag> .`
   from the repository root and `docker push`. This first push is manual: `Compute` needs an image to exist. Later images are
   built and pushed by `deploy-uat.yml`.
4. **Deploy everything else with no tasks running:**
   `cdk deploy Network Data Messaging Edge Compute Observability -c imageTag=<tag> -c apiDesiredCount=0 -c workerDesiredCount=0 -c webDesiredCount=0 [other context]`.
   With a domain and no hosted zone, the certificate stays `Pending validation` until you add the **two** CNAMEs shown in the
   ACM console (one for `<domainName>`, one for `api.<domainName>`: ACM needs both); the Edge stack waits for it.
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
   **Demo data (optional, for a demonstration):** see "Loading the demo data" below.
8. **Start the services:** redeploy `Compute` without the three `...DesiredCount=0` overrides (or `aws ecs update-service --desired-count 1`
   for each). Start the API first and let it become healthy: the web server's pages call it. After any later change to a secret, force a new deployment (`aws ecs update-service --force-new-deployment`):
   ECS reads secrets when a task starts.
9. **Mail (SES):** verify the sender identity (domain with DKIM, or one address) and leave the sandbox if real recipients
   need mail (the sign-in code too: in the sandbox only verified addresses can sign in). The stack creates the
   configuration set `labconnect-uat` and lets the worker and the API send as the address in `sesFromAddress`; it does
   not create the identity (that needs DNS you control).
10. **DNS** (if no hosted zone was given): two alias records to the load balancer (`LoadBalancerDnsName` output): `<domainName>`
    (the web app) and `api.<domainName>` (the API), and the two certificate validation records. Confirm the alarm e-mail subscription.
    Without a domain, open `http://<LoadBalancerDnsName>/` from an address in `ingressCidrs`: that is the web app; the API is
    `http://<LoadBalancerDnsName>/v1/health` and the rest of `/v1/`.
11. **Staging check of the scan path** (OQ-168, OQ-169): upload a harmless file and the standard EICAR test string under
    `quarantine/` of the files bucket and watch `lc-files` and the worker log: the first should arrive as a
    `NO_THREATS_FOUND` result, the second as `THREATS_FOUND`. Nothing in this package has proved the real events yet.
12. **GitHub:** enable the deployment workflow only once the services run (step 8): see "Enabling the UAT deployment
    workflow" below.

## The deploy role (`uat-deployer`) and the deployment workflow

`.github/workflows/deploy-uat.yml` (P3-12) deploys the **application** to UAT: it builds and pushes the four images, runs
the migration task and rolls the `api`, `worker` and `web` services, in that order (the web app last, so that a new web app
never runs against an old API). It **never changes infrastructure**: it runs no `cdk` and no
CloudFormation deployment. You apply infrastructure changes yourself (the steps above), with your own credentials. The reason
is OQ-179: `cdk deploy` works through the CDK bootstrap roles, whose CloudFormation role is an administrator by default, and
a compromised workflow must not get that.

The role is assumed through GitHub's OIDC provider by exactly `repo:Hashtrak-sh/LabConnect:environment:uat`, for one hour at
most, and has these statements and no others (a test lists them):

| Statement | Allows | On |
|---|---|---|
| `ReadComputeStackOutputs` | `cloudformation:DescribeStacks` | stack `LabConnect-uat-compute` (the ARN ends in the stack id, hence `/*`) |
| `EcrLogin` | `ecr:GetAuthorizationToken` | `*` (cannot be narrowed) |
| `EcrPush` | the layer upload, `PutImage`, `BatchGetImage`, `DescribeImages` actions | the four repositories |
| `EcsTaskDefinitions` | register and describe a task definition | `*` (cannot be narrowed) |
| `EcsServices` | `ecs:UpdateService`, `ecs:DescribeServices` | the `api`, `worker` and `web` services |
| `EcsRunMigration` | `ecs:RunTask` | revisions of `labconnect-uat-migrate`, in the UAT cluster only |
| `EcsWatchTasks` | `ecs:DescribeTasks` | tasks of the UAT cluster |
| `PassTaskRoles` | `iam:PassRole` | the eight task and execution roles (api, worker, migrate, web), only to `ecs-tasks.amazonaws.com` |

Each statement is something the workflow calls; a test compares the two. It cannot assume any role, create IAM objects,
deregister task definitions, stop or list tasks, read the log groups, or touch the database, the secrets, the queues or
the bucket. Logs are left out on purpose: application logs can hold personal data and this repository's workflow logs are
public, so a person reads the log groups in AWS. Its reach
through `iam:PassRole` is the eight container roles: a task definition it registers can run any command with those roles'
permissions, so registering one is as powerful as the task roles are. The two web roles add nothing to that: the web task
role has no permission at all and the web execution role reads no secret and uses no key. That is why the `uat` environment and who may start
the workflow matter (OQ-185).

### Enabling the UAT deployment workflow

The workflow does nothing (its job is skipped) until you set the gate variable. Prerequisites: steps 1 to 8 above are done
(the `Compute` stack exists and the services run: a service with desired count 0 fails the rollout check).

1. In the repository settings create the GitHub **environment** `uat`. Required reviewers are optional on UAT
   (CI_CD.md section 3); restricting the environment's deployment branches to `main` is recommended.
2. Create these **variables** (Settings, Secrets and variables, Actions, Variables). None is a secret and there are no GitHub
   secrets:

   | Variable | Where | Value |
   |---|---|---|
   | `UAT_DEPLOY_ENABLED` | **repository** variable (a job's `if` cannot see environment variables) | `true` to enable; delete it or set anything else to disable |
   | `AWS_UAT_DEPLOY_ROLE_ARN` | repository or the `uat` environment | the `DeployRoleArn` output of the `Delivery` stack |
   | `AWS_REGION` | optional, **repository** variable (it is read before the job enters the environment) | default `ap-south-1` |
   | `UAT_API_BASE_URL` | optional, either | origin of the API, for example `https://api.<domainName>`. Unset: the smoke test is skipped |
   | `UAT_WEB_BASE_URL` | optional, either | origin of the web app, for example `https://<domainName>`. Set: the workflow also fetches `<origin>/health` and expects `{"status":"ok"}`. Unset: that step is skipped |

3. Run it once by hand (Actions, deploy-uat, Run workflow, on `main`) and read the job summary before relying on pushes.

**Drift.** The workflow registers new task definition revisions outside CloudFormation, so the `Compute` stack still records
the image tags it was last deployed with. Before the next `cdk deploy Compute`, read the tag now running
(`aws ecs describe-task-definition --task-definition labconnect-uat-api --query 'taskDefinition.containerDefinitions[0].image'`,
or the job summary of the last run) and pass it: `-c apiImageTag=<sha> -c workerImageTag=<sha> -c migrateImageTag=<sha> -c webImageTag=<sha>`
(`-c imageTag=<sha>` sets all four). Without it the services roll back to the old image. Details: CI_CD.md "As built (P3-12)".

## The web app and the API: how they are connected

**Visitors** reach both through the one load balancer, behind the one firewall:

| | With `domainName` | Without it |
|---|---|---|
| Web app | `https://<domainName>` (the HTTPS listener's default action) | `http://<load balancer name>/` and every path except `/v1/*` |
| API | `https://api.<domainName>` (listener rule on the host, priority 10) | `http://<load balancer name>/v1/*` (listener rule on the path, priority 10) |
| Certificate | one ACM certificate, names `<domainName>` and `api.<domainName>` | none |
| Port 80 | redirects to HTTPS | the only listener; only `ingressCidrs` can reach it |

**The web server reaches the API server-side, inside the VPC, by a private name** (never through the load balancer, which without
a domain admits only the listed client ranges). The browser never calls the API (API_CONVENTIONS section 4). The web task has
`API_BASE_URL=http://api.labconnect-uat.internal:3001/v1`; the name is an `A` record (TTL 10 seconds) that ECS keeps current in a
Cloud Map **private** DNS namespace (`labconnect-uat.internal`, resolvable only inside the VPC). The API's security group admits
the web group on port 3001 and nothing else new (the load balancer group was already there).

_Why Cloud Map DNS and not ECS Service Connect:_ both give a stable private name. Service Connect adds a proxy sidecar to every
task (CPU, memory, a second log stream), a namespace of its own and a different way for the API to publish its port, and its
behaviour (retries, outlier detection) cannot be asserted from a synthesised template. Cloud Map DNS is one namespace, one
service registry entry and one environment variable, all visible in the template and asserted by the tests. What it does not
give: no retries or connection draining at the name level (a request to a task that has just stopped fails once, and the
application must handle it), and the web server may hold a stale address for up to the record TTL plus its own connection
reuse. Moving to Service Connect later changes only the compute stack and the variable.

**Firewall rules.** The rate rules of `RATE_LIMITS` match on the path: `/v1/auth/` and `/v1/webhooks/`, which the API serves
on its own host (with a domain) or on the shared host (without). The web app's own calls to the API never pass the load
balancer, so **sign-ins made through the web app are not counted by `RateLimitAuth`**: only by `RateLimitAll` (2000 requests per
five minutes per address, which web pages and their assets now also count against) and by the API's own throttles. Those see the
web task's address, not the visitor's, unless the web app forwards the client address (OQ-243).

### Cookies and origins (what works and what does not; no application code was changed)

The API sets its refresh cookie `lc_refresh` with `HttpOnly; Secure; SameSite=Lax; Path=/v1/auth` and **no `Domain`** (host-only), on
`/v1/auth/otp/verify`, `/v1/auth/mfa/verify` and `/v1/auth/refresh`. `POST /v1/auth/refresh` also requires an `Origin` header equal to
one of `AUTH_ALLOWED_ORIGINS`, which the stack sets to the web origin: `https://<domainName>`, or `http://<load balancer name>`
without a domain. The API has **no CORS configuration** at all.

- **Through the web server (the design of API_CONVENTIONS section 4), both layouts.** The API's `Set-Cookie` goes to the Next
  server, which has no cookie jar: the browser never sees it. The web app must read the header, store the value in a cookie of its
  own on the web origin, and for a refresh send `Cookie: lc_refresh=<value>` **and `Origin: <the web origin>`** to the API itself
  (a server-side `fetch` sets no `Origin` of its own). Then the API's cookie scope (`Path=/v1/auth`, host-only) does not matter.
  What the web app must get right: the `Origin` it sends is exactly the allowed origin (with a domain `https://<domainName>`;
  without one `http://<load balancer name>`, no port), so it needs to know its own public origin (it has no `WEB_BASE_URL`
  today: derive it from the forwarded headers, or give it the variable); and the cookie it sets must be `Secure` **only when
  the site is HTTPS**.
- **Browser straight to the API, with a domain (`uat.x` to `api.uat.x`).** Same site, different origins. The cookie would be sent
  (`SameSite=Lax` is satisfied inside one site; host-only on `api.uat.x`, path `/v1/auth`, HTTPS so `Secure` is fine), but the
  browser blocks the cross-origin `fetch` first: no CORS headers exist. Does not work without API code (CORS with credentials).
- **Browser straight to the API, without a domain (one host, plain HTTP).** Same origin, so no CORS, and `/v1/auth` is routed to the
  API. But the cookie is `Secure` and browsers refuse to store a `Secure` cookie set over plain HTTP (localhost excepted), so the
  session can never be refreshed. Does not work; a certificate (a domain) is the fix. Through the web server it does work, as above.

Sign-in screens must therefore go through the web server's route handlers (OQ-241).

## Loading the demo data

`seed demo` creates fictitious labs, customers and a platform team (clearly marked "DEMO"; 200 lab sites, 5,000 scope lines, 3
onboarded labs, 3 customer organisations, a booking in every state). **The migration task can run it as it is.** The only guard,
`assertNotProduction` in `packages/database/src/seed/env.ts`, refuses `APP_ENV=production` only; the task sets `NODE_ENV=production`
(which the seed ignores) and `APP_ENV=uat`. It runs `seed reference` first, which needs the three QR key variables the task
definition already sets, and then does nothing if the demo data is already there. One-off, with your own credentials, after the
migration (step 6):

```sh
aws ecs run-task --cluster labconnect-uat --launch-type FARGATE --task-definition labconnect-uat-migrate \
  --network-configuration "awsvpcConfiguration={subnets=[<PrivateSubnetIds>],securityGroups=[<MigrateSecurityGroupId>],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"migrate","command":["node","dist/seed/cli.js","demo"]}]}'
```

The output (`Demo data created: ...` or `Demo data is already there. Nothing changed.`) is in the log group `/labconnect/uat/migrate`.
Add `"environment":[{"name":"DEMO_EMAIL_DOMAIN","value":"<domain>"}]` inside the container override to change the e-mail domain of
the demo people (default `demo.labconnect.test`: a `.test` name that no mail can reach). **Signing in as a demo user needs a
code sent by SES**, so before a demonstration decide which addresses the demo people have and make them verified in SES (OQ-244).
Not run against a real database in this task; the override shape is from the ECS API reference, from memory.

## What a first deployment of the web service could trip over

Things offline tests cannot show, and what was done about each:

| Risk | What was done |
|---|---|
| The image does not start under ECS (wrong bind address, root file system, port) | Built and run locally as the `node` user: `/health` answers 200, the container health command exits 0. Next is told `--hostname 0.0.0.0` explicitly (a container's `HOSTNAME` is its own id). Under ECS: untested. |
| The private name does not resolve, or resolves too early | The record exists only while an API task is registered; until then the web server's calls fail (`ENOTFOUND`; locally, the search page still rendered and `/api/suggest` answered 500). Start the API first (step 8). VPC DNS support is on by default in the VPC construct. Untested. |
| Health-check timing | `/health` does not call the API. Container start period 60 s, service grace period 60 s, load balancer check every 30 s (two good checks to be healthy). Next was ready in under a second locally. Untested under ECS. |
| Listener rule priorities | One rule (priority 10) per listener, default action the web app; asserted by tests in both layouts. |
| Certificate with two names and manual DNS validation | One certificate, `<domainName>` plus `api.<domainName>`; ACM shows two CNAMEs and both must exist, or `cdk deploy Edge` waits (step 4 says so). With a hosted zone both records are created. Untested. |
| Cookie scope across the two host names | Analysed above, no code changed; sign-in must go through the web server (OQ-241). |
| Outbound access at build or run time | The web task needs none at run time except the API (private) and AWS endpoints (443). Telemetry is switched off (`NEXT_TELEMETRY_DISABLED=1`); the pages on the customer branch use a system font stack and no remote assets; `apps/web` fetched nothing at build time (the build ran with no API and no environment). The image build downloads npm packages, as the others do. |
| Pages that bake the API address in at build time | None today (`API_BASE_URL` is read per request; the build succeeded without it). A page that fetched while being prerendered would call the wrong address at build: use dynamic APIs (Next docs, self-hosting). |
| Static assets, redirects and the Host header | Next builds redirect URLs from `Host`; the load balancer passes it unchanged. Assets are served by the Next server itself (no CDN). |
| Rate limit and managed rules meeting a real page load | `RateLimitAll` counts every asset request; a demonstration from one office address could hit 2000 per five minutes. Managed-rule false positives on Next requests (query-string size, bodies) are possible. Not changed; OQ-243. |
| Security headers | Not set by anything (OQ-242). |
| The deploy role and the first web rollout | The service must exist and have `webDesiredCount` of at least 1 before the workflow's rollout check passes (it fails for 0). Step 8. |
| The ECS service-linked role and Cloud Map registration | ECS registers tasks in Cloud Map through its service-linked role, which AWS creates on first use; not checked. |

## Demo one-time codes (UAT demonstrations only)

For a demonstration without a mailbox (OQ-237) the API can accept a fixed one-time code for the demo accounts. Read `AUTHENTICATION_AND_AUTHORISATION.md` section 9 first: it applies only to addresses in `demo.labconnect.test`, never to a real address, never replaces the authenticator step, and **the API refuses to start with it in production**. UAT must hold no real personal data while it is on (`SECURITY_AND_PRIVACY.md`, OQ-238).

Nothing is deployed by these steps; a person runs them.

1. Load the demo data once, if the database does not have it yet: `seed:reference`, then `seed:demo` (MIGRATION_AND_SEED_STRATEGY.md section 3; it refuses `APP_ENV=production`).
2. Deploy the compute stack with the context parameter, passing the image tags that are running (see "Drift" above): `cdk deploy LabConnect-uat-compute -c demoOtpCode=444444 -c apiImageTag=<sha> -c workerImageTag=<sha> -c migrateImageTag=<sha>`. The code must be exactly six digits, else synthesis fails. It is set on the **API** task definition only, with `DEMO_OTP_EMAIL_DOMAIN=demo.labconnect.test`; the worker and the migration task do not get it.
3. Check the API log for the one start-up warning "Demo one-time codes are ENABLED for the demo domain demo.labconnect.test".
4. **Before the demo, enrol authenticators** for the demo accounts whose roles need one: sign in once as each platform user (Ops, Data Steward, Finance, Admin), each demo Customer Finance user and each demo Lab Checker with the fixed code, scan the secret into an authenticator app, confirm, and keep the recovery codes. The fixed code does not replace this step; an account that has not enrolled cannot get past it during the demo. **Do this straight after loading the demo data, before anyone else can reach the environment:** until an account has enrolled, whoever signs in to it first with the fixed code enrols their own authenticator and then owns that account, the platform accounts included. The demo accounts whose roles need no authenticator (customer admins, requesters, lab Makers) can be used by anyone who knows an address and the code. So while the setting is on, keep UAT reachable only from the listed addresses (`ingressCidrs`) where possible, and keep no real data in it.
5. During the demo, sign in with the demo address and `444444`. No mail is sent.
6. **After the demo, turn it off:** deploy the compute stack again without `demoOtpCode` (with the image tags), and confirm that the API task definition has neither `DEMO_OTP_CODE` nor `DEMO_OTP_EMAIL_DOMAIN` (`aws ecs describe-task-definition --task-definition labconnect-uat-api`).

### What to try in a demo

Fictitious data only. The table is generated from the seed (`packages/database/src/seed/demo-guide.ts`); a test fails if it differs, so after changing the seed, update it with the output of `renderDemoGuide()`.

<!-- demo-guide:start -->
<!-- Generated by renderDemoGuide() in packages/database/src/seed/demo-guide.ts; a test fails if this block differs from its output. -->

| Type in the search box | What it shows |
|---|---|
| `pH` | Many labs at once. Two bookable sites (Vasundhara in Faridabad and Aravali) show different prices and turnaround for the same test; the turnaround filter narrows the list. |
| `TS` | The abbreviation for tensile strength (the synonym list): TMT bars, structural steel plates, HDPE and cables, at building-materials, mechanical and polymer labs. |
| `cement` | Many listed labs and two bookable sites of Vasundhara, each with prices: Gurugram (strength, fineness, setting time, soundness) and Faridabad (chemical analysis). |
| `aflatoxin` | A test that only one lab offers: a one-line result, the Aravali laboratory. |
| `ceiling fan` | Labs that are listed but not yet on LabConnect: no price, no slots, "Request this lab". |
| `radioactivity` | Nothing: no lab offers it, which leads to the "request a lab" path. |

The four bookable sites (prices, slots, a booking in every state):

| Site | Certificate |
|---|---|
| Vasundhara Testing Laboratories (DEMO), Gurugram | `DEMO-TC-0001-1` |
| Vasundhara Testing Laboratories (DEMO), Faridabad | `DEMO-TC-0001-2` |
| Shivalik Polymer Testing Centre (DEMO), Noida | `DEMO-TC-0002-1` |
| Aravali Food and Water Laboratory (DEMO), Ghaziabad | `DEMO-TC-0003-1` |

Two unclaimed labs for the claim story (the lab owner accounts below hold no role, so a claim can be approved):

| Lab | Certificate |
|---|---|
| Narmada Analytical Services (DEMO), Delhi | `DEMO-TC-0004-1` |
| Kaveri Environmental Testing Laboratory (DEMO), Gurugram | `DEMO-TC-0005-1` |

Demo accounts (all in `demo.labconnect.test`; the sign-in code is the one set for the environment):

| Role | Address |
|---|---|
| Customer admin (business) | `customer.admin.demo2@demo.labconnect.test` |
| Customer requester (business) | `customer.requester.demo2@demo.labconnect.test` |
| Customer admin (individual) | `customer.admin.demo1@demo.labconnect.test` |
| Lab Maker (Vasundhara) | `maker1.0001@demo.labconnect.test` |
| Lab Checker (Vasundhara) | `checker1.0001@demo.labconnect.test` |
| Lab owner with no lab yet (claim story) | `lab.owner.demo1@demo.labconnect.test` |
| Lab owner with no lab yet (claim story) | `lab.owner.demo2@demo.labconnect.test` |
| Lab owner with no lab yet (claim story) | `lab.owner.demo3@demo.labconnect.test` |
| Platform Ops | `ops.demo@demo.labconnect.test` |
| Platform Data Steward | `steward.demo@demo.labconnect.test` |
| Platform Finance | `finance.demo@demo.labconnect.test` |
| Platform Admin | `admin.demo@demo.labconnect.test` |
<!-- demo-guide:end -->

## What is manual or outside the code

AWS account and its CDK bootstrap; the first image push; the JWT signing key; SES sender verification and leaving the
sandbox; DNS when there is no hosted zone; the alarm e-mail confirmation; the platform administrator seed; the GitHub
environment; GuardDuty (the Malware Protection plan is created by the stack; its role is the template of the AWS
documentation, compared with the page on 2026-11-25, but it has not been exercised: check the plan's status in the
console after the first deploy, and that a scan result reaches `lc-files`, whose key policy and queue policy are
also the documented ones, OQ-178);
SES-to-bounce handling (no destination is configured); the weekly restore drill and the dashboards of OBSERVABILITY.md
(not built, see "As built" in the AWS document).

## Known gaps a person should know about before relying on UAT

- **Sign-in codes reach only verified addresses until SES leaves the sandbox.** The API now sends the sign-in code through
  SES (the worker's sender and configuration set; the API role may `ses:SendEmail` on the same three resources), but nothing
  is deployed and no mail was sent. It still needs a verified SES identity (the sender address or its domain) and, to reach
  real users, the account must leave the SES sandbox: in the sandbox SES delivers only to verified addresses, so only a
  verified address can receive a sign-in code (OQ-172, OQ-175). The API refuses to start without `EMAIL_TRANSPORT=ses`
  and a from-address, which the task definition sets.
- **Database TLS verification is untested against RDS.** The images trust the RDS CA bundle (downloaded at image build) and
  the URLs say `sslmode=require`. `pg` and Prisma should both verify; confirm on the first migration run.
- **The web app is the prototype that `apps/web` contains.** The service and image exist; what the pages show is whatever
  `apps/web` has on the commit deployed (the search screens, from the customer branch, once merged). No CloudFront (OQ-173).
  **No security headers** (HSTS, CSP) are set by anything yet: neither the load balancer nor the web app (OQ-242).
  **Sign-in through the web app is not designed yet** and depends on how the web app handles the API's refresh cookie
  (see "Cookies and origins" below, OQ-241).
- **The signals the application does not emit yet** (outbox lag, due-timer backlog, stuck bookings, webhook signature failures)
  have no alarm; only what the worker logs today is alarmed.

## Cost drivers (no prices given: look them up for your region)

Always on, in rough order of weight: the **NAT gateway** (hours and data), the **interface endpoints** (six, in each AZ),
the **RDS instance** and its storage and backups, the **load balancer**, the **Fargate tasks** (API, web and worker, vCPU and memory
hours; `webCpu`/`webMemoryMiB` size the web task), the **Cloud Map private DNS namespace** (one private hosted zone and its queries), the **web application firewall** (web ACL, six rules and requests), **KMS keys** (three, plus requests), **Secrets
Manager** (about a dozen secrets), **CloudWatch** (logs, 22 alarms, metric filters). Usage-based: S3 and
GuardDuty Malware Protection (per object and per gigabyte scanned), SQS, SES (per message), ECR storage, data transfer. Optional:
OpenSearch (instance and storage) and the budget. The docs allow stopping UAT at night; that schedule is not built.

## Rotating the signing key

The application supports a rotation (`AUTH_JWT_PREVIOUS_PUBLIC_KEY`, `AUTH_JWT_PREVIOUS_KEY_ID`, a new `AUTH_JWT_KEY_ID`; see
`.env.example`), but this package provides only the secret of the current key: the previous-key variables are not wired
into the task definition. The rotation procedure is a decision still open (OQ-94), to be built with it.
