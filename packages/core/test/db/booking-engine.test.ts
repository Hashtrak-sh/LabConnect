import { randomUUID } from 'node:crypto';
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  type BookingStatus,
  type BookingTransition,
  ROLES,
  type TransitionActor,
} from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import {
  BookingError,
  differentFromMakerGuard,
  eventTypesFor,
  TransitionRegistry,
} from '../../src/index.js';
import { type Caller, useBookingHarness } from './booking-support.js';
import { gate, sqlState } from './support.js';

// P3-07: the BookingEngine against the real migrations, grants, triggers and row-level security,
// connected as the API role (tenant and platform contexts) and the worker role (system context).

const MOVES = BOOKING_TRANSITIONS.filter((t) => t.from.length > 0);
const code = (error: unknown): string | undefined =>
  error instanceof BookingError ? error.code : undefined;

describe('BookingEngine', () => {
  const h = useBookingHarness();
  const { engine, as, callers, rows } = h;

  /** Everything the engine writes about one booking. */
  const snapshot = async (id: string) => {
    const [booking] = await rows<{ status: BookingStatus; lock_version: number }>(
      'SELECT status, lock_version FROM booking WHERE id = $1',
      [id],
    );
    const [history] = await rows<{ n: string }>(
      'SELECT count(*) AS n FROM booking_status_history WHERE booking_id = $1',
      [id],
    );
    const [audit] = await rows<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE entity_type = 'booking' AND entity_id = $1`,
      [id],
    );
    const [outbox] = await rows<{ n: string }>(
      `SELECT count(*) AS n FROM outbox_event WHERE aggregate_id = $1`,
      [id],
    );
    const [timers] = await rows<{ n: string }>(
      `SELECT count(*) AS n FROM timer WHERE aggregate_id = $1`,
      [id],
    );
    return {
      status: booking?.status,
      lockVersion: booking?.lock_version,
      history: Number(history?.n),
      audit: Number(audit?.n),
      outbox: Number(outbox?.n),
      timers: Number(timers?.n),
    };
  };

  const run = (
    caller: Caller,
    bookingId: string,
    transition: BookingTransition,
    extra: { expectedLockVersion?: number; reason?: string } = {},
  ) =>
    as(caller, (tx) =>
      engine().transition(tx, {
        bookingId,
        transitionId: transition.id,
        actor: caller.actor,
        reason: 'test reason',
        input: h.inputFor(transition),
        requestContext: { requestId: 'req-1', ip: '203.0.113.9', userAgent: 'vitest' },
        ...extra,
      }),
    );

  describe('every transition of the shared table', () => {
    for (const transition of MOVES) {
      const entries = [
        ...new Map(
          transition.commands
            .flatMap((command) => command.actors)
            .map((a) => [JSON.stringify(a), a]),
        ).values(),
      ];

      for (const from of transition.from) {
        it(`${transition.id} ${from} -> ${transition.to}: status, history, audit, event`, async () => {
          const id = await h.placeBooking(from);
          const before = await snapshot(id);
          const caller = h.callerFor(entries[0] as TransitionActor);
          const result = await run(caller, id, transition);

          expect(result).toMatchObject({
            bookingId: id,
            transitionId: transition.id,
            fromStatus: from,
            toStatus: transition.to,
            lockVersion: (before.lockVersion ?? -1) + 1,
          });
          const after = await snapshot(id);
          expect(after).toMatchObject({
            status: transition.to,
            lockVersion: (before.lockVersion ?? -1) + 1,
            history: before.history + 1,
            audit: before.audit + 1,
          });

          const [history] = await rows('SELECT * FROM booking_status_history WHERE id = $1', [
            result.historyId,
          ]);
          expect(history).toMatchObject({
            booking_id: id,
            transition_id: transition.id,
            from_status: from,
            to_status: transition.to,
            reason: 'test reason',
            actor_user_id: caller.actor.kind === 'USER' ? caller.actor.userId : null,
            actor_role: caller.actor.kind === 'USER' ? caller.actor.role : null,
            actor_party:
              caller.actor.kind === 'SYSTEM'
                ? 'SYSTEM'
                : { CUSTOMER: 'CUSTOMER', LAB: 'LAB', PLATFORM: 'PLATFORM' }[
                    ROLES[caller.actor.role].orgType
                  ],
          });
          expect((history as { occurred_at: Date }).occurred_at.toISOString()).toBe(
            '2026-11-25T10:00:00.000Z',
          );

          const audits = await rows<Record<string, unknown>>(
            `SELECT * FROM audit_log WHERE entity_type = 'booking' AND entity_id = $1 AND action = 'booking.transition'`,
            [id],
          );
          expect(audits).toHaveLength(1);
          expect(audits[0]).toMatchObject({
            before: { status: from },
            after: { status: transition.to, transitionId: transition.id },
            reason: 'test reason',
            request_id: 'req-1',
            actor_user_id: caller.actor.kind === 'USER' ? caller.actor.userId : null,
          });

          const expected = eventTypesFor(transition.id, caller.actor);
          const events = await rows<{ id: string; event_type: string; payload: unknown }>(
            'SELECT id::text AS id, event_type, payload FROM outbox_event WHERE aggregate_id = $1',
            [id],
          );
          events.sort((a, b) => result.eventIds.indexOf(a.id) - result.eventIds.indexOf(b.id));
          expect(events.map((e) => e.event_type)).toEqual(expected);
          expect(events.map((e) => e.id)).toEqual(result.eventIds);
          for (const event of events) {
            expect((event.payload as { data: unknown }).data).toEqual({
              bookingId: id,
              fromStatus: from,
              toStatus: transition.to,
              transitionId: transition.id,
            });
          }
        });
      }

      // The other listed actors, from the first state.
      for (const [index, entry] of entries.entries()) {
        if (index === 0) continue;
        it(`${transition.id}: ${JSON.stringify(entry)} may also trigger it`, async () => {
          const id = await h.placeBooking(transition.from[0] as BookingStatus);
          const result = await run(h.callerFor(entry), id, transition);
          expect(result.toStatus).toBe(transition.to);
        });
      }

      const illegalFrom = BOOKING_STATUSES.filter((s) => !transition.from.includes(s));
      it(`${transition.id} is refused from the ${String(illegalFrom.length)} other states, and nothing is written`, async () => {
        const caller = h.callerFor(entries[0] as TransitionActor);
        for (const state of illegalFrom) {
          const id = await h.placeBooking(state);
          const before = await snapshot(id);
          const error = await run(caller, id, transition).catch((e: unknown) => e);
          expect(code(error), `${transition.id} from ${state}`).toBe('INVALID_STATE_TRANSITION');
          expect((error as BookingError).meta).toMatchObject({ currentState: state });
          expect(await snapshot(id)).toEqual(before);
        }
      }, 120_000);

      it(`${transition.id} is refused for an actor the table does not list, and nothing is written`, async () => {
        const id = await h.placeBooking(transition.from[0] as BookingStatus);
        const before = await snapshot(id);
        const listedRoles = new Set(entries.flatMap((e) => (e.kind === 'ROLE' ? [e.role] : [])));
        const ownerListed = entries.some((e) => e.kind === 'OWNER');
        const systemSources = entries.flatMap((e) =>
          e.kind === 'SYSTEM' ? [e.source ?? 'ANY'] : [],
        );
        const candidates: { name: string; caller: Caller; allowed: boolean }[] = [
          // The fixture bookings were requested by `customerAdmin`, so that person is the owner
          // whatever role they claim; the colleague is in the same organisation and is not.
          {
            name: 'C-Admin (the owner)',
            caller: callers.customerAdmin(),
            allowed: listedRoles.has('CUSTOMER_ADMIN') || ownerListed,
          },
          {
            name: 'C-Req (the owner)',
            caller: callers.requester(),
            allowed: listedRoles.has('CUSTOMER_REQUESTER') || ownerListed,
          },
          {
            name: 'C-Fin (the owner)',
            caller: callers.finance(),
            allowed: listedRoles.has('CUSTOMER_FINANCE') || ownerListed,
          },
          {
            name: 'C-Admin (a colleague)',
            caller: callers.colleague('CUSTOMER_ADMIN'),
            allowed: listedRoles.has('CUSTOMER_ADMIN'),
          },
          {
            name: 'C-Req (a colleague)',
            caller: callers.colleague('CUSTOMER_REQUESTER'),
            allowed: entries.some(
              (e) =>
                e.kind === 'ROLE' && e.role === 'CUSTOMER_REQUESTER' && e.qualifier === undefined,
            ),
          },
          {
            name: 'C-Fin (a colleague)',
            caller: callers.colleague('CUSTOMER_FINANCE'),
            allowed: listedRoles.has('CUSTOMER_FINANCE'),
          },
          { name: 'L-Maker', caller: callers.maker(), allowed: listedRoles.has('LAB_MAKER') },
          { name: 'L-Checker', caller: callers.checker(), allowed: listedRoles.has('LAB_CHECKER') },
          { name: 'Ops', caller: callers.ops(), allowed: listedRoles.has('PLATFORM_OPS') },
          {
            name: 'system without a source',
            caller: callers.system(),
            allowed: systemSources.includes('ANY'),
          },
          {
            name: 'system (Payments)',
            caller: callers.system('PAYMENTS'),
            allowed: systemSources.includes('ANY') || systemSources.includes('PAYMENTS'),
          },
          {
            name: 'system (EC-01)',
            caller: callers.system('EC-01'),
            allowed: systemSources.includes('ANY') || systemSources.includes('EC-01'),
          },
        ];
        const wrong = candidates.filter((c) => !c.allowed);
        expect(wrong.length).toBeGreaterThan(0);
        for (const candidate of wrong) {
          const error = await run(candidate.caller, id, transition).catch((e: unknown) => e);
          expect(code(error), `${transition.id} by ${candidate.name}`).toBe('FORBIDDEN');
        }
        expect(await snapshot(id)).toEqual(before);
      });
    }
  });

  describe('actor and context checks', () => {
    const t03 = MOVES.find((t) => t.id === 'T-03') as BookingTransition;

    it('refuses a request that calls itself SYSTEM, Ops or another organisation, and writes nothing', async () => {
      const id = await h.placeBooking('REQUESTED');
      const before = await snapshot(id);
      const w = h.world();
      const attempts: [string, Caller][] = [
        [
          'a lab user in a tenant context claiming SYSTEM',
          { context: h.contexts.checker(), actor: { kind: 'SYSTEM' } },
        ],
        [
          'a lab user in a tenant context claiming Ops',
          {
            context: h.contexts.checker(),
            actor: { kind: 'USER', userId: w.users.checker, role: 'PLATFORM_OPS' },
          },
        ],
        [
          'a user in the system context',
          {
            context: h.contexts.system(),
            actor: { kind: 'USER', userId: w.users.checker, role: 'LAB_CHECKER' },
          },
        ],
        [
          'a different user id than the context',
          {
            context: h.contexts.checker(),
            actor: { kind: 'USER', userId: w.users.maker, role: 'LAB_CHECKER' },
          },
        ],
        [
          'a different organisation id than the context',
          {
            context: h.contexts.checker(),
            actor: {
              kind: 'USER',
              userId: w.users.checker,
              role: 'LAB_CHECKER',
              orgId: w.orgs.otherLab,
            },
          },
        ],
        [
          'a site-limited checker of another site',
          {
            context: h.contexts.checker(),
            actor: {
              kind: 'USER',
              userId: w.users.checker,
              role: 'LAB_CHECKER',
              labSiteIds: [randomUUID()],
            },
          },
        ],
      ];
      for (const [name, caller] of attempts) {
        const error = await run(caller, id, t03).catch((e: unknown) => e);
        expect(code(error), name).toBe('FORBIDDEN');
      }
      expect(await snapshot(id)).toEqual(before);
    });

    it('accepts a site-limited checker of the booking site', async () => {
      const id = await h.placeBooking('REQUESTED');
      const w = h.world();
      const caller: Caller = {
        context: h.contexts.checker(),
        actor: {
          kind: 'USER',
          userId: w.users.checker,
          role: 'LAB_CHECKER',
          labSiteIds: [w.lab.site],
        },
      };
      expect((await run(caller, id, t03)).toStatus).toBe('ACCEPTED');
    });

    it('a customer other than the owner may not edit (OWNER needs the requester)', async () => {
      const id = await h.placeBooking('REQUESTED', {});
      const w = h.world();
      const t02 = MOVES.find((t) => t.id === 'T-02') as BookingTransition;
      // same organisation, different user, requester role
      const caller: Caller = {
        context: { kind: 'tenant', orgId: w.orgs.customer, userId: w.users.otherCustomerAdmin },
        actor: { kind: 'USER', userId: w.users.otherCustomerAdmin, role: 'CUSTOMER_REQUESTER' },
      };
      const error = await run(caller, id, t02).catch((e: unknown) => e);
      expect(code(error)).toBe('FORBIDDEN');
    });
  });

  describe('not found and tenancy', () => {
    const t03 = MOVES.find((t) => t.id === 'T-03') as BookingTransition;

    it("tenant B cannot transition tenant A's booking: not found, nothing written", async () => {
      const id = await h.placeBooking('REQUESTED');
      const before = await snapshot(id);
      const w = h.world();
      const stranger: Caller = {
        context: h.contexts.otherChecker(),
        actor: { kind: 'USER', userId: w.users.otherChecker, role: 'LAB_CHECKER' },
      };
      const error = await run(stranger, id, t03).catch((e: unknown) => e);
      expect(code(error)).toBe('NOT_FOUND');
      expect(await snapshot(id)).toEqual(before);
    });

    it('an unknown booking and a malformed id are not found', async () => {
      for (const id of [randomUUID(), 'not-a-uuid']) {
        const error = await run(callers.checker(), id, t03).catch((e: unknown) => e);
        expect(code(error)).toBe('NOT_FOUND');
      }
    });

    it('rejects T-01 on an existing booking and an unknown transition id', async () => {
      const id = await h.placeBooking('REQUESTED');
      const t01 = BOOKING_TRANSITIONS.find((t) => t.id === 'T-01') as BookingTransition;
      expect(code(await run(callers.customerAdmin(), id, t01).catch((e: unknown) => e))).toBe(
        'INVALID_STATE_TRANSITION',
      );
      const error = await as(callers.checker(), (tx) =>
        engine().transition(tx, {
          bookingId: id,
          transitionId: 'T-99' as 'T-01',
          actor: callers.checker().actor,
        }),
      ).catch((e: unknown) => e);
      expect(code(error)).toBe('VALIDATION_FAILED');
    });
  });

  describe('required input', () => {
    const find = (tid: string) => MOVES.find((t) => t.id === tid) as BookingTransition;
    const cases: [string, BookingStatus, string, Record<string, unknown>, string | undefined][] = [
      ['T-05 needs a rejection reason', 'REQUESTED', 'checker', {}, 'ok'],
      ['T-25 needs a cancellation code', 'REQUESTED', 'customerAdmin', {}, 'ok'],
      ['T-18 needs expectedReportDate', 'RECEIVED', 'maker', {}, 'ok'],
      ['T-18 needs a valid date', 'RECEIVED', 'maker', { expectedReportDate: '2026-02-31' }, 'ok'],
      ['T-15 needs a reason', 'SAMPLE_RECORDED', 'checker', {}, undefined],
      ['T-28 needs a reason', 'SAMPLE_RECORDED', 'checker', {}, undefined],
    ];
    for (const [name, state, who, input, reason] of cases) {
      it(`${name}: VALIDATION_FAILED and nothing is written`, async () => {
        const tid = name.slice(0, 4);
        const id = await h.placeBooking(state);
        const before = await snapshot(id);
        const caller = callers[who as 'checker' | 'customerAdmin' | 'maker']();
        const error = await as(caller, (tx) =>
          engine().transition(tx, {
            bookingId: id,
            transitionId: find(tid).id,
            actor: caller.actor,
            input,
            ...(reason === 'ok' ? { reason: 'x' } : {}),
          }),
        ).catch((e: unknown) => e);
        expect(code(error)).toBe('VALIDATION_FAILED');
        expect(await snapshot(id)).toEqual(before);
      });
    }

    it('the columns the new state fixes are written with the status', async () => {
      const id = await h.placeBooking('RECEIVED');
      await run(callers.maker(), id, find('T-18'));
      const [row] = await rows<Record<string, unknown>>(
        "SELECT to_char(expected_report_date, 'YYYY-MM-DD') AS expected_report_date FROM booking WHERE id = $1",
        [id],
      );
      expect(row?.expected_report_date).toBe('2026-12-20');

      const cancelled = await h.placeBooking('UNDER_TEST');
      await run(callers.checker(), cancelled, find('T-27'));
      const [c] = await rows<Record<string, unknown>>(
        'SELECT cancellation_code_node_id::text AS code, cancelled_by_party, completed_at FROM booking WHERE id = $1',
        [cancelled],
      );
      expect(c).toMatchObject({ code: h.world().nodes.cancelReason, cancelled_by_party: 'LAB' });

      const done = await h.placeBooking('REPORT_RELEASED');
      await run(callers.system(), done, find('T-23'));
      const [d] = await rows<{ completed_at: Date }>(
        'SELECT completed_at FROM booking WHERE id = $1',
        [done],
      );
      expect(d?.completed_at.toISOString()).toBe('2026-11-25T10:00:00.000Z');
    });
  });

  describe('optimistic concurrency and row locks', () => {
    const t = (tid: string) => MOVES.find((x) => x.id === tid) as BookingTransition;

    it('refuses a stale expectedLockVersion and accepts the current one', async () => {
      const id = await h.placeBooking('REQUESTED');
      const before = await snapshot(id);
      const stale = await run(callers.checker(), id, t('T-03'), { expectedLockVersion: 7 }).catch(
        (e: unknown) => e,
      );
      expect(code(stale)).toBe('CONCURRENT_MODIFICATION');
      expect((stale as BookingError).meta).toMatchObject({
        currentLockVersion: before.lockVersion,
      });
      expect(await snapshot(id)).toEqual(before);
      const ok = await run(callers.checker(), id, t('T-03'), {
        expectedLockVersion: before.lockVersion as number,
      });
      expect(ok.lockVersion).toBe((before.lockVersion as number) + 1);
    });

    it('of two concurrent transitions on one booking exactly one wins', async () => {
      const id = await h.placeBooking('REQUESTED');
      const hold = gate();
      const entered = gate();
      const first = as(callers.checker(), async (tx) => {
        const result = await engine().transition(tx, {
          bookingId: id,
          transitionId: 'T-03',
          actor: callers.checker().actor,
        });
        entered.open();
        await hold.wait; // keep the row locked, uncommitted
        return result;
      });
      await entered.wait;
      const second = as(callers.checker(), (tx) =>
        engine().transition(tx, {
          bookingId: id,
          transitionId: 'T-05',
          actor: callers.checker().actor,
          input: h.inputFor(t('T-05')),
        }),
      ).catch((e: unknown) => e);
      // The second transaction is blocked on the row lock until the first commits.
      const early = await Promise.race([second, Promise.resolve('blocked')]);
      expect(early).toBe('blocked');
      hold.open();
      expect((await first).toStatus).toBe('ACCEPTED');
      const error = await second;
      expect(code(error)).toBe('INVALID_STATE_TRANSITION');
      expect((error as BookingError).meta).toMatchObject({ currentState: 'ACCEPTED' });
      const after = await snapshot(id);
      expect(after).toMatchObject({ status: 'ACCEPTED', history: 1 });
    });

    it('a transition waiting on the lock sees the changed lock version', async () => {
      const id = await h.placeBooking('REQUESTED');
      const hold = gate();
      const entered = gate();
      const first = as(callers.requester(), async (tx) => {
        const result = await engine().transition(tx, {
          bookingId: id,
          transitionId: 'T-02',
          actor: callers.requester().actor,
        });
        entered.open();
        await hold.wait;
        return result;
      });
      await entered.wait;
      const second = as(callers.checker(), (tx) =>
        engine().transition(tx, {
          bookingId: id,
          transitionId: 'T-03',
          actor: callers.checker().actor,
          expectedLockVersion: 0,
        }),
      ).catch((e: unknown) => e);
      hold.open();
      await first;
      expect(code(await second)).toBe('CONCURRENT_MODIFICATION');
    });
  });

  describe('atomicity', () => {
    it('a failing effect rolls back the status, history, audit, event and its own writes together', async () => {
      const id = await h.placeBooking('REQUESTED');
      const before = await snapshot(id);
      const registry = new TransitionRegistry().addEffect('T-03', {
        name: 'writes-then-fails',
        async run(context) {
          // writes of its own, then fails
          await context.services.timers.schedule(context.tx, {
            type: 'PAYMENT_DUE',
            aggregate: { type: 'booking', id },
            dueAt: new Date('2026-12-01T00:00:00Z'),
          });
          throw new Error('boom');
        },
      });
      const caller = callers.checker();
      await expect(
        as(caller, (tx) =>
          engine(registry).transition(tx, {
            bookingId: id,
            transitionId: 'T-03',
            actor: caller.actor,
          }),
        ),
      ).rejects.toThrow('boom');
      expect(await snapshot(id)).toEqual(before);
    });

    it('a refusing guard writes nothing', async () => {
      const id = await h.placeBooking('REQUESTED');
      const before = await snapshot(id);
      const registry = new TransitionRegistry().addGuard('T-03', {
        name: 'site-not-bookable',
        run() {
          throw new BookingError('SITE_NOT_BOOKABLE');
        },
      });
      const error = await as(callers.checker(), (tx) =>
        engine(registry).transition(tx, {
          bookingId: id,
          transitionId: 'T-03',
          actor: callers.checker().actor,
        }),
      ).catch((e: unknown) => e);
      expect(code(error)).toBe('SITE_NOT_BOOKABLE');
      expect(await snapshot(id)).toEqual(before);
    });

    it('guards and effects run in registration order, guards before the write and effects after it', async () => {
      const id = await h.placeBooking('REQUESTED');
      const order: string[] = [];
      const registry = new TransitionRegistry()
        .addGuard('T-03', {
          name: 'g1',
          run(context) {
            order.push(`g1:${context.booking.status}`);
          },
        })
        .addColumns('T-03', {
          name: 'c1',
          build() {
            order.push('c1');
            return { deviationNotes: 'set with the status' };
          },
        })
        .addGuard('ALL', { name: 'g2', run: () => void order.push('g2') })
        .addEffect('T-03', {
          name: 'e1',
          run(context) {
            order.push(`e1:${context.updated.status}:${context.booking.status}`);
          },
        })
        .addEffect('ALL', { name: 'e2', run: () => void order.push('e2') });
      await as(callers.checker(), (tx) =>
        engine(registry).transition(tx, {
          bookingId: id,
          transitionId: 'T-03',
          actor: callers.checker().actor,
        }),
      );
      expect(order).toEqual(['g1:REQUESTED', 'g2', 'c1', 'e1:ACCEPTED:REQUESTED', 'e2']);
      const [row] = await rows<{ deviation_notes: string }>(
        'SELECT deviation_notes FROM booking WHERE id = $1',
        [id],
      );
      expect(row?.deviation_notes).toBe('set with the status');
    });

    it('a maker cannot approve their own record through the registered guard', async () => {
      const id = await h.placeBooking('SAMPLE_RECORDED');
      const before = await snapshot(id);
      const w = h.world();
      const registry = new TransitionRegistry().addGuard(
        ['T-14', 'T-15', 'T-28'],
        differentFromMakerGuard('receipt.maker-is-not-checker', () => w.users.checker),
      );
      const caller = callers.checker(); // pretend the checker is the maker of the receipt
      const error = await as(caller, (tx) =>
        engine(registry).transition(tx, {
          bookingId: id,
          transitionId: 'T-14',
          actor: caller.actor,
        }),
      ).catch((e: unknown) => e);
      expect(code(error)).toBe('SELF_APPROVAL_FORBIDDEN');
      expect(await snapshot(id)).toEqual(before);
    });
  });

  describe('the database guard trigger', () => {
    it('is satisfied by the engine, and a raw status update afterwards in the same transaction is refused', async () => {
      const id = await h.placeBooking('REQUESTED');
      const caller = callers.checker();
      await as(caller, async (tx) => {
        await engine().transition(tx, { bookingId: id, transitionId: 'T-03', actor: caller.actor });
        // the engine cleared app.transition_id: nothing else can change the status now
        const raw =
          await tx.$executeRaw`UPDATE booking SET status = 'PAID' WHERE id = ${id}::uuid`.catch(
            (e: unknown) => e,
          );
        expect(sqlState(raw)).toBe('LC002');
        throw new Error('rolled back on purpose');
      }).catch(() => undefined);
      expect((await snapshot(id)).status).toBe('REQUESTED');
    });

    it('a raw status update without the engine is refused', async () => {
      const id = await h.placeBooking('REQUESTED');
      const error = await as(
        callers.checker(),
        (tx) => tx.$executeRaw`UPDATE booking SET status = 'ACCEPTED' WHERE id = ${id}::uuid`,
      ).catch((e: unknown) => e);
      expect(sqlState(error)).toBe('LC002');
    });
  });

  describe('frozen bookings (EC-01)', () => {
    const t = (tid: string) => MOVES.find((x) => x.id === tid) as BookingTransition;

    it('accepts only T-25 to T-27 and Ops while frozen_at is set', async () => {
      const id = await h.placeBooking('REQUESTED');
      await h
        .db()
        .query(`UPDATE booking SET frozen_at = now(), frozen_reason = 'EC-01 test' WHERE id = $1`, [
          id,
        ]);
      const before = await snapshot(id);
      const refused = await run(callers.checker(), id, t('T-03')).catch((e: unknown) => e);
      expect(code(refused)).toBe('INVALID_STATE_TRANSITION');
      expect((refused as BookingError).meta).toMatchObject({
        currentState: 'REQUESTED',
        frozen: true,
      });
      expect(await snapshot(id)).toEqual(before);
      expect((await run(callers.customerAdmin(), id, t('T-25'))).toStatus).toBe('CANCELLED');

      const disputed = await h.placeBooking('DISPUTED');
      await h
        .db()
        .query(`UPDATE booking SET frozen_at = now(), frozen_reason = 'EC-01 test' WHERE id = $1`, [
          disputed,
        ]);
      const system = await run(callers.system(), disputed, t('T-24')).catch((e: unknown) => e);
      expect(code(system)).toBe('INVALID_STATE_TRANSITION');
      expect((await run(callers.ops(), disputed, t('T-24'))).toStatus).toBe('COMPLETED');
    });
  });

  describe('submit (T-01)', () => {
    const data = (overrides: Record<string, unknown> = {}) => {
      const w = h.world();
      return {
        bookingNo: `LC-2611-${String(Math.floor(Math.random() * 90000) + 10000)}`,
        customerOrgId: w.orgs.customer,
        requesterUserId: w.users.customerAdmin,
        labSiteId: w.lab.site,
        labOrgId: w.lab.org,
        itemName: 'DEMO cement sample',
        declaredPackageCount: 1,
        preferredDropDate: new Date('2026-12-01T00:00:00Z'),
        priceListId: w.lab.priceList,
        subtotalPaise: 100_000n,
        gstPaise: 18_000n,
        totalPaise: 118_000n,
        labSnapshot: { site: 'DEMO' },
        ...overrides,
      };
    };

    it('inserts the booking in REQUESTED with history, audit and booking.requested', async () => {
      const caller = callers.customerAdmin();
      const result = await as(caller, (tx) =>
        engine().submit(tx, { booking: data(), actor: caller.actor }),
      );
      expect(result).toMatchObject({
        transitionId: 'T-01',
        fromStatus: null,
        toStatus: 'REQUESTED',
        lockVersion: 0,
      });
      const s = await snapshot(result.bookingId);
      expect(s).toMatchObject({ status: 'REQUESTED', history: 1, audit: 1, outbox: 1 });
      const [history] = await rows<{ from_status: string | null; actor_party: string }>(
        'SELECT from_status, actor_party FROM booking_status_history WHERE booking_id = $1',
        [result.bookingId],
      );
      expect(history).toMatchObject({ from_status: null, actor_party: 'CUSTOMER' });
      const [event] = await rows<{ event_type: string }>(
        'SELECT event_type FROM outbox_event WHERE aggregate_id = $1',
        [result.bookingId],
      );
      expect(event?.event_type).toBe('booking.requested');
    });

    it('lets Ops submit on behalf of a customer, saying who acts', async () => {
      const ops = callers.ops();
      const w = h.world();
      const result = await as(ops, (tx) =>
        engine().submit(tx, { booking: data({ onBehalfByUserId: w.users.ops }), actor: ops.actor }),
      );
      expect(result.toStatus).toBe('REQUESTED');
      const wrong = await as(ops, (tx) =>
        engine().submit(tx, {
          booking: data({ onBehalfByUserId: w.users.admin }),
          actor: ops.actor,
        }),
      ).catch((e: unknown) => e);
      expect(code(wrong)).toBe('FORBIDDEN');
    });

    it('refuses a lab user, another organisation, another requester, and SYSTEM, and writes nothing', async () => {
      const w = h.world();
      const before = await rows<{ n: string }>('SELECT count(*) AS n FROM booking');
      const tries: [string, Caller, Record<string, unknown>][] = [
        ['a lab maker', callers.maker(), {}],
        [
          'a customer for another organisation',
          callers.customerAdmin(),
          { customerOrgId: w.orgs.otherCustomer },
        ],
        [
          'a customer naming another requester',
          callers.customerAdmin(),
          { requesterUserId: w.users.otherCustomerAdmin },
        ],
        ['the system', callers.system(), {}],
      ];
      for (const [name, caller, overrides] of tries) {
        const error = await as(caller, (tx) =>
          engine().submit(tx, { booking: data(overrides), actor: caller.actor }),
        ).catch((e: unknown) => e);
        expect(code(error) ?? sqlState(error), name).toBeDefined();
        expect(code(error), name).toBe('FORBIDDEN');
      }
      expect(await rows('SELECT count(*) AS n FROM booking')).toEqual(before);
    });

    it('a guard that refuses leaves no booking behind', async () => {
      const caller = callers.customerAdmin();
      const registry = new TransitionRegistry().addGuard('T-01', {
        name: 'open-booking-limit',
        run() {
          throw new BookingError('OPEN_BOOKING_LIMIT');
        },
      });
      const no = `LC-2611-${String(Math.floor(Math.random() * 90000) + 10000)}`;
      const error = await as(caller, (tx) =>
        engine(registry).submit(tx, { booking: data({ bookingNo: no }), actor: caller.actor }),
      ).catch((e: unknown) => e);
      expect(code(error)).toBe('OPEN_BOOKING_LIMIT');
      expect(await rows('SELECT 1 FROM booking WHERE booking_no = $1', [no])).toHaveLength(0);
    });
  });
});
