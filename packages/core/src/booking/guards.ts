import { BookingError } from './errors.js';
import type { MaybePromise, TransitionContext, TransitionGuard } from './types.js';

/**
 * A guard factory for "checker is not the maker" (T-14, T-15, T-21, T-28; CLAUDE.md section 5).
 * The maker is recorded in `receipt_record` or `report_version`, which belong to the custody
 * and reports modules, so those modules register this guard with their own lookup. The
 * database refuses the same thing independently (constraints C-01 and C-02); this gives the
 * caller the catalogued error before anything is written.
 */
export function differentFromMakerGuard(
  name: string,
  makerOf: (context: TransitionContext) => MaybePromise<string | null>,
): TransitionGuard {
  return {
    name,
    async run(context) {
      const { actor } = context.command;
      if (actor.kind !== 'USER') return;
      const maker = await makerOf(context);
      if (maker !== null && maker === actor.userId) {
        throw new BookingError('SELF_APPROVAL_FORBIDDEN', {
          detail: 'The checker cannot be the maker of the record.',
          meta: { transitionId: context.transition.id },
        });
      }
    },
  };
}
