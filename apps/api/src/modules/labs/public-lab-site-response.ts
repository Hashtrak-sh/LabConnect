import type { components } from '@labconnect/api-contract';
import { CURRENCY, paiseToJson } from '@labconnect/shared';
import type {
  PublicPricePage,
  PublicScopeLineItem,
  PublicScopePage,
  PublicSiteAccreditation,
  PublicSiteProfile,
} from '@labconnect/core';

type Schemas = components['schemas'];
export type PublicLabSite = Schemas['PublicLabSite'];
type PublicAccreditation = Schemas['PublicAccreditation'];
export type PublicScopeLineList = Schemas['PublicScopeLineList'];
export type PublicPriceList = Schemas['PublicPriceList'];
type Money = Schemas['Money'];
type PublicScopeLine = Schemas['PublicScopeLine'];
type ScopeSiteType = PublicScopeLine['siteType'];

function accreditation(source: PublicSiteAccreditation): PublicAccreditation {
  return {
    certificateNo: source.certificateNo,
    accreditationBody: { code: source.bodyCode, name: source.bodyName },
    standard: { code: source.standardCode, name: source.standardName },
    labCategory: source.labCategory,
    validFrom: source.validFrom,
    validTo: source.validTo,
    status: source.status,
    statusAsOf: source.statusAsOf,
    verificationUrl: source.verificationUrl,
  };
}

/**
 * The directory's profile as the `getPublicLabSite` response (`PublicLabSite`). The profile type
 * carries only public fields, so this is a rename: nothing private can be dropped here because
 * the service never read it.
 */
export function toPublicLabSite(profile: PublicSiteProfile): PublicLabSite {
  return {
    id: profile.labSiteId,
    siteCode: profile.siteCode,
    name: profile.name,
    address: profile.address,
    location: profile.location,
    listingStatus: profile.listingStatus,
    rating: { average: profile.ratingAverage, count: profile.ratingCount },
    accreditations: profile.accreditations.map(accreditation),
    receivingHours: profile.receivingHours,
  };
}

function scopeLine(line: PublicScopeLineItem): PublicScopeLine {
  return {
    id: line.scopeLineId,
    certificateNo: line.certificateNo,
    discipline: line.discipline,
    group: line.group,
    product: line.product,
    parameter: line.parameter,
    method: line.method,
    methodText: line.methodText,
    rangeText: line.rangeText,
    // The column is the `scope_site_type` enum, which the contract mirrors (test/enums.test.ts).
    siteType: line.siteType as ScopeSiteType,
    temporarilyUnavailable: line.temporarilyUnavailable,
  };
}

/** The directory's scope page as the `listPublicScopeLines` response. `limit` is the request's. */
export function toPublicScopeLineList(page: PublicScopePage, limit: number): PublicScopeLineList {
  return { data: page.lines.map(scopeLine), page: { nextCursor: page.nextCursor, limit } };
}

const money = (paise: bigint): Money => ({ amountPaise: paiseToJson(paise), currency: CURRENCY });

/** The directory's price page as the `getPublicPriceList` response. `limit` is the request's. */
export function toPublicPriceList(page: PublicPricePage, limit: number): PublicPriceList {
  return {
    priceList: {
      versionNo: page.priceList.versionNo,
      effectiveFrom: page.priceList.effectiveFrom.toISOString(),
    },
    data: page.items.map((item) => ({
      scopeLine: scopeLine(item.scopeLine),
      price: money(item.pricePaise),
      samplePrep: money(item.samplePrepPaise),
      gstRateBp: item.gstRateBp,
      sampleQty: item.sampleQty,
      sampleUnit: item.sampleUnit,
      packagingInstructions: item.packagingInstructions,
      tatDays: item.tatDays,
      isAvailable: item.isAvailable,
    })),
    page: { nextCursor: page.nextCursor, limit },
  };
}
