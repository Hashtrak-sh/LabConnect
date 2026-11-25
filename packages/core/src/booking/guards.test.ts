import { findTransition } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import { BookingError, isBookingError } from './errors.js';
import { differentFromMakerGuard } from './guards.js';
import type { TransitionContext } from './types.js';

const context = (actor: TransitionContext['command']['actor']): TransitionContext =>
  ({
    transition: findTransition('T-14'),
    command: { bookingId: 'b', transitionId: 'T-14', actor },
  }) as unknown as TransitionContext;

describe('differentFromMakerGuard', () => {
  const guard = differentFromMakerGuard('receipt.maker-is-not-checker', () => 'maker-user');

  it('refuses the maker acting as checker with SELF_APPROVAL_FORBIDDEN', async () => {
    await expect(
      guard.run(context({ kind: 'USER', userId: 'maker-user', role: 'LAB_CHECKER' })),
    ).rejects.toMatchObject({
      code: 'SELF_APPROVAL_FORBIDDEN',
      status: 403,
    });
  });

  it('lets another checker, the system, and a record without a maker through', async () => {
    await guard.run(context({ kind: 'USER', userId: 'someone-else', role: 'LAB_CHECKER' }));
    await guard.run(context({ kind: 'SYSTEM' }));
    await differentFromMakerGuard('g', () => null).run(
      context({ kind: 'USER', userId: 'maker-user', role: 'LAB_CHECKER' }),
    );
  });
});

describe('BookingError', () => {
  it('carries the catalogued status, detail and meta', () => {
    const error = new BookingError('INVALID_STATE_TRANSITION', {
      detail: 'no',
      meta: { currentState: 'PAID' },
    });
    expect(error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      status: 409,
      detail: 'no',
      meta: { currentState: 'PAID' },
    });
    expect(error.message).toBe('no');
    expect(new BookingError('NOT_FOUND').message).toBe('NOT_FOUND');
  });

  it('is recognised by shape as well as by class', () => {
    expect(isBookingError(new BookingError('NOT_FOUND'))).toBe(true);
    const lookalike = Object.assign(new Error('x'), { name: 'BookingError', code: 'NOT_FOUND' });
    expect(isBookingError(lookalike)).toBe(true);
    expect(isBookingError(new Error('x'))).toBe(false);
    expect(isBookingError('x')).toBe(false);
  });
});
