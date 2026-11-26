import type { components } from '@labconnect/api-contract';
import { describe, expect, it } from 'vitest';
import { toResultCard } from './result-model';

type LabSearchResult = components['schemas']['LabSearchResult'];

function result(
  overrides: Partial<LabSearchResult['labSite']> = {},
  extra: Partial<LabSearchResult> = {},
): LabSearchResult {
  return {
    labSite: {
      id: '0190d6a2-7c4e-7a1b-9c3d-0123456789ab',
      siteCode: 'LS-UP-0001',
      name: 'Example Testing Noida',
      city: 'Noida',
      stateCode: 'UP',
      pincode: '201301',
      location: { lat: 28.57, lng: 77.32 },
      listingStatus: 'BOOKABLE',
      rating: { average: 4.56, count: 38 },
      accreditations: [
        {
          certificateNo: 'TC-10482',
          accreditationBody: { code: 'NABL', name: 'NABL' },
          standard: { code: 'ISO_IEC_17025_TESTING', name: 'ISO/IEC 17025' },
          labCategory: 'TESTING',
          validFrom: '2026-01-01',
          validTo: '2028-08-14',
          status: 'VALID',
          statusAsOf: '2026-11-24',
          verificationUrl: null,
        },
      ],
      ...overrides,
    },
    distanceKm: 4.234,
    priceFrom: { amountPaise: 120_000, currency: 'INR' },
    minTatDays: 5,
    nextSlotAt: '2026-11-26T04:30:00Z',
    matchedLines: [
      {
        scopeLine: {
          id: '0190d6a2-7c4e-7a1b-9c3d-0123456789d1',
          certificateNo: 'TC-10482',
          discipline: { code: 'CHEM', name: 'Chemical' },
          group: null,
          product: null,
          parameter: { code: 'MFR', name: 'Melt flow rate' },
          method: { code: 'IS_2530', name: 'IS 2530 (Part 6)' },
          methodText: null,
          rangeText: null,
          siteType: 'PERMANENT',
          temporarilyUnavailable: false,
        },
        price: { amountPaise: 120_000, currency: 'INR' },
        tatDays: 5,
      },
    ],
    matchedLineCount: 1,
    ...extra,
  };
}

describe('search result card model (board B1)', () => {
  it('describes a bookable lab as B1 does', () => {
    expect(toResultCard(result())).toEqual({
      id: '0190d6a2-7c4e-7a1b-9c3d-0123456789ab',
      name: 'Example Testing Noida',
      href: '/labs/0190d6a2-7c4e-7a1b-9c3d-0123456789ab',
      state: 'bookable',
      certificateNo: 'TC-10482',
      meta: 'Noida, UP · 4.2 km · ★ 4.6 (38 ratings)',
      matched: [
        {
          id: '0190d6a2-7c4e-7a1b-9c3d-0123456789d1',
          name: 'Melt flow rate · IS 2530 (Part 6)',
          detail: '₹1,200.00 · 5 days',
        },
      ],
      matchedCount: 1,
      priceFrom: '₹1,200.00',
      tat: 'Report in 5 days',
      nextSlot: 'Next drop slot: Thu 26 Nov 2026',
      point: { lat: 28.57, lng: 77.32 },
    });
  });

  it('tells listed and calibration labs apart from bookable ones', () => {
    const listed = toResultCard(
      result(
        { listingStatus: 'LISTED' },
        { priceFrom: null, minTatDays: null, nextSlotAt: null, distanceKm: null },
      ),
    );
    expect(listed).toMatchObject({
      state: 'listed',
      priceFrom: null,
      tat: null,
      nextSlot: null,
      meta: 'Noida, UP · ★ 4.6 (38 ratings)',
    });
    const [accreditation] = result().labSite.accreditations;
    const calibration = toResultCard(
      result({
        listingStatus: 'LISTED',
        accreditations:
          accreditation === undefined ? [] : [{ ...accreditation, labCategory: 'CALIBRATION' }],
      }),
    );
    expect(calibration.state).toBe('calibration');
  });
});
