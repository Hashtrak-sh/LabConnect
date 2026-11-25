import type { Prisma } from '@labconnect/database';
import { uuidv7 } from '@labconnect/database/test-utils';
import { describe, expect, it } from 'vitest';
import {
  handleNotificationEvent,
  type InboxItem,
  NotificationInbox,
  type Page,
  type PreferenceItem,
} from '../../src/index.js';
import { sqlState } from './support.js';
import { useNotifications } from './notifications-support.js';

// P3-08: what a user sees of their own notifications, under the real role and row-level security.

describe('NotificationInbox', () => {
  const t = useNotifications();

  const asUser = <T>(userId: string, work: (inbox: NotificationInbox) => Promise<T>): Promise<T> =>
    t.scope().runAsUser(userId, (tx) => work(new NotificationInbox(tx, userId, t.clock)));

  /** One in-app notification for the requester of booking A per call, a second apart. */
  const notify = async (type = 'booking.accepted'): Promise<string> => {
    t.clock.advance(1000);
    const event = t.event(type, t.booking());
    await handleNotificationEvent(t.deps(), event);
    return event.id;
  };

  const idOf = async (eventId: string, userId: string): Promise<string> =>
    (
      await t
        .db()
        .query<{ id: string }>(
          `SELECT id::text FROM notification WHERE event_id = $1::uuid AND recipient_user_id = $2::uuid AND channel = 'IN_APP'`,
          [eventId, userId],
        )
    ).rows[0]?.id ?? '';

  const listAll = async (userId: string, organisationId: string, limit: number) => {
    const seen: InboxItem[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page: Page<InboxItem> = await asUser(userId, (inbox) =>
        inbox.list(organisationId, { limit, cursor }),
      );
      seen.push(...page.data);
      cursor = page.page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 50);
    return { seen, pages };
  };

  it('shows a user only their own in-app notifications of the active organisation, newest first', async () => {
    const { a, b, lab } = t.world();
    const first = await notify('booking.accepted');
    const second = await notify('booking.rejected');
    await notify('booking.requested'); // also gives the lab people rows

    const own = await asUser(a.requester, (inbox) => inbox.list(a.organisationId));
    expect(own.data.map((item) => item.eventCode)).toEqual([
      'booking.requested',
      'booking.rejected',
      'booking.accepted',
    ]);
    expect(own.page).toEqual({ nextCursor: null, limit: 25 });
    expect(own.data.every((item) => item.organisationId === a.organisationId)).toBe(true);
    const accepted = own.data.find((item) => item.eventCode === 'booking.accepted');
    expect(accepted).toMatchObject({ isActionRequired: true, readAt: null });
    expect(accepted?.payload).toMatchObject({ labName: 'DEMO Lab' });
    expect(own.data.map((item) => item.id)).toContain(await idOf(first, a.requester));
    expect(own.data.map((item) => item.id)).toContain(await idOf(second, a.requester));

    // Others see their own, not this user's.
    const checker = await asUser(lab.checker, (inbox) => inbox.list(lab.organisationId));
    expect(checker.data.map((item) => item.eventCode)).toEqual(['booking.requested']);
    const stranger = await asUser(b.requester, (inbox) => inbox.list(b.organisationId));
    expect(stranger.data).toEqual([]);
    // The same user asking for another organisation's inbox gets nothing, not an error.
    const wrongOrg = await asUser(a.requester, (inbox) => inbox.list(b.organisationId));
    expect(wrongOrg.data).toEqual([]);
    // No membership, no inbox.
    expect((await asUser(a.requester, (inbox) => inbox.list(null))).data).toEqual([]);
  });

  it('pages without skipping or repeating a row', async () => {
    const { a } = t.world();
    for (let n = 0; n < 4; n += 1) await notify('booking.expired');
    // Two events in the same instant: the cursor must still separate them.
    const event = t.event('booking.expired', t.booking());
    await handleNotificationEvent(t.deps(), event);
    await handleNotificationEvent(t.deps(), t.event('booking.expired', t.booking()));

    const whole = await asUser(a.requester, (inbox) =>
      inbox.list(a.organisationId, { limit: 100 }),
    );
    for (const size of [1, 2, 3, 100]) {
      const { seen } = await listAll(a.requester, a.organisationId, size);
      expect(
        seen.map((item) => item.id),
        `limit ${String(size)}`,
      ).toEqual(whole.data.map((item) => item.id));
    }
    expect(new Set(whole.data.map((item) => item.id)).size).toBe(whole.data.length);
    const firstPage = await asUser(a.requester, (inbox) =>
      inbox.list(a.organisationId, { limit: 2 }),
    );
    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.page.nextCursor).toEqual(expect.any(String));
    expect(firstPage.page.limit).toBe(2);
  });

  it('refuses an unreadable cursor and a page size out of range', async () => {
    const { a } = t.world();
    for (const cursor of [
      'nope',
      Buffer.from('{"t":"x","i":"y"}').toString('base64url'),
      Buffer.from('[]').toString('base64url'),
    ]) {
      await expect(
        asUser(a.requester, (inbox) => inbox.list(a.organisationId, { cursor })),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    for (const limit of [0, 101, -1, 1.5]) {
      await expect(
        asUser(a.requester, (inbox) => inbox.list(a.organisationId, { limit })),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
  });

  it('marks a notification read once, and filters the unread', async () => {
    const { a } = t.world();
    const eventId = await notify('booking.no_show');
    const id = await idOf(eventId, a.requester);
    const before = await asUser(a.requester, (inbox) =>
      inbox.list(a.organisationId, { unread: true }),
    );
    expect(before.data.map((item) => item.id)).toContain(id);

    await asUser(a.requester, (inbox) => inbox.markRead(a.organisationId, id));
    const readAt = (
      await t
        .db()
        .query<{ read_at: Date }>('SELECT read_at FROM notification WHERE id = $1::uuid', [id])
    ).rows[0]?.read_at;
    expect(readAt).toEqual(t.clock.now());

    t.clock.advance(60_000);
    await asUser(a.requester, (inbox) => inbox.markRead(a.organisationId, id)); // again: changes nothing
    const again = (
      await t
        .db()
        .query<{ read_at: Date }>('SELECT read_at FROM notification WHERE id = $1::uuid', [id])
    ).rows[0]?.read_at;
    expect(again).toEqual(readAt);

    const after = await asUser(a.requester, (inbox) =>
      inbox.list(a.organisationId, { unread: true }),
    );
    expect(after.data.map((item) => item.id)).not.toContain(id);
    const all = await asUser(a.requester, (inbox) => inbox.list(a.organisationId, { limit: 100 }));
    expect(all.data.find((item) => item.id === id)?.readAt).toEqual(readAt);
  });

  it("answers 404 for another user's notification, an unknown id and a wrong organisation", async () => {
    const { a, b, lab } = t.world();
    const eventId = await notify('booking.requested');
    const requesterId = await idOf(eventId, a.requester);
    const checkerId = await idOf(eventId, lab.checker);

    // The checker's id, asked by the requester (and the other way round), and by a user of another tenant.
    for (const [user, org, id] of [
      [a.requester, a.organisationId, checkerId],
      [lab.checker, lab.organisationId, requesterId],
      [b.admin, b.organisationId, requesterId],
      [a.requester, a.organisationId, uuidv7()],
      [a.requester, a.organisationId, 'not-a-uuid'],
      [a.requester, b.organisationId, requesterId], // own row, but not of the active organisation
    ] as const) {
      await expect(asUser(user, (inbox) => inbox.markRead(org, id))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    await expect(
      asUser(a.requester, (inbox) => inbox.markRead(null, requesterId)),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // Nothing was marked read by any of that.
    const unread = await t
      .db()
      .query('SELECT 1 FROM notification WHERE event_id = $1::uuid AND read_at IS NOT NULL', [
        eventId,
      ]);
    expect(unread.rowCount).toBe(0);
  });

  it('keeps a user of two organisations to the active one', async () => {
    const { a, b } = t.world();
    const both = await t.twoOrgUser();
    const aggregateId = uuidv7();
    t.context.set(aggregateId, {
      bookingNo: 'LC-X',
      customers: [{ organisationId: a.organisationId, userIds: [both.userId] }],
    });
    await handleNotificationEvent(t.deps(), t.event('booking.accepted', aggregateId));
    expect((await asUser(both.userId, (inbox) => inbox.list(a.organisationId))).data).toHaveLength(
      1,
    );
    expect((await asUser(both.userId, (inbox) => inbox.list(b.organisationId))).data).toHaveLength(
      0,
    );
  });

  it('never shows a muted notification', async () => {
    const { a } = t.world();
    await asUser(a.requester, (inbox) =>
      inbox.setPreferences([{ eventCode: 'booking.rejected', channel: 'IN_APP', muted: true }]),
    );
    const eventId = await notify('booking.rejected');
    const id = await idOf(eventId, a.requester);
    expect(
      (await t.rowsOf(eventId)).find(
        (row) => row.recipient_user_id === a.requester && row.channel === 'IN_APP',
      )?.status,
    ).toBe('SUPPRESSED');
    const list = await asUser(a.requester, (inbox) => inbox.list(a.organisationId, { limit: 100 }));
    expect(list.data.map((item) => item.id)).not.toContain(id);
    await expect(
      asUser(a.requester, (inbox) => inbox.markRead(a.organisationId, id)),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  describe('row-level security and grants, as the API role', () => {
    it('shows a user only their own rows even to a raw query, and lets them change nothing but read_at', async () => {
      const { a, lab } = t.world();
      const eventId = await notify('booking.requested');
      const checkerRow = await idOf(eventId, lab.checker);
      const ownRow = await idOf(eventId, a.requester);

      const seen = await t.scope().runAsUser(a.requester, async (tx) => {
        const rows = await tx.$queryRaw<
          { recipient_user_id: string }[]
        >`SELECT recipient_user_id::text FROM notification`;
        return rows.map((row) => row.recipient_user_id);
      });
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen)).toEqual(new Set([a.requester]));

      // Another user's row: the update matches no row.
      const touched = await t
        .scope()
        .runAsUser(
          a.requester,
          (tx) =>
            tx.$executeRaw`UPDATE notification SET read_at = now() WHERE id = ${checkerRow}::uuid`,
        );
      expect(touched).toBe(0);
      // Own row, the one column a user may change.
      expect(
        await t
          .scope()
          .runAsUser(
            a.requester,
            (tx) =>
              tx.$executeRaw`UPDATE notification SET read_at = now() WHERE id = ${ownRow}::uuid`,
          ),
      ).toBe(1);

      // Everything else is the worker's: the API role has no privilege on those columns.
      for (const statement of [
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`UPDATE notification SET status = 'FAILED' WHERE id = ${ownRow}::uuid`,
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`UPDATE notification SET payload = '{}'::jsonb WHERE id = ${ownRow}::uuid`,
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`UPDATE notification SET recipient_user_id = ${checkerRow}::uuid WHERE id = ${ownRow}::uuid`,
      ]) {
        const error = await t
          .scope()
          .runAsUser(a.requester, statement)
          .then(
            () => undefined,
            (caught: unknown) => caught,
          );
        expect(sqlState(error)).toBe('42501');
      }
      // Nor can it insert or delete.
      const insert = await t
        .scope()
        .runAsUser(
          a.requester,
          (tx) =>
            tx.$executeRaw`INSERT INTO notification (id, recipient_user_id, organisation_id, event_code, event_id, channel, template_version, payload)
                       VALUES (${uuidv7()}::uuid, ${a.requester}::uuid, ${a.organisationId}::uuid, 'booking.accepted', ${uuidv7()}::uuid, 'IN_APP', 0, '{}'::jsonb)`,
        )
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );
      expect(sqlState(insert)).toBe('42501');
    });
  });

  describe('preferences', () => {
    it("stores, lists and overwrites a user's mute settings, apart from other users", async () => {
      const { a, lab } = t.world();
      const items: PreferenceItem[] = [
        { eventCode: 'booking.accepted', channel: 'EMAIL', muted: true },
        { eventCode: 'booking.accepted', channel: 'IN_APP', muted: false },
        { eventCode: 'booking.expired', channel: 'EMAIL', muted: true },
      ];
      await asUser(a.finance, (inbox) => inbox.setPreferences(items));
      await asUser(lab.checker, (inbox) =>
        inbox.setPreferences([{ eventCode: 'report.submitted', channel: 'EMAIL', muted: true }]),
      );

      const listed = await asUser(a.finance, (inbox) => inbox.listPreferences());
      expect(listed.data).toEqual(items);
      expect(listed.page).toEqual({ nextCursor: null, limit: 25 });

      await asUser(a.finance, (inbox) =>
        inbox.setPreferences([
          { eventCode: 'booking.accepted', channel: 'EMAIL', muted: false },
          { eventCode: 'booking.expired', channel: 'EMAIL', muted: false },
          { eventCode: 'booking.expired', channel: 'EMAIL', muted: true }, // a repeated pair: the last wins
        ]),
      );
      const changed = await asUser(a.finance, (inbox) => inbox.listPreferences());
      expect(changed.data).toEqual([
        { eventCode: 'booking.accepted', channel: 'EMAIL', muted: false },
        { eventCode: 'booking.accepted', channel: 'IN_APP', muted: false },
        { eventCode: 'booking.expired', channel: 'EMAIL', muted: true },
      ]);

      // Paging, in a fixed order.
      const one = await asUser(a.finance, (inbox) => inbox.listPreferences({ limit: 2 }));
      expect(one.data).toHaveLength(2);
      const rest = await asUser(a.finance, (inbox) =>
        inbox.listPreferences({ limit: 2, cursor: one.page.nextCursor ?? undefined }),
      );
      expect([...one.data, ...rest.data]).toEqual(changed.data);
      expect(rest.page.nextCursor).toBeNull();

      const checker = await asUser(lab.checker, (inbox) => inbox.listPreferences());
      expect(checker.data).toEqual([
        { eventCode: 'report.submitted', channel: 'EMAIL', muted: true },
      ]);
    });

    it('refuses a code that is not a notification event and stores nothing of the request', async () => {
      const { a } = t.world();
      await expect(
        asUser(a.admin, (inbox) =>
          inbox.setPreferences([
            { eventCode: 'booking.accepted', channel: 'EMAIL', muted: true },
            { eventCode: 'auth.otp', channel: 'EMAIL', muted: true },
          ]),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((await asUser(a.admin, (inbox) => inbox.listPreferences())).data).toEqual([]);
    });
  });
});
