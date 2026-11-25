import type { LabSearchDocument } from '../../src/index.js';

let counter = 0;
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A public search document for unit tests. Override what the test is about. */
export function searchDocument(overrides: Partial<LabSearchDocument> = {}): LabSearchDocument {
  counter += 1;
  return {
    scopeLineId: uuid(1000 + counter),
    labSiteId: uuid(1),
    siteCode: 'LS-DL-0001',
    siteName: 'Alpha Testing Delhi',
    city: 'Delhi',
    stateCode: 'DL',
    pincode: '110001',
    location: { lat: 28.61, lng: 77.21 },
    listingStatus: 'BOOKABLE',
    isBookable: true,
    labCategory: 'TESTING',
    accreditationStatus: 'VALID',
    accreditation: {
      certificateNo: 'TC-1',
      bodyCode: 'NABL',
      bodyName: 'NABL',
      standardCode: 'ISO_IEC_17025_TESTING',
      standardName: 'ISO/IEC 17025 testing',
      validFrom: '2026-01-01',
      validTo: '2027-12-31',
      statusAsOf: '2026-11-01',
      verificationUrlTemplate: 'https://nabl.example.test/verify?c={certificate_no}',
    },
    discipline: { code: 'MECH', name: 'Mechanical' },
    group: { code: 'METALS', name: 'Metals' },
    product: { code: 'TMT', name: 'TMT bar', aliases: ['rebar'] },
    parameter: { code: 'TENSILE', name: 'Tensile strength', aliases: ['UTS'] },
    method: { code: 'IS_1608', name: 'IS 1608', standardCode: 'IS 1608' },
    methodText: null,
    rangeText: '10-600 kN',
    siteType: 'PERMANENT',
    temporarilyUnavailable: false,
    pricePaise: 100_000n,
    tatDays: 5,
    ratingAvg: null,
    ratingCount: 0,
    nextSlotAt: '2026-11-26T04:30:00.000Z',
    projectedAt: '2026-11-25T10:00:00.000Z',
    ...overrides,
  };
}

export const siteUuid = uuid;
