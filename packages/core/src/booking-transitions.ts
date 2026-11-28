import { registerDefaultBookingEffects } from './booking/default-effects.js';
import { BookingEngine } from './booking/engine.js';
import { TransitionRegistry } from './booking/registry.js';
import type { BookingEngineServices } from './booking/types.js';
import { registerPaymentBookingGuards } from './payments/booking-guards.js';

// The one place that decides what runs on each booking transition, for every process (the API
// and the worker). A transition behaves the same whichever process fires it: the API accepting a
// booking, the worker expiring it on a timer, the payments intake confirming it.
//
// It sits at the root of `packages/core`, outside the module folders, because it is wiring and
// not a module: the `booking` module must not import `payments` (MODULE_BOUNDARIES rule 3), so the
// guards and effects other modules give the engine are put together here. A module that adds a
// guard or an effect registers it in `createBookingTransitionRegistry`, and both apps get it.

/** Every guard, effect and column of the booking transitions, in one registry. */
export function createBookingTransitionRegistry(): TransitionRegistry {
  return registerPaymentBookingGuards(registerDefaultBookingEffects(new TransitionRegistry()));
}

/** A `BookingEngine` with the full registry. Each process builds one and shares it. */
export function createBookingEngine(services: BookingEngineServices): BookingEngine {
  return new BookingEngine(services, createBookingTransitionRegistry());
}
