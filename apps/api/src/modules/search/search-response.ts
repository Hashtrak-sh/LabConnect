import type { components } from '@labconnect/api-contract';
import type {
  MatchedLine,
  SearchResult,
  SiteAccreditation,
  SiteSearchResult,
} from '@labconnect/core';

type Schemas = components['schemas'];
export type LabSearchResultList = Schemas['LabSearchResultList'];
type LabSearchResult = Schemas['LabSearchResult'];
type LabSearchMatchedLine = Schemas['LabSearchMatchedLine'];
type PublicAccreditation = Schemas['PublicAccreditation'];
type Money = Schemas['Money'];

/** A JSON integer. Paise above 2^53 would lose digits, so they are refused, not rounded. */
export function paiseToMoney(paise: bigint): Money {
  const amountPaise = Number(paise);
  if (!Number.isSafeInteger(amountPaise)) {
    throw new RangeError('A price is too large to send as a JSON number.');
  }
  return { amountPaise, currency: 'INR' };
}

/**
 * The accreditation body's own page for the certificate, from `verification_url_template`. The
 * template syntax is not documented (OQ-159): `{certificate_no}` or `{certificateNo}` is replaced
 * by the URL-encoded certificate number. A body without a template, or a template that is not
 * a URL once filled in, gives `null`.
 */
export function verificationUrl(template: string | null, certificateNo: string): string | null {
  if (template === null) return null;
  const filled = template.replaceAll(/\{certificate_?[nN]o\}/g, encodeURIComponent(certificateNo));
  try {
    return new URL(filled).toString();
  } catch {
    return null;
  }
}

function accreditation(source: SiteAccreditation): PublicAccreditation {
  return {
    certificateNo: source.certificateNo,
    accreditationBody: { code: source.bodyCode, name: source.bodyName },
    standard: { code: source.standardCode, name: source.standardName },
    labCategory: source.labCategory,
    validFrom: source.validFrom,
    validTo: source.validTo,
    status: source.status,
    statusAsOf: source.statusAsOf,
    verificationUrl: verificationUrl(source.verificationUrlTemplate, source.certificateNo),
  };
}

function matchedLine(line: MatchedLine): LabSearchMatchedLine {
  return {
    scopeLine: {
      id: line.scopeLineId,
      certificateNo: line.certificateNo,
      discipline: line.discipline,
      group: line.group,
      product: line.product,
      parameter: line.parameter,
      method: line.method,
      methodText: line.methodText,
      rangeText: line.rangeText,
      siteType: line.siteType,
      temporarilyUnavailable: line.temporarilyUnavailable,
    },
    price: line.pricePaise === null ? null : paiseToMoney(line.pricePaise),
    tatDays: line.tatDays,
  };
}

function result(item: SiteSearchResult): LabSearchResult {
  const { site } = item;
  return {
    labSite: {
      id: site.labSiteId,
      siteCode: site.siteCode,
      name: site.name,
      city: site.city,
      stateCode: site.stateCode,
      pincode: site.pincode,
      location: site.location,
      listingStatus: site.listingStatus,
      rating: { average: site.ratingAverage, count: site.ratingCount },
      accreditations: site.accreditations.map(accreditation),
    },
    distanceKm: item.distanceKm,
    priceFrom: item.priceFromPaise === null ? null : paiseToMoney(item.priceFromPaise),
    minTatDays: item.minTatDays,
    nextSlotAt: item.nextSlotAt,
    matchedLines: item.matchedLines.map(matchedLine),
    matchedLineCount: item.matchedLineCount,
  };
}

/**
 * The service result as the `searchLabs` response (`LabSearchResultList`). The result type of
 * `SearchService` carries only fields the contract has, so this is a rename and a conversion of
 * money and ratings, and nothing is dropped here that could still be private (the service
 * never had it). The later controller calls `search` and returns this. `limit` is the page size
 * the request was made with.
 */
export function toLabSearchResultList(page: SearchResult, limit: number): LabSearchResultList {
  return {
    data: page.items.map(result),
    page: { nextCursor: page.nextCursor, limit },
  };
}
