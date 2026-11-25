import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../support/identity-app.js';

// listNotifications, markNotificationRead, listNotificationPreferences and
// updateNotificationPreferences over HTTP, through contractRequest(), on a real database as the
// API role under row-level security.

interface Item {
  id: string;
  organisationId: string;
  eventCode: string;
  isActionRequired: boolean;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}
interface ListBody {
  data: Item[];
  page: { nextCursor: string | null; limit: number };
}

describe('notifications over HTTP', () => {
  const t = useIdentityApp();
  let fixtures: Awaited<ReturnType<typeof t.fixtures>>;
  let requester: string;
  let admin: string;
  let requesterToken: string;
  let adminToken: string;
  const created: Record<string, string[]> = {};

  /** Writes a notification row as the owner (the worker's consumer does this in production). */
  const insert = async (
    userId: string,
    organisationId: string,
    options: {
      eventCode?: string;
      channel?: 'IN_APP' | 'EMAIL';
      status?: string;
      actionRequired?: boolean;
      at?: Date;
      payload?: Record<string, unknown>;
    } = {},
  ): Promise<string> => {
    const id = randomUUID();
    await t.db().query(
      `INSERT INTO notification (id, recipient_user_id, organisation_id, event_code, event_id, channel,
                                 template_version, payload, is_action_required, status, sent_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::notif_channel, 0, $7::jsonb, $8, $9::notif_status, $10, $10)`,
      [
        id,
        userId,
        organisationId,
        options.eventCode ?? 'booking.accepted',
        randomUUID(),
        options.channel ?? 'IN_APP',
        JSON.stringify(options.payload ?? { bookingNo: 'LC-1' }),
        options.actionRequired ?? false,
        options.status ?? 'SENT',
        options.at ?? t.clock.now(),
      ],
    );
    (created[userId] ??= []).push(id);
    return id;
  };

  const auth = (token: string, extra: Record<string, string> = {}) => ({
    token,
    headers: extra,
  });

  beforeAll(async () => {
    fixtures = await t.fixtures();
    requester = fixtures.customer.requester.id;
    admin = fixtures.customer.admin.id;
    requesterToken = (await t.signIn(fixtures.customer.requester.email)).accessToken;
    adminToken = (await t.signIn(fixtures.customer.admin.email)).accessToken;
  });

  describe('GET /v1/me/notifications', () => {
    it('lists the in-app notifications of the active organisation, newest first, in the contract shape', async () => {
      const org = fixtures.customer.organisationId;
      const older = await insert(requester, org, {
        eventCode: 'booking.expired',
        at: new Date('2026-11-25T09:00:00Z'),
      });
      const newer = await insert(requester, org, {
        eventCode: 'booking.accepted',
        actionRequired: true,
        at: new Date('2026-11-25T09:30:00Z'),
        payload: { bookingNo: 'LC-9', labName: 'DEMO Lab', actionUrl: '/bookings/x' },
      });
      // Not in the inbox: an email row, a muted row, and another user's row.
      await insert(requester, org, { channel: 'EMAIL', status: 'QUEUED' });
      await insert(requester, org, { status: 'SUPPRESSED' });
      await insert(admin, org);

      const response = await t.api.get('/v1/me/notifications', auth(requesterToken));
      expect(response.status).toBe(200);
      const body = response.body as ListBody;
      expect(body.data.map((item) => item.id)).toEqual([newer, older]);
      expect(body.page).toEqual({ nextCursor: null, limit: 25 });
      expect(body.data[0]).toEqual({
        id: newer,
        organisationId: org,
        eventCode: 'booking.accepted',
        isActionRequired: true,
        payload: { bookingNo: 'LC-9', labName: 'DEMO Lab', actionUrl: '/bookings/x' },
        createdAt: '2026-11-25T09:30:00.000Z',
        readAt: null,
      });
    });

    it('pages with limit and nextCursor, and filters the unread', async () => {
      const org = fixtures.customer.organisationId;
      const base = new Date('2026-11-25T08:00:00Z').getTime();
      const ids: string[] = [];
      for (let n = 0; n < 5; n += 1) {
        ids.push(
          await insert(admin, org, {
            eventCode: 'booking.rejected',
            at: new Date(base + n * 1000),
          }),
        );
      }
      // The same instant for two rows: the cursor must not skip one.
      ids.push(
        await insert(admin, org, { eventCode: 'booking.rejected', at: new Date(base + 4000) }),
      );

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const query = `?limit=2${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
        const response = await t.api.get(`/v1/me/notifications${query}`, auth(adminToken));
        expect(response.status).toBe(200);
        const body = response.body as ListBody;
        expect(body.page.limit).toBe(2);
        seen.push(
          ...body.data
            .filter((item) => item.eventCode === 'booking.rejected')
            .map((item) => item.id),
        );
        cursor = body.page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor !== undefined && pages < 20);
      expect(new Set(seen).size).toBe(6);
      expect([...seen].sort()).toEqual([...ids].sort());

      const first = ids[0] ?? '';
      expect(
        (await t.api.post(`/v1/me/notifications/${first}/read`, auth(adminToken))).status,
      ).toBe(204);
      const unread = await t.api.get(
        '/v1/me/notifications?unread=true&limit=100',
        auth(adminToken),
      );
      const unreadIds = (unread.body as ListBody).data.map((item) => item.id);
      expect(unreadIds).not.toContain(first);
      expect(unreadIds).toContain(ids[1]);
      const all = await t.api.get('/v1/me/notifications?unread=false&limit=100', auth(adminToken));
      expect((all.body as ListBody).data.find((item) => item.id === first)?.readAt).not.toBeNull();
    });

    it('is empty for a user with no membership, and 401 without a token', async () => {
      const email = t.newEmail('nomember');
      const { accessToken } = await t.signIn(email);
      const response = await t.api.get('/v1/me/notifications', auth(accessToken));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: [], page: { nextCursor: null, limit: 25 } });
      const anonymous = await t.api.get('/v1/me/notifications');
      expect(anonymous.status).toBe(401);
      expect(anonymous.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it("answers 404 for an X-Active-Membership that is not the user's, and keeps to the chosen organisation", async () => {
      const foreign = await t.personOf(fixtures.individual.admin.id);
      const stolen = await t
        .db()
        .query<{ id: string }>('SELECT id FROM membership WHERE user_id = $1', [foreign.id]);
      const response = await t.api.get(
        '/v1/me/notifications',
        auth(requesterToken, { 'X-Active-Membership': stolen.rows[0]?.id ?? '' }),
      );
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('answers 422 for an unreadable cursor and for a limit out of range', async () => {
      for (const query of ['cursor=garbage', 'limit=0', 'limit=101', 'limit=abc', 'unread=maybe']) {
        const response = await t.api.get(`/v1/me/notifications?${query}`, {
          ...auth(requesterToken),
          invalidRequest: 'the invalid query is the point of this test',
        });
        expect(response.status, query).toBe(422);
        expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
    });
  });

  describe('POST /v1/me/notifications/{id}/read', () => {
    it('sets readAt once and answers 204 each time', async () => {
      const id = await insert(requester, fixtures.customer.organisationId);
      const first = await t.api.post(`/v1/me/notifications/${id}/read`, auth(requesterToken));
      expect(first.status).toBe(204);
      expect(first.text).toBe('');
      const readAt = (
        await t
          .db()
          .query<{ read_at: Date }>('SELECT read_at FROM notification WHERE id = $1', [id])
      ).rows[0]?.read_at;
      expect(readAt).toBeInstanceOf(Date);
      t.clock.advance(60_000);
      expect(
        (await t.api.post(`/v1/me/notifications/${id}/read`, auth(requesterToken))).status,
      ).toBe(204);
      const again = (
        await t
          .db()
          .query<{ read_at: Date }>('SELECT read_at FROM notification WHERE id = $1', [id])
      ).rows[0]?.read_at;
      expect(again).toEqual(readAt);
    });

    it("answers 404 for another user's notification, an unknown id and a malformed id, and marks nothing", async () => {
      const others = await insert(admin, fixtures.customer.organisationId);
      for (const id of [others, randomUUID(), 'not-a-uuid']) {
        const response = await t.api.post(`/v1/me/notifications/${id}/read`, {
          ...auth(requesterToken),
          invalidRequest: 'a malformed id is the point of this case',
        });
        expect(response.status, id).toBe(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      }
      const row = await t
        .db()
        .query('SELECT 1 FROM notification WHERE id = $1 AND read_at IS NOT NULL', [others]);
      expect(row.rowCount).toBe(0);
    });

    it('answers 401 without a token', async () => {
      const id = await insert(requester, fixtures.customer.organisationId);
      expect((await t.api.post(`/v1/me/notifications/${id}/read`)).status).toBe(401);
    });
  });

  describe('/v1/me/notification-preferences', () => {
    it('lists nothing until a preference is stored, then what was stored', async () => {
      const empty = await t.api.get('/v1/me/notification-preferences', auth(adminToken));
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ data: [], page: { nextCursor: null, limit: 25 } });

      const saved = await t.api.patch('/v1/me/notification-preferences', {
        ...auth(adminToken),
        body: {
          preferences: [
            { eventCode: 'booking.expired', channel: 'EMAIL', muted: true },
            { eventCode: 'booking.accepted', channel: 'EMAIL', muted: true }, // action required: stored, no effect when sending
          ],
        },
      });
      expect(saved.status).toBe(204);
      expect(saved.text).toBe('');

      const listed = await t.api.get('/v1/me/notification-preferences', auth(adminToken));
      expect(listed.body).toEqual({
        data: [
          { eventCode: 'booking.accepted', channel: 'EMAIL', muted: true },
          { eventCode: 'booking.expired', channel: 'EMAIL', muted: true },
        ],
        page: { nextCursor: null, limit: 25 },
      });

      // Unmuting overwrites; pairs that are not listed stay as they were.
      await t.api.patch('/v1/me/notification-preferences', {
        ...auth(adminToken),
        body: { preferences: [{ eventCode: 'booking.expired', channel: 'EMAIL', muted: false }] },
      });
      const after = await t.api.get('/v1/me/notification-preferences?limit=1', auth(adminToken));
      const afterBody = after.body as { data: unknown[]; page: { nextCursor: string | null } };
      expect(afterBody.data).toEqual([
        { eventCode: 'booking.accepted', channel: 'EMAIL', muted: true },
      ]);
      const next = await t.api.get(
        `/v1/me/notification-preferences?limit=1&cursor=${encodeURIComponent(afterBody.page.nextCursor ?? '')}`,
        auth(adminToken),
      );
      expect((next.body as { data: unknown[] }).data).toEqual([
        { eventCode: 'booking.expired', channel: 'EMAIL', muted: false },
      ]);
    });

    it("keeps one user's settings from another", async () => {
      await t.api.patch('/v1/me/notification-preferences', {
        ...auth(adminToken),
        body: { preferences: [{ eventCode: 'report.released', channel: 'IN_APP', muted: true }] },
      });
      const other = await t.api.get('/v1/me/notification-preferences', auth(requesterToken));
      expect(JSON.stringify(other.body)).not.toContain('report.released');
    });

    it('answers 422 for an unknown event code, an unknown field and an empty list, and stores nothing', async () => {
      const before = (await t.db().query('SELECT 1 FROM notification_preference')).rowCount;
      for (const body of [
        { preferences: [{ eventCode: 'auth.otp', channel: 'EMAIL', muted: true }] },
        { preferences: [{ eventCode: 'nope', channel: 'EMAIL', muted: true }] },
        { preferences: [{ eventCode: 'booking.accepted', channel: 'FAX', muted: true }] },
        { preferences: [{ eventCode: 'booking.accepted', channel: 'EMAIL', muted: 'yes' }] },
        {
          preferences: [{ eventCode: 'booking.accepted', channel: 'EMAIL', muted: true, extra: 1 }],
        },
        { preferences: [] },
        {
          preferences: [{ eventCode: 'booking.accepted', channel: 'EMAIL', muted: true }],
          userId: 'x',
        },
        {},
      ]) {
        const response = await t.api.patch('/v1/me/notification-preferences', {
          ...auth(adminToken),
          body,
          invalidRequest: 'invalid bodies are the point of this test',
        });
        expect(response.status, JSON.stringify(body)).toBe(422);
        expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      expect((await t.db().query('SELECT 1 FROM notification_preference')).rowCount).toBe(before);
    });

    it('answers 400 for a body that is not JSON and 401 without a token', async () => {
      const malformed = await t.api.patch('/v1/me/notification-preferences', {
        ...auth(adminToken),
        headers: { 'Content-Type': 'application/json' },
        body: '{"preferences": ',
        invalidRequest: 'malformed JSON must give 400',
      });
      expect(malformed.status).toBe(400);
      const anonymous = await t.api.patch('/v1/me/notification-preferences', {
        body: { preferences: [{ eventCode: 'booking.accepted', channel: 'EMAIL', muted: true }] },
      });
      expect(anonymous.status).toBe(401);
    });
  });
});
