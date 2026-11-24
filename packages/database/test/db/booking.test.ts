import { beforeAll, describe, expect, it } from 'vitest';
import { advanceTo, createBooking, createWorld, transition, type World } from './fixtures.js';
import { expectPgError, insert, PG, rollback, setLocal, update, useDatabase } from './helpers.js';

describe('booking', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it(
    'C-09 refuses a status change without a transition id',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      await setLocal(db(), 'app.transition_id', '');
      await expectPgError(db(), PG.illegalTransition, () =>
        update(db(), 'booking', booking.id, { status: 'ACCEPTED' }),
      );
      // a new booking needs one too
      await expectPgError(db(), PG.illegalTransition, async () => {
        const again = await createBooking(db(), world);
        await setLocal(db(), 'app.transition_id', '');
        await insert(db(), 'booking', {
          booking_no: 'LC-2611-99999',
          customer_org_id: again.customerOrg,
          requester_user_id: world.users.customerAdmin,
          lab_site_id: world.lab.site,
          lab_org_id: world.lab.org,
          status: 'REQUESTED',
          item_name: 'x',
          declared_package_count: 1,
          preferred_drop_date: '2026-12-01',
          price_list_id: world.lab.priceList,
          subtotal_paise: 0,
          gst_paise: 0,
          total_paise: 0,
          lab_snapshot: {},
        });
      });
    }),
  );

  it(
    'C-09 refuses a jump that is not a transition, and a transition id that does not match the jump',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      // REQUESTED cannot go straight to PAID, whatever id is claimed
      await expectPgError(db(), PG.illegalTransition, () =>
        transition(db(), booking.id, 'T-09', 'PAID'),
      );
      await expectPgError(db(), PG.illegalTransition, () =>
        transition(db(), booking.id, 'T-03', 'PAID'),
      );
      // T-05 is REQUESTED -> REJECTED, not -> ACCEPTED
      await expectPgError(db(), PG.illegalTransition, () =>
        transition(db(), booking.id, 'T-05', 'ACCEPTED'),
      );
      // a new booking cannot start anywhere but REQUESTED
      await expectPgError(db(), PG.illegalTransition, () =>
        createBooking(db(), world, { overrides: { status: 'ACCEPTED' } }),
      );
    }),
  );

  it(
    'C-09 accepts the whole happy path and stamps status_changed_at',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      await advanceTo(db(), booking.id, 'REPORT_RELEASED');
      await transition(db(), booking.id, 'T-23', 'COMPLETED');
      const result = await db().query<{ status: string; moved: boolean }>(
        'SELECT status, status_changed_at >= created_at AS moved FROM booking WHERE id = $1',
        [booking.id],
      );
      expect(result.rows[0]).toEqual({ status: 'COMPLETED', moved: true });
      // terminal: nothing leads out of COMPLETED
      await expectPgError(db(), PG.illegalTransition, () =>
        transition(db(), booking.id, 'T-22', 'DISPUTED'),
      );
    }),
  );

  it(
    'C-09 accepts T-28, rejecting a sample as unfit',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      await advanceTo(db(), booking.id, 'SAMPLE_RECORDED');
      await transition(db(), booking.id, 'T-28', 'CANCELLED', {
        cancellation_code_node_id: world.nodes.cancelReason,
        cancelled_by_party: 'LAB',
      });
    }),
  );

  it(
    'C-10 rejects totals that do not add up',
    inTx(async () => {
      await expectPgError(db(), PG.check, () =>
        createBooking(db(), world, { overrides: { total_paise: 118_001 } }),
      );
      await expectPgError(db(), PG.check, () =>
        createBooking(db(), world, { overrides: { gst_paise: -1, total_paise: 99_999 } }),
      );
    }),
  );

  it(
    'C-43 freezes booking totals once the booking is no longer REQUESTED',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      // still editable while REQUESTED (T-02)
      await update(db(), 'booking', booking.id, {
        subtotal_paise: 200_000,
        gst_paise: 36_000,
        total_paise: 236_000,
      });
      await advanceTo(db(), booking.id, 'ACCEPTED');
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'booking', booking.id, {
          subtotal_paise: 100_000,
          gst_paise: 18_000,
          total_paise: 118_000,
        }),
      );
    }),
  );

  it(
    'C-11 freezes line prices once the booking is no longer REQUESTED',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      await update(db(), 'booking_line', booking.line, {
        unit_price_paise: 90_000,
        gst_paise: 16_200,
        line_total_paise: 106_200,
      });
      await advanceTo(db(), booking.id, 'ACCEPTED');
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'booking_line', booking.line, {
          unit_price_paise: 1,
          gst_paise: 0,
          line_total_paise: 1,
        }),
      );
      await expectPgError(db(), PG.frozen, () =>
        db().query('DELETE FROM booking_line WHERE id = $1', [booking.line]),
      );
      // the line's status and the countered quantity can still change
      await update(db(), 'booking_line', booking.line, {
        status: 'IN_PROGRESS',
        required_sample_qty: 2,
      });
    }),
  );

  it(
    'C-45 rejects a line total that does not add up',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      await expectPgError(db(), PG.check, () =>
        update(db(), 'booking_line', booking.line, { line_total_paise: 1 }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'booking_line', booking.line, { gst_rate_bp: 2801 }),
      );
    }),
  );

  it(
    'C-46 rejects a line whose scope line or price item belongs to another lab site',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const line = {
        ...booking.keys,
        line_no: 2,
        snapshot: {},
        unit_price_paise: 100,
        sample_prep_paise: 0,
        gst_rate_bp: 1800,
        gst_paise: 18,
        line_total_paise: 118,
      };
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'booking_line', {
          ...line,
          scope_line_id: world.otherLab.scopeLine,
          scope_line_version_id: world.otherLab.scopeLineVersion,
          price_item_id: world.otherLab.priceItem,
        }),
      );
      // the version must be a version of that scope line
      await expectPgError(db(), PG.foreignKey, () =>
        update(db(), 'booking_line', booking.line, {
          scope_line_version_id: world.otherLab.scopeLineVersion,
        }),
      );
    }),
  );

  it(
    'C-44 requires a reason for a cancelled or rejected booking, and for a frozen one',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      await expectPgError(db(), PG.check, () => transition(db(), booking.id, 'T-25', 'CANCELLED'));
      await expectPgError(db(), PG.check, () => transition(db(), booking.id, 'T-05', 'REJECTED'));
      await expectPgError(db(), PG.check, () =>
        update(db(), 'booking', booking.id, { frozen_at: new Date() }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'booking', booking.id, { declared_package_count: 51 }),
      );
      await transition(db(), booking.id, 'T-05', 'REJECTED', {
        rejection_reason_node_id: world.nodes.rejectReason,
      });
    }),
  );

  it(
    'C-29 C-47 require a counter-offer to propose something, and allow one pending counter per booking',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const counter = {
        ...booking.keys,
        message: 'Please bring 2 kg',
        expires_at: new Date(Date.now() + 86_400_000),
        proposed_by_user_id: world.users.checker,
      };
      await expectPgError(db(), PG.check, () => insert(db(), 'counter_offer', counter));
      const first = await insert(db(), 'counter_offer', {
        ...counter,
        extra_quantity_notes: '2 kg instead of 1 kg',
      });
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'counter_offer', { ...counter, proposed_drop_date: '2026-12-03' }),
      );
      await update(db(), 'counter_offer', first, { status: 'DECLINED' });
      await insert(db(), 'counter_offer', { ...counter, proposed_drop_date: '2026-12-03' });
    }),
  );

  it(
    'C-15 C-48 prevent overbooking a slot and holding two slots for one booking',
    inTx(async () => {
      const slot = await insert(db(), 'slot', {
        organisation_id: world.orgs.lab,
        lab_site_id: world.lab.site,
        slot_date: '2026-12-01',
        starts_at: '2026-12-01T04:00:00Z',
        ends_at: '2026-12-01T06:00:00Z',
        capacity: 2,
        held_count: 1,
        booked_count: 1,
      });
      await expectPgError(db(), PG.check, () => update(db(), 'slot', slot, { held_count: 2 }));
      await expectPgError(db(), PG.check, () => update(db(), 'slot', slot, { booked_count: -1 }));
      await expectPgError(db(), PG.check, () =>
        update(db(), 'slot', slot, { ends_at: '2026-12-01T03:00:00Z' }),
      );

      const booking = await createBooking(db(), world);
      const hold = { ...booking.keys, slot_id: slot };
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'slot_hold', { ...hold, kind: 'SOFT' }),
      );
      const first = await insert(db(), 'slot_hold', {
        ...hold,
        kind: 'SOFT',
        expires_at: new Date(Date.now() + 3_600_000),
      });
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'slot_hold', { ...hold, kind: 'CONFIRMED' }),
      );
      await update(db(), 'slot_hold', first, { released_at: new Date() });
      await insert(db(), 'slot_hold', { ...hold, kind: 'CONFIRMED' });
    }),
  );

  it(
    'C-49 lists each transition once per from-state, including the one that starts from nothing',
    inTx(async () => {
      await expectPgError(db(), PG.unique, () =>
        db().query(`INSERT INTO booking_transition VALUES (90, 'T-01', NULL, 'REQUESTED')`),
      );
      await expectPgError(db(), PG.unique, () =>
        db().query(`INSERT INTO booking_transition VALUES (91, 'T-25', 'REQUESTED', 'CANCELLED')`),
      );
    }),
  );
});
