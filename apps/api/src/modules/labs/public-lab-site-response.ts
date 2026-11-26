import type { components } from '@labconnect/api-contract';
import type { PublicSiteAccreditation, PublicSiteProfile } from '@labconnect/core';

type Schemas = components['schemas'];
export type PublicLabSite = Schemas['PublicLabSite'];
type PublicAccreditation = Schemas['PublicAccreditation'];

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
