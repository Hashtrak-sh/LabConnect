import { BOOKING_STATES, bookingInState } from '../factories/booking.js';
import {
  type CatalogueSpec,
  createCatalogue,
  createCustomer,
  createLab,
  createPlatformTeam,
  createPublishedChangeSet,
  type LabFixture,
  loadReference,
  type SiteSpec,
  type Tx,
} from '../factories/world.js';
import { assertNotProduction } from './env.js';

// `seed:demo` (MIGRATION_AND_SEED_STRATEGY.md section 3): fictitious data for local
// development and UAT. Every organisation, site and user it creates is marked "DEMO".
// No real lab, person or NABL record is used.

export const DEMO_SITE_COUNT = 200;
export const DEMO_SCOPE_LINES_PER_SITE = 25;
const DEMO_MARKER = 'DEMO-LAB-0001';

export interface DemoSeedOptions {
  env?: Record<string, string | undefined>;
  now?: Date;
  /** Domain of the demo users' email addresses. Default `demo.labconnect.test`. */
  emailDomain?: string;
}

export interface DemoSeedResult {
  /** True when the demo data was already there and nothing was done. */
  skipped: boolean;
  labSites: number;
  scopeLines: number;
  bookings: number;
}

/** A small repeatable generator, so every run lays the demo sites out the same way. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Rough centres of five Delhi NCR cities. Sites are scattered a few kilometres around them. */
const CITIES = [
  { city: 'Delhi', stateCode: 'DL', pincodePrefix: '110', lat: 28.61, lon: 77.21 },
  { city: 'Gurugram', stateCode: 'HR', pincodePrefix: '122', lat: 28.46, lon: 77.03 },
  { city: 'Noida', stateCode: 'UP', pincodePrefix: '201', lat: 28.54, lon: 77.39 },
  { city: 'Faridabad', stateCode: 'HR', pincodePrefix: '121', lat: 28.41, lon: 77.31 },
  { city: 'Ghaziabad', stateCode: 'UP', pincodePrefix: '201', lat: 28.67, lon: 77.45 },
] as const;

/** Four disciplines × two groups × three products × five parameters = 120 parameters. */
function demoCatalogue(): CatalogueSpec[] {
  const tree: [string, [string, string[]][]][] = [
    [
      'Chemical',
      [
        ['Building materials', ['Cement', 'Steel', 'Aggregate']],
        ['Water', ['Drinking water', 'Waste water', 'Ground water']],
      ],
    ],
    [
      'Mechanical',
      [
        ['Metals', ['Steel bar', 'Aluminium sheet', 'Copper wire']],
        ['Polymers', ['Plastic pipe', 'Rubber sheet', 'Plastic film']],
      ],
    ],
    [
      'Electrical',
      [
        ['Cables', ['Power cable', 'Control cable', 'Flexible cord']],
        ['Appliances', ['Switch', 'Socket', 'Lamp holder']],
      ],
    ],
    [
      'Biological',
      [
        ['Food', ['Milk powder', 'Edible oil', 'Spice mix']],
        ['Packaged water', ['Bottled water', 'Mineral water', 'Jar water']],
      ],
    ],
  ];
  const code = (...parts: string[]): string =>
    `DEMO_${parts
      .join('_')
      .toUpperCase()
      .replaceAll(/[^A-Z0-9]+/g, '_')}`;
  return tree.map(([discipline, groups]) => ({
    code: code(discipline),
    name: `DEMO ${discipline}`,
    groups: groups.map(([group, products]) => ({
      code: code(discipline, group),
      name: `DEMO ${group}`,
      products: products.map((product) => ({
        code: code(discipline, group, product),
        name: `DEMO ${product}`,
        parameters: [1, 2, 3, 4, 5].map((n) => ({
          code: code(discipline, group, product, `P${String(n)}`),
          name: `DEMO parameter ${String(n)} of ${product.toLowerCase()}`,
        })),
      })),
    })),
  }));
}

/**
 * Creates the demo data in the given transaction. Needs `seed:reference` first.
 * Does nothing if the demo data is already there. Refuses to run in production.
 */
export async function seedDemo(tx: Tx, options: DemoSeedOptions = {}): Promise<DemoSeedResult> {
  assertNotProduction('seed:demo', options.env ?? process.env);
  if (await tx.organisation.findFirst({ where: { nablLabRef: DEMO_MARKER } })) {
    return { skipped: true, labSites: 0, scopeLines: 0, bookings: 0 };
  }
  const now = options.now ?? new Date();
  const emailDomain = options.emailDomain ?? 'demo.labconnect.test';
  const random = generator(20_261_124);

  const reference = await loadReference(tx);
  const platform = await createPlatformTeam(tx, { tag: 'demo', emailDomain });
  const changeSetId = await createPublishedChangeSet(tx, platform, 'DEMO data');
  const catalogue = await createCatalogue(tx, reference, changeSetId, demoCatalogue());
  const context = { reference, platform, catalogue, changeSetId };

  let siteNumber = 0;
  const nextSite = (): SiteSpec => {
    const place = CITIES[siteNumber % CITIES.length] ?? CITIES[0];
    siteNumber++;
    return {
      name: `DEMO Testing Laboratory ${String(siteNumber).padStart(3, '0')}, ${place.city}`,
      city: place.city,
      stateCode: place.stateCode,
      pincode: `${place.pincodePrefix}${String(Math.floor(random() * 90) + 1).padStart(3, '0')}`,
      lat: place.lat + (random() - 0.5) * 0.12,
      lon: place.lon + (random() - 0.5) * 0.12,
    };
  };
  const perSite = DEMO_SCOPE_LINES_PER_SITE;
  const lab = (
    tag: string,
    siteCount: number,
    onboarded: boolean,
    extra = {},
  ): Promise<LabFixture> =>
    createLab(tx, context, {
      tag,
      name: `DEMO Laboratory ${tag}`,
      onboarded,
      sites: Array.from({ length: siteCount }, nextSite),
      parametersPerSite: perSite,
      parameterOffset: Math.floor(random() * catalogue.parameters.length),
      price: (index) => BigInt(50_000 + ((index * 7) % 20) * 12_500),
      emailDomain,
      now,
      ...extra,
    });

  // ---- three onboarded labs (four bookable sites), with Makers and Checkers
  const onboarded = [
    await lab('0001', 2, true, { makers: 2, checkers: 2 }),
    await lab('0002', 1, true, { makers: 2, checkers: 1 }),
    await lab('0003', 1, true, { makers: 1, checkers: 1 }),
  ];
  let labSites = 4;

  // ---- the rest: listed, unclaimed labs. A few have an accreditation that is not valid.
  for (let n = 4; labSites < DEMO_SITE_COUNT; n++, labSites++) {
    const accreditationStatus =
      n % 40 === 0 ? 'SUSPENDED' : n % 25 === 0 ? 'EXPIRED' : ('VALID' as const);
    await lab(String(n).padStart(4, '0'), 1, false, { accreditationStatus });
  }

  // ---- three customers: individual, business, government
  const customers = [
    await createCustomer(tx, {
      tag: 'demo1',
      name: 'DEMO Individual Customer',
      segment: 'INDIVIDUAL',
      emailDomain,
    }),
    await createCustomer(tx, {
      tag: 'demo2',
      name: 'DEMO Business Customer Pvt Ltd',
      segment: 'BUSINESS',
      emailDomain,
    }),
    await createCustomer(tx, {
      tag: 'demo3',
      name: 'DEMO Government Department',
      segment: 'GOVERNMENT',
      emailDomain,
    }),
  ];

  // ---- one booking in every state, spread over the customers and the bookable sites
  const bookableSites = onboarded.flatMap((owner) => owner.sites.map((site) => ({ owner, site })));
  let bookings = 0;
  for (const [index, state] of BOOKING_STATES.entries()) {
    const target = bookableSites[index % bookableSites.length];
    const customer = customers[index % customers.length];
    if (!target || !customer) throw new Error('unreachable: demo labs and customers exist');
    await bookingInState(tx, state, {
      reference,
      customer,
      lab: target.owner,
      site: target.site,
      lineCount: 1 + (index % 3),
      packageCount: 1 + (index % 2),
      slotId: target.site.slotIds[index % Math.max(target.site.slotIds.length, 1)] ?? null,
      bookingNo: `LC-DEMO-${String(index + 1).padStart(7, '0')}`,
      itemName: `DEMO sample ${String(index + 1)}`,
      now,
    });
    bookings++;
  }

  return { skipped: false, labSites, scopeLines: labSites * perSite, bookings };
}
