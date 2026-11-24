# Collaboration guide: two developers and Claude Code

**Status:** Approved baseline.

## 1. Who does what
| | @akshit-anand (Developer 1) | @Hashtrak-sh (Developer 2) |
|---|---|---|
| Module | Customer: search UX, lab pages, booking creation, counter response, payment UX, handover view, customer dashboard, report download and share, disputes (customer side), customer org admin | Laboratory: claim and onboarding, users, catalogue and price import, capacity, inbox and decisions, scanner, receipts, testing, reports, amendments, lab dashboard |
| Branch | `dev-customer` | `dev-lab` |
| Also leads (shared) | Search service, notifications templates, E2E harness | Database schema, booking engine, payments core, custody/QR, infrastructure, release management |
| Admin console | Split per feature in the task tracker | Split per feature in the task tracker |

Both developers review each other's PRs. Each developer runs Claude Code on **their own branch only**.

## 2. The contract-first handshake (avoids parallel collisions)
For any feature that spans both modules (e.g. booking → lab decision):
1. **Shared PR first:** whichever developer owns the task writes the API contract (`openapi.yaml`), any schema migration, enum or state-machine change. The other developer reviews it. Merge it to `main`.
2. Both developers merge `main` into their dev branches.
3. Each implements their side against the agreed contract, with mocks (generated from OpenAPI) for the other side: `contractExample(operationId, status)` from `@labconnect/api-contract/examples` returns the contract's example for a response, and `createApiClient()` from `@labconnect/api-contract` is the typed client. The API side tests every call with `contractRequest()` and removes the operation from `apps/api/test/contract/not-implemented.txt` (TESTING_STRATEGY §8).
4. Integration test or E2E in the later of the two PRs.

**Never** change a shared file inside a feature PR without flagging it as "Shared change" in the PR template.

## 3. Daily rhythm (lightweight)
- Start of day: merge `main` into your dev branch, run tests, check `TASK_TRACKER.md` and the open PRs.
- Post in the team channel: the shared changes you plan today (one line).
- End of day: push your dev branch. Open PRs when a task meets the definition of done.

## 4. Working with Claude Code
- Start every session with the MASTER_PROMPT §2 template. Name the developer and branch.
- Ask Claude Code for a plan first and approve it. Keep tasks to one task ID.
- Review every diff yourself. Claude Code implements and the developers are accountable (CD-50).
- If Claude Code proposes something outside scope or changes a shared file unexpectedly, reject it and point it at `SCOPE_AND_EXCLUSIONS.md`.
- Keep `docs/` updated in the same PR. Claude Code is instructed to do this, so check that it did.

## 5. Conflict hotspots and how to avoid them
| Hotspot | Rule |
|---|---|
| `schema.prisma` and migrations | One owner per migration PR. Coordinate migration timestamps. Never edit a merged migration. |
| `openapi.yaml` | Edit only through shared PRs. Split it into per-module files (`paths/booking.yaml`) bundled at build time, to reduce merge conflicts. |
| `packages/shared` enums | Append only, alphabetised. Coordinate through a shared PR. |
| `messages/en.json` | Namespaced keys per module (`customer.*`, `lab.*`, `admin.*`, `common.*`). |
| Seed data | Separate seed files per module. |

## 6. Definition of done (per task)
- [ ] Meets the referenced FR, BR, AC and EC items
- [ ] Tests at the required levels pass (TESTING_STRATEGY §3)
- [ ] Permission and tenant-isolation tests updated for new endpoints
- [ ] OpenAPI matches the implementation (contract test green: `pnpm test:contract`)
- [ ] RTM updated
- [ ] Docs updated
- [ ] Reviewed and approved by the other developer
