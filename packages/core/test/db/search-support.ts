import { uuidv7, type Prisma } from '@labconnect/database';
import {
  createCatalogue,
  createLab,
  createPlatformTeam,
  createPublishedChangeSet,
  loadReference,
  seedReference,
  type CatalogueSpec,
  type LabFixture,
  type LabOptions,
} from '@labconnect/database/test-utils';
import { beforeAll } from 'vitest';
import {
  FixedClock,
  InMemorySearchIndex,
  PostgresSearchIndex,
  buildLabSearchDocuments,
  normaliseSearchQuery,
  withPublicReadContext,
  type SearchIndex,
  type SearchPage,
  type SearchRequest,
} from '../../src/index.js';
import { usePlatform } from './support.js';

export const NOW = new Date('2026-11-25T10:00:00Z');

const CATALOGUE: CatalogueSpec[] = [
  {
    code: 'SX_MECHANICAL',
    name: 'Mechanical',
    groups: [
      {
        code: 'SX_METALS',
        name: 'Metals',
        products: [
          {
            code: 'SX_TMT',
            name: 'TMT bar',
            parameters: [
              { code: 'SX_TENSILE', name: 'Tensile strength' },
              { code: 'SX_YIELD', name: 'Yield strength' },
            ],
          },
          {
            code: 'SX_ALU',
            name: 'Aluminium sheet',
            parameters: [{ code: 'SX_HARDNESS', name: 'Hardness' }],
          },
        ],
      },
    ],
  },
  {
    code: 'SX_CHEMICAL',
    name: 'Chemical',
    groups: [
      {
        code: 'SX_BUILDING',
        name: 'Building materials',
        products: [
          {
            code: 'SX_CEMENT',
            name: 'Cement',
            parameters: [
              { code: 'SX_CHLORIDE', name: 'Chloride content' },
              { code: 'SX_SULPHATE', name: 'Sulphate content' },
            ],
          },
        ],
      },
    ],
  },
];

/** Catalogue parameter indexes, in the order `createCatalogue` makes them. */
export const P = { tensile: 0, yield: 1, hardness: 2, chloride: 3, sulphate: 4 } as const;

export interface SearchWorld {
  /** Visible, bookable. Delhi pin. Lines: tensile, yield, hardness (prices 1000, 1250, 1500 rupees). */
  a1: LabFixture['sites'][number];
  /** Visible, bookable. Noida pin. Lines: chloride, sulphate, tensile. */
  a2: LabFixture['sites'][number];
  /** Visible, bookable. Gurugram pin. Lines: tensile (900 rupees), yield (1000). */
  b: LabFixture['sites'][number];
  /** Listed, unclaimed (not bookable). Faridabad pin. Lines: tensile, yield. */
  c: LabFixture['sites'][number];
  /** Onboarded, but the site has no approved pin yet. Lines: tensile, yield. */
  noPin: LabFixture['sites'][number];
  /** Flag still says bookable, but the published price list was superseded. */
  noPriceList: LabFixture['sites'][number];
  /** Flag still says bookable, but KYC is not verified. */
  kycPending: LabFixture['sites'][number];
  /** A calibration accreditation: listed, found, never priced. */
  calibration: LabFixture['sites'][number];
  /** Never shown, and why. */
  hidden: Record<
    | 'expired'
    | 'suspended'
    | 'withdrawn'
    | 'orgSuspended'
    | 'orgClosed'
    | 'siteHidden'
    | 'medical'
    | 'dateExpired'
    | 'siteInactive',
    LabFixture['sites'][number]
  >;
  /** B has one more line that is INACTIVE: it must not be found. */
  inactiveLineId: string;
  /** A DRAFT price list of A1 with absurdly low prices: must never leak. */
  draftPricePaise: bigint;
  /** METHOD node code attached to A1's tensile line. */
  methodCode: string;
  visibleSiteIds: string[];
}

/** The database tests of search: a world of labs on the real schema, and the three roles. */
export function useSearchWorld() {
  const platform = usePlatform();
  const clock = new FixedClock(new Date(NOW.getTime() + 2 * 3_600_000));
  let world: SearchWorld | undefined;

  beforeAll(async () => {
    world = await platform.owner().$transaction(
      async (tx) => {
        await seedReference(tx);
        const reference = await loadReference(tx);
        const team = await createPlatformTeam(tx);
        const changeSetId = await createPublishedChangeSet(tx, team, 'DEMO search tests');
        const catalogue = await createCatalogue(tx, reference, changeSetId, CATALOGUE);
        const context = { reference, platform: team, catalogue, changeSetId };
        const lab = (options: LabOptions) => createLab(tx, context, { now: NOW, ...options });
        const first = (fixture: LabFixture): LabFixture['sites'][number] => {
          const site = fixture.sites[0];
          if (!site) throw new Error('a lab without a site');
          return site;
        };

        const a = await lab({
          tag: 'SA',
          name: 'Alpha Testing',
          sites: [
            { name: 'Alpha Testing Delhi', city: 'Delhi', lat: 28.61, lon: 77.21 },
            {
              name: 'Alpha Testing Noida',
              city: 'Noida',
              stateCode: 'UP',
              pincode: '201301',
              lat: 28.54,
              lon: 77.39,
            },
          ],
          parametersPerSite: 3,
        });
        const [a1, a2] = a.sites;
        if (!a1 || !a2) throw new Error('two sites expected');
        const b = first(
          await lab({
            tag: 'SB',
            name: 'Bravo Metals',
            sites: [
              {
                name: 'Bravo Metals Gurugram',
                city: 'Gurugram',
                stateCode: 'HR',
                lat: 28.46,
                lon: 77.03,
              },
            ],
            parametersPerSite: 2,
            price: (index) => BigInt(90_000 + index * 10_000),
          }),
        );
        const c = first(
          await lab({
            tag: 'SC',
            name: 'Charlie Unclaimed',
            onboarded: false,
            sites: [
              {
                name: 'Charlie Unclaimed Faridabad',
                city: 'Faridabad',
                stateCode: 'HR',
                lat: 28.41,
                lon: 77.31,
              },
            ],
            parametersPerSite: 2,
          }),
        );
        const noPin = first(
          await lab({
            tag: 'SN',
            name: 'November Nopin',
            sites: [{ name: 'November Nopin Lab', city: 'Delhi' }],
            parametersPerSite: 2,
          }),
        );
        const noPriceList = first(
          await lab({
            tag: 'SP',
            name: 'Papa Nopricelist',
            sites: [{ name: 'Papa Nopricelist Lab', city: 'Delhi', lat: 28.62, lon: 77.22 }],
            parametersPerSite: 2,
          }),
        );
        const kycPending = first(
          await lab({
            tag: 'SK',
            name: 'Kilo Kycpending',
            sites: [{ name: 'Kilo Kycpending Lab', city: 'Delhi', lat: 28.63, lon: 77.23 }],
            parametersPerSite: 2,
          }),
        );
        const calibration = first(
          await lab({
            tag: 'SL',
            name: 'Lima Calibration',
            sites: [{ name: 'Lima Calibration Lab', city: 'Delhi', lat: 28.64, lon: 77.24 }],
            parametersPerSite: 2,
          }),
        );

        const simple = async (
          tag: string,
          name: string,
          extra: LabOptions = {},
        ): Promise<{ fixture: LabFixture; site: LabFixture['sites'][number] }> => {
          const fixture = await lab({
            tag,
            name,
            sites: [{ name: `${name} Lab`, city: 'Delhi', lat: 28.65, lon: 77.25 }],
            parametersPerSite: 2,
            ...extra,
          });
          return { fixture, site: first(fixture) };
        };
        const expired = await simple('SE', 'Echo Expired', { accreditationStatus: 'EXPIRED' });
        const suspended = await simple('SS', 'Sierra Suspended', {
          accreditationStatus: 'SUSPENDED',
        });
        const withdrawn = await simple('SW', 'Whiskey Withdrawn', {
          accreditationStatus: 'WITHDRAWN',
        });
        const orgSuspended = await simple('SG', 'Golf Orgsuspended');
        const orgClosed = await simple('SQ', 'Quebec Orgclosed');
        const siteHidden = await simple('SH', 'Hotel Hidden');
        const medical = await simple('SM', 'Mike Medical');
        const dateExpired = await simple('SD', 'Delta Dateexpired');
        const siteInactive = await simple('SI', 'India Siteinactive');

        // ---- states the labs module would produce (here set directly, as the owner)
        await tx.$executeRaw`UPDATE organisation SET status = 'SUSPENDED' WHERE id = ${orgSuspended.fixture.organisationId}::uuid`;
        await tx.$executeRaw`UPDATE organisation SET status = 'CLOSED' WHERE id = ${orgClosed.fixture.organisationId}::uuid`;
        await tx.$executeRaw`UPDATE lab_site SET listing_status = 'HIDDEN', is_bookable = false WHERE id = ${siteHidden.site.id}::uuid`;
        await tx.$executeRaw`UPDATE lab_site SET status = 'INACTIVE' WHERE id = ${siteInactive.site.id}::uuid`;
        await tx.$executeRaw`UPDATE accreditation SET lab_category = 'MEDICAL' WHERE id = ${medical.site.accreditationId}::uuid`;
        await tx.$executeRaw`UPDATE accreditation SET valid_to = (${NOW}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date - 1 WHERE id = ${dateExpired.site.accreditationId}::uuid`;
        await tx.$executeRaw`UPDATE price_list SET status = 'SUPERSEDED', effective_to = ${NOW}::timestamptz WHERE id = ${noPriceList.priceListId ?? ''}::uuid`;
        await tx.$executeRaw`UPDATE organisation SET kyc_status = 'SUBMITTED' WHERE id = (SELECT organisation_id FROM lab_site WHERE id = ${kycPending.id}::uuid)`;
        await tx.$executeRaw`UPDATE accreditation SET lab_category = 'CALIBRATION' WHERE id = ${calibration.accreditationId}::uuid`;

        // an inactive line of B
        const inactiveLine = b.scopeLines[1];
        if (!inactiveLine) throw new Error('B has two lines');
        await tx.$executeRaw`UPDATE scope_line SET status = 'INACTIVE' WHERE id = ${inactiveLine.id}::uuid`;

        // a draft price list of A1, cheaper than anything real
        const draftPricePaise = 1n;
        const draftId = uuidv7();
        const orgOfA = a.organisationId;
        await tx.priceList.create({
          data: { id: draftId, organisationId: orgOfA, labSiteId: a1.id, versionNo: 2 },
        });
        await tx.priceItem.createMany({
          data: a1.scopeLines.map((line) => ({
            id: uuidv7(),
            organisationId: orgOfA,
            priceListId: draftId,
            scopeLineId: line.id,
            pricePaise: draftPricePaise,
            sampleQty: 1,
            sampleUnitNodeId: reference.node('UNIT', 'KG'),
            tatDays: 1,
          })),
        });

        // a METHOD node on A1's tensile line
        const methodCode = 'SX_IS_1608';
        const method = await tx.$queryRaw<{ taxonomy_id: string; node_type_id: string }[]>`
          SELECT t.id AS taxonomy_id, nt.id AS node_type_id
            FROM md_taxonomy t JOIN md_node_type nt ON nt.taxonomy_id = t.id
           WHERE t.code = 'METHOD' LIMIT 1`;
        const taxonomy = method[0];
        if (!taxonomy) throw new Error('the METHOD taxonomy has no node type');
        const methodId = uuidv7();
        await tx.mdNode.create({
          data: {
            id: methodId,
            taxonomyId: taxonomy.taxonomy_id,
            nodeTypeId: taxonomy.node_type_id,
            code: methodCode,
            name: 'IS 1608 tensile test of metals',
            attributes: { standard_code: 'IS 1608' } satisfies Prisma.InputJsonValue,
          },
        });
        const tensileLine = a1.scopeLines[P.tensile];
        if (!tensileLine) throw new Error('A1 has a tensile line');
        await tx.$executeRaw`UPDATE scope_line SET method_node_id = ${methodId}::uuid, range_text = '10-600 kN' WHERE id = ${tensileLine.id}::uuid`;

        return {
          a1,
          a2,
          b,
          c,
          noPin,
          noPriceList,
          kycPending,
          calibration,
          hidden: {
            expired: expired.site,
            suspended: suspended.site,
            withdrawn: withdrawn.site,
            orgSuspended: orgSuspended.site,
            orgClosed: orgClosed.site,
            siteHidden: siteHidden.site,
            medical: medical.site,
            dateExpired: dateExpired.site,
            siteInactive: siteInactive.site,
          },
          inactiveLineId: inactiveLine.id,
          draftPricePaise,
          methodCode,
          visibleSiteIds: [a1, a2, b, c, noPin, noPriceList, kycPending, calibration].map(
            (site) => site.id,
          ),
        } satisfies SearchWorld;
      },
      { maxWait: 60_000, timeout: 600_000 },
    );
  }, 600_000);

  const known = (): SearchWorld => {
    if (!world) throw new Error('the world is not ready');
    return world;
  };

  const asOf = (): Date => clock.now();
  const postgres = (): PostgresSearchIndex => new PostgresSearchIndex(platform.api());

  /** Every document the projector makes now, loaded into an in-memory index. */
  const projected = async (): Promise<InMemorySearchIndex> => {
    const index = new InMemorySearchIndex();
    const at = asOf();
    const result = await withPublicReadContext(platform.worker(), (tx) =>
      buildLabSearchDocuments(tx, { all: true, after: null, limit: 1000 }, at),
    );
    await index.replaceSites(result.sites);
    return index;
  };

  const run = (
    index: SearchIndex,
    request: SearchRequest = {},
    synonyms?: Map<string, string[]>,
  ): Promise<SearchPage> => {
    const query = normaliseSearchQuery({ limit: 100, ...request }, asOf());
    if (query.text !== null && synonyms) {
      const expansions = synonyms.get(query.text.toLowerCase());
      if (expansions) query.terms = [...query.terms, ...expansions];
    }
    return index.search(query);
  };

  return { platform, clock, world: known, asOf, postgres, projected, run };
}
