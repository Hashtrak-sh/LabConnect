import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClaimLabs } from '../support/claim-labs.js';
import { START, refreshCookie, useIdentityApp } from '../support/identity-app.js';

// Demo one-time codes (UAT only) over HTTP, on a real database: the fixed code of demo accounts,
// no mail for them, and everything else (lockout, authenticator step, limits, other addresses)
// as before. The setting is in the identity environment the API reads, as `DEMO_OTP_CODE`.

const CODE = '444444';
const DEMO_DOMAIN = 'demo.labconnect.test';

describe('demo one-time codes over HTTP', () => {
  const t = useIdentityApp();
  // At collection time, before the app is built: it starts with the setting on.
  t.env.DEMO_OTP_CODE = CODE;
  const makeLab = useClaimLabs(t, new Date(START));

  let fixtures: Awaited<ReturnType<typeof t.fixtures>> | undefined;
  const known = async () => (fixtures ??= await t.fixtures());

  /** Everything the process writes to the console and to Nest's logger. */
  let lines: string[] = [];
  let restore: (() => void)[] = [];
  beforeEach(() => {
    lines = [];
    const keep = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(keep),
      vi.spyOn(console, 'info').mockImplementation(keep),
      vi.spyOn(console, 'warn').mockImplementation(keep),
      vi.spyOn(console, 'error').mockImplementation(keep),
      vi.spyOn(console, 'debug').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'error').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'log').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(keep),
    ];
    restore = spies.map((spy) => () => {
      spy.mockRestore();
    });
  });
  afterEach(() => {
    for (const undo of restore) undo();
    t.env.DEMO_OTP_CODE = CODE;
  });

  const requestCode = (email: string) =>
    t.api.post('/v1/auth/otp/request', { body: { email, purpose: 'LOGIN' } });
  const verifyCode = (email: string, code: string) =>
    t.api.post('/v1/auth/otp/verify', { body: { email, code } });
  /** Signs in with the fixed code, without any mail. */
  const demoSignIn = async (email: string) => {
    const requested = await requestCode(email);
    expect(requested.status).toBe(202);
    const response = await verifyCode(email, CODE);
    return {
      response,
      body: response.body as { mfaRequired: boolean; mfaEnrolled?: boolean; accessToken: string },
      cookie: refreshCookie(response),
    };
  };
  const wrong = (code: string): string => (code === '000000' ? '000001' : '000000');

  it('signs a demo user in with the fixed code and sends no mail', async () => {
    const { customer } = await known();
    const before = t.mailer.sent.length;
    const { response, body, cookie } = await demoSignIn(customer.admin.email);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ mfaRequired: false, tokenType: 'Bearer' });
    expect(cookie).not.toBeNull();
    expect(t.mailer.sent).toHaveLength(before);
    expect(t.mailer.claimSent).toHaveLength(0);
    const me = await t.api.get('/v1/me', { token: body.accessToken });
    expect(me.status).toBe(200);
  });

  it('says the same to the client for a demo address as for any other: 202, no body', async () => {
    const { customer } = await known();
    const demo = await requestCode(customer.requester.email);
    const other = await requestCode(t.newEmail('other'));
    expect(demo.status).toBe(other.status);
    expect(demo.text).toBe(other.text);
    expect(Object.keys(demo.headers).sort()).toEqual(Object.keys(other.headers).sort());
  });

  it('marks the issued code in the audit log with a flag, never the code or the address', async () => {
    const { individual } = await known();
    await demoSignIn(individual.admin.email);
    const rows = await t
      .db()
      .query<{ action: string; after: unknown }>(
        `SELECT action, after FROM audit_log WHERE action = 'auth.otp_request' AND after->>'demoCode' = 'true'`,
      );
    expect(rows.rowCount).toBeGreaterThan(0);
    const everything = await t
      .db()
      .query<{ row: string }>('SELECT row_to_json(t)::text AS row FROM audit_log t');
    const text = everything.rows.map((r) => r.row).join('\n');
    expect(text).not.toContain(`"${CODE}"`);
    expect(text).not.toContain(individual.admin.email);
  });

  it('still locks after five wrong guesses although the right code is known', async () => {
    const { customer } = await known();
    const email = customer.admin.email;
    await requestCode(email);
    for (let attempt = 1; attempt <= 4; attempt++) {
      const response = await verifyCode(email, wrong(CODE));
      expect(response.body).toMatchObject({ code: 'OTP_INVALID' });
    }
    expect((await verifyCode(email, wrong(CODE))).body).toMatchObject({ code: 'OTP_LOCKED' });
    const locked = await verifyCode(email, CODE);
    expect(locked.status).not.toBe(200);
    expect(locked.body).toMatchObject({ code: 'OTP_LOCKED' });
    expect(refreshCookie(locked)).toBeNull();
  });

  it('still expires after 10 minutes', async () => {
    const { customer } = await known();
    await requestCode(customer.requester.email);
    t.clock.advance(10 * 60_000 + 1000);
    const response = await verifyCode(customer.requester.email, CODE);
    expect(response.body).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('still limits requests: the sixth in 15 minutes for one demo address is 429', async () => {
    const { individual } = await known();
    const email = individual.admin.email;
    t.clock.advance(60 * 60_000);
    for (let i = 0; i < 5; i++) expect((await requestCode(email)).status).toBe(202);
    const sixth = await requestCode(email);
    expect(sixth.status).toBe(429);
    expect(sixth.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  describe('the authenticator step is still required', () => {
    it('gives a demo Customer Finance user and a demo Ops user only a partial session', async () => {
      const { customer, platform } = await known();
      for (const person of [customer.finance, platform.ops]) {
        const { response, body, cookie } = await demoSignIn(person.email);
        expect(response.status).toBe(200);
        expect(body).toMatchObject({ mfaRequired: true, mfaEnrolled: false });
        expect(cookie).toBeNull();
        // The partial token opens nothing but the authenticator routes.
        expect((await t.api.get('/v1/me', { token: body.accessToken })).status).toBe(401);
      }
    });

    it('needs a real authenticator code: a wrong one is refused, the right one completes the sign-in', async () => {
      const { platform } = await known();
      const { body } = await demoSignIn(platform.ops.email);
      const enrolment = await t.enrol(body.accessToken);
      expect(enrolment.confirmed.status).toBe(200);
      t.clock.advance(30_000);

      // The fixed one-time code is not a TOTP code, and a wrong authenticator code gets nowhere.
      for (const code of [CODE, wrong(t.totpNow(enrolment.secret))]) {
        const refused = await t.api.post('/v1/auth/mfa/verify', {
          token: body.accessToken,
          body: { code },
        });
        expect(refused.status).toBe(422);
        expect(refused.body).toMatchObject({ code: 'OTP_INVALID' });
        expect(refreshCookie(refused)).toBeNull();
      }
      const verified = await t.api.post('/v1/auth/mfa/verify', {
        token: body.accessToken,
        body: { code: t.totpNow(enrolment.secret) },
      });
      expect(verified.status).toBe(200);
      const full = (verified.body as { accessToken: string }).accessToken;
      expect((await t.api.get('/v1/me', { token: full })).status).toBe(200);
    });

    it('locks the authenticator after five wrong codes, as for any user', async () => {
      const { customer } = await known();
      const { body } = await demoSignIn(customer.finance.email);
      await t.enrol(body.accessToken);
      t.clock.advance(30_000);
      const responses = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        responses.push(
          await t.api.post('/v1/auth/mfa/verify', {
            token: body.accessToken,
            body: { code: '000000' },
          }),
        );
      }
      expect(responses.at(-1)?.body).toMatchObject({ code: 'OTP_LOCKED' });
    });
  });

  describe('other addresses', () => {
    it('sends a random code by mail to an address outside the demo domain, even for platform staff', async () => {
      const stranger = t.newEmail('plain');
      const { response, code } = await t.requestCode(stranger);
      expect(response.status).toBe(202);
      expect(code).toMatch(/^\d{6}$/);
      expect(t.mailer.sent.filter((m) => m.to === stranger)).toHaveLength(1);
      // The fixed code does not sign them in (unless the random one happens to be it).
      if (code !== CODE)
        expect((await verifyCode(stranger, CODE)).body).toMatchObject({ code: 'OTP_INVALID' });
    });

    it('sends a random code by mail for near misses of the domain, and the fixed code opens nothing', async () => {
      for (const domain of [
        `sub.${DEMO_DOMAIN}`,
        `${DEMO_DOMAIN}.evil.example`,
        `x${DEMO_DOMAIN}`,
        'labconnect.test',
      ]) {
        const email = t.newEmail('near').replace('example.test', domain);
        const { response, code } = await t.requestCode(email);
        expect(response.status, email).toBe(202);
        expect(code, email).toMatch(/^\d{6}$/);
        if (code !== CODE)
          expect((await verifyCode(email, CODE)).body, email).toMatchObject({
            code: 'OTP_INVALID',
          });
      }
    });

    it('cannot create a demo-domain account: with no account the code is random, mailed to nobody, and refused', async () => {
      const email = `nobody.${Math.random().toString(16).slice(2, 10)}@${DEMO_DOMAIN}`;
      const requested = await requestCode(email);
      expect(requested.status).toBe(202);
      // A random code was made, and a mail was sent to the address (the ordinary path; the domain
      // cannot receive it), so the fixed code is not the one stored.
      expect(t.mailer.lastCodeFor(email)).toMatch(/^\d{6}$/);
      if (t.mailer.lastCodeFor(email) !== CODE) {
        const response = await verifyCode(email, CODE);
        expect(response.body).toMatchObject({ code: 'OTP_INVALID' });
        expect(refreshCookie(response)).toBeNull();
      }
      const users = await t.db().query('SELECT 1 FROM app_user WHERE email = $1', [email]);
      expect(users.rowCount).toBe(0);
    });
  });

  describe('lab claim code of a demo lab site', () => {
    const newUser = async (label = 'claimant') => {
      const email = t.newEmail(label);
      const session = await t.signIn(email);
      return { email, token: session.accessToken };
    };

    it('is the fixed code, is not mailed, and completes the claim', async () => {
      const claimable = await makeLab({
        email: `site.${Math.random().toString(16).slice(2, 10)}@${DEMO_DOMAIN}`,
      });
      const user = await newUser();
      const started = await t.api.post('/v1/lab/claims', {
        token: user.token,
        body: { certificateNo: claimable.certificateNo },
      });
      expect(started.status).toBe(201);
      expect(t.mailer.claimSent).toEqual([]);
      const id = (started.body as { id: string }).id;
      const verified = await t.api.post(`/v1/lab/claims/${id}/verify-otp`, {
        token: user.token,
        body: { code: CODE },
        headers: { 'If-Match': started.headers.etag ?? '"0"' },
      });
      expect(verified.status).toBe(200);
      expect(verified.body).toMatchObject({ status: 'PENDING_REVIEW' });
      const audit = await t
        .db()
        .query<{ action: string; after: Record<string, unknown> }>(
          `SELECT action, after FROM audit_log WHERE entity_id = $1 AND action = 'lab_claim.start'`,
          [id],
        );
      expect(audit.rows[0]?.after).toMatchObject({ codeSent: true, demoCode: true });
      expect(JSON.stringify(audit.rows)).not.toContain(CODE);
    });

    it('is a random, mailed code for a real lab address and for a look-alike of the demo domain', async () => {
      for (const email of [
        'quality@nabl-lab.co.in',
        `site@${DEMO_DOMAIN}.evil.example`,
        `site@sub.${DEMO_DOMAIN}`,
      ]) {
        const claimable = await makeLab({ email });
        const user = await newUser();
        const sent = t.mailer.claimSent.length;
        const started = await t.api.post('/v1/lab/claims', {
          token: user.token,
          body: { certificateNo: claimable.certificateNo },
        });
        expect(started.status, email).toBe(201);
        expect(t.mailer.claimSent, email).toHaveLength(sent + 1);
        expect(t.mailer.claimSent.at(-1)?.to).toBe(email);
        const audit = await t
          .db()
          .query<{ after: Record<string, unknown> }>(
            `SELECT after FROM audit_log WHERE entity_id = $1 AND action = 'lab_claim.start'`,
            [(started.body as { id: string }).id],
          );
        expect(audit.rows[0]?.after).not.toHaveProperty('demoCode');
      }
    });

    it('still locks after five wrong guesses although the right code is known', async () => {
      const claimable = await makeLab({
        email: `site.${Math.random().toString(16).slice(2, 10)}@${DEMO_DOMAIN}`,
      });
      const user = await newUser();
      const started = await t.api.post('/v1/lab/claims', {
        token: user.token,
        body: { certificateNo: claimable.certificateNo },
      });
      const id = (started.body as { id: string }).id;
      const attempt = (code: string) =>
        t.api.post(`/v1/lab/claims/${id}/verify-otp`, {
          token: user.token,
          body: { code },
          headers: { 'If-Match': '"0"' },
        });
      for (let i = 0; i < 5; i++) await attempt(wrong(CODE));
      const locked = await attempt(CODE);
      expect(locked.status).not.toBe(200);
      expect(locked.body).toMatchObject({ code: 'OTP_LOCKED' });
    });
  });

  it('is off when the setting is absent: a demo address gets a random code by mail', async () => {
    const { customer } = await known();
    Reflect.deleteProperty(t.env, 'DEMO_OTP_CODE');
    const before = t.mailer.sent.length;
    const { response, code } = await t.requestCode(customer.admin.email);
    expect(response.status).toBe(202);
    expect(t.mailer.sent).toHaveLength(before + 1);
    expect(code).toMatch(/^\d{6}$/);
    if (code !== CODE) {
      const refused = await verifyCode(customer.admin.email, CODE);
      expect(refused.body).toMatchObject({ code: 'OTP_INVALID' });
    }
  });

  it('never writes the code to a log line, a response or the outbox', async () => {
    const { customer } = await known();
    const responses = [
      await requestCode(customer.admin.email),
      await verifyCode(customer.admin.email, CODE),
    ];
    responses.push(await verifyCode(customer.admin.email, wrong(CODE)));
    for (const response of responses)
      expect(response.text + JSON.stringify(response.headers)).not.toContain(CODE);
    expect(lines.join('\n')).not.toContain(CODE);
    const outbox = await t
      .db()
      .query<{ row: string }>('SELECT row_to_json(t)::text AS row FROM outbox_event t');
    expect(outbox.rows.map((r) => r.row).join('\n')).not.toContain(CODE);
  });
});
