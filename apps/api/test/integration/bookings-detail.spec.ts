import { randomUUID } from 'node:crypto';
import { uuidv7 } from '@labconnect/database';
import {
  BOOKING_STATES,
  bookingInState,
  type BookingFixture,
  loadReference,
} from '@labconnect/database/test-utils';
import { ROLES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../support/identity-app.js';
import { buildWorld, type TenantUser, type World } from '../support/isolation/world.js';

// `getBooking` over HTTP, held to the contract, on a real database (I3-SHR-01): the customer and
// the lab view of a booking in every state, what each party may not see, the lab contact once the
// booking is paid, the own side's rating, and who gets 404 or 403.

interface ViewBody {
  viewerParty: 'CUSTOMER' | 'LAB';
  id: string;
  status: string;
  lockVersion: number;
  lines: { snapshot: { discipline: { code: string }; tatDays: number } }[];
  labSnapshot: { siteName: string; accreditation: { certificateNo: string } };
  statusHistory: { transitionId: string }[];
  counterOffer: unknown;
  holdCase: unknown;
  labContact?: unknown;
  requester?: { userId: string };
  ownRating: { direction: string; scoreOverall: number } | null;
}

describe('bookings: GET /v1/bookings/{id}', () => {
  const t = useIdentityApp();
  let w: World;
  const tokens = new Map<string, string>();
  const byState = new Map<string, BookingFixture>();
  /** A REQUESTED booking at lab A's second site, requested by customer A's admin. */
  let adminsAtSite2: BookingFixture;
  let ofCustomerB: BookingFixture;

  const tokenOf = async (user: TenantUser): Promise<string> => {
    const known = tokens.get(user.id);
    if (known !== undefined) return known;
    const session =
      ROLES[user.role].mfa === 'REQUIRED'
        ? await t.signInWithMfa(user.email)
        : await t.signIn(user.email);
    tokens.set(user.id, session.accessToken);
    return session.accessToken;
  };
  const read = async (user: TenantUser, id: string, invalidRequest?: string) =>
    t.api.get(`/v1/bookings/${id}`, {
      token: await tokenOf(user),
      ...(invalidRequest !== undefined && { invalidRequest }),
    });
  const stateOf = (state: string): BookingFixture => {
    const found = byState.get(state);
    if (!found) throw new Error(`no booking in ${state}`);
    return found;
  };

  beforeAll(async () => {
    w = await buildWorld(t);
    const { customerA, customerB, labA } = w.fixtures;
    const [siteA1, siteA2] = labA.sites;
    if (!siteA1 || !siteA2) throw new Error('lab A needs two sites');
    await t.owner(async (tx) => {
      const reference = await loadReference(tx);
      for (const state of BOOKING_STATES) {
        const booking = await bookingInState(tx, state, {
          reference,
          customer: customerA,
          lab: labA,
          site: siteA1,
        });
        byState.set(state, booking);
      }
      adminsAtSite2 = await bookingInState(tx, 'REQUESTED', {
        reference,
        customer: customerA,
        lab: labA,
        site: siteA2,
      });
      await tx.$executeRaw`UPDATE booking SET requester_user_id = ${customerA.admin}::uuid WHERE id = ${adminsAtSite2.id}::uuid`;
      ofCustomerB = await bookingInState(tx, 'REQUESTED', {
        reference,
        customer: customerB,
        lab: labA,
        site: siteA1,
      });
      // The contact the site gives its customers, and a rating in each direction.
      await tx.labSitePrivate.update({
        where: { labSiteId: siteA1.id },
        data: {
          publicContact: { name: 'DEMO Desk', phone: '+910000000001', email: 'desk@example.test' },
        },
      });
      const completed = byState.get('COMPLETED');
      if (!completed) throw new Error('no completed booking');
      for (const [direction, score, ratedBy] of [
        ['CUSTOMER_TO_LAB', 5, customerA.admin],
        ['LAB_TO_CUSTOMER', 2, labA.checkers[0] ?? ''],
      ] as const) {
        await tx.rating.create({
          data: {
            id: uuidv7(),
            bookingId: completed.id,
            customerOrgId: customerA.organisationId,
            labOrgId: labA.organisationId,
            direction,
            ratedByUserId: ratedBy,
            scoreOverall: score,
            isPublic: false,
          },
        });
      }
    });
  }, 300_000);

  it('gives the customer and the lab their own view of a booking in every state', async () => {
    const admin = w.customerA.user('CUSTOMER_ADMIN');
    const checker = w.labA.user('LAB_CHECKER');
    for (const state of BOOKING_STATES) {
      const booking = stateOf(state);
      const customer = await read(admin, booking.id);
      expect(customer.status, state).toBe(200);
      const body = customer.body as ViewBody;
      expect(body.viewerParty).toBe('CUSTOMER');
      expect(body.status).toBe(state);
      expect(customer.headers.etag).toBe(`"${String(body.lockVersion)}"`);
      expect(customer.headers['cache-control']).toBe('no-store');
      expect(body.statusHistory[0]?.transitionId).toBe('T-01');
      // Filled from the scope line and price item where the stored snapshot lacks the field.
      expect(body.lines[0]?.snapshot.discipline.code).toBeTruthy();
      expect(body.lines[0]?.snapshot.tatDays).toBeGreaterThan(0);
      expect(body.labSnapshot.accreditation.certificateNo).toBeTruthy();

      const lab = await read(checker, booking.id);
      expect(lab.status, state).toBe(200);
      const labBody = lab.body as ViewBody;
      expect(labBody.viewerParty).toBe('LAB');
      // The lab view has no field about the customer's people, sites or the lab contact.
      expect(labBody).not.toHaveProperty('requester');
      expect(labBody).not.toHaveProperty('customerSite');
      expect(labBody).not.toHaveProperty('labContact');
    }
  });

  it('shows the counter-offer and the hold case where the booking has them', async () => {
    const admin = w.customerA.user('CUSTOMER_ADMIN');
    const countered = (await read(admin, stateOf('COUNTERED').id)).body as ViewBody;
    expect(countered.counterOffer).not.toBeNull();
    const onHold = (await read(admin, stateOf('ON_HOLD').id)).body as ViewBody;
    expect(onHold.holdCase).not.toBeNull();
    const requested = (await read(admin, stateOf('REQUESTED').id)).body as ViewBody;
    expect(requested.counterOffer).toBeNull();
    expect(requested.holdCase).toBeNull();
  });

  it("shows the lab's contact to the customer only once the booking has been paid", async () => {
    const admin = w.customerA.user('CUSTOMER_ADMIN');
    const unpaid = (await read(admin, stateOf('ACCEPTED').id)).body as ViewBody;
    expect(unpaid.labContact).toBeNull();
    const paid = (await read(admin, stateOf('HANDOVER_SET').id)).body as ViewBody;
    expect(paid.labContact).toEqual({
      name: 'DEMO Desk',
      phone: '+910000000001',
      email: 'desk@example.test',
    });
  });

  it("gives each party its own side's rating only", async () => {
    const id = stateOf('COMPLETED').id;
    const customer = (await read(w.customerA.user('CUSTOMER_ADMIN'), id)).body as ViewBody;
    expect(customer.ownRating).toMatchObject({ direction: 'CUSTOMER_TO_LAB', scoreOverall: 5 });
    const lab = (await read(w.labA.user('LAB_CHECKER'), id)).body as ViewBody;
    expect(lab.ownRating).toMatchObject({ direction: 'LAB_TO_CUSTOMER', scoreOverall: 2 });
  });

  it("refuses a requester a colleague's booking with 403, and gives them their own", async () => {
    const requester = w.customerA.user('CUSTOMER_REQUESTER');
    const colleagues = await read(requester, adminsAtSite2.id);
    expect(colleagues.status).toBe(403);
    expect((colleagues.body as { code: string }).code).toBe('FORBIDDEN');
    const own = await read(requester, stateOf('REQUESTED').id);
    expect(own.status).toBe(200);
  });

  it('answers 404, like an unknown id, for a booking outside the caller’s organisation or sites', async () => {
    const cases: [TenantUser, string, string][] = [
      [w.customerB.user('CUSTOMER_ADMIN'), stateOf('REQUESTED').id, 'another customer'],
      [w.labB.user('LAB_CHECKER'), stateOf('REQUESTED').id, 'another lab'],
      [w.siteMaker, adminsAtSite2.id, 'a site the Maker is not assigned to'],
      [w.customerA.user('CUSTOMER_ADMIN'), ofCustomerB.id, "another customer's booking"],
      [w.customerA.user('CUSTOMER_ADMIN'), randomUUID(), 'an unknown id'],
    ];
    for (const [user, id, label] of cases) {
      const response = await read(user, id);
      expect(response.status, label).toBe(404);
      expect((response.body as { code: string }).code, label).toBe('NOT_FOUND');
    }
    // The site-assigned Maker reads a booking of their own site.
    expect((await read(w.siteMaker, stateOf('REQUESTED').id)).status).toBe(200);
  });

  it('refuses platform staff with 403, and an id that is not a UUID with 422', async () => {
    const staff = await read(w.platform.user('PLATFORM_OPS'), stateOf('REQUESTED').id);
    expect(staff.status).toBe(403);
    const bad = await read(
      w.customerA.user('CUSTOMER_ADMIN'),
      'not-a-uuid',
      'the id is not a UUID',
    );
    expect(bad.status).toBe(422);
  });
});
