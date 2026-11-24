import { describe, expect, it } from 'vitest';
import {
  isRef,
  listOperations,
  loadBundledDocument,
  type OpenApiDocument,
  resolve,
  type Response,
} from './helpers.js';

// Public endpoints (`/v1/public`) return public reference data only (TENANT_ISOLATION.md §1,
// SEARCH.md §1, QR_AND_VERIFICATION.md §5). No property of a response schema reachable from a
// public operation may be one of the private fields below. Matching ignores case.

/** Private fields, with where they come from. Extend it when a new private column appears. */
const denyList: Record<string, string> = {
  // lab_site_private (E-04), app_user, invitations
  contactEmail: 'lab_site_private.contact_email, lead_request.contact_email',
  contactPhone: 'lab_site_private.contact_phone',
  publicContact: 'lab_site_private.public_contact: shown to a paying customer only',
  email: 'app_user.email',
  phone: 'app_user.phone_e164',
  phoneE164: 'app_user.phone_e164',
  // organisation_private, organisation
  pan: 'organisation_private',
  panLast4: 'organisation_private.pan_last4',
  panCiphertext: 'organisation_private.pan_ciphertext',
  trustFlags: 'organisation_private.trust_flags: platform only',
  gstin: 'organisation.gstin, customer_site.gstin',
  legalName: 'organisation.legal_name',
  kycStatus: 'organisation.kyc_status',
  // bank_account
  bankAccount: 'bank_account',
  accountNumber: 'bank_account',
  accountNumberLast4: 'bank_account.account_number_last4',
  accountHolderName: 'bank_account.account_holder_name',
  ifsc: 'bank_account.ifsc',
  // lab internals
  organisationId: 'internal tenant id, not needed publicly',
  labOrgId: 'internal tenant id',
  bookabilityReasons: 'lab_site.bookability_reasons: the lab onboarding state',
  maxOpenJobs: 'lab_site.max_open_jobs',
  responsivenessScore: 'lab_site.responsiveness_score: internal ranking',
  geocodeConfidence: 'lab_site.geocode_confidence',
  capacity: 'slot capacity',
  heldCount: 'slot.held_count',
  bookedCount: 'slot.booked_count',
  // customers and bookings
  customerOrgId: 'tenant id of a customer',
  customerId: 'customer identity',
  customerSiteId: 'customer_site',
  customerName: 'customer identity (QR_AND_VERIFICATION §5: not shown)',
  bookingId: 'booking',
  bookingNo: 'booking',
  requesterUserId: 'lead_request.requester_user_id',
  userId: 'app_user id',
  makerUserId: 'report_version.maker_user_id',
  checkerUserId: 'report_version.checker_user_id',
  createdByUserId: 'audit column',
  // report internals
  originalFileId: 'report_version.original_file_id',
  originalSha256: 'report_version.original_sha256: only the stamped hash is shown',
  stampedFileId: 'report_version.stamped_file_id',
  fileId: 'file_object',
  objectKey: 'file_object.object_key',
  reviewComments: 'report_version.review_comments',
  amendmentReason: 'report_version.amendment_reason',
  results: 'report content (QR_AND_VERIFICATION §5: not shown)',
  batchNo: 'TRF content (QR_AND_VERIFICATION §5: not shown)',
  tokenHash: 'report_share_link.token_hash',
  accessCount: 'report_share_link.access_count',
  recipientNote: 'report_share_link.recipient_note',
  ipHash: 'verification_event.ip_hash',
  ipAddress: 'report_access_log.ip_address',
};

/** Property names reachable from a schema, following `$ref`s, each with its path. */
function reachableProperties(
  doc: OpenApiDocument,
  node: unknown,
  at: string,
  seen = new Set<string>(),
): { name: string; at: string }[] {
  if (typeof node !== 'object' || node === null) return [];
  if (isRef(node)) {
    if (seen.has(node.$ref)) return [];
    seen.add(node.$ref);
    return reachableProperties(doc, resolve(doc, node), node.$ref, seen);
  }
  const found: { name: string; at: string }[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'examples' || key === 'example') continue;
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const name of Object.keys(value)) found.push({ name, at });
    }
    found.push(...reachableProperties(doc, value, `${at}/${key}`, seen));
  }
  return found;
}

const doc = loadBundledDocument();
const publicOperations = listOperations(doc).filter((o) => o.path.startsWith('/public/'));
const denied = new Map(Object.keys(denyList).map((name) => [name.toLowerCase(), name]));

/** Deny-listed properties in the 2xx responses of the given operations. */
function leaks(operations: typeof publicOperations): string[] {
  const out: string[] = [];
  for (const { key, operation } of operations) {
    for (const [status, value] of Object.entries(operation.responses)) {
      if (!status.startsWith('2')) continue;
      const response = resolve<Response>(doc, value);
      for (const media of Object.values(response.content ?? {})) {
        for (const { name, at } of reachableProperties(doc, media.schema, key)) {
          if (denied.has(name.toLowerCase())) out.push(`${key}: ${name} (${at})`);
        }
      }
    }
  }
  return out;
}

describe('public responses (TENANT_ISOLATION §1)', () => {
  it('covers the public operations', () => {
    expect(publicOperations.length).toBeGreaterThan(0);
  });

  it('contain no private field', () => {
    expect(leaks(publicOperations)).toEqual([]);
  });

  it('would catch a private field deep in a referenced schema', () => {
    // Guards the walker itself: a `$ref` chain to a schema with a denied property is found.
    const probe = {
      key: 'GET /probe',
      method: 'get' as const,
      path: '/probe',
      operation: {
        responses: {
          '200': {
            description: 'probe',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    site: { $ref: '#/components/schemas/PublicLabSite' },
                    nested: { type: 'object', properties: { TrustFlags: { type: 'object' } } },
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(leaks([probe])).toEqual(['GET /probe: TrustFlags (GET /probe/properties/nested)']);
  });
});
