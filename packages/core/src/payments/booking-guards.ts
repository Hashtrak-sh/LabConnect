import { BookingError } from '../booking/errors.js';
import type { TransitionGuard } from '../booking/types.js';
import type { TransitionRegistry } from '../booking/registry.js';

/**
 * T-09 `ConfirmPayment`: "Verified capture equals the booking total" (BOOKING_STATE_MACHINE.md
 * section 3). The engine only knows the actor (SYSTEM / PAYMENTS); this guard makes the
 * engine itself refuse T-09 unless the command names a payment order of this booking that
 * is `CAPTURED` for exactly the booking total, so no other caller with the PAYMENTS source
 * can mark a booking paid. It runs inside the engine, before anything is written, in the
 * transaction of the caller (which has already set the order to `CAPTURED`).
 *
 * The booking module cannot import payments (rule 3), so the app registers this guard on the
 * registry it gives the engine (`registerPaymentBookingGuards`).
 */
export const confirmPaymentGuard: TransitionGuard = {
  name: 'payments.confirm-payment-captured',
  async run(context) {
    const orderId = context.command.input?.paymentOrderId;
    if (typeof orderId !== 'string') {
      throw new BookingError('PAYMENT_AMOUNT_MISMATCH', {
        detail: 'ConfirmPayment needs the captured payment order.',
      });
    }
    const rows = await context.tx.$queryRaw<{ ok: boolean }[]>`
      SELECT (status = 'CAPTURED' AND amount_paise = ${context.booking.totalPaise}) AS ok
        FROM payment_order
       WHERE id = ${orderId}::uuid AND booking_id = ${context.booking.id}::uuid`;
    if (rows[0]?.ok !== true) {
      throw new BookingError('PAYMENT_AMOUNT_MISMATCH', {
        detail: 'There is no verified capture of the booking total.',
      });
    }
  },
};

/** Adds the payments module's guards to the registry the app gives the BookingEngine. */
export function registerPaymentBookingGuards(registry: TransitionRegistry): TransitionRegistry {
  return registry.addGuard('T-09', confirmPaymentGuard);
}
