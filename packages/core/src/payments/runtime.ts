import type { GatewayCode } from '@labconnect/database';
import { BookingEngine } from '../booking/engine.js';
import { registerDefaultBookingEffects } from '../booking/default-effects.js';
import { TransitionRegistry } from '../booking/registry.js';
import type { BookingEngineServices } from '../booking/types.js';
import { AesGcmSecretCipher } from '../identity/cipher.js';
import { parseSecretBytes } from '../identity/hasher.js';
import { registerPaymentBookingGuards } from './booking-guards.js';
import { createPaymentGateway, selectGatewayCode, type GatewayEnv } from './gateway-factory.js';
import type { PaymentGateway } from './gateway.js';
import { PaymentService } from './service.js';

/**
 * The payments module as an app wires it, shared by the API and the worker so both build it
 * the same way. Everything that needs a secret is created on first use, never at start-up,
 * so an app boots without them and fails with a clear message where they are needed. Only
 * the cheap, secret-free check runs at start-up (`validate`): the gateway name and the
 * production guard, so a misconfigured deployment fails fast.
 *
 * Environment:
 * - `PAYMENT_GATEWAY`: `fake` (the only value; unset means `fake` where it is allowed).
 * - `PAYMENT_FAKE_WEBHOOK_SECRET`: the fake's own HMAC key, 16 or more characters.
 * - `PAYMENT_PAYLOAD_ENCRYPTION_KEY`: 32 bytes (base64 or hex), AES-256-GCM key for the
 *   stored notification bodies. Local and test; deployed environments use KMS (P3-11).
 * - `APP_ENV`, `NODE_ENV`: the production guard of the fake gateway.
 */
export class PaymentsRuntime {
  private gatewayInstance: PaymentGateway | undefined;
  private serviceInstance: PaymentService | undefined;

  constructor(
    private readonly env: GatewayEnv,
    private readonly services: BookingEngineServices,
    /**
     * The booking engine to move bookings with. The worker passes the one engine it builds for
     * the whole process (default effects and the T-09 guard); without it the runtime builds an
     * engine of its own, which is what the API does.
     */
    private readonly sharedEngine?: BookingEngine,
  ) {}

  /** Fails (throws) if the configured gateway does not exist or may not run here. No secrets needed. */
  validate(): void {
    selectGatewayCode(this.env);
  }

  /** The code of the configured gateway. Needs no secret, so a request can be refused before one is read. */
  get gatewayCode(): GatewayCode {
    return selectGatewayCode(this.env);
  }

  get gateway(): PaymentGateway {
    this.gatewayInstance ??= createPaymentGateway({ env: this.env, clock: this.services.clock });
    return this.gatewayInstance;
  }

  get service(): PaymentService {
    if (!this.serviceInstance) {
      const key = this.env.PAYMENT_PAYLOAD_ENCRYPTION_KEY;
      if (key === undefined || key.trim() === '') {
        throw new Error('PAYMENT_PAYLOAD_ENCRYPTION_KEY is not set. See .env.example.');
      }
      const cipher = new AesGcmSecretCipher(
        parseSecretBytes(key, 'PAYMENT_PAYLOAD_ENCRYPTION_KEY'),
      );
      // The engine the payments module moves bookings with: the default booking effects (they
      // cancel the payment timers when T-09 leaves ACCEPTED) and the T-09 guard.
      const engine =
        this.sharedEngine ??
        new BookingEngine(
          this.services,
          registerPaymentBookingGuards(registerDefaultBookingEffects(new TransitionRegistry())),
        );
      this.serviceInstance = new PaymentService({
        gateway: this.gateway,
        cipher,
        clock: this.services.clock,
        audit: this.services.audit,
        outbox: this.services.outbox,
        timers: this.services.timers,
        engine,
      });
    }
    return this.serviceInstance;
  }
}
