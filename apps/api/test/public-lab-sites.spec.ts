import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LabDirectoryService, type PublicSiteProfile } from '@labconnect/core';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.config.js';
import { AppModule } from '../src/app.module.js';
import { contractRequest } from './support/contract/index.js';

// I1-CUS-02: `GET /v1/public/lab-sites/{siteId}` over the HTTP stack, every exchange held to the
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

class StubDirectory {
  readonly asked: string[] = [];
  getPublicSite(siteId: string): Promise<PublicSiteProfile | null> {
    this.asked.push(siteId);
    return Promise.resolve(siteId === SITE ? PROFILE : null);
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
});
