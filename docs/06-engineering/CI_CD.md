# CI/CD (GitHub Actions)

**Status:** DRAFT. Implement in task P0-06 (CI) and P3-12 (deploy).

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
