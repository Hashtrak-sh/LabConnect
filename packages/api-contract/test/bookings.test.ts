import { describe, expect, it } from 'vitest';
import { isRef, loadBundledDocument, reachablePropertyNames, type Schema } from './helpers.js';

// A booking is shared, but each party's view leaves out what the other party must not read
// (TENANT_ISOLATION.md §1, SCHEMA_SPECIFICATION §2.12 and §5.17, OQ-29).

const doc = loadBundledDocument();

describe('booking views per party', () => {
  const privateTo: Record<string, string[]> = {
    // Customer-owned: the requester, customer sites, users and contacts, platform-only flags.
    BookingForLab: [
      'requester',
      'requesterUserId',
      'customerSite',
      'customerSiteId',
      'placedByPlatform',
      'onBehalfOf',
      'fullName',
      'userId',
      'email',
      'phone',
      'trustFlags',
      'panLast4',
    ],
    // Lab-owned: onboarding state, capacity, internal scores, bank and KYC data.
    BookingForCustomer: [
      'bookabilityReasons',
      'maxOpenJobs',
      'responsivenessScore',
      'capacity',
      'heldCount',
      'bookedCount',
      'bankAccount',
      'accountNumberLast4',
      'kycStatus',
      'trustFlags',
      'clockSkewFlag',
    ],
  };

  it.each(Object.entries(privateTo))(
    '%s reaches none of the other party’s fields',
    (name, deny) => {
      const schema = doc.components.schemas[name];
      expect(schema).toBeDefined();
      const names = reachablePropertyNames(doc, schema);
      expect(deny.filter((field) => names.has(field.toLowerCase()))).toEqual([]);
    },
  );

  it('are the only shapes a booking is returned in', () => {
    const view = doc.components.schemas.BookingView as Schema & { oneOf?: unknown[] };
    expect((view.oneOf ?? []).map((s) => (isRef(s) ? s.$ref : s))).toEqual([
      '#/components/schemas/BookingForCustomer',
      '#/components/schemas/BookingForLab',
    ]);
  });
});
