import { describe, expect, it } from 'vitest';
import { withPublicWriteContext } from '../../src/index.js';
import { usePlatform } from './support.js';

// What an anonymous visitor that may write (`withPublicWriteContext`) can insert into, pinned from
// the catalogue (review of PR #58, comment 3). The context is meant only for the "Request a lab"
// lead, but row-level security does not limit it to that: these two lists say what else it could
// reach. A change to either list is a security decision and must be made on purpose, here.

/** Tables with an INSERT (or ALL) policy whose check is the literal `true`: open to anyone. */
const OPEN_INSERT_POLICIES = ['audit_log', 'lead_request', 'outbox_event', 'timer'];

/** Tables without row-level security that the API role may insert into: guarded by code only. */
const TABLES_WITHOUT_RLS = [
  'accreditation',
  'accreditation_body',
  'accreditation_standard',
  'accreditation_version',
  'config_parameter',
  'fee_rule',
  'holiday_calendar',
  'lab_site',
  'lab_site_version',
  'md_attribute_definition',
  'md_node',
  'md_node_type',
  'md_node_version',
  'md_taxonomy',
  'notification_template',
  'organisation',
  'organisation_version',
  'qr_signing_key',
  'receiving_hours',
  'retention_rule',
  'scope_line',
  'scope_line_version',
  'search_synonym',
  'search_synonym_version',
  'site_closure',
  'slot',
  'verification_event',
];

describe('withPublicWriteContext: what an anonymous visitor can insert into', () => {
  const platform = usePlatform();

  it('has exactly these insert policies open to anyone', async () => {
    const rows = await platform.owner().$queryRaw<{ tablename: string }[]>`
      SELECT DISTINCT tablename FROM pg_policies
       WHERE schemaname = 'public' AND cmd IN ('INSERT', 'ALL')
         AND coalesce(with_check, qual) = 'true'
       ORDER BY tablename`;
    expect(rows.map((row) => row.tablename)).toEqual(OPEN_INSERT_POLICIES);
  });

  it('has exactly these API-writable tables without row-level security', async () => {
    const rows = await platform.owner().$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
         AND NOT c.relrowsecurity AND c.relname <> '_prisma_migrations'
         AND has_table_privilege('app_rw', c.oid, 'INSERT')
       ORDER BY c.relname`;
    expect(rows.map((row) => row.relname)).toEqual(TABLES_WITHOUT_RLS);
  });

  it('refuses a tenant table even though it may write', async () => {
    await expect(
      withPublicWriteContext(
        platform.api(),
        (tx) =>
          tx.$executeRaw`INSERT INTO customer_settings (organisation_id) VALUES (gen_random_uuid())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
