import { describe, expect, it } from 'vitest';
import type { AccessUser } from '@/features/access/roles';
import {
  decisionNotice,
  type InboxItem,
  landingPath,
  readCounter,
  readQuantity,
  readTab,
  rowsOfTab,
} from './desk-model';

const item = (dropDeadlineAt: string | null): InboxItem =>
  ({ booking: { dropDeadlineAt }, pendingApproval: null, viewerWasMaker: false }) as InboxItem;

const userWith = (roles: AccessUser['memberships'][number]['roles'] | null): AccessUser => ({
  id: 'u',
  name: 'DEMO',
  active: roles === null ? null : { organisation: 'Org', orgType: 'LAB', roles },
  memberships: [],
});

describe('lab desk model', () => {
  it('reads a tab, defaulting to new requests', () => {
    expect(readTab('overdue')).toBe('overdue');
    expect(readTab('nonsense')).toBe('new');
    expect(readTab(undefined)).toBe('new');
  });

  it('splits paid bookings by the drop deadline', () => {
    const now = new Date('2026-11-29T10:00:00Z');
    const due = item('2026-11-29T12:00:00Z');
    const late = item('2026-11-29T09:00:00Z');
    expect(rowsOfTab('drops', [due, late], now)).toEqual([due]);
    expect(rowsOfTab('overdue', [due, late], now)).toEqual([late]);
  });

  it('lands lab members on /lab, Ops on /admin/claims, everyone else on /', () => {
    expect(landingPath(userWith(['LAB_MAKER']))).toBe('/lab');
    expect(landingPath(userWith(['LAB_CHECKER']))).toBe('/lab');
    expect(landingPath(userWith(['PLATFORM_OPS']))).toBe('/admin/claims');
    expect(landingPath(userWith(['CUSTOMER_ADMIN']))).toBe('/');
    expect(landingPath(userWith(null))).toBe('/');
  });

  it('names each refusal of a decision', () => {
    expect(decisionNotice({ status: 409, code: 'SLOT_UNAVAILABLE' })).toBe('slot-unavailable');
    expect(decisionNotice({ status: 409, code: 'INVALID_STATE_TRANSITION' })).toBe(
      'already-decided',
    );
    expect(decisionNotice({ status: 422, code: 'SITE_NOT_BOOKABLE' })).toBe('site-not-bookable');
    expect(decisionNotice({ status: 412 })).toBe('changed');
    expect(decisionNotice({ status: 500 })).toBe('failed');
  });

  it('reads quantities with at most three decimals', () => {
    expect(readQuantity('')).toBeNull();
    expect(readQuantity('2.5')).toBe(2.5);
    expect(readQuantity('1.0004')).toBe('invalid');
    expect(readQuantity('0')).toBe('invalid');
    expect(readQuantity('-1')).toBe('invalid');
  });

  it('builds a counter-offer: another slot and/or more sample, and a message', () => {
    const lines = [{ lineId: 'l1', unitCode: 'G', current: 30 }];
    expect(
      readCounter(
        { slotId: 's2', message: ' More please ', quantities: { l1: '40' } },
        lines,
        's1',
      ),
    ).toEqual({
      ok: true,
      body: {
        proposedSlotId: 's2',
        perLineQuantity: [{ lineId: 'l1', sampleQty: 40, unitCode: 'G' }],
        message: 'More please',
      },
    });
    // The current slot and no quantity: nothing to propose.
    expect(readCounter({ slotId: 's1', message: 'x', quantities: {} }, lines, 's1')).toEqual({
      ok: false,
      errors: ['nothing'],
    });
    // Less than now, and no message.
    expect(readCounter({ slotId: '', message: '', quantities: { l1: '20' } }, lines, 's1')).toEqual(
      { ok: false, errors: ['message', 'qty:l1'] },
    );
  });
});
