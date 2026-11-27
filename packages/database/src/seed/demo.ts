import { uuidv7 } from '../ids.js';
import { BOOKING_STATES, bookingInState } from '../factories/booking.js';
import {
  createCatalogue,
  createCustomer,
  createLab,
  createPlatformTeam,
  createPublishedChangeSet,
  createUser,
  type LabFixture,
  type LineSpec,
  loadReference,
  type ParameterRef,
  type SiteSpec,
  type Tx,
} from '../factories/world.js';
import { DEMO_CATALOGUE, DEMO_PARAMETER_META, DEMO_SYNONYMS, demoFlat } from './demo-catalogue.js';
import {
  CITIES,
  CITY_NAMES,
  type CityName,
  NAME_WORDS,
  NAMED_LABS,
  offeredBy,
  PROFILE_NAMES,
  PROFILES,
  type ProfileName,
  siteNameOf,
  termsFor,
} from './demo-labs.js';
import { assertNotProduction } from './env.js';

// `seed:demo` (MIGRATION_AND_SEED_STRATEGY.md section 3): fictitious data for local
// development and UAT. Every organisation, site and user it creates is marked "DEMO".
// No real lab, person or NABL record is used. The catalogue of tests (`demo-catalogue.ts`) is
// generic knowledge about tests, not NABL data.

export const DEMO_SITE_COUNT = 200;
/** All scope lines of all sites. The named labs have what they have; the others share the rest. */
export const DEMO_SCOPE_LINE_COUNT = 5000;
/** Number of lab owner accounts that hold no membership anywhere (for the claim story). */
export const DEMO_LAB_OWNER_COUNT = 3;
/** The first lab. Its presence tells the seed that the demo data is already there. */
const DEMO_MARKER = `DEMO-LAB-${NAMED_LABS[0]?.tag ?? '0001'}`;
/** Days of open slots at the bookable sites, from the day of the seed: about four months. */
const DEMO_SLOT_DAYS = 120;

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
  /** Tests (parameters of the catalogue) and the products they belong to. */
  tests: number;
  products: number;
  labOwners: number;
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

/** The address, name and map pin of a site in `city`, scattered a few kilometres around its centre. */
function placeIn(city: CityName, random: () => number): Omit<SiteSpec, 'name'> {
  const place = CITIES[city];
  const [first, last] = place.pincodes;
  return {
    city,
    district: place.district,
    stateCode: place.stateCode,
    pincode: String(first + Math.floor(random() * (last - first + 1))),
    line1: `DEMO Plot ${String(1 + Math.floor(random() * 98))}, DEMO Industrial Area`,
    lat: place.lat + (random() - 0.5) * 0.1,
    lon: place.lon + (random() - 0.5) * 0.1,
  };
}

function pickProfile(random: () => number): ProfileName {
  const draw = random();
  let sum = 0;
  for (const name of PROFILE_NAMES) {
    sum += PROFILES[name].weight;
    if (draw < sum) return name;
  }
  return 'building';
}

/**
 * Creates the demo data in the given transaction. Needs `seed:reference` first.
 * Does nothing if the demo data is already there (a database seeded by an older version of
 * this seed keeps its data: the seed never rewrites). Refuses to run in production.
 */
export async function seedDemo(tx: Tx, options: DemoSeedOptions = {}): Promise<DemoSeedResult> {
  assertNotProduction('seed:demo', options.env ?? process.env);
  if (await tx.organisation.findFirst({ where: { nablLabRef: DEMO_MARKER } })) {
    return {
      skipped: true,
      labSites: 0,
      scopeLines: 0,
      bookings: 0,
      tests: 0,
      products: 0,
      labOwners: 0,
    };
  }
  const now = options.now ?? new Date();
  const emailDomain = options.emailDomain ?? 'demo.labconnect.test';
  const random = generator(20_261_124);

  const reference = await loadReference(tx);
  const platform = await createPlatformTeam(tx, { tag: 'demo', emailDomain });
  const changeSetId = await createPublishedChangeSet(tx, platform, 'DEMO data');
  const catalogue = await createCatalogue(tx, reference, changeSetId, DEMO_CATALOGUE, demoFlat());
  const context = { reference, platform, catalogue, changeSetId };

  // ---- search synonyms (abbreviations), published with the same change set
  const synonymIds = DEMO_SYNONYMS.map(() => uuidv7());
  await tx.searchSynonym.createMany({
    data: DEMO_SYNONYMS.map((synonym, index) => ({
      id: synonymIds[index] ?? '',
      term: synonym.term,
      expandsTo: [...synonym.expandsTo],
    })),
  });
  await tx.searchSynonymVersion.createMany({
    data: DEMO_SYNONYMS.map((synonym, index) => ({
      id: uuidv7(),
      searchSynonymId: synonymIds[index] ?? '',
      versionNo: 1,
      snapshot: { term: synonym.term, expandsTo: [...synonym.expandsTo] },
      changeSetId,
      publishedAt: now,
    })),
  });

  // ---- the tests of every product, in catalogue order
  const byProduct = new Map<string, ParameterRef[]>();
  for (const parameter of catalogue.parameters) {
    const list = byProduct.get(parameter.productCode) ?? [];
    list.push(parameter);
    byProduct.set(parameter.productCode, list);
  }
  const productParameters = (productCode: string): ParameterRef[] => {
    const list = byProduct.get(productCode);
    if (!list) throw new Error(`Unknown product ${productCode}.`);
    return list;
  };

  const lab = (
    tag: string,
    name: string,
    onboarded: boolean,
    sites: SiteSpec[],
    lines: (siteIndex: number) => LineSpec[],
    extra: {
      makers?: number;
      checkers?: number;
      accreditationStatus?: 'SUSPENDED' | 'EXPIRED';
    } = {},
  ): Promise<LabFixture> =>
    createLab(tx, context, {
      tag,
      name,
      onboarded,
      sites,
      lines,
      slotDays: DEMO_SLOT_DAYS,
      emailDomain,
      now,
      ...extra,
    });

  // ---- the named labs: three onboarded (four bookable sites), four listed and unclaimed
  const onboarded: LabFixture[] = [];
  let namedLines = 0;
  for (const named of NAMED_LABS) {
    const linesOf = (siteIndex: number): LineSpec[] => {
      const site = named.sites[siteIndex];
      if (!site) throw new Error('unreachable: the site exists');
      const lines = site.products
        .flatMap(productParameters)
        .filter((parameter) => offeredBy(parameter.parameterCode, site.key))
        .map((parameter): LineSpec => {
          if (!named.onboarded) return { parameter };
          const terms = termsFor(site.key, parameter.parameterCode);
          return { parameter, pricePaise: terms.pricePaise, tatDays: terms.tatDays };
        });
      namedLines += lines.length;
      return lines;
    };
    const fixture = await lab(
      named.tag,
      named.name,
      named.onboarded,
      named.sites.map((site) => ({
        name: siteNameOf(named.name, site.city),
        ...placeIn(site.city, random),
      })),
      linesOf,
      named.onboarded ? { makers: named.makers, checkers: named.checkers } : {},
    );
    if (named.onboarded) onboarded.push(fixture);
  }
  let labSites = NAMED_LABS.reduce((sum, named) => sum + named.sites.length, 0);

  // ---- the other labs: listed and unclaimed, each of one kind and with a coherent set of tests.
  // Between them they hold the rest of the 5,000 scope lines. A few have an accreditation that
  // is not valid (and so are not found by search).
  const otherSites = DEMO_SITE_COUNT - labSites;
  const linesLeft = DEMO_SCOPE_LINE_COUNT - namedLines;
  const reserved = new Set(NAMED_LABS.map((entry) => entry.name.split(' ')[0] ?? ''));
  const words = NAME_WORDS.filter((word) => !reserved.has(word));
  const usedNames = new Set<string>();
  let firstTag = NAMED_LABS.length + 1;
  for (let index = 0; index < otherSites; index++, labSites++, firstTag++) {
    const tag = String(firstTag).padStart(4, '0');
    const profileName = pickProfile(random);
    const profile = PROFILES[profileName];
    const city = CITY_NAMES[Math.floor(random() * CITY_NAMES.length)] ?? 'Delhi';

    // the first word and kind of name that no lab has yet
    let name = '';
    for (let attempt = 0; name === ''; attempt++) {
      const word = words[(index + attempt) % words.length] ?? '';
      const kind = profile.kinds.find((candidate) => !usedNames.has(`${word} ${candidate}`));
      if (kind !== undefined) {
        usedNames.add(`${word} ${kind}`);
        name = `${word} ${kind} (DEMO)`;
      }
    }

    // The kind's products in the order people ask for them. Each lab takes most of the popular
    // ones and fewer of the rare ones, whole products at a time; it is filled up or cut at the
    // end (the least asked-for tests) to the number of lines it has to have.
    const products = profile.products.map((code) =>
      productParameters(code).filter((parameter) => offeredBy(parameter.parameterCode, null)),
    );
    const count = Math.floor(linesLeft / otherSites) + (index < linesLeft % otherSites ? 1 : 0);
    const available = products.reduce((sum, parameters) => sum + parameters.length, 0);
    if (count > available) throw new Error(`The ${profileName} profile has too few tests.`);
    const taken = products.map(
      (_, position) => random() < 0.95 - (0.55 * position) / Math.max(products.length - 1, 1),
    );
    let chosen = products.flatMap((parameters, position) => (taken[position] ? parameters : []));
    for (const [position, parameters] of products.entries()) {
      if (chosen.length >= count) break;
      if (!taken[position]) chosen = [...chosen, ...parameters];
    }
    const lines = chosen.slice(0, count).map((parameter): LineSpec => ({ parameter }));

    const status = firstTag % 40 === 0 ? 'SUSPENDED' : firstTag % 25 === 0 ? 'EXPIRED' : undefined;
    await lab(
      tag,
      name,
      false,
      [{ name: siteNameOf(name, city), ...placeIn(city, random) }],
      () => lines,
      status ? { accreditationStatus: status } : {},
    );
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

  // ---- people who will claim a lab on stage: active, and with no membership and no role anywhere
  for (let number = 1; number <= DEMO_LAB_OWNER_COUNT; number++) {
    await createUser(tx, {
      email: `lab.owner.demo${String(number)}@${emailDomain}`,
      fullName: `DEMO Lab Owner ${String(number)}`,
    });
  }

  // ---- one booking in every state, spread over the customers and the bookable sites
  const bookableSites = onboarded.flatMap((owner) => owner.sites.map((site) => ({ owner, site })));
  let bookings = 0;
  for (const [index, state] of BOOKING_STATES.entries()) {
    const target = bookableSites[index % bookableSites.length];
    const customer = customers[index % customers.length];
    if (!target || !customer) throw new Error('unreachable: demo labs and customers exist');
    const product = target.site.scopeLines[0]?.parameter.product ?? 'Sample';
    await bookingInState(tx, state, {
      reference,
      customer,
      lab: target.owner,
      site: target.site,
      lineCount: 1 + (index % 3),
      packageCount: 1 + (index % 2),
      slotId: target.site.slotIds[index % Math.max(target.site.slotIds.length, 1)] ?? null,
      bookingNo: `LC-DEMO-${String(index + 1).padStart(7, '0')}`,
      itemName: `${product} sample (DEMO)`,
      now,
    });
    bookings++;
  }

  return {
    skipped: false,
    labSites,
    scopeLines: DEMO_SCOPE_LINE_COUNT,
    bookings,
    tests: DEMO_PARAMETER_META.size,
    products: byProduct.size,
    labOwners: DEMO_LAB_OWNER_COUNT,
  };
}
