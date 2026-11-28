import { randomUUID } from 'node:crypto';
import {
  addMember,
  bookingInState,
  createUser,
  loadReference,
} from '@labconnect/database/test-utils';
import { ROLES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../support/identity-app.js';
import { buildWorld, type TenantUser, type World } from '../support/isolation/world.js';

// `listBookings` over HTTP, held to the contract, on a real database (I3-SHR-01): who sees which
// bookings (customer organisation, own bookings for a requester, assigned sites for a lab member),
// the scope and status filters, the cursor, and the refusals.

interface Summary {
  id: string;
  bookingNo: string;
  status: string;
  labSite: { id: string };
  total: { amountPaise: number; currency: string };
  slot: { id: string } | null;
}
interface ListBody {
  data: Summary[];
  page: { nextCursor: string | null; limit: number };
}

describe('bookings: GET /v1/bookings', () => {
  const t = useIdentityApp();
  let w: World;
  const tokens = new Map<string, string>();
  /** Bookings by name, created in this order (so the newest is the last). */
  const ids: Record<string, string> = {};
  /** A Maker of lab A with no site assigned (RR-3: no site means no booking). */
  let siteless: TenantUser;

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
  const list = async (user: TenantUser, query = '', invalidRequest?: string) =>
    t.api.get(`/v1/bookings${query}`, {
      token: await tokenOf(user),
      ...(invalidRequest !== undefined && { invalidRequest }),
    });
  const idsOf = (body: unknown): string[] => (body as ListBody).data.map((row) => row.id);

  beforeAll(async () => {
    w = await buildWorld(t);
    const { customerA, customerB, labA, labB } = w.fixtures;
    const [siteA1, siteA2] = labA.sites;
    if (!siteA1 || !siteA2) throw new Error('lab A needs two sites');
    const start = Date.parse('2026-11-20T04:00:00Z');
    const at = (minutes: number) => new Date(start + minutes * 60_000);
    await t.owner(async (tx) => {
      const reference = await loadReference(tx);
      // Created a minute apart, so "newest first" has one answer.
      const make = async (
        name: string,
        state: Parameters<typeof bookingInState>[1],
        options: Omit<Parameters<typeof bookingInState>[2], 'reference'>,
        minute: number,
      ) => {
        const booking = await bookingInState(tx, state, { ...options, reference, now: at(minute) });
        ids[name] = booking.id;
        await tx.$executeRaw`UPDATE booking SET created_at = ${at(minute)} WHERE id = ${booking.id}::uuid`;
        return booking;
      };
      await make('a1Requested', 'REQUESTED', { customer: customerA, lab: labA, site: siteA1 }, 1);
      await make('a2Accepted', 'ACCEPTED', { customer: customerA, lab: labA, site: siteA2 }, 2);
      const byAdmin = await make(
        'a1ByAdmin',
        'REQUESTED',
        { customer: customerA, lab: labA, site: siteA1 },
        3,
      );
      // Requested by the admin, not by the requester.
      await tx.$executeRaw`UPDATE booking SET requester_user_id = ${customerA.admin}::uuid WHERE id = ${byAdmin.id}::uuid`;
      await make('bAtLabA', 'REQUESTED', { customer: customerB, lab: labA, site: siteA2 }, 4);
      await make('aAtLabB', 'REQUESTED', { customer: customerA, lab: labB }, 5);
      const email = `siteless.${randomUUID().slice(0, 8)}@demo.labconnect.test`;
      const userId = await createUser(tx, { email, fullName: 'DEMO Siteless Maker' });
      const membershipId = await addMember(tx, userId, labA.organisationId, 'LAB_MAKER', []);
      siteless = {
        id: userId,
        email,
        role: 'LAB_MAKER',
        organisationId: labA.organisationId,
        membershipId,
      };
    });
  }, 300_000);

  it("a customer admin sees every booking of the organisation, newest first, and no one else's", async () => {
    const response = await list(w.customerA.user('CUSTOMER_ADMIN'), '?limit=100');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(idsOf(response.body)).toEqual([
      ids.aAtLabB,
      ids.a1ByAdmin,
      ids.a2Accepted,
      ids.a1Requested,
    ]);
    const first = (response.body as ListBody).data[0];
    expect(first?.total.currency).toBe('INR');
    expect(Number.isInteger(first?.total.amountPaise)).toBe(true);
    expect(first?.bookingNo).toMatch(/^LC-\d{4}-\d{7}$/);
  });

  it('a requester sees only the bookings they requested', async () => {
    const response = await list(w.customerA.user('CUSTOMER_REQUESTER'), '?limit=100');
    expect(response.status).toBe(200);
    expect(idsOf(response.body)).toEqual([ids.aAtLabB, ids.a2Accepted, ids.a1Requested]);
  });

  it("a lab member sees the bookings of the lab's assigned sites, of every customer", async () => {
    const checker = await list(w.labA.user('LAB_CHECKER'), '?limit=100');
    expect(checker.status).toBe(200);
    expect(idsOf(checker.body)).toEqual([
      ids.bAtLabA,
      ids.a1ByAdmin,
      ids.a2Accepted,
      ids.a1Requested,
    ]);
    // A Maker assigned to the first site only (RR-3).
    const siteMaker = await list(w.siteMaker, '?limit=100');
    expect(idsOf(siteMaker.body)).toEqual([ids.a1ByAdmin, ids.a1Requested]);
    // The other lab sees none of them.
    const otherLab = await list(w.labB.user('LAB_CHECKER'), '?limit=100');
    expect(idsOf(otherLab.body)).toEqual([ids.aAtLabB]);
  });

  it('filters by status, and accepts the scope of the active membership', async () => {
    const accepted = await list(w.customerA.user('CUSTOMER_ADMIN'), '?status=ACCEPTED');
    expect(idsOf(accepted.body)).toEqual([ids.a2Accepted]);
    const two = await list(w.labA.user('LAB_CHECKER'), '?scope=lab&status=ACCEPTED,CANCELLED');
    expect(two.status).toBe(200);
    expect(idsOf(two.body)).toEqual([ids.a2Accepted]);
  });

  it('walks the pages with the cursor, and a cursor of an invisible booking gives an empty page', async () => {
    const admin = w.customerA.user('CUSTOMER_ADMIN');
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `?limit=1${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = await list(admin, query);
      expect(page.status).toBe(200);
      const body = page.body as ListBody;
      expect(body.page.limit).toBe(1);
      seen.push(...body.data.map((row) => row.id));
      cursor = body.page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual([ids.aAtLabB, ids.a1ByAdmin, ids.a2Accepted, ids.a1Requested]);

    // A cursor that names customer B's booking: customer A cannot place it, so nothing follows.
    const foreign = Buffer.from(JSON.stringify({ i: ids.bAtLabA }), 'utf8').toString('base64url');
    const empty = await list(admin, `?cursor=${foreign}`);
    expect(empty.status).toBe(200);
    expect(idsOf(empty.body)).toEqual([]);
  });

  it('refuses a scope of the other side, an unknown status, a bad cursor or limit, and unknown parameters with 422', async () => {
    const admin = w.customerA.user('CUSTOMER_ADMIN');
    const cases: [string, string][] = [
      ['?scope=lab', 'scope'],
      ['?status=SHIPPED', 'status'],
      ['?status=REQUESTED,REQUESTED', 'status'],
      ['?cursor=not-a-cursor', 'cursor'],
      ['?limit=0', 'limit'],
      ['?orgId=' + randomUUID(), 'orgId'],
    ];
    for (const [query, reason] of cases) {
      const response = await list(admin, query, `${reason} is not valid`);
      expect(response.status, query).toBe(422);
      expect((response.body as { code: string }).code, query).toBe('VALIDATION_FAILED');
    }
  });

  it('gives a lab member with no assigned site an empty list', async () => {
    const response = await list(siteless, '?limit=100');
    expect(response.status).toBe(200);
    expect(idsOf(response.body)).toEqual([]);
  });

  it('names the field when the scope is of the other side', async () => {
    const response = await list(w.customerA.user('CUSTOMER_ADMIN'), '?scope=lab');
    expect(response.status).toBe(422);
    const body = response.body as { errors?: { path: string; message: string }[] };
    expect(body.errors?.[0]?.path).toBe('scope');
    expect(body.errors?.[0]?.message).toBeTruthy();
  });

  it('refuses a user with no membership with 403', async () => {
    const session = await t.signIn(t.newEmail('no-membership'));
    const response = await t.api.get('/v1/bookings', { token: session.accessToken });
    expect(response.status).toBe(403);
  });

  it('refuses platform staff with 403: they read bookings in the admin console', async () => {
    const response = await list(w.platform.user('PLATFORM_OPS'));
    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
  });

  it('needs a session', async () => {
    const response = await t.api.get('/v1/bookings');
    expect(response.status).toBe(401);
  });
});
