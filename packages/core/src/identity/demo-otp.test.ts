import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from '../platform/redact.js';
import {
  DEFAULT_DEMO_EMAIL_DOMAIN,
  DemoOtpConfigError,
  isDemoDestination,
  parseDemoOtpSettings,
} from './demo-otp.js';

const settings = (env: Record<string, string | undefined> = {}) => {
  const parsed = parseDemoOtpSettings({ DEMO_OTP_CODE: '444444', ...env });
  if (parsed === undefined) throw new Error('expected the demo setting to be on');
  return parsed;
};
const failure = (env: Record<string, string | undefined>): DemoOtpConfigError => {
  try {
    parseDemoOtpSettings(env);
  } catch (error) {
    if (error instanceof DemoOtpConfigError) return error;
    throw error;
  }
  return expect.fail('expected the setting to be refused');
};

describe('demo one-time code settings', () => {
  describe('off by default', () => {
    it('is off when neither variable is present, in every environment', () => {
      for (const env of [
        {},
        { NODE_ENV: 'production' },
        { NODE_ENV: 'production', APP_ENV: 'production' },
        { APP_ENV: 'uat' },
        { NODE_ENV: 'test' },
      ]) {
        expect(parseDemoOtpSettings(env)).toBeUndefined();
      }
    });

    it('is off with a domain but no code', () => {
      expect(
        parseDemoOtpSettings({ DEMO_OTP_EMAIL_DOMAIN: 'demo.labconnect.test' }),
      ).toBeUndefined();
    });
  });

  describe('production refuses it', () => {
    const forbidden = [
      { APP_ENV: 'production' },
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', APP_ENV: 'local' },
      { NODE_ENV: 'production', APP_ENV: 'staging' },
      { NODE_ENV: 'production', APP_ENV: '' },
      { NODE_ENV: 'development', APP_ENV: 'production' },
      { NODE_ENV: ' Production ', APP_ENV: ' PRODUCTION ' },
      { NODE_ENV: 'PRODUCTION' },
    ];
    it.each(forbidden)('refuses the code in %j, naming the variable and not the value', (env) => {
      const error = failure({ ...env, DEMO_OTP_CODE: '482915' });
      expect(error.message).toContain('DEMO_OTP_CODE');
      expect(error.message).not.toContain('482915');
    });

    it.each(forbidden)('refuses the domain alone in %j, naming the variable', (env) => {
      const error = failure({ ...env, DEMO_OTP_EMAIL_DOMAIN: 'demo.labconnect.test' });
      expect(error.message).toContain('DEMO_OTP_EMAIL_DOMAIN');
    });

    it('refuses an empty value too (present is present)', () => {
      expect(failure({ APP_ENV: 'production', DEMO_OTP_CODE: '' }).message).toContain(
        'DEMO_OTP_CODE',
      );
    });

    it('is allowed on a developer machine, in test and on UAT (which runs the production build)', () => {
      for (const env of [
        {},
        { NODE_ENV: 'development' },
        { NODE_ENV: 'test' },
        { APP_ENV: 'local' },
        { APP_ENV: 'test' },
        { APP_ENV: 'uat' },
        { NODE_ENV: 'production', APP_ENV: 'uat' },
        { NODE_ENV: 'production', APP_ENV: ' UAT ' },
      ]) {
        expect(parseDemoOtpSettings({ ...env, DEMO_OTP_CODE: '444444' })).toBeDefined();
      }
    });
  });

  describe('the code', () => {
    it.each([
      '44444',
      '4444444',
      'abcdef',
      '44444a',
      '444 444',
      ' 444444',
      '444444 ',
      '',
      '４４４４４４',
      '-44444',
      '4.4444',
    ])('must be exactly six digits: refuses %j without repeating it', (code) => {
      const error = failure({ DEMO_OTP_CODE: code });
      expect(error.message).toContain('DEMO_OTP_CODE');
      if (code.trim() !== '') expect(error.message).not.toContain(code);
    });

    it('accepts six digits, including leading zeros', () => {
      expect(settings({ DEMO_OTP_CODE: '000123' }).code).toBe('000123');
    });
  });

  describe('the domain', () => {
    it('defaults to the demo seed domain', () => {
      expect(settings().emailDomain).toBe(DEFAULT_DEMO_EMAIL_DOMAIN);
      expect(DEFAULT_DEMO_EMAIL_DOMAIN).toBe('demo.labconnect.test');
    });

    it.each([
      ['demo.labconnect.test', 'demo.labconnect.test'],
      ['Demo.Example', 'demo.example'],
      ['  uat.demo.invalid ', 'uat.demo.invalid'],
      ['x.localhost', 'x.localhost'],
      ['a-b.example', 'a-b.example'],
    ])('accepts %j under a reserved top-level domain', (given, expected) => {
      expect(settings({ DEMO_OTP_EMAIL_DOMAIN: given }).emailDomain).toBe(expected);
    });

    it.each([
      'labconnect.in',
      'example.com',
      'example.org',
      'gov.in',
      'demo.labconnect.test.com',
      'test',
      'example',
      'localhost',
      '.test',
      'demo.test.',
      'demo..test',
      'demo test.test',
      'demo.labconnect.tést',
      'dеmo.labconnect.test',
      'demo.labconnect.test.evil.in',
      'user@demo.labconnect.test',
      '-demo.test',
      'demo-.test',
      '',
    ])('refuses %j (not a name under a reserved top-level domain)', (domain) => {
      const error = failure({ DEMO_OTP_CODE: '444444', DEMO_OTP_EMAIL_DOMAIN: domain });
      expect(error.message).toContain('DEMO_OTP_EMAIL_DOMAIN');
      if (domain.length > 9) expect(error.message).not.toContain(domain);
    });

    it('refuses a non-ASCII letter that folds to ASCII when lower-cased (the Kelvin sign)', () => {
      expect(() =>
        parseDemoOtpSettings({ DEMO_OTP_CODE: '444444', DEMO_OTP_EMAIL_DOMAIN: 'Kiosk.example' }),
      ).toThrow(/DEMO_OTP_EMAIL_DOMAIN/);
    });
  });

  describe('never shows the code', () => {
    it('keeps it out of JSON, inspect and a spread of the settings', () => {
      const demo = settings({ DEMO_OTP_CODE: '482915' });
      expect(demo.code).toBe('482915');
      expect(JSON.stringify(demo)).not.toContain('482915');
      expect(inspect(demo, { showHidden: false })).not.toContain('482915');
      expect(JSON.stringify({ ...demo })).not.toContain('482915');
      expect(JSON.stringify(demo)).toContain('demo.labconnect.test');
    });

    it('is not changed after it was read', () => {
      const demo = settings();
      expect(() => {
        (demo as { emailDomain: string }).emailDomain = 'evil.example';
      }).toThrow();
    });
  });

  describe('the audit key', () => {
    it('is not blanked by the redactor (a key with "otp" in it would be)', () => {
      expect(redact({ demoCode: true, codeSent: true })).toEqual({
        demoCode: true,
        codeSent: true,
      });
      expect(redact({ demoOtp: true })).toEqual({ demoOtp: REDACTED });
    });
  });
});

describe('isDemoDestination', () => {
  const demo = settings();
  const yes = [
    'demo1.demo1@demo.labconnect.test',
    'Ops.Demo@DEMO.LabConnect.TEST',
    '  checker@demo.labconnect.test  ',
    // trimmed by the same normalisation that makes it the same destination
    'x@demo.labconnect.test\n',
    'a@demo.labconnect.test',
  ];
  const no = [
    // not the demo domain at all, including the platform team and a real lab address
    'ops@labconnect.in',
    'someone@example.test',
    'lab@nabl-lab.co.in',
    'admin@gov.in',
    // subdomain, parent, prefix, suffix and look-alikes
    'x@sub.demo.labconnect.test',
    'x@labconnect.test',
    'x@test',
    'x@demo.labconnect.test.evil.example',
    'x@demo.labconnect.test.com',
    'x@evildemo.labconnect.test',
    'x@xdemo.labconnect.test',
    'x@demo-labconnect.test',
    'x@demo.labconnect.tes',
    'x@demo.labconnect.testt',
    // trailing dot, punctuation, a second @, no @, no local part
    'x@demo.labconnect.test.',
    'x@.demo.labconnect.test',
    'x@demo.labconnect.test@evil.example',
    'x@evil.example@demo.labconnect.test',
    'x@@demo.labconnect.test',
    'demo.labconnect.test',
    '@demo.labconnect.test',
    '',
    // whitespace and control characters inside
    'x y@demo.labconnect.test',
    'x@demo.labconnect.test x@evil.example',
    'x@demo.labconnect.test\u0000',
    'x@demo.labconnect.test\n\nx@evil.example',
    'x@demo.labconnect .test',
    // non-ASCII: look-alike letters, zero-width, full-width, combining
    'x@dеmo.labconnect.test',
    'x@demo.labconnect.tеst',
    'x@demo.labconnect.test​',
    '​x@demo.labconnect.test',
    'x@demo。labconnect.test',
    'x@demo.labconnect.test́',
    'x@ｄemo.labconnect.test',
    'x@DEMO.LABCONNECT.TESTK',
    'x@İdemo.labconnect.test',
  ];

  it.each(yes)('matches %j', (email) => {
    expect(isDemoDestination(email, demo)).toBe(true);
  });
  it.each(no)('does not match %j', (email) => {
    expect(isDemoDestination(email, demo)).toBe(false);
  });

  it('follows the configured domain, and only that', () => {
    const other = settings({ DEMO_OTP_EMAIL_DOMAIN: 'uat.demo.example' });
    expect(isDemoDestination('a@uat.demo.example', other)).toBe(true);
    expect(isDemoDestination('a@demo.labconnect.test', other)).toBe(false);
  });

  it('does not fold a Kelvin sign into a k of the configured domain', () => {
    const kiosk = settings({ DEMO_OTP_EMAIL_DOMAIN: 'kiosk.example' });
    expect(isDemoDestination('a@kiosk.example', kiosk)).toBe(true);
    expect(isDemoDestination('a@Kiosk.example', kiosk)).toBe(false);
  });
});
