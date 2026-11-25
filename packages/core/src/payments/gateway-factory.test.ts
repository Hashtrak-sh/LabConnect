import { describe, expect, it } from 'vitest';
import { FixedClock } from '../platform/clock.js';
import {
  createPaymentGateway,
  fakeGatewayAllowed,
  PaymentGatewayConfigError,
  selectGatewayCode,
} from './gateway-factory.js';

const clock = new FixedClock('2026-11-25T10:00:00Z');
const SECRET = 'fake-test-secret-0123456789';

describe('the production guard of the fake gateway', () => {
  it.each([
    [{}, true],
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: 'test' }, true],
    [{ APP_ENV: 'local' }, true],
    [{ APP_ENV: 'test', NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'Production' }, false],
    [{ APP_ENV: 'production' }, false],
    [{ APP_ENV: 'production', NODE_ENV: 'development' }, false],
    [{ APP_ENV: 'PRODUCTION', NODE_ENV: 'production' }, false],
    // UAT runs the production build; only an explicit APP_ENV=uat allows the fake there.
    [{ NODE_ENV: 'production', APP_ENV: 'uat' }, true],
    [{ NODE_ENV: 'production', APP_ENV: ' UAT ' }, true],
  ])('%j allows the fake: %s', (env, allowed) => {
    expect(fakeGatewayAllowed(env)).toBe(allowed);
  });

  it('refuses to select the fake in production, with a message that names the way out', () => {
    expect(() => selectGatewayCode({ NODE_ENV: 'production', PAYMENT_GATEWAY: 'fake' })).toThrow(
      /not allowed in production/,
    );
    expect(() => selectGatewayCode({ APP_ENV: 'production' })).toThrow(PaymentGatewayConfigError);
    expect(() => selectGatewayCode({ NODE_ENV: 'production' })).toThrow(
      /PAYMENT_GATEWAY is not set/,
    );
  });

  it('selects the fake in UAT and locally', () => {
    expect(
      selectGatewayCode({ NODE_ENV: 'production', APP_ENV: 'uat', PAYMENT_GATEWAY: 'fake' }),
    ).toBe('FAKE');
    expect(selectGatewayCode({})).toBe('FAKE');
    expect(selectGatewayCode({ PAYMENT_GATEWAY: ' FAKE ' })).toBe('FAKE');
  });

  it('fails fast for any other gateway: no adapter for a real one exists', () => {
    for (const name of ['icici', 'ICICI', 'razorpay', 'real']) {
      expect(() => selectGatewayCode({ PAYMENT_GATEWAY: name })).toThrow(
        /no adapter for a real payment gateway exists yet/,
      );
    }
  });
});

describe('createPaymentGateway', () => {
  it('builds the fake from the environment and needs its secret', () => {
    const gateway = createPaymentGateway({
      env: { PAYMENT_GATEWAY: 'fake', PAYMENT_FAKE_WEBHOOK_SECRET: SECRET },
      clock,
    });
    expect(gateway.code).toBe('FAKE');
    expect(() => createPaymentGateway({ env: { PAYMENT_GATEWAY: 'fake' }, clock })).toThrow(
      /PAYMENT_FAKE_WEBHOOK_SECRET is not set/,
    );
  });

  it('never builds the fake in production, even with a secret', () => {
    expect(() =>
      createPaymentGateway({
        env: {
          NODE_ENV: 'production',
          PAYMENT_GATEWAY: 'fake',
          PAYMENT_FAKE_WEBHOOK_SECRET: SECRET,
        },
        clock,
      }),
    ).toThrow(PaymentGatewayConfigError);
  });
});
