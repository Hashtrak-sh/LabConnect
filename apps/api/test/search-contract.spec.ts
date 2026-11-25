import {
  deniedFieldPaths,
  InMemorySearchIndex,
  type LabSearchDocument,
  normaliseSearchQuery,
  type SearchResult,
} from '@labconnect/core';
import { describe, expect, it } from 'vitest';
import {
  paiseToMoney,
  toLabSearchResultList,
  verificationUrl,
} from '../src/modules/search/search-response.js';
import { type ExchangeResponse, loadContract, validateResponse } from './support/contract/index.js';

// The mapper from the search service's result to the `searchLabs` response, held to the contract's
// own schema by the harness validator (the later controller then only calls it). The compile-time
// check is the declared return type, `LabSearchResultList` from the generated types.

const contract = loadContract();
const operation = contract.byOperationId('searchLabs');
if (!operation) throw new Error('searchLabs is not in the contract');

const AT = new Date('2026-11-25T10:00:00Z');
const SITE_A = '0190d6a2-7c4e-7a1b-9c3d-0123456789ab';
const SITE_B = '0190d6a2-7c4e-7a1b-9c3d-0123456789ac';

function document(overrides: Partial<LabSearchDocument> = {}): LabSearchDocument {
  return {
    scopeLineId: '0190d6a2-7c4e-7a1b-9c3d-0123456789d1',
    labSiteId: SITE_A,
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
      certificateNo: 'TC 1/2',
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

async function searched(
  documents: LabSearchDocument[],
  request: Parameters<typeof normaliseSearchQuery>[0],
): Promise<SearchResult> {
  const index = new InMemorySearchIndex();
  await index.upsertDocuments(documents);
  return { ...(await index.search(normaliseSearchQuery(request, AT))), backend: 'memory' };
}

const asResponse = (body: unknown): ExchangeResponse => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body,
  text: JSON.stringify(body),
});

const violations = (body: unknown): string[] =>
  validateResponse(contract, operation, asResponse(body)).map(
    (violation) => `${violation.subject} ${violation.pointer} ${violation.reason}`,
  );

describe('toLabSearchResultList', () => {
  it('fits the searchLabs response schema, for a bookable site with matched lines', async () => {
    const page = await searched([document()], { q: 'tensile', lat: 28.6, lng: 77.2, limit: 10 });
    const body = toLabSearchResultList(page, 10);
    expect(violations(body)).toEqual([]);
    const [item] = body.data;
    expect(item?.priceFrom).toEqual({ amountPaise: 125_000, currency: 'INR' });
    expect(item?.minTatDays).toBe(5);
    expect(item?.matchedLines[0]?.scopeLine.id).toBe('0190d6a2-7c4e-7a1b-9c3d-0123456789d1');
    expect(item?.matchedLines[0]?.price?.amountPaise).toBe(125_000);
    expect(item?.labSite.rating).toEqual({ average: 4.5, count: 12 });
    expect(item?.labSite.accreditations[0]?.verificationUrl).toBe(
      'https://nabl.example.test/verify?c=TC%201%2F2',
    );
    expect(item?.distanceKm).toBeGreaterThanOrEqual(0);
    expect(body.page).toEqual({ nextCursor: null, limit: 10 });
  });

  it('fits the schema for a listed site with no price, no slot, no pin, no rating and a name-only match', async () => {
    const doc = document({
      listingStatus: 'LISTED',
      isBookable: false,
      pricePaise: null,
      tatDays: null,
      nextSlotAt: null,
      location: null,
      ratingAvg: null,
      ratingCount: 0,
      group: null,
      product: null,
      method: null,
      rangeText: null,
      methodText: 'in-house',
      accreditation: { ...document().accreditation, verificationUrlTemplate: null },
    });
    const body = toLabSearchResultList(await searched([doc], { q: 'alpha' }), 25);
    expect(violations(body)).toEqual([]);
    const [item] = body.data;
    expect(item).toMatchObject({
      distanceKm: null,
      priceFrom: null,
      minTatDays: null,
      nextSlotAt: null,
      matchedLines: [],
      matchedLineCount: 0,
    });
    expect(item?.labSite.location).toBeNull();
    expect(item?.labSite.rating.average).toBeNull();
    expect(item?.labSite.accreditations[0]?.verificationUrl).toBeNull();
  });

  it('fits the schema for an empty page and for a page with a cursor', async () => {
    expect(violations(toLabSearchResultList(await searched([], {}), 25))).toEqual([]);
    const docs = [document(), document({ labSiteId: SITE_B, scopeLineId: SITE_B })];
    const page = await searched(docs, { limit: 1 });
    const body = toLabSearchResultList(page, 1);
    expect(body.page.nextCursor).toMatch(/^mem1\./);
    expect(violations(body)).toEqual([]);
  });

  it('has no field of the public boundary deny-list, and nothing the contract does not declare', async () => {
    const page = await searched([document()], { q: 'tensile' });
    const body = toLabSearchResultList(page, 25);
    expect(deniedFieldPaths(body)).toEqual([]);
    // an extra field is a violation (additionalProperties: false), so the check above has teeth
    const leaky = structuredClone(body) as unknown as { data: Record<string, unknown>[] };
    leaky.data[0] = { ...leaky.data[0], labOrgId: 'x' };
    expect(violations(leaky).length).toBeGreaterThan(0);
    expect(deniedFieldPaths(leaky)).toEqual(['data[0].labOrgId']);
  });

  it('turns bigint paise into a JSON integer and refuses one that would lose digits', () => {
    expect(paiseToMoney(2_50_000n)).toEqual({ amountPaise: 250_000, currency: 'INR' });
    expect(() => paiseToMoney(2n ** 60n)).toThrow(RangeError);
    // the JSON of a response never carries a bigint (JSON.stringify would throw)
    expect(() => JSON.stringify(paiseToMoney(1n))).not.toThrow();
  });

  it('builds the verification link from the body template', () => {
    expect(verificationUrl(null, 'X')).toBeNull();
    expect(verificationUrl('https://v.example.test/{certificateNo}', 'A B')).toBe(
      'https://v.example.test/A%20B',
    );
    expect(verificationUrl('not a url {certificate_no}', 'A')).toBeNull();
    expect(verificationUrl('https://v.example.test/lookup', 'A')).toBe(
      'https://v.example.test/lookup',
    );
  });
});
