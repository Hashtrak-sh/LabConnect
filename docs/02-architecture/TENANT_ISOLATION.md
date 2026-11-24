# Tenant isolation

**Status:** DRAFT for gate G1.

## 1. Tenancy model
- A **tenant** is an `organisation` (`org_type` = `CUSTOMER`, `LAB` or `PLATFORM`).
- Data falls into five classes:

| Class | Examples | Visibility |
|---|---|---|
| Public reference | Taxonomies, `lab_site`, published accreditation, scope lines, published price lists, receiving hours of **listed** sites. Private columns of sites and organisations live in `lab_site_private` and `organisation_private`. | Anyone, read-only |
| Customer-owned | Customer sites, settings | That customer org and its members (per role) |
| Lab-owned | KYC, bank, unpublished price-list drafts, slot templates, users | That lab org (per role and site assignment) |
| **Shared transactional** | Booking, lines, TRF and attachments, packages, custody, receipt, reports, payments, disputes | Both parties on the booking, each per role, plus the platform per role. Three exceptions are narrower: `dispute_message` with `PLATFORM_ONLY` visibility (platform only), `rating` from lab to customer (lab and platform only), `break_glass_grant` (platform only). |
| Platform | Change sets, imports, config, audit | Platform roles only |

## 2. Rules
1. Every tenant-owned table has `organisation_id` (or, for shared transactional rows, both `customer_org_id` and `lab_org_id`, denormalised from the booking). The keys are guaranteed by **composite foreign keys**, not by triggers: a child row cannot be written with tenant keys that differ from its booking's (schema spec §0, **+TK** and **+ORG**).
2. The API derives the actor's organisation from the **active membership in the session**. It never trusts an org ID in the path, query or body.
3. Every repository method that touches tenant data takes a `TenantScope` (`{ actorUserId, orgId, orgType, roles, siteIds }`) and adds the predicate itself. Lint rule: Prisma calls on tenant tables outside repositories are forbidden.
4. Lab users are further limited to their assigned `siteIds` (`membership_site`). **This is enforced by the repositories only**, and proven by the tenant-isolation test suite. RLS policies compare organisations, not sites.
5. A request for a resource outside scope returns **404**, not 403, so existence doesn't leak. Exception: role failures on in-scope resources return 403.
6. Platform staff access is role-based. Report files need break-glass: a `break_glass_grant` row approved by a different `PLATFORM_ADMIN`, time-boxed, with every access logged in `report_access_log` against the grant.
7. Background jobs run as `SYSTEM` with an explicit, logged scope per job. They connect as the database role `app_worker` and set `app.is_system`.
8. File access is never granted from `file_object` alone. The API resolves the entity a file is attached to and checks access to that.

## 3. Defence in depth: PostgreSQL RLS (ADR-005)
- Roles: the API connects as `app_rw`, the worker as `app_worker`. Neither has `BYPASSRLS`. Migrations run as `app_owner`, which owns the tables and is therefore **not** subject to the policies. `FORCE ROW LEVEL SECURITY` is deliberately not set: the validation triggers run as the owner (`SECURITY DEFINER`) and must see every row, for example to check a refund against all refunds of a payment order. The owner role is never used by the application.
- Each unit of work runs in one transaction that first sets `app.org_id`, `app.user_id`, `app.is_platform` and `app.is_system` with `set_config(…, true)` (the same as `SET LOCAL`). The function `withDbContext(prisma, context, work)` in `packages/database` does this and hands `work` the transaction client. All four settings are written every time. Worker jobs use the `system` context. "Platform staff" and "system job" are separate settings and separate branches in every policy.
- Inside `work`, only the transaction client is used. A query sent through the outer client runs on another connection with no settings and sees no tenant rows.
- A per-query client extension (each query wrapped in its own small transaction) is **not** used. On Prisma 7.10 a write made through such an extension inside an interactive transaction was committed although the transaction rolled back.
- Policies read settings through helper functions (`app_org_id()`, `app_is_platform()`, `app_is_system()`), which treat an unset **or empty** setting as "no access". On a pooled connection a setting that was used earlier returns an empty string, not NULL.
- Every policy states `WITH CHECK` as well as `USING`.
- `outbox_event` and `timer` payloads contain tenant data and have no tenant key. Only `app_worker` can read them; `app_rw` can insert (and, for `timer`, cancel).
- Policies (example for `booking`):
  ```sql
  CREATE POLICY booking_tenant ON booking
    USING (
      app_is_platform() OR app_is_system()
      OR customer_org_id = app_org_id()
      OR lab_org_id      = app_org_id()
    )
    WITH CHECK ( /* same expression */ );
  ```
- Public reference tables have no RLS (or a permissive SELECT policy). `price_list` and `price_item` are public only when the list is PUBLISHED or SUPERSEDED; drafts are visible to the owning lab. `md_change_set` is visible to the platform and to the lab named in `proposed_by_org_id`. `app_user` is visible to the user, to members of an organisation the user belongs to, and to the platform.
- The policies exist from the first migration and are tested with raw SQL as `app_rw` and `app_worker` (`row-level-security.test.ts`).
- **Spike P1-08, done** (`packages/database/test/db/prisma-rls.test.ts`). Through Prisma 7.10 with the `pg` driver adapter, as a login user that inherits `app_rw`:
  - each party sees only its own rows, the platform sees all, and no context sees nothing and raises no error;
  - a connection reused from the pool carries nothing over after a commit or a rollback;
  - writes to another tenant are refused (`update` finds no record, `create` fails the policy check);
  - 600 concurrent units of work in mixed contexts stayed apart on a pool of 4 connections, and again through PgBouncer in transaction mode on 3 server connections.
- Not covered by the spike: RDS Proxy (cannot be run locally), read replicas, and throughput figures. If a pooler other than PgBouncer is chosen, this test file is run through it before it is used.
- The login users are created by each environment's infrastructure: one that inherits `app_rw` for the API, one that inherits `app_worker` for the worker. **The application never connects as the owner or a superuser, which bypass the policies.** On a developer machine `pnpm db:local-users` creates both (`API_DATABASE_URL`, `WORKER_DATABASE_URL` in `.env`); `DATABASE_URL` stays the owner and is for migrations and seeds only.
- The `system` context is not tied to the database role. The API needs it before a user is known (finding a session by its token, a user by email), so `app_rw` can set it. Whether to narrow that is OQ-30.

## 4. Testing
- **Tenant-isolation suite:** for every endpoint that returns or changes tenant data, seed orgs A and B and assert that A can't read, list, count or change B's data (404 or empty).
- **RLS suite:** run raw SQL as `app_rw` with A's settings and assert that B's rows are invisible. The same through Prisma, a shared pool and PgBouncer.
- **Search:** the OpenSearch index contains only public reference data. A test asserts that no customer, booking or price-draft fields are indexed.
