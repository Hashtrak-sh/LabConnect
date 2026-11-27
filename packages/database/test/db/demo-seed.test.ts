import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  DEMO_LAB_OWNER_COUNT,
  DEMO_SCOPE_LINE_COUNT,
  DEMO_SITE_COUNT,
  seedDemo,
} from '../../src/seed/demo.js';
import {
  DEMO_CATALOGUE,
  DEMO_PARAMETER_META,
  DEMO_SYNONYMS,
  demoFlat,
} from '../../src/seed/demo-catalogue.js';
import { demoGuide, DEMO_EMAIL_DOMAIN } from '../../src/seed/demo-guide.js';
import { CITIES, type CityName, NAMED_LABS } from '../../src/seed/demo-labs.js';
import { seedReference } from '../../src/seed/reference.js';
import { PATIENT, usePrisma } from './prisma.js';

// The content of `seed:demo`: the catalogue of tests, the labs and what they offer, the lab owner
// accounts, determinism and idempotency (MIGRATION_AND_SEED_STRATEGY.md section 3).

const NOW = new Date('2026-11-24T06:00:00.000Z');
const DAY = 86_400_000;
const docs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs');

async function seedAll(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await seedReference(tx, { now: NOW });
    await seedDemo(tx, { now: NOW });
  }, PATIENT);
}

/** Everything that decides how the demo reads, without ids and without clock-dependent dates. */
async function snapshot(prisma: PrismaClient): Promise<Record<string, unknown>> {
  const nodes = await prisma.mdNode.findMany({
    where: { attributes: { path: ['demo'], equals: true } },
    include: { parent: { select: { code: true } }, nodeType: { select: { code: true } } },
    orderBy: { code: 'asc' },
  });
  const sites = await prisma.labSite.findMany({
    include: { organisation: true, accreditations: true },
    orderBy: { siteCode: 'asc' },
  });
  const lines = await prisma.scopeLine.findMany({
    include: { parameterNode: true, labSite: true, rangeUnitNode: true, methodNode: true },
  });
  const prices = await prisma.priceItem.findMany({
    include: { scopeLine: { include: { parameterNode: true, labSite: true } } },
  });
  const geo = await prisma.$queryRaw<{ site_code: string; lat: number; lon: number }[]>`
    SELECT site_code, ST_Y(geo_point::geometry) AS lat, ST_X(geo_point::geometry) AS lon FROM lab_site ORDER BY site_code`;
  return {
    nodes: nodes.map((node) => [
      node.code,
      node.name,
      node.aliases,
      node.attributes,
      node.parent?.code ?? null,
      node.nodeType.code,
    ]),
    synonyms: (await prisma.searchSynonym.findMany({ orderBy: { term: 'asc' } })).map((row) => [
      row.term,
      row.expandsTo,
    ]),
    sites: sites.map((site) => [
      site.siteCode,
      site.name,
      site.organisation.displayName,
      site.organisation.nablLabRef,
      site.organisation.claimStatus,
      site.pincode,
      site.stateCode,
      site.address,
      site.accreditations.map((accreditation) => [
        accreditation.certificateNo,
        accreditation.status,
      ]),
    ]),
    geo,
    lines: lines
      .map((line) => [
        line.labSite.siteCode,
        line.parameterNode.code,
        line.methodNode?.code ?? null,
        line.methodText,
        line.rangeText,
        line.rangeUnitNode?.code ?? null,
      ])
      .sort((a, b) =>
        `${String(a[0])}|${String(a[1])}`.localeCompare(`${String(b[0])}|${String(b[1])}`),
      ),
    prices: prices
      .map((item) => [
        item.scopeLine.labSite.siteCode,
        item.scopeLine.parameterNode.code,
        item.pricePaise,
        item.tatDays,
        item.sampleQty.toString(),
      ])
      .sort((a, b) =>
        `${String(a[0])}|${String(a[1])}`.localeCompare(`${String(b[0])}|${String(b[1])}`),
      ),
    users: (await prisma.appUser.findMany({ orderBy: { email: 'asc' } })).map((user) => [
      user.email,
      user.fullName,
      user.status,
    ]),
  };
}

describe('seed:demo content', () => {
  const first = usePrisma();
  const second = usePrisma();

  beforeAll(async () => {
    await Promise.all([seedAll(first.prisma()), seedAll(second.prisma())]);
  }, 900_000);

  describe('the catalogue of tests', () => {
    it('has four disciplines, about 30 products and 100 to 150 parameters, each in its place', async () => {
      const nodes = await first.prisma().mdNode.findMany({
        where: { attributes: { path: ['demo'], equals: true }, taxonomy: { code: 'SCOPE' } },
        include: { nodeType: true },
      });
      const count = (type: string): number =>
        nodes.filter((node) => node.nodeType.code === type).length;
      expect(count('DISCIPLINE')).toBeGreaterThanOrEqual(4);
      expect(count('GROUP')).toBeGreaterThanOrEqual(8);
      expect(count('PRODUCT')).toBeGreaterThanOrEqual(20);
      expect(count('PRODUCT')).toBeLessThanOrEqual(30);
      expect(count('PARAMETER')).toBeGreaterThanOrEqual(100);
      expect(count('PARAMETER')).toBeLessThanOrEqual(150);
      expect(count('PARAMETER')).toBe(DEMO_PARAMETER_META.size);
      const disciplines = nodes
        .filter((node) => node.nodeType.code === 'DISCIPLINE')
        .map((node) => node.name);
      expect(disciplines).toEqual(
        expect.arrayContaining(['Chemical', 'Mechanical', 'Biological', 'Electrical']),
      );
    });

    it('gives every parameter a product, a group, a discipline and a unit, and no duplicate codes', async () => {
      const rows = await first.prisma().$queryRaw<
        {
          code: string;
          name: string;
          unit: string | null;
          product: string;
          grp: string;
          disc: string;
        }[]
      >`
        SELECT pa.code, pa.name, pa.attributes->>'unit' AS unit, p.code AS product, g.code AS grp, d.code AS disc
          FROM md_node pa
          JOIN md_node_type t ON t.id = pa.node_type_id AND t.code = 'PARAMETER'
          JOIN md_node p ON p.id = pa.parent_id
          JOIN md_node g ON g.id = p.parent_id
          JOIN md_node d ON d.id = g.parent_id
         WHERE pa.attributes->>'demo' = 'true'`;
      expect(rows).toHaveLength(DEMO_PARAMETER_META.size);
      expect(new Set(rows.map((row) => row.code)).size).toBe(rows.length);
      for (const row of rows) {
        expect(row.unit, row.code).toBeTruthy();
        expect(row.disc).toMatch(/^DEMO_/);
      }
      const allCodes = await first.prisma().mdNode.findMany({
        where: { code: { startsWith: 'DEMO_' } },
        select: { code: true, taxonomyId: true },
      });
      expect(new Set(allCodes.map((node) => `${node.taxonomyId}|${node.code}`)).size).toBe(
        allCodes.length,
      );
      // no two parameters of one product share a name
      const names = rows.map((row) => `${row.product}|${row.name}`);
      expect(new Set(names).size).toBe(names.length);
    });

    it('does not read like generated test data', async () => {
      const bad = await first.prisma().mdNode.count({
        where: {
          OR: [{ name: { contains: 'DEMO parameter' } }, { name: { startsWith: 'DEMO ' } }],
          attributes: { path: ['demo'], equals: true },
        },
      });
      expect(bad).toBe(0);
      expect(
        await first
          .prisma()
          .scopeLine.count({ where: { methodText: { startsWith: 'DEMO method' } } }),
      ).toBe(0);
    });

    it('marks its master data by code prefix and attribute, and the reference data is untouched', async () => {
      const demoNodes = await first.prisma().mdNode.findMany({
        where: { attributes: { path: ['demo'], equals: true } },
        select: { code: true },
      });
      expect(demoNodes.every((node) => node.code.startsWith('DEMO_'))).toBe(true);
      // The units seed:reference has are used as they are, not created again.
      const reference = await first.prisma().$queryRaw<{ code: string }[]>`
        SELECT n.code FROM md_node n JOIN md_taxonomy t ON t.id = n.taxonomy_id
         WHERE t.code = 'UNIT' AND n.attributes->>'demo' IS DISTINCT FROM 'true'`;
      expect(reference.map((node) => node.code).sort()).toEqual([
        'G',
        'KG',
        'L',
        'M',
        'MG',
        'ML',
        'MM',
        'PIECE',
      ]);
      // and the tests that use millimetres point at that value
      const mm = await first.prisma().scopeLine.count({ where: { rangeUnitNode: { code: 'MM' } } });
      expect(mm).toBeGreaterThan(0);
    });

    it('gives each scope line its method, its standard where there is one, and its unit', async () => {
      const lines = await first.prisma().scopeLine.findMany({
        include: { methodNode: true, rangeUnitNode: true, parameterNode: true },
      });
      expect(lines).toHaveLength(DEMO_SCOPE_LINE_COUNT);
      for (const line of lines) {
        expect(line.methodNode, line.parameterNode.code).not.toBeNull();
        expect(line.rangeUnitNode, line.parameterNode.code).not.toBeNull();
        expect(line.rangeText).toBeTruthy();
        const standard = (line.methodNode?.attributes as { standard_code?: string } | null)
          ?.standard_code;
        expect(line.methodText).toBe(standard ?? line.methodNode?.name);
      }
    });

    it('uses exactly the standards that docs list as used, and no others', () => {
      const used = [
        ...new Set(
          demoFlat().methods.flatMap((method) =>
            method.standardCode ? [method.standardCode] : [],
          ),
        ),
      ].sort();
      expect(used.length).toBeGreaterThan(30);
      const text = readFileSync(
        join(docs, '03-database', 'MIGRATION_AND_SEED_STRATEGY.md'),
        'utf8',
      );
      const block =
        /<!-- demo-standards:start -->([\s\S]*?)<!-- demo-standards:end -->/.exec(text)?.[1] ?? '';
      const listed = [...block.matchAll(/^\| (\S[^|]*?) \|/gm)]
        .map((match) => (match[1] ?? '').trim())
        .filter((cell) => /^(IS|ISO) \d/.test(cell))
        .sort();
      expect(listed).toEqual(used);
      for (const standard of used) {
        expect(standard).toMatch(/^(IS \d+( \(Part \d+\))?|ISO \d+(-\d+)?)$/);
      }
    });

    it('seeds the synonyms the search expands, such as TS for tensile strength', async () => {
      const rows = await first.prisma().searchSynonym.findMany();
      expect(rows).toHaveLength(DEMO_SYNONYMS.length);
      expect(rows.find((row) => row.term.toLowerCase() === 'ts')?.expandsTo).toEqual([
        'tensile strength',
      ]);
      expect(await first.prisma().searchSynonymVersion.count()).toBe(DEMO_SYNONYMS.length);
    });

    it('is the same list that the catalogue file declares', async () => {
      const declared = DEMO_CATALOGUE.flatMap((d) =>
        d.groups.flatMap((g) => g.products.flatMap((p) => p.parameters.map((x) => x.code))),
      ).sort();
      const stored = (
        await first.prisma().mdNode.findMany({
          where: {
            nodeType: { code: 'PARAMETER' },
            attributes: { path: ['demo'], equals: true },
          },
          select: { code: true },
        })
      )
        .map((node) => node.code)
        .sort();
      expect(stored).toEqual(declared);
    });
  });

  describe('the labs', () => {
    it('names every organisation and site with DEMO, and no two sites share a name', async () => {
      const sites = await first.prisma().labSite.findMany({ include: { organisation: true } });
      expect(sites).toHaveLength(DEMO_SITE_COUNT);
      for (const site of sites) {
        expect(site.name, site.siteCode).toContain('(DEMO)');
        expect(site.organisation.displayName).toContain('(DEMO)');
        expect(site.organisation.legalName).toContain('(DEMO)');
      }
      expect(new Set(sites.map((site) => site.name)).size).toBe(DEMO_SITE_COUNT);
      const labs = await first.prisma().organisation.findMany({ where: { orgType: 'LAB' } });
      expect(new Set(labs.map((lab) => lab.displayName)).size).toBe(labs.length);
      const customers = await first
        .prisma()
        .organisation.findMany({ where: { orgType: 'CUSTOMER' } });
      expect(customers.every((customer) => customer.displayName.includes('DEMO'))).toBe(true);
    });

    it('names the four bookable sites as the guide says, and not like generated fixtures', async () => {
      const bookable = await first
        .prisma()
        .labSite.findMany({ where: { isBookable: true }, orderBy: { siteCode: 'asc' } });
      expect(bookable.map((site) => site.name).sort()).toEqual(
        demoGuide()
          .bookableSites.map((site) => site.name)
          .sort(),
      );
      expect(
        await first
          .prisma()
          .labSite.count({ where: { name: { contains: 'DEMO Testing Laboratory' } } }),
      ).toBe(0);
      expect(
        await first
          .prisma()
          .organisation.count({ where: { displayName: { startsWith: 'DEMO Laboratory' } } }),
      ).toBe(0);
    });

    it('keeps cities, states, pincodes and map pins consistent, and the contact addresses in the demo domain', async () => {
      const sites = await first.prisma().labSite.findMany({ include: { labSitePrivates: true } });
      for (const site of sites) {
        const address = site.address as {
          city: CityName;
          district: string;
          state_code: string;
          line1: string;
          pincode: string;
        };
        const place = CITIES[address.city];
        expect(place, site.siteCode).toBeDefined();
        expect(site.stateCode).toBe(place.stateCode);
        expect(address.state_code).toBe(place.stateCode);
        expect(address.district).toBe(place.district);
        expect(address.line1).toContain('DEMO');
        expect(Number(site.pincode)).toBeGreaterThanOrEqual(place.pincodes[0]);
        expect(Number(site.pincode)).toBeLessThanOrEqual(place.pincodes[1]);
        expect(site.name).toContain(`, ${address.city}`);
        expect(site.labSitePrivates[0]?.contactEmail ?? '').toMatch(
          new RegExp(`@${DEMO_EMAIL_DOMAIN.replaceAll('.', '\\.')}$`),
        );
      }
      const [pins] = await first.prisma().$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM lab_site WHERE geo_point IS NOT NULL AND geocode_status = 'MANUAL_APPROVED'`;
      expect(pins?.n).toBe(BigInt(DEMO_SITE_COUNT));
    });

    it('gives every site at least one test, and a lab only tests that belong together', async () => {
      const lines = await first.prisma().$queryRaw<
        { site: string; disc: string; product: string }[]
      >`
        SELECT s.site_code AS site, d.code AS disc, p.code AS product
          FROM scope_line sl JOIN lab_site s ON s.id = sl.lab_site_id
          JOIN md_node d ON d.id = sl.discipline_node_id JOIN md_node p ON p.id = sl.product_node_id`;
      const perSite = new Map<string, { disc: Set<string>; product: Set<string> }>();
      for (const line of lines) {
        const entry = perSite.get(line.site) ?? { disc: new Set(), product: new Set() };
        entry.disc.add(line.disc);
        entry.product.add(line.product);
        perSite.set(line.site, entry);
      }
      expect(perSite.size).toBe(DEMO_SITE_COUNT);
      const food = [
        'EDIBLE_OIL',
        'MUSTARD_OIL',
        'MILK_POWDER',
        'HONEY',
        'TURMERIC',
        'CHILLI',
      ].flatMap((name) => [`DEMO_CHEM_${name}`, `DEMO_BIO_${name}`]);
      for (const [site, entry] of perSite) {
        const hasFood = [...entry.product].some((product) => food.includes(product));
        const hasStructure = [...entry.product].some((product) =>
          ['DEMO_MECH_OPC', 'DEMO_MECH_TMT', 'DEMO_MECH_COARSE_AGG', 'DEMO_MECH_BRICKS'].includes(
            product,
          ),
        );
        const hasCable = [...entry.product].some((product) => product.startsWith('DEMO_ELEC_'));
        const hasWater = [...entry.product].some((product) =>
          /_(DRINKING|GROUND|PACKAGED)_WATER$|TREATED_EFFLUENT/.test(product),
        );
        expect(hasFood && hasStructure, `${site}: food and building materials`).toBe(false);
        expect(hasCable && (hasFood || hasWater), `${site}: electrical with food or water`).toBe(
          false,
        );
      }
    });

    it('spreads the tests: several labs for a popular one, one or two for some, none for one', async () => {
      const rows = await first.prisma().$queryRaw<{ code: string; sites: bigint }[]>`
        SELECT pa.code, count(DISTINCT sl.lab_site_id) AS sites
          FROM md_node pa LEFT JOIN scope_line sl ON sl.parameter_node_id = pa.id
         WHERE pa.attributes->>'demo' = 'true' AND pa.node_type_id IN (SELECT id FROM md_node_type WHERE code = 'PARAMETER')
         GROUP BY pa.code`;
      const sites = new Map(rows.map((row) => [row.code, Number(row.sites)]));
      expect(sites.get('DEMO_CHEM_DRINKING_WATER_PH_VALUE')).toBeGreaterThan(20);
      expect(sites.get('DEMO_MECH_OPC_COMPRESSIVE_STRENGTH')).toBeGreaterThan(20);
      expect(sites.get('DEMO_CHEM_CHILLI_AFLATOXIN_B1')).toBe(1);
      expect([...sites.values()].filter((n) => n === 1 || n === 2).length).toBeGreaterThanOrEqual(
        3,
      );
      expect(sites.get('DEMO_CHEM_DRINKING_WATER_GROSS_ALPHA_ACTIVITY')).toBe(0);
      expect([...sites.values()].filter((n) => n === 0).length).toBe(1);
      // the exclusive tests are only where the catalogue says
      for (const [code, meta] of DEMO_PARAMETER_META) {
        if (meta.only === undefined) expect(sites.get(code), code).toBeGreaterThan(2);
        else expect(sites.get(code), code).toBe(meta.only.length);
      }
    });

    it('prices a test differently at the bookable sites, in whole rupees, with a turnaround of at least a day', async () => {
      const items = await first
        .prisma()
        .priceItem.findMany({ include: { scopeLine: { include: { labSite: true } } } });
      expect(items.length).toBeGreaterThan(100);
      const byParameter = new Map<string, Set<bigint>>();
      for (const item of items) {
        expect(item.pricePaise % 1000n, 'a multiple of 10 rupees').toBe(0n);
        expect(item.pricePaise).toBeGreaterThanOrEqual(20_000n);
        expect(item.pricePaise).toBeLessThanOrEqual(1_000_000n);
        expect(item.tatDays).toBeGreaterThanOrEqual(1);
        expect(item.tatDays).toBeLessThanOrEqual(14);
        const set = byParameter.get(item.scopeLine.parameterNodeId) ?? new Set();
        set.add(item.pricePaise);
        byParameter.set(item.scopeLine.parameterNodeId, set);
      }
      // a test offered at two bookable sites does not cost the same at both (pH is one)
      const shared = await first.prisma().$queryRaw<{ n: bigint; prices: bigint }[]>`
        SELECT count(DISTINCT s.id) AS n, count(DISTINCT pi.price_paise) AS prices
          FROM price_item pi JOIN scope_line sl ON sl.id = pi.scope_line_id JOIN lab_site s ON s.id = sl.lab_site_id
          JOIN md_node pa ON pa.id = sl.parameter_node_id
         WHERE pa.code = 'DEMO_CHEM_DRINKING_WATER_PH_VALUE'`;
      expect(shared[0]?.n).toBe(2n);
      expect(shared[0]?.prices).toBe(2n);
      const tats = await first.prisma().priceItem.groupBy({ by: ['tatDays'], _count: true });
      expect(tats.length).toBeGreaterThan(4);
    });

    it('does not go stale: certificates stay valid for months, open slots reach four months out', async () => {
      const accreditations = await first
        .prisma()
        .accreditation.findMany({ where: { status: 'VALID' } });
      expect(accreditations.length).toBeGreaterThan(150);
      for (const accreditation of accreditations) {
        expect(accreditation.validFrom.getTime()).toBeLessThan(NOW.getTime());
        expect(accreditation.validTo.getTime() - NOW.getTime()).toBeGreaterThan(400 * DAY);
      }
      const slots = await first.prisma().slot.findMany({ where: { status: 'OPEN' } });
      expect(slots.every((slot) => slot.startsAt.getTime() > NOW.getTime())).toBe(true);
      const last = Math.max(...slots.map((slot) => slot.startsAt.getTime()));
      expect(last - NOW.getTime()).toBeGreaterThan(100 * DAY);
      const perSite = await first.prisma().slot.groupBy({ by: ['labSiteId'], _count: true });
      expect(perSite).toHaveLength(4);
    });

    it('has the hours and instructions a lab page shows, for every bookable site', async () => {
      const bookable = await first
        .prisma()
        .labSite.findMany({ where: { isBookable: true }, include: { receivingHourses: true } });
      for (const site of bookable) {
        expect(site.receivingHourses.length).toBe(6);
        expect(site.submissionInstructions).toBeTruthy();
      }
    });

    it('samples are sized for the product: litres of water, kilograms of cement, never one kilogram of everything', async () => {
      const items = await first.prisma().priceItem.findMany({
        include: { sampleUnitNode: true, scopeLine: { include: { productNode: true } } },
      });
      const unitOf = (product: string): Set<string> =>
        new Set(
          items
            .filter((item) => item.scopeLine.productNode?.code === product)
            .map((item) => item.sampleUnitNode.code),
        );
      expect(unitOf('DEMO_CHEM_DRINKING_WATER')).toEqual(new Set(['L']));
      expect(unitOf('DEMO_MECH_OPC')).toEqual(new Set(['KG']));
      expect(unitOf('DEMO_MECH_TMT')).toEqual(new Set(['PIECE']));
      expect(unitOf('DEMO_ELEC_PVC_CABLE')).toEqual(new Set(['M']));
    });
  });

  describe('the guide', () => {
    it('names labs, certificates and accounts that exist', async () => {
      const guide = demoGuide();
      for (const site of [...guide.bookableSites, ...guide.claimLabs]) {
        const row = await first.prisma().accreditation.findFirst({
          where: { certificateNo: site.certificateNo },
          include: { labSite: { include: { organisation: true } } },
        });
        expect(row?.labSite.name, site.certificateNo).toBe(site.name);
      }
      for (const lab of guide.claimLabs) {
        const row = await first.prisma().accreditation.findFirstOrThrow({
          where: { certificateNo: lab.certificateNo },
          include: { labSite: { include: { organisation: true } } },
        });
        expect(row.labSite.organisation.claimStatus).toBe('UNCLAIMED');
        expect(row.status).toBe('VALID');
        expect(row.labSite.listingStatus).toBe('LISTED');
      }
      for (const lab of guide.bookableSites) {
        const row = await first.prisma().accreditation.findFirstOrThrow({
          where: { certificateNo: lab.certificateNo },
          include: { labSite: true },
        });
        expect(row.labSite.isBookable).toBe(true);
      }
      for (const account of guide.accounts) {
        const user = await first.prisma().appUser.findUnique({ where: { email: account.email } });
        expect(user?.status, account.email).toBe('ACTIVE');
      }
    });

    it('offers search terms that name something in the catalogue', async () => {
      const nodes = await first.prisma().mdNode.findMany({
        where: { attributes: { path: ['demo'], equals: true }, taxonomy: { code: 'SCOPE' } },
        select: { name: true, aliases: true },
      });
      const synonyms = await first.prisma().searchSynonym.findMany();
      const words = [
        ...nodes.flatMap((node) => [node.name, ...node.aliases]),
        ...synonyms.map((row) => row.term),
      ].map((word) => word.toLowerCase());
      for (const tip of demoGuide().searches) {
        expect(
          words.some((word) => word.includes(tip.term.toLowerCase())),
          tip.term,
        ).toBe(true);
      }
    });
  });

  describe('the lab owners', () => {
    it('exist, are active, and hold no membership and no role anywhere', async () => {
      const owners = await first.prisma().appUser.findMany({
        where: { email: { startsWith: 'lab.owner.demo' } },
        orderBy: { email: 'asc' },
      });
      expect(owners.map((user) => user.email)).toEqual(
        [1, 2, 3].map((n) => `lab.owner.demo${String(n)}@${DEMO_EMAIL_DOMAIN}`),
      );
      expect(owners.map((user) => user.fullName)).toEqual([
        'DEMO Lab Owner 1',
        'DEMO Lab Owner 2',
        'DEMO Lab Owner 3',
      ]);
      expect(owners).toHaveLength(DEMO_LAB_OWNER_COUNT);
      for (const owner of owners) {
        expect(owner.status).toBe('ACTIVE');
        expect(owner.isPlatformStaff).toBe(false);
        expect(await first.prisma().membership.count({ where: { userId: owner.id } })).toBe(0);
        expect(
          await first
            .prisma()
            .membershipRole.count({ where: { membership: { userId: owner.id } } }),
        ).toBe(0);
      }
    });
  });

  describe('totals', () => {
    it('has 200 sites, 5,000 scope lines, three onboarded labs with four bookable sites, three customers, a booking in every state', async () => {
      expect(await first.prisma().labSite.count()).toBe(200);
      expect(await first.prisma().scopeLine.count()).toBe(5000);
      expect(await first.prisma().labSite.count({ where: { isBookable: true } })).toBe(4);
      expect(
        await first
          .prisma()
          .organisation.count({ where: { orgType: 'LAB', claimStatus: 'CLAIMED' } }),
      ).toBe(3);
      expect(await first.prisma().organisation.count({ where: { orgType: 'CUSTOMER' } })).toBe(3);
      expect(await first.prisma().booking.count()).toBe(18);
      expect(NAMED_LABS.filter((lab) => lab.onboarded)).toHaveLength(3);
    });

    it('lets about one site in twenty have a certificate that is not valid, so search skips it', async () => {
      const notValid = await first
        .prisma()
        .accreditation.count({ where: { status: { not: 'VALID' } } });
      expect(notValid).toBeGreaterThan(5);
      expect(notValid).toBeLessThan(25);
      expect(
        await first.prisma().labSite.count({
          where: { isBookable: true, accreditations: { none: { status: 'VALID' } } },
        }),
      ).toBe(0);
    });
  });

  describe('determinism and idempotency', () => {
    it('gives the same catalogue, names, sites, scope and prices in two fresh databases', async () => {
      const [a, b] = await Promise.all([snapshot(first.prisma()), snapshot(second.prisma())]);
      expect((a.nodes as unknown[]).length).toBeGreaterThan(200);
      expect(b).toEqual(a);
    });

    it('does nothing on a second run', async () => {
      const before = await snapshot(first.prisma());
      const again = await first.prisma().$transaction((tx) => seedDemo(tx, { now: NOW }), PATIENT);
      expect(again).toEqual({
        skipped: true,
        labSites: 0,
        scopeLines: 0,
        bookings: 0,
        tests: 0,
        products: 0,
        labOwners: 0,
      });
      expect(await snapshot(first.prisma())).toEqual(before);
    });
  });
});

describe('seed:demo on a database that an older version of the seed filled', () => {
  const { prisma } = usePrisma();

  it('leaves the old demo data as it is (the marker is the first lab, as before) and adds nothing', async () => {
    await prisma().$transaction(async (tx) => {
      await seedReference(tx, { now: NOW });
      // what the old seed left: the first lab, found by its reference
      await tx.organisation.create({
        data: {
          id: '018f0000-0000-7000-8000-0000000000aa',
          orgType: 'LAB',
          legalName: 'DEMO Laboratory 0001',
          displayName: 'DEMO Laboratory 0001',
          claimStatus: 'CLAIMED',
          nablLabRef: 'DEMO-LAB-0001',
        },
      });
    }, PATIENT);
    const result = await prisma().$transaction((tx) => seedDemo(tx, { now: NOW }), PATIENT);
    expect(result.skipped).toBe(true);
    expect(await prisma().organisation.count()).toBe(1);
    expect(await prisma().mdNode.count({ where: { code: { startsWith: 'DEMO_' } } })).toBe(0);
    expect(await prisma().searchSynonym.count()).toBe(0);
    expect(await prisma().appUser.count()).toBe(0);
  });
});

describe('seed:demo in a fresh database, with another e-mail domain', () => {
  const { prisma } = usePrisma();

  it('keeps the lab owners and the sign-in domain together, and lab e-mail addresses in the domain', async () => {
    await prisma().$transaction(async (tx) => {
      await seedReference(tx, { now: NOW });
      await seedDemo(tx, { now: NOW, emailDomain: 'uat.example.test' });
    }, PATIENT);
    expect(
      await prisma().appUser.count({
        where: { NOT: { email: { endsWith: '@uat.example.test' } } },
      }),
    ).toBe(0);
    expect(
      await prisma().appUser.count({ where: { email: 'lab.owner.demo3@uat.example.test' } }),
    ).toBe(1);
    expect(
      await prisma().labSitePrivate.count({
        where: { NOT: { contactEmail: { endsWith: '@uat.example.test' } } },
      }),
    ).toBe(0);
  });
});
