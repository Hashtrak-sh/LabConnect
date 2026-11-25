/**
 * Field names that may never appear in a public search document or in a public search response
 * (TENANT_ISOLATION.md sections 1 and 4: "a test asserts that no customer, booking or
 * price-draft fields are indexed").
 *
 * Mirror of the `denyList` in `packages/api-contract/test/public-boundary.test.ts`, which is the
 * source and is not importable (a test file). `deny-list.test.ts` reads that file and fails if a
 * name is added there and not here. Extend both when a new private column appears.
 *
 * Names are compared without case and without `_`, so `lab_org_id` and `labOrgId` are the same.
 */
export const PUBLIC_BOUNDARY_DENY_LIST: readonly string[] = [
  'contactEmail',
  'contactPhone',
  'publicContact',
  'email',
  'phone',
  'phoneE164',
  'pan',
  'panLast4',
  'panCiphertext',
  'trustFlags',
  'gstin',
  'legalName',
  'kycStatus',
  'bankAccount',
  'accountNumber',
  'accountNumberLast4',
  'accountHolderName',
  'ifsc',
  'organisationId',
  'labOrgId',
  'bookabilityReasons',
  'maxOpenJobs',
  'responsivenessScore',
  'geocodeConfidence',
  'capacity',
  'heldCount',
  'bookedCount',
  'customerOrgId',
  'customerId',
  'customerSiteId',
  'customerName',
  'bookingId',
  'bookingNo',
  'requesterUserId',
  'userId',
  'makerUserId',
  'checkerUserId',
  'createdByUserId',
  'originalFileId',
  'originalSha256',
  'stampedFileId',
  'fileId',
  'objectKey',
  'reviewComments',
  'amendmentReason',
  'results',
  'batchNo',
  'tokenHash',
  'accessCount',
  'recipientNote',
  'ipHash',
  'ipAddress',
];

const normalise = (name: string): string => name.replaceAll('_', '').toLowerCase();
const DENIED = new Map(PUBLIC_BOUNDARY_DENY_LIST.map((name) => [normalise(name), name]));

/** Paths (`a.b[0].c`) of every property of `value` whose name is on the deny-list. */
export function deniedFieldPaths(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => deniedFieldPaths(item, `${path}[${String(index)}]`));
  }
  if (typeof value !== 'object' || value === null || value instanceof Date) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path === '' ? key : `${path}.${key}`;
    return [...(DENIED.has(normalise(key)) ? [here] : []), ...deniedFieldPaths(child, here)];
  });
}
