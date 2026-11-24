import { describe, expect, it } from 'vitest';
import { loadBundledDocument, prismaEnums, readRepoFile } from './helpers.js';

// Contract enums that mirror a database enum (components/schemas/enums.yaml). With the same name
// an enum carries exactly the Prisma values; with another name it may accept a subset.

const doc = loadBundledDocument();

describe('enums shared with the database', () => {
  const enums = prismaEnums();
  // Contract schema → Prisma enum, and whether the contract may accept a subset.
  const mirrored: [schema: string, prismaEnum: string, subset: boolean][] = [
    // Identity, organisations and memberships
    ['RoleCode', 'RoleCode', false],
    ['CustomerRoleCode', 'RoleCode', true],
    ['LabRoleCode', 'RoleCode', true],
    ['AdminPlatformRoleCode', 'RoleCode', true],
    ['OrgType', 'OrgType', false],
    ['OrgStatus', 'OrgStatus', false],
    ['CustomerSegment', 'CustomerSegment', false],
    ['ClaimStatus', 'ClaimStatus', false],
    ['UserStatus', 'UserStatus', false],
    ['AdminUserStatusUpdate', 'UserStatus', true],
    ['MembershipStatus', 'MembershipStatus', false],
    ['LabMembershipSettableStatus', 'MembershipStatus', true],
    ['OtpRequestPurpose', 'OtpPurpose', true],
    ['NotifChannel', 'NotifChannel', false],
    // Lab onboarding
    ['ClaimMethod', 'ClaimMethod', false],
    ['ClaimRequestStatus', 'ClaimRequestStatus', false],
    ['VerificationStatus', 'VerificationStatus', false],
    ['AdminVerificationDecision', 'VerificationStatus', true],
    // Lab sites
    ['AccreditationStatus', 'AccreditationStatus', false],
    ['PublicLabCategory', 'LabCategory', true],
    ['ListingStatus', 'ListingStatus', false],
    ['PublicListingStatus', 'ListingStatus', true],
    ['ScopeSiteType', 'ScopeSiteType', false],
    ['GeocodeStatus', 'GeocodeStatus', false],
    ['AdminGeocodeQueueStatus', 'GeocodeStatus', true],
    ['PriceListStatus', 'PriceListStatus', false],
    ['SlotStatus', 'SlotStatus', false],
    ['LabSlotSettableStatus', 'SlotStatus', true],
    ['LeadKind', 'LeadKind', false],
    ['LeadStatus', 'LeadStatus', false],
    // Master data and imports
    ['MdStatus', 'MdStatus', false],
    ['MdDataType', 'MdDataType', false],
    ['MdTargetType', 'MdTargetType', false],
    ['ChangeSource', 'ChangeSource', false],
    ['ChangeSetStatus', 'ChangeSetStatus', false],
    ['ChangeOperation', 'ChangeOperation', false],
    ['ValidationStatus', 'ValidationStatus', false],
    ['ImportKind', 'ImportKind', false],
    ['ImportStatus', 'ImportStatus', false],
    ['ImportSourceFormat', 'ImportSourceFormat', false],
    ['ImportMatchResult', 'ImportMatchResult', false],
    ['ImportRowAction', 'ImportRowAction', false],
    // Bookings
    ['BookingStatus', 'BookingStatus', false],
    ['BookingLineStatus', 'BookingLineStatus', false],
    ['BookingLineTargetStatus', 'BookingLineStatus', true],
    ['PartyType', 'PartyType', false],
    ['CounterStatus', 'CounterStatus', false],
    ['HoldDecision', 'HoldDecision', false],
    ['HoldStatus', 'HoldStatus', false],
    ['TimerType', 'TimerType', false],
    ['RatingDirection', 'RatingDirection', false],
    // Custody, receipt and files
    ['PackageStatus', 'PackageStatus', false],
    ['CustodyEventType', 'CustodyEventType', false],
    ['CustodyScanEventType', 'CustodyEventType', true],
    ['ReceiptDecision', 'ReceiptDecision', false],
    ['ScanStatus', 'ScanStatus', false],
    // Reports and verification
    ['ReportStatus', 'ReportStatus', false],
    ['ReportVersionStatus', 'ReportVersionStatus', false],
    ['ConformityResult', 'ConformityResult', false],
    ['VerificationResult', 'VerificationResult', false],
    // Payments, refunds, payouts and reconciliation
    ['GatewayCode', 'GatewayCode', false],
    ['PaymentOrderStatus', 'PaymentOrderStatus', false],
    ['FinDocType', 'FinDocType', false],
    ['RefundStatus', 'RefundStatus', false],
    ['PayoutStatus', 'PayoutStatus', false],
    ['PayoutMechanism', 'PayoutMechanism', false],
    ['PayoutHoldReason', 'PayoutHoldReason', false],
    ['AdminPayoutHoldPlaceReason', 'PayoutHoldReason', true],
    ['SettlementMatchStatus', 'SettlementMatchStatus', false],
    // Disputes
    ['DisputeStatus', 'DisputeStatus', false],
    ['DisputeOutcome', 'DisputeOutcome', false],
    ['MessageVisibility', 'MessageVisibility', false],
    // Platform configuration
    ['ConfigScope', 'ConfigScope', false],
  ];

  it.each(mirrored)('%s matches Prisma enum %s', (schema, prismaEnum, subset) => {
    const values = doc.components.schemas[schema]?.enum ?? [];
    const expected = enums.get(prismaEnum) ?? [];
    expect(expected).not.toEqual([]);
    if (subset) {
      expect(values).not.toEqual([]);
      for (const v of values) expect(expected).toContain(v);
    } else {
      expect(values).toEqual(expected);
    }
  });

  it('mirrors every contract enum that shares a name with a Prisma enum', () => {
    const covered = new Set(mirrored.map(([schema]) => schema));
    const unchecked = Object.entries(doc.components.schemas)
      .filter(([name, schema]) => schema.enum !== undefined && enums.has(name))
      .map(([name]) => name)
      .filter((name) => !covered.has(name));
    expect(unchecked).toEqual([]);
  });

  it('mirrors every enum of enums.yaml, and lists no other schema', () => {
    // enums.yaml holds the enums that mirror the database; module-only enums live elsewhere.
    const source = readRepoFile('packages/api-contract/openapi/components/schemas/enums.yaml');
    const defined = [...source.matchAll(/^([A-Za-z]\w*):/gm)].map((m) => m[1] ?? '');
    expect([...defined].sort()).toEqual(mirrored.map(([schema]) => schema).sort());
  });
});
