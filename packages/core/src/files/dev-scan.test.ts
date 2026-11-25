import { describe, expect, it } from 'vitest';
import {
  assertDevScanAllowed,
  DevScanForbiddenError,
  DevScanRunner,
  isDevScanEnabled,
} from './dev-scan.js';

const deps = {} as ConstructorParameters<typeof DevScanRunner>[0];

describe('the dev-only scan cannot be enabled in production', () => {
  it('is off unless FILES_DEV_AUTO_SCAN is true', () => {
    expect(isDevScanEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isDevScanEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isDevScanEnabled({ NODE_ENV: 'development', FILES_DEV_AUTO_SCAN: 'false' })).toBe(false);
    expect(isDevScanEnabled({ NODE_ENV: 'development', FILES_DEV_AUTO_SCAN: '1' })).toBe(false);
  });

  it('is on in development and test when asked for', () => {
    expect(isDevScanEnabled({ NODE_ENV: 'development', FILES_DEV_AUTO_SCAN: 'true' })).toBe(true);
    expect(isDevScanEnabled({ NODE_ENV: 'test', FILES_DEV_AUTO_SCAN: 'true' })).toBe(true);
  });

  it('refuses when NODE_ENV=production, so the worker does not start', () => {
    expect(() => isDevScanEnabled({ NODE_ENV: 'production', FILES_DEV_AUTO_SCAN: 'true' })).toThrow(
      DevScanForbiddenError,
    );
  });

  it('refuses when NODE_ENV is unset or unknown (a forgotten NODE_ENV must not enable a fake scanner)', () => {
    expect(() => isDevScanEnabled({ FILES_DEV_AUTO_SCAN: 'true' })).toThrow(DevScanForbiddenError);
    expect(() => isDevScanEnabled({ NODE_ENV: 'staging', FILES_DEV_AUTO_SCAN: 'true' })).toThrow(
      DevScanForbiddenError,
    );
  });

  it('cannot even build a runner in production', () => {
    expect(() => new DevScanRunner(deps, { NODE_ENV: 'production' })).toThrow(
      DevScanForbiddenError,
    );
    expect(() => new DevScanRunner(deps, {})).toThrow(DevScanForbiddenError);
    expect(() => new DevScanRunner(deps, { NODE_ENV: 'development' })).not.toThrow();
    expect(() => {
      assertDevScanAllowed({ NODE_ENV: 'production' });
    }).toThrow('NODE_ENV');
  });
});
