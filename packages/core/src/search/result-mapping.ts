import type { LabSearchDocument, MatchedLine, SiteAccreditation, SiteSummary } from './model.js';

/** The line of a document, as a result shows it. */
export function documentToMatchedLine(doc: LabSearchDocument): MatchedLine {
  return {
    scopeLineId: doc.scopeLineId,
    certificateNo: doc.accreditation.certificateNo,
    discipline: { code: doc.discipline.code, name: doc.discipline.name },
    group: doc.group === null ? null : { code: doc.group.code, name: doc.group.name },
    product: doc.product === null ? null : { code: doc.product.code, name: doc.product.name },
    parameter: { code: doc.parameter.code, name: doc.parameter.name },
    method: doc.method === null ? null : { code: doc.method.code, name: doc.method.name },
    methodText: doc.methodText,
    rangeText: doc.rangeText,
    siteType: doc.siteType,
    temporarilyUnavailable: doc.temporarilyUnavailable,
    pricePaise: doc.pricePaise,
    tatDays: doc.tatDays,
  };
}

/** The accreditation of a document, as a result shows it. */
export function documentToAccreditation(doc: LabSearchDocument): SiteAccreditation {
  const a = doc.accreditation;
  return {
    certificateNo: a.certificateNo,
    bodyCode: a.bodyCode,
    bodyName: a.bodyName,
    standardCode: a.standardCode,
    standardName: a.standardName,
    labCategory: doc.labCategory,
    validFrom: a.validFrom,
    validTo: a.validTo,
    status: 'VALID',
    statusAsOf: a.statusAsOf,
    verificationUrlTemplate: a.verificationUrlTemplate,
  };
}

/** Site-level fields of a document (identical on every document of the site). */
export function documentToSite(
  doc: LabSearchDocument,
  accreditations: SiteAccreditation[],
): SiteSummary {
  return {
    labSiteId: doc.labSiteId,
    siteCode: doc.siteCode,
    name: doc.siteName,
    city: doc.city,
    stateCode: doc.stateCode,
    pincode: doc.pincode,
    location: doc.location,
    listingStatus: doc.listingStatus,
    ratingAverage: doc.ratingAvg,
    ratingCount: doc.ratingCount,
    accreditations,
  };
}

export const accreditationKey = (a: { bodyCode: string; certificateNo: string }): string =>
  `${a.bodyCode}\u0000${a.certificateNo}`;

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (sphere). PostGIS measures on the spheroid: within about 0.5 %. */
export function haversineMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
