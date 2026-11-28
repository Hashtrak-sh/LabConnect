import { randomUUID } from 'node:crypto';
import { bookingInState, loadReference } from '@labconnect/database/test-utils';
import { ROLES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../support/identity-app.js';
import { buildWorld, type TenantUser, type World } from '../support/isolation/world.js';

// `getLabInbox` over HTTP, held to the contract, on a real database (I3-LAB-01): the bookings of
// the caller's assigned sites that need the lab, most urgent deadline first, the approvals waiting
// for a Checker with `viewerWasMaker`, the filters, the cursor, and the refusals.

interface Item {
  booking: {
    id: string;
    status: string;
    customerDisplayName: string;
    lineCount: number;
    declaredPackageCount: number;
    total: { amountPaise: number; currency: string };
  };
  pendingApproval: 'RECEIPT' | 'REPORT' | null;
  viewerWasMaker: boolean;
}
interface InboxBody {
  data: Item[];
  page: { nextCursor: string | null; limit: number };
}

describe('lab inbox: GET /v1/lab/inbox', () => {
  const t = useIdentityApp();
  let w: World;
  const tokens = new Map<string, string>();
  const ids: Record<string, string> = {};
  let siteA1Id: string;
  let siteA2Id: string;

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
  const inbox = async (user: TenantUser, query = '', invalidRequest?: string) =>
    t.api.get(`/v1/lab/inbox${query}`, {
      token: await tokenOf(user),
      ...(invalidRequest !== undefined && { invalidRequest }),
    });
  const idsOf = (body: unknown): string[] => (body as InboxBody).data.map((row) => row.booking.id);
  const itemOf = (body: unknown, id: string | undefined): Item | undefined =>
    (body as InboxBody).data.find((row) => row.booking.id === id);

  beforeAll(async () => {
    w = await buildWorld(t);
    const { customerA, customerB, labA, labB } = w.fixtures;
    const [siteA1, siteA2] = labA.sites;
    if (!siteA1 || !siteA2) throw new Error('lab A needs two sites');
    siteA1Id = siteA1.id;
    siteA2Id = siteA2.id;
    const base = Date.parse('2026-12-01T04:30:00Z');
    const at = (minutes: number) => new Date(base + minutes * 60_000);
    await t.owner(async (tx) => {
      const reference = await loadReference(tx);
      const make = async (
        name: string,
        state: Parameters<typeof bookingInState>[1],
        options: Omit<Parameters<typeof bookingInState>[2], 'reference'>,
      ) => {
        const booking = await bookingInState(tx, state, { ...options, reference });
        ids[name] = booking.id;
        return booking.id;
      };
      const set = async (id: string, column: string, value: Date) => {
        // Deadlines and the status time, set so the order has one answer.
        await tx.$executeRawUnsafe(
          `UPDATE booking SET ${column} = $1::timestamptz WHERE id = $2::uuid`,
          value.toISOString(),
          id,
        );
      };
      const atA1 = { customer: customerA, lab: labA, site: siteA1 };
      await set(await make('requested', 'REQUESTED', atA1), 'lab_decision_due_at', at(60));
      await set(
        await make('requestedA2', 'REQUESTED', { customer: customerB, lab: labA, site: siteA2 }),
        'lab_decision_due_at',
        at(30),
      );
      // A lapsed or pending counter-offer: the booking sorts by the latest offer's expiry.
      const countered = await make('countered', 'COUNTERED', atA1);
      await tx.$executeRaw`UPDATE counter_offer SET expires_at = ${at(90)} WHERE booking_id = ${countered}::uuid`;
      await set(await make('accepted', 'ACCEPTED', atA1), 'payment_due_at', at(120));
      await set(await make('paid', 'PAID', atA1), 'drop_deadline_at', at(150));
      await set(await make('handover', 'HANDOVER_SET', atA1), 'drop_deadline_at', at(180));
      await set(await make('sample', 'SAMPLE_RECORDED', atA1), 'status_changed_at', at(-120));
      await set(await make('report', 'REPORT_IN_REVIEW', atA1), 'status_changed_at', at(-60));
      await make('completed', 'COMPLETED', atA1);
      // A completed booking with an amendment of its released report in review: terminal, but
      // listed while the amendment waits for a Checker.
      const amended = await make('amended', 'COMPLETED', atA1);
      await set(amended, 'status_changed_at', at(-180));
      await tx.$executeRaw`
        INSERT INTO report_version (id, booking_id, customer_org_id, lab_org_id, report_id,
               version_no, status, is_amendment, amendment_reason, issue_date, original_file_id,
               original_sha256, bound_package_id, bind_event_id, maker_user_id, submitted_at,
               verification_code, signing_key_id)
        SELECT ${randomUUID()}::uuid, booking_id, customer_org_id, lab_org_id, report_id,
               version_no + 1, 'IN_REVIEW', true, 'DEMO correction', issue_date, original_file_id,
               original_sha256, bound_package_id, bind_event_id, maker_user_id, now(),
               ${randomUUID().slice(0, 16).replaceAll('-', 'X').toUpperCase()}, signing_key_id
          FROM report_version WHERE booking_id = ${amended}::uuid AND status = 'RELEASED'`;
      await make('rejected', 'REJECTED', atA1);
      await make('atLabB', 'REQUESTED', { customer: customerA, lab: labB });
    });
  }, 300_000);

  /** Lab A's inbox, most urgent first: deadlines in order, then the approvals by status time. */
  const expected = () => [
    ids.requestedA2,
    ids.requested,
    ids.countered,
    ids.accepted,
    ids.paid,
    ids.handover,
    ids.amended,
    ids.sample,
    ids.report,
  ];

  it('lists the open bookings of the assigned sites, most urgent first, and no terminal one', async () => {
    const response = await inbox(w.labA.user('LAB_CHECKER'), '?limit=100');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(idsOf(response.body)).toEqual(expected());
    const first = itemOf(response.body, ids.requested);
    expect(first?.booking.lineCount).toBe(1);
    expect(first?.booking.declaredPackageCount).toBe(1);
    expect(first?.booking.total.currency).toBe('INR');
    expect(first?.booking.customerDisplayName).toBeTruthy();
    expect(first?.pendingApproval).toBeNull();
    expect(first?.viewerWasMaker).toBe(false);
  });

  it('marks the receipt and the report waiting for a Checker, and who made them', async () => {
    const checker = await inbox(w.labA.user('LAB_CHECKER'), '?limit=100');
    expect(itemOf(checker.body, ids.sample)).toMatchObject({
      pendingApproval: 'RECEIPT',
      viewerWasMaker: false,
    });
    expect(itemOf(checker.body, ids.report)).toMatchObject({
      pendingApproval: 'REPORT',
      viewerWasMaker: false,
    });
    expect(itemOf(checker.body, ids.amended)).toMatchObject({
      booking: { status: 'COMPLETED' },
      pendingApproval: 'REPORT',
    });
    // The Maker made both, so another Checker must approve them (EC-54).
    const maker = await inbox(w.labA.user('LAB_MAKER'), '?limit=100');
    expect(maker.status).toBe(200);
    expect(itemOf(maker.body, ids.sample)?.viewerWasMaker).toBe(true);
    expect(itemOf(maker.body, ids.report)?.viewerWasMaker).toBe(true);
    expect(itemOf(maker.body, ids.requested)?.viewerWasMaker).toBe(false);
  });

  it('keeps a Maker of one site to that site, and another lab to its own bookings', async () => {
    const siteMaker = await inbox(w.siteMaker, '?limit=100');
    expect(idsOf(siteMaker.body)).toEqual(expected().filter((id) => id !== ids.requestedA2));
    const otherLab = await inbox(w.labB.user('LAB_CHECKER'), '?limit=100');
    expect(idsOf(otherLab.body)).toEqual([ids.atLabB]);
  });

  it('filters by status, terminal ones included when asked, and by one of the sites', async () => {
    const checker = w.labA.user('LAB_CHECKER');
    const requested = await inbox(checker, '?status=REQUESTED,COMPLETED');
    expect(requested.status).toBe(200);
    expect(idsOf(requested.body)).toEqual([
      ids.requestedA2,
      ids.requested,
      ids.completed,
      ids.amended,
    ]);
    const site2 = await inbox(checker, `?siteId=${siteA2Id}`);
    expect(idsOf(site2.body)).toEqual([ids.requestedA2]);
  });

  it("refuses a site that is not one of the caller's with 404", async () => {
    const notAssigned = await inbox(w.siteMaker, `?siteId=${siteA2Id}`);
    expect(notAssigned.status).toBe(404);
    expect((notAssigned.body as { code: string }).code).toBe('NOT_FOUND');
    const unknown = await inbox(w.labA.user('LAB_CHECKER'), `?siteId=${randomUUID()}`);
    expect(unknown.status).toBe(404);
    const assigned = await inbox(w.siteMaker, `?siteId=${siteA1Id}`);
    expect(assigned.status).toBe(200);
  });

  it('walks the pages with the cursor in the same order', async () => {
    const checker = w.labA.user('LAB_CHECKER');
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = await inbox(checker, query);
      expect(page.status).toBe(200);
      seen.push(...idsOf(page.body));
      cursor = (page.body as InboxBody).page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(expected());

    // A cursor with only an id (no position) is not a cursor of this list.
    const idOnly = Buffer.from(JSON.stringify({ i: ids.atLabB }), 'utf8').toString('base64url');
    const refused = await inbox(checker, `?cursor=${idOnly}`, 'cursor is not valid');
    expect(refused.status).toBe(422);
    // A forged position only moves the start among the caller's own rows.
    const forged = Buffer.from(
      JSON.stringify({ d: '0', s: '0', i: '00000000-0000-0000-0000-000000000000' }),
      'utf8',
    ).toString('base64url');
    const all = await inbox(checker, `?limit=100&cursor=${forged}`);
    expect(idsOf(all.body)).toEqual(expected());
  });

  it('keeps its place when the last booking of a page changes before the next page', async () => {
    const checker = w.labA.user('LAB_CHECKER');
    const first = await inbox(checker, '?limit=2');
    expect(idsOf(first.body)).toEqual([ids.requestedA2, ids.requested]);
    const cursor = (first.body as InboxBody).page.nextCursor;
    // The Checker acts on the last row: its deadline and status time move.
    const moved = (sql: string) => t.owner((tx) => tx.$executeRawUnsafe(sql, ids.requested ?? ''));
    await moved(
      `UPDATE booking SET lab_decision_due_at = now() + interval '30 days', status_changed_at = now() WHERE id = $1::uuid`,
    );
    try {
      const second = await inbox(checker, `?limit=2&cursor=${String(cursor)}`);
      expect(idsOf(second.body)).toEqual([ids.countered, ids.accepted]);
    } finally {
      await moved(
        `UPDATE booking SET lab_decision_due_at = '2026-12-01T05:30:00Z' WHERE id = $1::uuid`,
      );
    }
  });

  it('refuses bad parameters with 422', async () => {
    const checker = w.labA.user('LAB_CHECKER');
    const cases: [string, string][] = [
      ['?status=SHIPPED', 'status'],
      ['?status=REQUESTED,REQUESTED', 'status'],
      ['?siteId=not-a-uuid', 'siteId'],
      ['?cursor=not-a-cursor', 'cursor'],
      ['?limit=101', 'limit'],
      ['?scope=lab', 'scope'],
    ];
    for (const [query, reason] of cases) {
      const response = await inbox(checker, query, `${reason} is not valid`);
      expect(response.status, query).toBe(422);
      expect((response.body as { code: string }).code, query).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a customer membership and platform staff with 403', async () => {
    for (const user of [w.customerA.user('CUSTOMER_ADMIN'), w.platform.user('PLATFORM_OPS')]) {
      const response = await inbox(user);
      expect(response.status, user.role).toBe(403);
      expect((response.body as { code: string }).code).toBe('FORBIDDEN');
    }
  });

  it('needs a session', async () => {
    const response = await t.api.get('/v1/lab/inbox');
    expect(response.status).toBe(401);
  });
});
