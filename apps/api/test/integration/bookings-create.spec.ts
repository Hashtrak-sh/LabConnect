import { randomUUID } from 'node:crypto';
import { ROLES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../support/identity-app.js';
import { buildWorld, type TenantUser, type World } from '../support/isolation/world.js';

// Booking submission over HTTP, held to the contract, on a real database (I3-CUS-01): the
// estimate, the duplicate warning, `createBooking` (T-01: number, lines, TRF, soft hold, decision
// timers, BR-015) and `updateBooking` (T-02: new TRF version, re-priced lines, the hold moved,
// the clock restarted), and who may do what.

interface ViewBody {
  id: string;
  viewerParty: string;
  bookingNo: string;
  status: string;
  lockVersion: number;
  labDecisionDueAt: string | null;
  slot: { id: string } | null;
  lines: { scopeLineId: string; snapshot: { parameter: { code: string } } }[];
  trf: { versionNo: number; form: Record<string, unknown> };
  total: { amountPaise: number };
}

describe('bookings: submit and edit', () => {
  const t = useIdentityApp();
  let w: World;
  const tokens = new Map<string, string>();
  let siteId: string;
  let otherSiteId: string;
  let lineIds: string[];
  let foreignLineId: string;

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
  const owner = () => w.customerA.user('CUSTOMER_REQUESTER');
  const admin = () => w.customerA.user('CUSTOMER_ADMIN');
  const post = async (user: TenantUser, path: string, body: object, invalidRequest?: string) =>
    t.api.post(`/v1/bookings${path}`, {
      token: await tokenOf(user),
      headers: { 'Idempotency-Key': randomUUID() },
      body,
      ...(invalidRequest !== undefined && { invalidRequest }),
    });
  const one = async <T>(sql: string, args: unknown[]) =>
    (await t.db().query<T & Record<string, unknown>>(sql, args)).rows[0];
  /** Open slots of a site with room, from the test clock on, soonest first. */
  const openSlots = async (site: string) =>
    (
      await t.db().query<{ id: string; day: string }>(
        `SELECT id, slot_date::text AS day FROM slot
          WHERE lab_site_id = $1 AND status = 'OPEN' AND held_count + booked_count < capacity
            AND starts_at > $2 ORDER BY starts_at`,
        [site, t.clock.now()],
      )
    ).rows;
  const trf = (itemName: string, batchNo = 'B-1') => ({
    schemaVersion: 'trf.v1',
    form: { itemName, batchNo },
    conformityRequired: false,
  });
  const createBody = async (overrides: object = {}) => {
    const slot = (await openSlots(siteId))[0];
    return {
      labSiteId: siteId,
      slotId: slot?.id,
      preferredDropDate: slot?.day,
      declaredPackageCount: 1,
      lines: [{ scopeLineId: lineIds[0] }],
      trf: trf(`DEMO item ${randomUUID().slice(0, 6)}`),
      ...overrides,
    };
  };

  beforeAll(async () => {
    w = await buildWorld(t);
    const [site, other] = w.fixtures.labA.sites;
    if (!site || !other) throw new Error('lab A needs two sites');
    siteId = site.id;
    otherSiteId = other.id;
    lineIds = site.scopeLines.map((line) => line.id);
    foreignLineId = other.scopeLines[0]?.id ?? '';
    // The world publishes its price lists at the real time (a published list cannot be
    // back-dated); the app's clock starts before that, so it moves to now, before anyone signs in.
    t.clock.set(new Date(Date.now() + 60_000));
  }, 300_000);

  it('estimates: line prices + GST = total, platform fee zero, nothing held', async () => {
    const before = (await openSlots(siteId))[0];
    const response = await post(admin(), '/estimate', {
      labSiteId: siteId,
      lines: lineIds.slice(0, 2).map((scopeLineId) => ({ scopeLineId })),
      slotId: before?.id,
    });
    expect(response.status).toBe(200);
    const body = response.body as {
      lines: { lineTotal: { amountPaise: number } }[];
      subtotal: { amountPaise: number };
      gst: { amountPaise: number };
      platformFee: { amountPaise: number };
      total: { amountPaise: number };
    };
    expect(body.lines).toHaveLength(Math.min(2, lineIds.length));
    expect(body.platformFee.amountPaise).toBe(0);
    expect(body.total.amountPaise).toBe(body.subtotal.amountPaise + body.gst.amountPaise);
    expect(body.lines.reduce((sum, line) => sum + line.lineTotal.amountPaise, 0)).toBe(
      body.total.amountPaise,
    );
    const slot = await one<{ held_count: number }>('SELECT held_count FROM slot WHERE id = $1', [
      before?.id,
    ]);
    expect(slot?.held_count).toBe(0);
  });

  it("refuses another site's line (SCOPE_LINE_NOT_BOOKABLE per line) and an unknown site", async () => {
    const line = await post(admin(), '/estimate', {
      labSiteId: siteId,
      lines: [{ scopeLineId: lineIds[0] }, { scopeLineId: foreignLineId }],
    });
    expect(line.status).toBe(422);
    expect(line.body).toMatchObject({
      code: 'SCOPE_LINE_NOT_BOOKABLE',
      errors: [{ path: 'lines[1].scopeLineId' }],
    });
    const site = await post(admin(), '/estimate', {
      labSiteId: randomUUID(),
      lines: [{ scopeLineId: lineIds[0] }],
    });
    expect(site.status).toBe(422);
    expect((site.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('submits: REQUESTED with a booking number, snapshot lines, TRF v1, a soft hold and the decision timers', async () => {
    const body = await createBody();
    const before = await one<{ held_count: number }>('SELECT held_count FROM slot WHERE id = $1', [
      body.slotId,
    ]);
    const response = await post(owner(), '', body);
    expect(response.status).toBe(201);
    const view = response.body as ViewBody;
    expect(view).toMatchObject({
      viewerParty: 'CUSTOMER',
      status: 'REQUESTED',
      slot: { id: body.slotId },
    });
    expect(view.bookingNo).toMatch(/^LC-\d{4}-\d{7}$/);
    expect(response.headers.etag).toBe(`"${String(view.lockVersion)}"`);
    expect(view.lines.map((line) => line.scopeLineId)).toEqual([lineIds[0]]);
    expect(view.lines[0]?.snapshot.parameter.code).toBeTruthy();
    expect(view.trf).toMatchObject({ versionNo: 1, form: body.trf.form });
    expect(Date.parse(view.labDecisionDueAt ?? '')).toBeGreaterThan(t.clock.now().getTime());
    const hold = await one<{ kind: string; expires_at: Date }>(
      'SELECT kind, expires_at FROM slot_hold WHERE booking_id = $1 AND released_at IS NULL',
      [view.id],
    );
    expect(hold?.kind).toBe('SOFT');
    expect(hold?.expires_at.getTime()).toBeGreaterThan(Date.parse(view.labDecisionDueAt ?? ''));
    const after = await one<{ held_count: number }>('SELECT held_count FROM slot WHERE id = $1', [
      body.slotId,
    ]);
    expect(after?.held_count).toBe((before?.held_count ?? 0) + 1);
    const timers = await t
      .db()
      .query<{ timer_type: string }>(
        "SELECT timer_type FROM timer WHERE aggregate_id = $1 AND status = 'PENDING' ORDER BY timer_type",
        [view.id],
      );
    expect(timers.rows.map((row) => row.timer_type).sort()).toEqual([
      'LAB_DECISION_DUE',
      'LAB_DECISION_REMINDER_50',
      'LAB_DECISION_REMINDER_90',
    ]);
  });

  it('warns of a duplicate: same item, batch and tests, but not another batch', async () => {
    const body = await createBody({ trf: trf('DEMO duplicate item', 'DUP-1') });
    expect((await post(admin(), '', body)).status).toBe(201);
    const same = await post(admin(), '/duplicate-check', {
      itemName: ' demo duplicate ITEM ',
      batchNo: 'DUP-1',
      lines: [{ scopeLineId: lineIds[0] }],
    });
    expect(same.status).toBe(200);
    expect(same.body).toMatchObject({
      duplicateFound: true,
      windowDays: 7,
      matches: [{ status: 'REQUESTED' }],
    });
    const other = await post(admin(), '/duplicate-check', {
      itemName: 'DEMO duplicate item',
      batchNo: 'DUP-2',
      lines: [{ scopeLineId: lineIds[0] }],
    });
    expect(other.body).toMatchObject({ duplicateFound: false, matches: [] });
  });

  it('refuses a bad form, a slot of another site, a full slot, onBehalfOf and the wrong roles', async () => {
    const badForm = await post(
      owner(),
      '',
      await createBody({
        trf: { schemaVersion: 'trf.v1', form: { colour: 'red' }, conformityRequired: false },
      }),
    );
    expect(badForm.status).toBe(422);
    const paths = (badForm.body as { errors: { path: string }[] }).errors.map((e) => e.path).sort();
    expect(paths).toEqual(['trf.form', 'trf.form.itemName']);

    const foreign = (await openSlots(otherSiteId))[0];
    const wrongSite = await post(
      owner(),
      '',
      await createBody({ slotId: foreign?.id, preferredDropDate: foreign?.day }),
    );
    expect(wrongSite.status).toBe(422);
    expect((wrongSite.body as { errors: { path: string }[] }).errors[0]?.path).toBe('slotId');

    const full = await createBody();
    await t.owner(
      (tx) => tx.$executeRaw`UPDATE slot SET status = 'CLOSED' WHERE id = ${full.slotId}::uuid`,
    );
    try {
      const closed = await post(owner(), '', full);
      expect(closed.status).toBe(409);
      expect((closed.body as { code: string }).code).toBe('SLOT_UNAVAILABLE');
    } finally {
      await t.owner(
        (tx) => tx.$executeRaw`UPDATE slot SET status = 'OPEN' WHERE id = ${full.slotId}::uuid`,
      );
    }

    const onBehalf = await post(admin(), '', {
      ...(await createBody()),
      onBehalfOf: { customerOrgId: randomUUID(), requesterUserId: randomUUID() },
    });
    expect(onBehalf.status).toBe(403);
    for (const user of [
      w.customerA.user('CUSTOMER_FINANCE'),
      w.labA.user('LAB_CHECKER'),
      w.platform.user('PLATFORM_OPS'),
    ]) {
      expect((await post(user, '', await createBody())).status, user.role).toBe(403);
    }
    expect(
      (
        await post(w.labA.user('LAB_MAKER'), '/estimate', {
          labSiteId: siteId,
          lines: [{ scopeLineId: lineIds[0] }],
        })
      ).status,
    ).toBe(403);
  });

  it('stops at the open-request limit (BR-015) with 429', async () => {
    await t.owner(
      (tx) =>
        tx.$executeRaw`UPDATE config_parameter SET value = '1'::jsonb WHERE key = 'booking.max_open_requests_per_customer'`,
    );
    try {
      const response = await post(w.customerB.user('CUSTOMER_ADMIN'), '', await createBody());
      const second = await post(w.customerB.user('CUSTOMER_ADMIN'), '', await createBody());
      expect([response.status, second.status]).toContain(429);
      const limited = [response, second].find((r) => r.status === 429);
      expect((limited?.body as { code: string }).code).toBe('OPEN_BOOKING_LIMIT');
    } finally {
      await t.owner(
        (tx) =>
          tx.$executeRaw`UPDATE config_parameter SET value = '10'::jsonb WHERE key = 'booking.max_open_requests_per_customer'`,
      );
    }
  });

  it('edits: new TRF version, lines re-priced and replaced, the hold moved, the clock restarted', async () => {
    const created = (await post(owner(), '', await createBody())).body as ViewBody;
    const target = (await openSlots(siteId)).find((slot) => slot.id !== created.slot?.id);
    const oldSlot = created.slot?.id ?? '';
    const oldHeld = await one<{ held_count: number }>('SELECT held_count FROM slot WHERE id = $1', [
      oldSlot,
    ]);
    const newLines = lineIds.slice(0, 2).map((scopeLineId) => ({ scopeLineId }));
    const response = await t.api.patch(`/v1/bookings/${created.id}`, {
      token: await tokenOf(owner()),
      headers: { 'If-Match': `"${String(created.lockVersion)}"` },
      body: {
        lines: newLines,
        slotId: target?.id,
        preferredDropDate: target?.day,
        trf: trf('DEMO edited item', 'B-2'),
      },
    });
    expect(response.status).toBe(200);
    const view = response.body as ViewBody;
    expect(view.status).toBe('REQUESTED');
    expect(view.lockVersion).toBeGreaterThan(created.lockVersion);
    expect(view.trf).toMatchObject({
      versionNo: 2,
      form: { itemName: 'DEMO edited item', batchNo: 'B-2' },
    });
    expect(view.lines.map((line) => line.scopeLineId)).toEqual(
      newLines.map((line) => line.scopeLineId),
    );
    expect(view.slot?.id).toBe(target?.id);
    const live = await one<{ slot_id: string; kind: string }>(
      'SELECT slot_id, kind FROM slot_hold WHERE booking_id = $1 AND released_at IS NULL',
      [created.id],
    );
    expect(live).toEqual({ slot_id: target?.id, kind: 'SOFT' });
    expect(
      (await one<{ held_count: number }>('SELECT held_count FROM slot WHERE id = $1', [oldSlot]))
        ?.held_count,
    ).toBe((oldHeld?.held_count ?? 0) - 1);
    const timers = await t
      .db()
      .query(
        "SELECT 1 FROM timer WHERE aggregate_id = $1 AND status = 'PENDING' AND timer_type = 'LAB_DECISION_DUE'",
        [created.id],
      );
    expect(timers.rowCount).toBe(1);

    // The version it was shown at, a colleague requester, and a booking no longer REQUESTED.
    const stale = await t.api.patch(`/v1/bookings/${created.id}`, {
      token: await tokenOf(owner()),
      headers: { 'If-Match': `"${String(created.lockVersion)}"` },
      body: { declaredPackageCount: 2 },
    });
    expect(stale.status).toBe(412);
    const colleague = await t.api.patch(`/v1/bookings/${created.id}`, {
      token: await tokenOf(w.dual.inA),
      headers: { 'If-Match': `"${String(view.lockVersion)}"` },
      body: { declaredPackageCount: 2 },
    });
    expect(colleague.status).toBe(403);
    const cancelled = await t.api.post(`/v1/bookings/${created.id}/cancel`, {
      token: await tokenOf(owner()),
      headers: { 'If-Match': `"${String(view.lockVersion)}"`, 'Idempotency-Key': randomUUID() },
      body: { reasonCode: 'CUSTOMER_REQUEST' },
    });
    const late = await t.api.patch(`/v1/bookings/${created.id}`, {
      token: await tokenOf(owner()),
      headers: { 'If-Match': `"${String((cancelled.body as ViewBody).lockVersion)}"` },
      body: { declaredPackageCount: 2 },
    });
    expect(late.status).toBe(409);
  });
});
