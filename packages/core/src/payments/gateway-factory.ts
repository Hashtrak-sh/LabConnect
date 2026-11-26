import type { GatewayCode } from '@labconnect/database';
import type { Clock } from '../platform/clock.js';
import { nonProductionDeployment } from '../platform/deployment-env.js';
import { FakePaymentGateway } from './fake-gateway.js';
import type { PaymentGateway } from './gateway.js';

/** The environment the gateway selection reads. */
export type GatewayEnv = Readonly<Record<string, string | undefined>>;

export class PaymentGatewayConfigError extends Error {
  override name = 'PaymentGatewayConfigError';
}

/**
 * Whether the fake gateway may run here.
 *
 * Never in production: `APP_ENV=production` refuses it, and so does `NODE_ENV=production`
 * unless `APP_ENV=uat` says explicitly that this deployment is UAT (UAT is a deployed
 * environment that runs the production build; ICICI_PAYMENT_INTEGRATION.md section 4 allows
 * the fake in "local, CI and early UAT", and the contract says it is never enabled in
 * production, `receivePaymentWebhook`). `APP_ENV` is the variable the seeds already use
 * (`local`, `test`, `uat`, `production`). With neither set the fake is allowed: that is a
 * developer machine.
 */
export function fakeGatewayAllowed(env: GatewayEnv): boolean {
  return nonProductionDeployment(env);
}

/**
 * The gateway code that `PAYMENT_GATEWAY` selects. Fails with a clear message for anything
 * but `fake`: no adapter for a real gateway exists, because its documentation is not
 * available (OQ-01). With the variable unset the fake is the default wherever it is allowed;
 * where it is not (production) the variable is required.
 */
export function selectGatewayCode(env: GatewayEnv): GatewayCode {
  const raw = env.PAYMENT_GATEWAY?.trim().toLowerCase();
  const chosen = raw === undefined || raw === '' ? undefined : raw;
  if (chosen !== undefined && chosen !== 'fake') {
    throw new PaymentGatewayConfigError(
      'PAYMENT_GATEWAY must be "fake": no adapter for a real payment gateway exists yet ' +
        '(its documentation is not available, OQ-01).',
    );
  }
  if (!fakeGatewayAllowed(env)) {
    throw new PaymentGatewayConfigError(
      chosen === undefined
        ? 'PAYMENT_GATEWAY is not set, and the fake gateway is not allowed in production.'
        : 'The fake payment gateway is not allowed in production. UAT sets APP_ENV=uat explicitly.',
    );
  }
  return 'FAKE';
}

export interface CreateGatewayOptions {
  env: GatewayEnv;
  clock: Clock;
}

/**
 * The configured gateway. Needs `PAYMENT_FAKE_WEBHOOK_SECRET` (16 or more characters, any
 * string; it signs and verifies the fake's own notifications and protects nothing real).
 */
export function createPaymentGateway(options: CreateGatewayOptions): PaymentGateway {
  selectGatewayCode(options.env); // the guard and the name check
  const secret = options.env.PAYMENT_FAKE_WEBHOOK_SECRET;
  if (secret === undefined || secret.trim() === '') {
    throw new PaymentGatewayConfigError(
      'PAYMENT_FAKE_WEBHOOK_SECRET is not set. See .env.example.',
    );
  }
  return new FakePaymentGateway({ clock: options.clock, secret });
}
