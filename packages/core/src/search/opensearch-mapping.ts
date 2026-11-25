import type {
  AliasedCodeName,
  LabSearchDocument,
  PublicLabCategory,
  PublicListingStatus,
  ScopeSiteType,
} from './model.js';

/**
 * Index settings and mappings (SEARCH.md section 1). `dynamic: strict`: a field that is not
 * declared here cannot be indexed, so a new column cannot reach the index by accident (the
 * public-boundary rule of TENANT_ISOLATION.md section 4).
 *
 * Analysers: standard tokenizer, lower-case and ASCII folding (`lc_text`); an edge n-gram
 * analyser for typeahead (`lc_edge`, searched with `lc_text`). Synonyms are not an index-time
 * filter: the service expands them in the query, the same way for both backends (OQ-157), so
 * a synonym change needs no index rebuild. Typo tolerance is `fuzziness: AUTO` in the query.
 */
export const INDEX_SETTINGS = {
  number_of_shards: 1,
  analysis: {
    filter: {
      lc_edge_ngram: { type: 'edge_ngram', min_gram: 2, max_gram: 15 },
    },
    analyzer: {
      lc_text: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
      lc_edge: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding', 'lc_edge_ngram'],
      },
    },
  },
} as const;

const text = {
  type: 'text',
  analyzer: 'lc_text',
  fields: { edge: { type: 'text', analyzer: 'lc_edge', search_analyzer: 'lc_text' } },
} as const;
const keyword = { type: 'keyword' } as const;
const codeName = { properties: { code: keyword, name: text } } as const;
const aliased = { properties: { code: keyword, name: text, aliases: text } } as const;

export const INDEX_MAPPINGS = {
  dynamic: 'strict',
  properties: {
    scope_line_id: keyword,
    lab_site_id: keyword,
    site_code: { type: 'text', analyzer: 'lc_text', fields: { raw: keyword } },
    site_name: text,
    city: keyword,
    state_code: keyword,
    pincode: keyword,
    location: { type: 'geo_point' },
    listing_status: keyword,
    is_bookable: { type: 'boolean' },
    lab_category: keyword,
    accreditation_status: keyword,
    accreditation: {
      properties: {
        certificate_no: keyword,
        body_code: keyword,
        body_name: { type: 'keyword', index: false },
        standard_code: keyword,
        standard_name: { type: 'keyword', index: false },
        valid_from: { type: 'date', format: 'strict_date' },
        valid_to: { type: 'date', format: 'strict_date' },
        status_as_of: { type: 'date', format: 'strict_date' },
        verification_url_template: { type: 'keyword', index: false },
      },
    },
    discipline: codeName,
    group: codeName,
    product: aliased,
    parameter: aliased,
    method: {
      properties: {
        code: keyword,
        name: text,
        standard_code: { type: 'text', analyzer: 'lc_text', fields: { raw: keyword } },
      },
    },
    method_text: { type: 'text', analyzer: 'lc_text' },
    range_text: { type: 'keyword', index: false },
    site_type: keyword,
    temporarily_unavailable: { type: 'boolean' },
    price_paise: { type: 'long' },
    tat_days: { type: 'integer' },
    rating_avg: { type: 'float' },
    rating_count: { type: 'integer' },
    next_slot_at: { type: 'date' },
    projected_at: { type: 'date' },
  },
} as const;

/** The JSON stored in the index: snake_case as in SEARCH.md, money as a JSON integer. */
export interface IndexedSource {
  scope_line_id: string;
  lab_site_id: string;
  site_code: string;
  site_name: string;
  city: string;
  state_code: string;
  pincode: string;
  location: { lat: number; lon: number } | null;
  listing_status: PublicListingStatus;
  is_bookable: boolean;
  lab_category: PublicLabCategory;
  accreditation_status: 'VALID';
  accreditation: {
    certificate_no: string;
    body_code: string;
    body_name: string;
    standard_code: string;
    standard_name: string;
    valid_from: string;
    valid_to: string;
    status_as_of: string;
    verification_url_template: string | null;
  };
  discipline: { code: string; name: string };
  group: { code: string; name: string } | null;
  product: { code: string; name: string; aliases: string[] } | null;
  parameter: { code: string; name: string; aliases: string[] };
  method: { code: string; name: string; standard_code: string | null } | null;
  method_text: string | null;
  range_text: string | null;
  site_type: ScopeSiteType;
  temporarily_unavailable: boolean;
  price_paise: number | null;
  tat_days: number | null;
  rating_avg: number | null;
  rating_count: number;
  next_slot_at: string | null;
  projected_at: string;
}

function moneyAsNumber(value: bigint | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError('A price is too large to index as a number.');
  }
  return number;
}

export function toSource(doc: LabSearchDocument): IndexedSource {
  return {
    scope_line_id: doc.scopeLineId,
    lab_site_id: doc.labSiteId,
    site_code: doc.siteCode,
    site_name: doc.siteName,
    city: doc.city,
    state_code: doc.stateCode,
    pincode: doc.pincode,
    location: doc.location === null ? null : { lat: doc.location.lat, lon: doc.location.lng },
    listing_status: doc.listingStatus,
    is_bookable: doc.isBookable,
    lab_category: doc.labCategory,
    accreditation_status: doc.accreditationStatus,
    accreditation: {
      certificate_no: doc.accreditation.certificateNo,
      body_code: doc.accreditation.bodyCode,
      body_name: doc.accreditation.bodyName,
      standard_code: doc.accreditation.standardCode,
      standard_name: doc.accreditation.standardName,
      valid_from: doc.accreditation.validFrom,
      valid_to: doc.accreditation.validTo,
      status_as_of: doc.accreditation.statusAsOf,
      verification_url_template: doc.accreditation.verificationUrlTemplate,
    },
    discipline: doc.discipline,
    group: doc.group,
    product: doc.product,
    parameter: doc.parameter,
    method:
      doc.method === null
        ? null
        : { code: doc.method.code, name: doc.method.name, standard_code: doc.method.standardCode },
    method_text: doc.methodText,
    range_text: doc.rangeText,
    site_type: doc.siteType,
    temporarily_unavailable: doc.temporarilyUnavailable,
    price_paise: moneyAsNumber(doc.pricePaise),
    tat_days: doc.tatDays,
    rating_avg: doc.ratingAvg,
    rating_count: doc.ratingCount,
    next_slot_at: doc.nextSlotAt,
    projected_at: doc.projectedAt,
  };
}

export function fromSource(source: IndexedSource): LabSearchDocument {
  const product: AliasedCodeName | null = source.product;
  return {
    scopeLineId: source.scope_line_id,
    labSiteId: source.lab_site_id,
    siteCode: source.site_code,
    siteName: source.site_name,
    city: source.city,
    stateCode: source.state_code,
    pincode: source.pincode,
    location:
      source.location === null ? null : { lat: source.location.lat, lng: source.location.lon },
    listingStatus: source.listing_status,
    isBookable: source.is_bookable,
    labCategory: source.lab_category,
    accreditationStatus: source.accreditation_status,
    accreditation: {
      certificateNo: source.accreditation.certificate_no,
      bodyCode: source.accreditation.body_code,
      bodyName: source.accreditation.body_name,
      standardCode: source.accreditation.standard_code,
      standardName: source.accreditation.standard_name,
      validFrom: source.accreditation.valid_from,
      validTo: source.accreditation.valid_to,
      statusAsOf: source.accreditation.status_as_of,
      verificationUrlTemplate: source.accreditation.verification_url_template,
    },
    discipline: source.discipline,
    group: source.group,
    product,
    parameter: source.parameter,
    method:
      source.method === null
        ? null
        : {
            code: source.method.code,
            name: source.method.name,
            standardCode: source.method.standard_code,
          },
    methodText: source.method_text,
    rangeText: source.range_text,
    siteType: source.site_type,
    temporarilyUnavailable: source.temporarily_unavailable,
    pricePaise: source.price_paise === null ? null : BigInt(source.price_paise),
    tatDays: source.tat_days,
    ratingAvg: source.rating_avg,
    ratingCount: source.rating_count,
    nextSlotAt: source.next_slot_at,
    projectedAt: source.projected_at,
  };
}
