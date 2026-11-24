# Tenant isolation

**Status:** DRAFT for gate G1.

## 1. Tenancy model
- A **tenant** is an `organisation` (`org_type` = `CUSTOMER`, `LAB` or `PLATFORM`).
- Data falls into four classes:

| Class | Examples | Visibility |
|---|---|---|
| Public reference | Taxonomies, published accreditation, scope lines, published price lists, receiving hours of **listed** sites | Anyone, read-only |
| Customer-owned | Customer sites, settings, TRF content, attachments | That customer org and its members (per role) |
| Lab-owned | KYC, bank, unpublished price-list drafts, slot templates, users | That lab org (per role and site assignment) |
| **Shared transactional** | Booking, lines, packages, custody, receipt, reports, payments, disputes | Both parties on the booking, each per role, plus the platform per role |
| Platform | Change sets, imports, config, audit | Platform roles only |

## 2. Rules
1. Every tenant-owned table has `organisation_id` (or, for shared transactional rows, both `customer_org_id` and `lab_org_id`, denormalised from the booking).
2. The API derives the actor's organisation from the **active membership in the session**. It never trusts an org ID in the path, query or body.
3. Every repository method that touches tenant data takes a `TenantScope` (`{ actorUserId, orgId, orgType, roles, siteIds }`) and adds the predicate itself. Lint rule: Prisma calls on tenant tables outside repositories are forbidden.
4. Lab users are further limited to their assigned `siteIds` (`membership_site`).
5. A request for a resource outside scope returns **404**, not 403, so existence doesn't leak. Exception: role failures on in-scope resources return 403.
6. Platform staff access is role-based. Report files need break-glass (`report_access_log.reason`, time-boxed grant).
7. Background jobs run as `SYSTEM` with an explicit, logged scope per job.

## 3. Defence in depth: PostgreSQL RLS (ADR-005)
- The application connects as role `app_rw` (no `BYPASSRLS`). Migrations run as `app_owner`.
- Each request transaction sets `SET LOCAL app.org_id = '<uuid>'`, `app.org_type`, `app.user_id`, `app.is_platform`, using a Prisma client extension that wraps queries in an interactive transaction.
- Policies (example for `booking`):
  ```sql
  CREATE POLICY booking_tenant ON booking
    USING (
      current_setting('app.is_platform', true) = 'true'
      OR customer_org_id = current_setting('app.org_id', true)::uuid
      OR lab_org_id      = current_setting('app.org_id', true)::uuid
    );
  ```
- Public reference tables have no RLS (or a permissive SELECT policy).
- Phase 1 spike (task P1-08): confirm Prisma + `SET LOCAL` + connection pooling works under load. If not, fall back to application-level scoping plus a nightly isolation audit query, and record the result in ADR-005.

## 4. Testing
- **Tenant-isolation suite:** for every endpoint that returns or changes tenant data, seed orgs A and B and assert that A can't read, list, count or change B's data (404 or empty).
- **RLS suite:** run raw SQL as `app_rw` with A's settings and assert that B's rows are invisible.
- **Search:** the OpenSearch index contains only public reference data. A test asserts that no customer, booking or price-draft fields are indexed.
