import { beforeAll, describe, expect, it } from 'vitest';
import {
  BOOKING_STATES,
  bookingInState,
  createCatalogue,
  createCustomer,
  createLab,
  createPlatformTeam,
  createPublishedChangeSet,
  type CustomerFixture,
  gstPaise,
  type LabFixture,
  loadReference,
  type Reference,
  seedReference,
  uuidv7,
} from '../../src/factories/index.js';
import { BookingStatus } from '../../src/generated/prisma/client.js';
import { PATIENT, usePrisma } from './prisma.js';

// P1-11: test factories (TESTING_STRATEGY.md section 5).

describe('factories', () => {
  const { prisma, db } = usePrisma();
  let reference: Reference;
  let customer: CustomerFixture;
  let lab: LabFixture;

  beforeAll(async () => {
    await prisma().$transaction(async (tx) => {
      await seedReference(tx);
      reference = await loadReference(tx);
      const platform = await createPlatformTeam(tx);
      const changeSetId = await createPublishedChangeSet(tx, platform, 'DEMO test data');
      const catalogue = await createCatalogue(tx, reference, changeSetId);
      customer = await createCustomer(tx);
      lab = await createLab(
        tx,
        { reference, platform, catalogue, changeSetId },
        { sites: [{}, {}] },
      );
    }, PATIENT);
  });

  it('covers every booking state', () => {
    expect([...BOOKING_STATES].sort()).toEqual(Object.keys(BookingStatus).sort());
  });

  it('builds an onboarded lab with a different Maker and Checker on every site', () => {
    expect(lab.sites).toHaveLength(2);
    expect(lab.makers).toHaveLength(1);
    expect(lab.checkers).toHaveLength(1);
    expect(lab.makers[0]).not.toBe(lab.checkers[0]);
    for (const site of lab.sites) {
      expect(site.priceListId).toBeDefined();
      expect(site.slotIds.length).toBeGreaterThan(0);
      expect(site.scopeLines.every((line) => line.priceItemId)).toBe(true);
    }
  });

  it.each(BOOKING_STATES)(
    'bookingInState(%s) ends in that state with a complete history',
    async (state) => {
      const booking = await prisma().$transaction(
        (tx) =>
          bookingInState(tx, state, { reference, customer, lab, lineCount: 2, packageCount: 2 }),
        PATIENT,
      );
      expect(booking.status).toBe(state);

      const row = await prisma().booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: { bookingLines: true },
      });
      expect(row.status).toBe(state);
      expect(row.bookingLines).toHaveLength(2);
      expect(row.totalPaise).toBe(
        row.bookingLines.reduce((sum, line) => sum + line.lineTotalPaise, 0n),
      );

      // The history is a chain from "new" to the current state, and every link is a legal transition.
      const history = await prisma().bookingStatusHistory.findMany({
        where: { bookingId: booking.id },
        orderBy: { id: 'asc' },
      });
      expect(history[0]?.fromStatus).toBeNull();
      expect(history.at(-1)?.toStatus).toBe(state);
      for (const [index, entry] of history.entries()) {
        if (index > 0) expect(entry.fromStatus).toBe(history[index - 1]?.toStatus);
        expect(
          await prisma().bookingTransition.count({
            where: {
              transitionId: entry.transitionId,
              fromStatus: entry.fromStatus,
              toStatus: entry.toStatus,
            },
          }),
        ).toBe(1);
      }
    },
  );

  it('leaves behind the rows each stage needs', async () => {
    const count = async (state: BookingStatus): Promise<Record<string, number>> => {
      const booking = await prisma().$transaction(
        (tx) => bookingInState(tx, state, { reference, customer, lab, packageCount: 2 }),
        PATIENT,
      );
      const where = { bookingId: booking.id };
      return {
        captured: await prisma().paymentOrder.count({ where: { ...where, status: 'CAPTURED' } }),
        packagesIssued: await prisma().package.count({ where: { ...where, status: 'ISSUED' } }),
        packagesReceived: await prisma().package.count({ where: { ...where, status: 'RECEIVED' } }),
        receipts: await prisma().receiptRecord.count({ where }),
        openHolds: await prisma().holdCase.count({ where: { ...where, status: 'OPEN' } }),
        released: await prisma().reportVersion.count({ where: { ...where, status: 'RELEASED' } }),
        inReview: await prisma().reportVersion.count({ where: { ...where, status: 'IN_REVIEW' } }),
        disputes: await prisma().dispute.count({ where }),
        payoutHolds: await prisma().payoutHold.count({ where }),
        liveSlotHolds: await prisma().slotHold.count({ where: { ...where, releasedAt: null } }),
        pendingCounters: await prisma().counterOffer.count({
          where: { ...where, status: 'PENDING' },
        }),
      };
    };
    const none = {
      captured: 0,
      packagesIssued: 0,
      packagesReceived: 0,
      receipts: 0,
      openHolds: 0,
      released: 0,
      inReview: 0,
      disputes: 0,
      payoutHolds: 0,
      liveSlotHolds: 1,
      pendingCounters: 0,
    };
    expect(await count('REQUESTED')).toEqual(none);
    expect(await count('COUNTERED')).toEqual({ ...none, pendingCounters: 1 });
    expect(await count('REJECTED')).toEqual({ ...none, liveSlotHolds: 0 });
    expect(await count('PAID')).toEqual({ ...none, captured: 1 });
    expect(await count('HANDOVER_SET')).toEqual({ ...none, captured: 1, packagesIssued: 2 });
    expect(await count('NO_SHOW')).toEqual({
      ...none,
      captured: 1,
      packagesIssued: 2,
      liveSlotHolds: 0,
    });
    expect(await count('ON_HOLD')).toEqual({
      ...none,
      captured: 1,
      packagesIssued: 2,
      receipts: 1,
      openHolds: 1,
    });
    const received = { ...none, captured: 1, packagesReceived: 2, receipts: 1 };
    expect(await count('RECEIVED')).toEqual(received);
    expect(await count('REPORT_IN_REVIEW')).toEqual({ ...received, inReview: 1 });
    expect(await count('REPORT_RELEASED')).toEqual({ ...received, released: 1 });
    expect(await count('DISPUTED')).toEqual({
      ...received,
      released: 1,
      disputes: 1,
      payoutHolds: 1,
    });
  });

  it('posts a balanced journal for the captured payment', async () => {
    const booking = await prisma().$transaction(
      (tx) => bookingInState(tx, 'PAID', { reference, customer, lab }),
      PATIENT,
    );
    const entries = await prisma().ledgerEntry.findMany({
      where: { journal: { bookingId: booking.id } },
      include: { account: true },
    });
    expect(
      entries.map((entry) => [entry.account.code, entry.debitPaise, entry.creditPaise]).sort(),
    ).toEqual([
      ['CUSTOMER_PREPAYMENT', 0n, booking.totalPaise],
      ['GATEWAY_CLEARING', booking.totalPaise, 0n],
    ]);
    expect(entries.find((entry) => entry.creditPaise > 0n)?.account.partyOrgId).toBe(
      customer.organisationId,
    );
  });

  it('keeps Maker and Checker apart on the receipt and on the report', async () => {
    const booking = await prisma().$transaction(
      (tx) => bookingInState(tx, 'REPORT_RELEASED', { reference, customer, lab }),
      PATIENT,
    );
    const receipt = await prisma().receiptRecord.findFirstOrThrow({
      where: { bookingId: booking.id },
    });
    const version = await prisma().reportVersion.findFirstOrThrow({
      where: { bookingId: booking.id },
    });
    expect(receipt.checkerUserId).not.toBe(receipt.makerUserId);
    expect(version.checkerUserId).not.toBe(version.makerUserId);
  });

  it('rounds GST half up, in whole paise', () => {
    expect(gstPaise(100_000n, 1800)).toBe(18_000n);
    expect(gstPaise(25n, 1800)).toBe(5n); // 4.5 → 5
    expect(gstPaise(24n, 1800)).toBe(4n); // 4.32 → 4
    expect(gstPaise(0n, 1800)).toBe(0n);
  });

  it('refuses a lab that is not onboarded', async () => {
    await expect(
      prisma().$transaction(async (tx) => {
        const platform = await createPlatformTeam(tx);
        const changeSetId = await createPublishedChangeSet(tx, platform, 'DEMO');
        const catalogue = {
          parameters: lab.sites[0]?.scopeLines.map((line) => line.parameter) ?? [],
          disciplineIds: [],
        };
        const listed = await createLab(
          tx,
          { reference, platform, catalogue, changeSetId },
          { onboarded: false },
        );
        return bookingInState(tx, 'REQUESTED', { reference, customer, lab: listed });
      }, PATIENT),
    ).rejects.toThrow('onboarded lab');
  });

  it('generates version 7 UUIDs that sort by time', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_000_001);
    expect(earlier).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(earlier < later).toBe(true);
    expect(db()).toBeDefined();
  });
});
