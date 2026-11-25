import { describe, expect, it } from 'vitest';
import {
  assertDevScanAllowed,
  DevScanForbiddenError,
  DevScanRunner,
  isDevScanEnabled,
  readFilesScannerMode,
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

describe('FILES_SCANNER selects the scanner and fails fast', () => {
  it('defaults to guardduty, in every environment', () => {
    for (const NODE_ENV of ['production', 'development', 'test', undefined]) {
      expect(readFilesScannerMode({ NODE_ENV })).toBe('guardduty');
    }
    expect(readFilesScannerMode({ NODE_ENV: 'production', FILES_SCANNER: 'guardduty' })).toBe(
      'guardduty',
    );
  });

  it('allows the fake scanner only in development and test', () => {
    expect(readFilesScannerMode({ NODE_ENV: 'development', FILES_SCANNER: 'fake' })).toBe('fake');
    expect(readFilesScannerMode({ NODE_ENV: 'test', FILES_SCANNER: 'fake' })).toBe('fake');
  });

  it('refuses the fake scanner in production, unset or unknown NODE_ENV: production never runs it silently', () => {
    for (const NODE_ENV of ['production', 'staging', undefined]) {
      expect(() => readFilesScannerMode({ NODE_ENV, FILES_SCANNER: 'fake' })).toThrow(
        DevScanForbiddenError,
      );
    }
    // The auto-scan switch alone selects the fake scanner, and is refused the same way.
    expect(() =>
      readFilesScannerMode({ NODE_ENV: 'production', FILES_DEV_AUTO_SCAN: 'true' }),
    ).toThrow(DevScanForbiddenError);
  });

  it('rejects an unknown value and a contradiction with the auto-scan switch', () => {
    expect(() =>
      readFilesScannerMode({ NODE_ENV: 'development', FILES_SCANNER: 'clamav' }),
    ).toThrow(RangeError);
    expect(() =>
      readFilesScannerMode({
        NODE_ENV: 'development',
        FILES_SCANNER: 'guardduty',
        FILES_DEV_AUTO_SCAN: 'true',
      }),
    ).toThrow(RangeError);
    expect(readFilesScannerMode({ NODE_ENV: 'development', FILES_DEV_AUTO_SCAN: 'true' })).toBe(
      'fake',
    );
  });
});
