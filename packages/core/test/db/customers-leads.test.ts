import { describe, expect, it } from 'vitest';
import {
  CoreError,
  LabDirectoryService,
  LeadService,
  withPublicReadContext,
} from '../../src/index.js';
import { useSearchWorld } from './search-support.js';

// I1-CUS-07: "Request a lab" leads, on the real schema and as the API's database role. The insert
// runs as an anonymous visitor under the `lead_write` policy; reading the rows back needs the
// owner connection here, because a visitor cannot (`lead_read`).

interface LeadRow {
  kind: string;
  lab_site_id: string | null;
  query: unknown;
  contact_email: string | null;
  status: string;
  requester_user_id: string | null;
}

describe('LeadService.createLead', () => {
  const { platform, clock, world } = useSearchWorld();
  const service = (): LeadService =>
    new LeadService({
      prisma: platform.api(),
      labs: new LabDirectoryService({ prisma: platform.api(), clock }),
    });
  const stored = (email: string): Promise<LeadRow[]> =>
    platform.owner().$queryRaw<LeadRow[]>`
      SELECT kind::text AS kind, lab_site_id, query, contact_email::text AS contact_email,
             status::text AS status, requester_user_id
        FROM lead_request WHERE contact_email = ${email}::citext`;

  it('records a "request this lab" lead on a listed site, as NEW and anonymous', async () => {
    const email = 'request-lab@example.test';
    await service().createLead({
      kind: 'REQUEST_LAB',
      labSiteId: world().c.id,
      query: null,
      contactEmail: email,
    });
    expect(await stored(email)).toEqual([
      {
        kind: 'REQUEST_LAB',
        lab_site_id: world().c.id,
        query: null,
        contact_email: email,
        status: 'NEW',
        requester_user_id: null,
      },
    ]);
  });

  it('records a no-result lead with the search criteria and no location', async () => {
    const email = 'no-result@example.test';
    await service().createLead({
      kind: 'NO_RESULT',
      query: { q: 'chromatography', pincode: '201301', radiusKm: 25 },
      contactEmail: email,
    });
    const rows = await stored(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.query).toEqual({ q: 'chromatography', pincode: '201301', radiusKm: 25 });
    expect(rows[0]?.lab_site_id).toBeNull();
  });

  it('refuses a "request this lab" lead on a site that is not listed', async () => {
    await expect(
      service().createLead({
        kind: 'REQUEST_LAB',
        labSiteId: world().hidden.siteHidden.id,
        query: null,
        contactEmail: null,
      }),
    ).rejects.toBeInstanceOf(CoreError);
  });

  it('lets no anonymous visitor read leads back', async () => {
    const seen = await withPublicReadContext(
      platform.api(),
      (tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM lead_request`,
    );
    expect(seen[0]?.n).toBe(0n);
  });
});
