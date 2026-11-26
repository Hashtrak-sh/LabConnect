import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  LabDirectoryQueryError,
  LabDirectoryService,
  type PublicPageQuery,
  type PublicPricePage,
  type PublicScopePage,
  type PublicScopeQuery,
  type PublicSiteProfile,
} from '@labconnect/core';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.config.js';
import { AppModule } from '../src/app.module.js';
import { contractRequest } from './support/contract/index.js';

// I1-CUS-02 and I1-CUS-03: `GET /v1/public/lab-sites/{siteId}` and `.../scope` over the HTTP stack, every exchange held to the
// contract by contractRequest(). The directory is a stub here; its SQL is tested on the real
// schema in packages/core/test/db/labs-public-directory.test.ts.

const SITE = '0190d6a2-7c4e-7a1b-9c3d-0123456789ab';
const MISSING = '0190d6a2-7c4e-7a1b-9c3d-0123456789ff';

const PROFILE: PublicSiteProfile = {
  labSiteId: SITE,
  siteCode: 'LS-UP-0001',
  name: 'Example Testing Noida',
  address: {
    line1: 'Plot 1, Example Industrial Area',
    line2: null,
    city: 'Noida',
    district: 'Gautam Buddh Nagar',
    stateCode: 'UP',
    pincode: '201301',
  },
  location: { lat: 28.57, lng: 77.32 },
  listingStatus: 'BOOKABLE',
  ratingAverage: 4.5,
  ratingCount: 12,
  accreditations: [
    {
      certificateNo: 'TC 0001',
      bodyCode: 'NABL',
      bodyName: 'NABL',
      standardCode: 'ISO_IEC_17025_TESTING',
      standardName: 'ISO/IEC 17025 testing',
      labCategory: 'TESTING',
      validFrom: '2026-01-01',
      validTo: '2027-12-31',
      status: 'VALID',
      statusAsOf: '2026-11-01',
      verificationUrl: 'https://accreditation.example.test/verify?c=TC%200001',
    },
  ],
  receivingHours: [
    { weekday: 1, opensAt: '09:30', closesAt: '13:00', cutoffAt: null },
    { weekday: 1, opensAt: '14:00', closesAt: '17:30', cutoffAt: '17:00' },
  ],
};

const SCOPE_PAGE: PublicScopePage = {
  lines: [
    {
      scopeLineId: '0190d6a2-7c4e-7a1b-9c3d-0123456789d1',
      certificateNo: 'TC 0001',
      discipline: { code: 'MECH', name: 'Mechanical' },
      group: { code: 'METALS', name: 'Metals' },
      product: { code: 'TMT', name: 'TMT bar' },
      parameter: { code: 'TENSILE', name: 'Tensile strength' },
      method: { code: 'IS_1608', name: 'IS 1608' },
      methodText: null,
      rangeText: '10-600 kN',
      siteType: 'PERMANENT',
      temporarilyUnavailable: false,
    },
  ],
  nextCursor: 'sc1.next',
};

const PRICE_PAGE: PublicPricePage = {
  priceList: { versionNo: 3, effectiveFrom: new Date('2026-11-01T00:00:00Z') },
  items: [
    {
      scopeLine: SCOPE_PAGE.lines[0] as PublicScopePage['lines'][number],
      pricePaise: 125_000n,
      samplePrepPaise: 0n,
      gstRateBp: 1800,
      sampleQty: 3,
      sampleUnit: { code: 'PIECE', name: 'Piece' },
      packagingInstructions: 'Bundle and tag each bar.',
      tatDays: 5,
      isAvailable: true,
    },
  ],
  nextCursor: null,
};

class StubDirectory {
  readonly asked: string[] = [];
  readonly scopeQueries: PublicScopeQuery[] = [];
  readonly pageQueries: PublicPageQuery[] = [];
  getPublicSite(siteId: string): Promise<PublicSiteProfile | null> {
    this.asked.push(siteId);
    return Promise.resolve(siteId === SITE ? PROFILE : null);
  }
  listPublicPrices(siteId: string, query: PublicPageQuery): Promise<PublicPricePage | null> {
    this.asked.push(siteId);
    this.pageQueries.push(query);
    return Promise.resolve(siteId === SITE ? PRICE_PAGE : null);
  }
  listPublicScope(siteId: string, query: PublicScopeQuery): Promise<PublicScopePage | null> {
    this.asked.push(siteId);
    this.scopeQueries.push(query);
    if (query.cursor === 'bad')
      return Promise.reject(new LabDirectoryQueryError('The cursor is not valid.'));
    return Promise.resolve(siteId === SITE ? SCOPE_PAGE : null);
  }
}

describe('GET /v1/public/lab-sites/{siteId}', () => {
  let app: INestApplication<Server>;
  const directory = new StubDirectory();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LabDirectoryService)
      .useValue(directory)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    directory.asked.length = 0;
    directory.scopeQueries.length = 0;
    directory.pageQueries.length = 0;
  });

  it('returns the public profile, anonymously', async () => {
    const response = await contractRequest(app).get(`/v1/public/lab-sites/${SITE}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: SITE,
      listingStatus: 'BOOKABLE',
      rating: { average: 4.5, count: 12 },
      accreditations: [
        {
          certificateNo: 'TC 0001',
          accreditationBody: { code: 'NABL', name: 'NABL' },
          standard: { code: 'ISO_IEC_17025_TESTING' },
        },
      ],
      receivingHours: [{ opensAt: '09:30' }, { cutoffAt: '17:00' }],
    });
  });

  it('answers a site that is missing or not public with 404', async () => {
    const response = await contractRequest(app).get(`/v1/public/lab-sites/${MISSING}`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses an id that is not a UUID with 422, before asking the directory', async () => {
    const response = await contractRequest(app).get('/v1/public/lab-sites/LS-UP-0001', {
      invalidRequest: 'a site code instead of a UUID must give 422',
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'siteId' }],
    });
    expect(directory.asked).toEqual([]);
  });

  // ---------------------------------------------------------------- scope (I1-CUS-03)

  it('lists the scope lines with a page cursor', async () => {
    const response = await contractRequest(app).get(`/v1/public/lab-sites/${SITE}/scope`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [{ id: SCOPE_PAGE.lines[0]?.scopeLineId, parameter: { code: 'TENSILE' } }],
      page: { nextCursor: 'sc1.next', limit: 25 },
    });
    expect(directory.scopeQueries).toEqual([{ text: null, cursor: null, limit: 25 }]);
  });

  it('cleans the search text and passes cursor and limit through', async () => {
    const response = await contractRequest(app).get(
      `/v1/public/lab-sites/${SITE}/scope?q=%20Tensile%20%20strength%20&cursor=sc1.x&limit=10`,
    );
    expect(response.status).toBe(200);
    expect(directory.scopeQueries).toEqual([
      { text: 'Tensile strength', cursor: 'sc1.x', limit: 10 },
    ]);
    expect(response.body).toMatchObject({ page: { limit: 10 } });
  });

  it('answers the scope of a site that is not public with 404', async () => {
    const response = await contractRequest(app).get(`/v1/public/lab-sites/${MISSING}/scope`);
    expect(response.status).toBe(404);
  });

  it('answers a cursor the directory refuses with 422', async () => {
    const response = await contractRequest(app).get(
      `/v1/public/lab-sites/${SITE}/scope?cursor=bad`,
    );
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses unknown or repeated parameters and a limit out of range, before asking', async () => {
    const response = await contractRequest(app).get(
      `/v1/public/lab-sites/${SITE}/scope?sort=name&q=a&q=b&limit=0`,
      { invalidRequest: 'unknown, repeated and out-of-range parameters must give 422' },
    );
    expect(response.status).toBe(422);
    const paths = (response.body as { errors: { path: string }[] }).errors.map((e) => e.path);
    expect(paths.sort()).toEqual(['limit', 'q', 'sort']);
    expect(directory.asked).toEqual([]);
  });

  // ---------------------------------------------------------------- prices (I1-CUS-04)

  it('returns the price list with money in paise', async () => {
    const response = await contractRequest(app).get(`/v1/public/lab-sites/${SITE}/prices?limit=5`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      priceList: { versionNo: 3, effectiveFrom: '2026-11-01T00:00:00.000Z' },
      data: [
        {
          price: { amountPaise: 125_000, currency: 'INR' },
          samplePrep: { amountPaise: 0, currency: 'INR' },
          gstRateBp: 1800,
          sampleUnit: { code: 'PIECE' },
          isAvailable: true,
        },
      ],
      page: { nextCursor: null, limit: 5 },
    });
    expect(directory.pageQueries).toEqual([{ cursor: null, limit: 5 }]);
  });

  it('answers a site that is not bookable with 404', async () => {
    const response = await contractRequest(app).get(`/v1/public/lab-sites/${MISSING}/prices`);
    expect(response.status).toBe(404);
  });

  it('refuses a search text on the price list (not a contract parameter)', async () => {
    const response = await contractRequest(app).get(`/v1/public/lab-sites/${SITE}/prices?q=x`, {
      invalidRequest: 'q is not a parameter of getPublicPriceList and must give 422',
    });
    expect(response.status).toBe(422);
    expect(directory.asked).toEqual([]);
  });
});
