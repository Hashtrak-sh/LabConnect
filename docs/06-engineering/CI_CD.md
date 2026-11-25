# CI/CD (GitHub Actions)

**Status:** DRAFT. CI is task P0-06. The UAT deployment (P3-12) is written but has never run: see "As built (P3-12)" (section 4b). Production release is not built.

## 1. Workflows

### `ci.yml`: on every push to `dev-*`, `feature/*` and every PR
1. Setup: pnpm cache, Turborepo remote cache (optional).
2. `lint` · `typecheck` · `dependency-cruiser`.
3. `test:unit` (affected packages).
4. Services: Postgres+PostGIS, Redis, LocalStack (containers) → `db:migrate:test` from empty → `test:db` → `test:integration` → `test:contract` → `test:permissions` → `test:isolation` → `test:workflow`.
5. `build` (all apps, Docker images built but not pushed).
6. Security: CodeQL (JS/TS), `pnpm audit --prod` (fail on high or critical), gitleaks.
7. On PRs to `main`: Playwright **smoke** E2E against an ephemeral docker-compose stack.
8. Reports: coverage comment, test summary.

Required status checks on `main` and `production`: `lint`, `typecheck`, `unit`, `db`, `integration`, `contract`, `permissions`, `isolation`, `workflow`, `build`, `e2e-smoke`, `codeql`.

### `deploy-uat.yml`: on push to `main`
1. Build and push images to ECR (tag = commit SHA).
2. Assume the AWS role through **OIDC** (`uat-deployer`).
3. Run the migration task (`prisma migrate deploy`) on ECS. Fail → stop.
4. Run `seed:reference` (idempotent).
5. Deploy `api`, `worker`, `web` services (rolling, with circuit-breaker rollback).
6. Smoke tests + Playwright full suite against UAT. Post the result to the PR and the team channel.

### `release-production.yml`: on push to `production`
1. **Environment `production` approval gate** (required reviewer @Hashtrak-sh).
2. Promote the **same image digests** that passed UAT (no rebuild).
3. RDS manual snapshot → migration task → deploy (blue/green via CodeDeploy for `api` and `web`, rolling for `worker`) → smoke → tag the release → GitHub Release notes.
4. Automated rollback on smoke failure (previous task definition). DB migrations are forward-compatible (expand/contract), so the app can roll back without a DB rollback.

### `nightly.yml`
Full E2E on UAT, axe accessibility, OWASP ZAP baseline on UAT, dependency audit, audit-log hash-chain verification job check, backup restore drill (weekly).

## 2. Secrets and configuration
- No secrets in the repository. App secrets live in AWS Secrets Manager, read at runtime by the task role. CI uses OIDC roles only.
- Environment config through SSM Parameter Store, plus `config_parameter` for business settings.

## 3. Branch to environment mapping
| Branch | Environment | Trigger | Approval |
|---|---|---|---|
| `dev-lab`, `dev-customer`, `feature/*` | none (CI only) | push / PR | — |
| `main` | UAT | merge | PR review |
| `production` | Production | merge of release PR | **Manual environment approval** |

## 4a. As built (P3-11)
The root `Dockerfile` has three targets, `api`, `worker` and `migrate` (`docker build --target <name> -t <repository>:<sha> .` from the repository root); there is no `web` image because `apps/web` is a skeleton. They run as the unprivileged `node` user, hold no secrets, and trust the RDS CA bundle (downloaded at build time). The `migrate` image is the one-off task of `deploy-uat.yml` steps 3 and 4: its default command runs `prisma migrate deploy`, creates the two database login users (`infrastructure/scripts/create-login-users.mjs`) and runs `seed reference`. The ECR repositories (immutable tags), the GitHub OIDC provider and the `uat-deployer` role (trusting only `repo:Hashtrak-sh/LabConnect:environment:uat`) are in `infrastructure/` (stack `Delivery`); the role's permissions, the cluster, service and task-definition names to deploy to, and the commands to run the migration task are in `infrastructure/README.md`. The CI jobs are unchanged: the package's `build` (tsc), `typecheck` and `test` run through the same turbo tasks as every other workspace, with no AWS credentials. `deploy-uat.yml` is described in "As built (P3-12)" below.

## 4b. As built (P3-12)
**Code and tests only. The workflow has never run, no AWS account was used, and nothing is deployed.** `.github/workflows/deploy-uat.yml` is a single job, `deploy-uat`, in the GitHub environment `uat`. Its logic is in tested Node scripts (`infrastructure/scripts/deploy/`, built-ins only, so the job needs no `pnpm install`; it relies on the Node that `ubuntu-latest` has preinstalled and uses nothing newer than Node 20); the steps are short `aws` calls plus those scripts.

**Against the six steps of section 1 (`deploy-uat.yml`).**
1. *Build and push images (tag = commit SHA):* done for `api`, `worker` and `migrate`. An image whose tag already exists (a re-run) is not built or pushed again, because the repositories are immutable.
2. *Assume the role through OIDC:* done (`aws-actions/configure-aws-credentials`, role `uat-deployer`); it happens before the build because the push needs it.
3. *Migration task, stop on failure:* done. A new revision of `labconnect-uat-migrate` with only the image changed is registered and run on Fargate in the private subnets with the migrate security group and no public IP. The job waits for the task to stop and fails unless the one container's exit code is 0 and the task stopped because that container exited. On failure the services are not touched. The task's output is in the log group `/labconnect/uat/migrate`.
4. *`seed reference`:* not a separate step. The migration task already runs `prisma migrate deploy`, the login-user script and `seed reference`, in that order.
5. *Deploy services:* `api` and `worker` (there is no `web` service: `apps/web` is a skeleton). For each, a new revision of its task definition with only the image changed is registered, `update-service` is called, and the job waits until the service is stable. Then it checks that the **primary deployment runs the new task definition and its rollout is COMPLETED**, that no other deployment is left, and that running equals desired (at least 1). The services have the circuit breaker with rollback, so "stable" alone can mean "rolled back to the old version"; that fails the job.
6. *Smoke tests and Playwright, post the result:* only a smoke test. `GET <UAT_API_BASE_URL>/v1/health` must answer 200 with `{"status":"ok"}`, with up to six tries ten seconds apart. Without `UAT_API_BASE_URL` the step says so and is skipped: with no domain the load balancer is reachable only from the listed CIDRs, which a GitHub runner is not in. There is no Playwright suite yet, and nothing is posted to a pull request or a team channel (none exists). The result is in the job summary (commit, image tags, task definition revisions, result; no secrets, and the account id is masked).

**What it does not do: change infrastructure.** It runs no `cdk` and no CloudFormation deployment. A person applies infrastructure changes with their own credentials (`infrastructure/README.md`). Reason: `cdk deploy` goes through the CDK bootstrap roles, whose CloudFormation role is an administrator by default (OQ-179), and a compromised workflow must not get that. So the `uat-deployer` role has no `sts:AssumeRole`; it can only read one stack's outputs (to find the cluster, subnets and security group), push images, register task definitions, run the migration task and see how it ended, and update the two services. Every permission is one the workflow calls. It cannot read the log groups: application logs can hold personal data and this repository's workflow logs are public, so a person reads them in AWS.

**It cannot run until a person enables it.** Triggers are `push` to `main` and `workflow_dispatch` (no inputs); never `pull_request` or `pull_request_target`. The job runs only if the repository variable `UAT_DEPLOY_ENABLED` is `true` and the ref is `main` (a manual run on another branch is skipped); otherwise the run is skipped, not failed. It reads the variables `AWS_UAT_DEPLOY_ROLE_ARN` (the `DeployRoleArn` output), `AWS_REGION` (a repository variable, default `ap-south-1`) and `UAT_API_BASE_URL` (optional). There are no GitHub secrets. `permissions` is `contents: read`; only the job adds `id-token: write`. Runs are serialised (`concurrency: deploy-uat`, never cancelled midway). Actions are pinned to full commit SHAs (`actions/checkout`, `aws-actions/configure-aws-credentials`); `ci.yml` still pins by tag (OQ-196). To enable: `infrastructure/README.md`, "Enabling the UAT deployment workflow". To disable: delete the variable `UAT_DEPLOY_ENABLED` (or set it to anything but `true`).

**Drift this causes.** The workflow registers task definition revisions outside CloudFormation. The `Compute` stack still records the image tags it was last deployed with (its `apiImageTag`, `workerImageTag` and `migrateImageTag` context values). A person who later runs `cdk deploy Compute` must pass the tags that are running now, or the services roll back to the old image. The running tag is in the job summary of the last successful run, and `aws ecs describe-task-definition --task-definition labconnect-uat-api --query 'taskDefinition.containerDefinitions[0].image'` shows it (the tag is the commit SHA). Then: `cdk deploy Compute -c apiImageTag=<sha> -c workerImageTag=<sha> -c migrateImageTag=<sha>` with the same other context as before (OQ-186).

**Other limits.** A migration is not rolled back when a later step fails (the services stay on the old image, the database on the new schema: migrations must be forward-compatible, see section 1; OQ-187). If the job's wait for the migration task times out, the task is left running. Revisions registered by the workflow carry no tags (only the image changes; the tags of the stack are not copied), and old revisions are never deregistered (OQ-197). The tests (`infrastructure/test/deploy-*.test.ts`) check the scripts against sample JSON and the workflow file against the invariants above; they cannot show how real AWS answers (OQ-188).

## 4. As built (P3-05)
`ci.yml` has real jobs `permissions` (`pnpm test:permissions`) and `isolation` (`pnpm test:isolation`), shaped like `contract`: checkout, pnpm, install, one command. Both start a PostGIS container through Testcontainers, so they need Docker (ubuntu-latest has it). The job names are the required status checks of section 1 and must not change. `pnpm test:contract` does not run them again. The declaration and coverage rules (no database) also run in `pnpm test`, job `unit`.
