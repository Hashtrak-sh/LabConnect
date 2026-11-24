# Git workflow

**Status:** Approved (product owner, Nov 2026).

## 1. Branches

| Branch | Purpose | Deploys to | Who merges |
|---|---|---|---|
| `production` | Released code | **Production** (after manual approval) | @Hashtrak-sh, via release PR |
| `main` | Integration and **UAT** | **UAT**, automatically on merge | PR author after approval |
| `dev-lab` | @Hashtrak-sh's working branch (laboratory module + shared work they lead) | — | @Hashtrak-sh |
| `dev-customer` | @akshit-anand's working branch (customer module + shared work they lead) | — | @akshit-anand |
| `feature/<task-id>-<slug>` | Optional short-lived branches cut **from your own dev branch** for larger tasks | — | owner |
| `hotfix/<slug>` | Urgent production fixes, cut from `production` | — | @Hashtrak-sh |

```mermaid
gitGraph
  commit id: "init"
  branch production
  checkout main
  branch dev-lab
  commit id: "lab work"
  checkout main
  branch dev-customer
  commit id: "customer work"
  checkout main
  merge dev-lab id: "PR #12"
  merge dev-customer id: "PR #13"
  checkout production
  merge main id: "release v0.1.0" tag: "v0.1.0"
```

## 2. Rules
1. **No direct pushes** to `main` or `production` (branch protection).
2. `dev-lab` / `dev-customer` → `main` only through a PR, which needs:
   - CI green (lint, typecheck, unit, integration, contract, migration, permission and isolation suites, build),
   - **1 approval from the other developer** (CODEOWNERS enforces this for shared paths),
   - branch up to date with `main`,
   - all conversations resolved.
3. Keep your dev branch fresh: **merge `main` into your dev branch at least daily** and before opening a PR. Don't rebase shared history after pushing.
4. Keep PRs small and focused (aim for < 600 changed lines, excluding generated code and migrations).
5. Shared changes (database, API contract, shared package, state machine) get their own PR, merged **before** the feature PRs that depend on them (see `COLLABORATION_GUIDE.md`).
6. Squash merge into `main`, with the PR title in Conventional Commits format.

## 3. Release to production
1. When UAT is signed off for a set of changes, open a **release PR `main` → `production`** titled `release: vX.Y.Z`, with a changelog and migration notes.
2. CI runs the full suite again, including E2E against UAT.
3. Merge with a **merge commit** (not squash), so production history mirrors main.
4. The `release-production` workflow pauses at the GitHub Environment `production`, which needs **manual approval by @Hashtrak-sh** (CD-57). It then: snapshots RDS → runs migrations → deploys → smoke tests → tags `vX.Y.Z`.
5. Versioning: SemVer. `0.x` until public launch.

## 4. Hotfixes
`hotfix/*` from `production` → PR to `production` (expedited review by the other developer, CI required) → approved deploy → **immediately back-merge `production` into `main`** via PR.

## 5. GitHub settings checklist (task P0-02)
- [ ] Default branch `main`. Protect `main` and `production`: require PRs, 1 approval, code-owner review, status checks, linear history off (merge commits allowed for releases), no force-push, no deletion.
- [ ] Environments `uat` (no approval) and `production` (required reviewer @Hashtrak-sh, deployment branch = `production` only).
- [ ] Collaborator `akshit-anand` with Write access.
- [ ] Secrets per environment through **GitHub OIDC → AWS IAM roles**. No long-lived AWS keys.
- [ ] Dependabot (npm, GitHub Actions, Docker) weekly. Secret scanning and push protection on.
