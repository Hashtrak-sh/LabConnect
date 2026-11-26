import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  type GeoPoint,
  InMemorySearchIndex,
  type LabSearchDocument,
  LazySearchService,
  normaliseSearchQuery,
  type SearchRequest,
  SearchQueryError,
  type SearchResult,
  type Suggestion,
} from '@labconnect/core';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.config.js';
import { AppModule } from '../src/app.module.js';
import { PincodeLocator } from '../src/modules/search/pincode-locator.js';
import { contractRequest } from './support/contract/index.js';

// I1-CUS-01: `GET /v1/public/search/labs` over the HTTP stack, every exchange held to the contract
// by contractRequest(). The search service is replaced by the in-memory index (the executable
// statement of the query semantics, SEARCH.md section 4), so no database or cluster is needed;
// the Postgres and OpenSearch adapters have their own conformance suite in packages/core.

const AT = new Date('2026-11-25T10:00:00Z');
const NEAR = '0190d6a2-7c4e-7a1b-9c3d-0123456789ab';
const FAR = '0190d6a2-7c4e-7a1b-9c3d-0123456789ac';
const NOIDA: GeoPoint = { lat: 28.535, lng: 77.391 };

function document(overrides: Partial<LabSearchDocument> = {}): LabSearchDocument {
  return {
    scopeLineId: '0190d6a2-7c4e-7a1b-9c3d-0123456789d1',
    labSiteId: NEAR,
    siteCode: 'LS-UP-0001',
    siteName: 'Example Testing Noida',
    city: 'Noida',
    stateCode: 'UP',
    pincode: '201301',
    location: { lat: 28.57, lng: 77.32 },
    listingStatus: 'BOOKABLE',
    isBookable: true,
    labCategory: 'TESTING',
    accreditationStatus: 'VALID',
    accreditation: {
      certificateNo: 'TC 0001',
      bodyCode: 'NABL',
      bodyName: 'NABL',
      standardCode: 'ISO_IEC_17025_TESTING',
      standardName: 'ISO/IEC 17025 testing',
      validFrom: '2026-01-01',
      validTo: '2027-12-31',
      statusAsOf: '2026-11-01',
      verificationUrlTemplate: 'https://accreditation.example.test/verify?c={certificate_no}',
    },
    discipline: { code: 'MECH', name: 'Mechanical' },
    group: { code: 'METALS', name: 'Metals' },
    product: { code: 'TMT', name: 'TMT bar', aliases: [] },
    parameter: { code: 'TENSILE', name: 'Tensile strength', aliases: [] },
    method: { code: 'IS_1608', name: 'IS 1608', standardCode: 'IS 1608' },
    methodText: null,
    rangeText: '10-600 kN',
    siteType: 'PERMANENT',
    temporarilyUnavailable: false,
    pricePaise: 125_000n,
    tatDays: 5,
    ratingAvg: 4.5,
    ratingCount: 12,
    nextSlotAt: '2026-11-26T04:30:00.000Z',
    projectedAt: '2026-11-25T10:00:00.000Z',
    ...overrides,
  };
}

const DOCUMENTS: LabSearchDocument[] = [
  document(),
  document({
    scopeLineId: '0190d6a2-7c4e-7a1b-9c3d-0123456789d2',
    labSiteId: FAR,
    siteCode: 'LS-MH-0002',
    siteName: 'Example Testing Pune',
    city: 'Pune',
    stateCode: 'MH',
    pincode: '411001',
    location: { lat: 18.52, lng: 73.86 },
    pricePaise: 90_000n,
  }),
];

/** The search service the controller injects, answering from the in-memory index. */
class MemorySearchService {
  readonly requests: SearchRequest[] = [];
  constructor(private readonly index: InMemorySearchIndex) {}
  async search(request: SearchRequest): Promise<SearchResult> {
    this.requests.push(request);
    return { ...(await this.index.search(normaliseSearchQuery(request, AT))), backend: 'memory' };
  }
  readonly suggested: string[] = [];
  suggest(text: string): Promise<Suggestion[]> {
    this.suggested.push(text);
    if (text.trim() === '!!') return Promise.reject(new SearchQueryError('q must not be empty.'));
    return Promise.resolve([
      { kind: 'PARAMETER', label: 'Tensile strength', code: 'TENSILE', labSiteId: null },
      { kind: 'LAB_SITE', label: 'Example Testing Noida', code: null, labSiteId: NEAR },
    ]);
  }
  circuit(): 'closed' {
    return 'closed';
  }
}

/** Knows one pincode, so the resolution path can be tested before a dataset exists (OQ-153). */
class OnePincodeLocator extends PincodeLocator {
  locate(pincode: string): Promise<GeoPoint | null> {
    return Promise.resolve(pincode === '201310' ? NOIDA : null);
  }
}

async function appWith(
  service: MemorySearchService,
  locator?: PincodeLocator,
): Promise<INestApplication<Server>> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LazySearchService)
    .useValue(service);
  if (locator !== undefined) builder = builder.overrideProvider(PincodeLocator).useValue(locator);
  const app = (await builder.compile()).createNestApplication<INestApplication<Server>>();
  configureApp(app);
  await app.init();
  return app;
}

describe('GET /v1/public/search/labs', () => {
  let app: INestApplication<Server>;
  let service: MemorySearchService;

  beforeAll(async () => {
    const index = new InMemorySearchIndex();
    await index.upsertDocuments(DOCUMENTS);
    service = new MemorySearchService(index);
    app = await appWith(service);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.requests.length = 0;
  });

  it('finds sites by text with their matched lines, anonymously', async () => {
    const response = await contractRequest(app).get('/v1/public/search/labs?q=tensile');
    expect(response.status).toBe(200);
    const body = response.body as {
      data: { labSite: { id: string }; matchedLines: unknown[]; priceFrom: unknown }[];
      page: { limit: number };
    };
    expect(body.data.map((item) => item.labSite.id).sort()).toEqual([NEAR, FAR].sort());
    expect(body.data[0]?.matchedLines.length).toBeGreaterThan(0);
    expect(body.page.limit).toBe(25);
  });

  it('keeps only sites inside the radius and sorts by distance with a location', async () => {
    const response = await contractRequest(app).get(
      '/v1/public/search/labs?q=tensile&lat=28.535&lng=77.391&radiusKm=25',
    );
    expect(response.status).toBe(200);
    const body = response.body as { data: { labSite: { id: string }; distanceKm: number }[] };
    expect(body.data.map((item) => item.labSite.id)).toEqual([NEAR]);
    expect(body.data[0]?.distanceKm).toBeLessThan(25);
  });

  it('passes the filters through as typed values, price as paise in a bigint', async () => {
    const response = await contractRequest(app).get(
      '/v1/public/search/labs?q=tensile&priceMax=100000&tatMax=7&category=TESTING&limit=10',
    );
    expect(response.status).toBe(200);
    expect(service.requests[0]).toMatchObject({
      q: 'tensile',
      priceMax: 100_000n,
      tatMax: 7,
      category: 'TESTING',
      limit: 10,
    });
    const body = response.body as { data: { labSite: { id: string } }[]; page: { limit: number } };
    expect(body.data.map((item) => item.labSite.id)).toEqual([FAR]);
    expect(body.page.limit).toBe(10);
  });

  it('answers a search with no match with an empty page (the no-result state)', async () => {
    const response = await contractRequest(app).get('/v1/public/search/labs?q=chromatography');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: [], page: { nextCursor: null } });
  });

  it('refuses lat without lng (core rule) with 422', async () => {
    const response = await contractRequest(app).get('/v1/public/search/labs?lat=28.5');
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a pincode together with a point', async () => {
    const response = await contractRequest(app).get(
      '/v1/public/search/labs?pincode=201310&lat=28.5&lng=77.3',
    );
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'pincode', code: 'INVALID_VALUE' }],
    });
    expect(service.requests).toEqual([]);
  });

  it('answers every pincode as unknown until a dataset exists (OQ-153)', async () => {
    const response = await contractRequest(app).get('/v1/public/search/labs?pincode=201310');
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ errors: [{ path: 'pincode' }] });
    expect(service.requests).toEqual([]);
  });

  it('refuses parameters the contract does not define, such as sort (OQ-151)', async () => {
    const response = await contractRequest(app).get('/v1/public/search/labs?q=tensile&sort=price', {
      invalidRequest: 'sort is not a contract parameter and must give 422',
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ errors: [{ path: 'sort', code: 'UNKNOWN_FIELD' }] });
  });

  it('refuses a repeated parameter', async () => {
    const response = await contractRequest(app).get('/v1/public/search/labs?q=tensile&q=bend', {
      invalidRequest: 'a repeated q must give 422',
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ errors: [{ path: 'q' }] });
  });

  it('refuses values that are not numbers, and a limit out of range', async () => {
    const response = await contractRequest(app).get(
      '/v1/public/search/labs?lat=north&lng=77.3&priceMax=12.50&limit=500',
      { invalidRequest: 'malformed numbers must give 422' },
    );
    expect(response.status).toBe(422);
    const paths = (response.body as { errors: { path: string }[] }).errors.map((e) => e.path);
    expect(paths.sort()).toEqual(['lat', 'limit', 'priceMax']);
    expect(service.requests).toEqual([]);
  });
});

describe('GET /v1/public/search/labs with a pincode locator', () => {
  let app: INestApplication<Server>;
  let service: MemorySearchService;

  beforeAll(async () => {
    const index = new InMemorySearchIndex();
    await index.upsertDocuments(DOCUMENTS);
    service = new MemorySearchService(index);
    app = await appWith(service, new OnePincodeLocator());
  });

  afterAll(async () => {
    await app.close();
  });

  it('searches around the pincode centroid (AC-DIS-01 once the dataset exists)', async () => {
    const response = await contractRequest(app).get(
      '/v1/public/search/labs?q=tensile&pincode=201310&radiusKm=25',
    );
    expect(response.status).toBe(200);
    expect(service.requests[0]).toMatchObject({ lat: NOIDA.lat, lng: NOIDA.lng, radiusKm: 25 });
    expect(service.requests[0]).not.toHaveProperty('pincode');
    const body = response.body as { data: { labSite: { id: string } }[] };
    expect(body.data.map((item) => item.labSite.id)).toEqual([NEAR]);
  });

  it('still answers an unknown pincode with 422', async () => {
    const response = await contractRequest(app).get('/v1/public/search/labs?pincode=999999');
    expect(response.status).toBe(422);
  });
});

describe('GET /v1/public/search/suggest', () => {
  let app: INestApplication<Server>;
  let service: MemorySearchService;

  beforeAll(async () => {
    service = new MemorySearchService(new InMemorySearchIndex());
    app = await appWith(service);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns suggestions anonymously, in the contract shape', async () => {
    const response = await contractRequest(app).get('/v1/public/search/suggest?q=tens');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      suggestions: [
        { kind: 'PARAMETER', label: 'Tensile strength', code: 'TENSILE', labSiteId: null },
        { kind: 'LAB_SITE', label: 'Example Testing Noida', code: null, labSiteId: NEAR },
      ],
    });
    expect(service.suggested).toEqual(['tens']);
  });

  it('requires q, refuses other parameters, and maps a refused text to 422', async () => {
    const missing = await contractRequest(app).get('/v1/public/search/suggest', {
      invalidRequest: 'q is required and must give 422',
    });
    expect(missing.status).toBe(422);
    expect(missing.body).toMatchObject({ errors: [{ path: 'q', code: 'REQUIRED' }] });
    const extra = await contractRequest(app).get('/v1/public/search/suggest?q=te&limit=5', {
      invalidRequest: 'limit is not a parameter of suggestSearch and must give 422',
    });
    expect(extra.status).toBe(422);
    const refused = await contractRequest(app).get('/v1/public/search/suggest?q=!!');
    expect(refused.status).toBe(422);
  });
});
