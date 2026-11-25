import { describe, expect, it, vi } from 'vitest';
import { jwtPayload, refreshCookie, useIdentityApp } from '../support/identity-app.js';

// requestOtp and verifyOtp over HTTP, held to the contract, on a real database.

describe('POST /v1/auth/otp/request', () => {
  const t = useIdentityApp();
  let fixtures: Awaited<ReturnType<typeof t.fixtures>> | undefined;
  const known = async () => (fixtures ??= await t.fixtures());

  it('answers 202 with no body and sends the code by email', async () => {
    const email = t.newEmail();
    const { response, code } = await t.requestCode(email);
    expect(response.status).toBe(202);
    expect(response.text).toBe('');
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(code).toMatch(/^\d{6}$/);
    expect(t.mailer.sent.filter((message) => message.to === email)).toHaveLength(1);
    expect(t.mailer.sent.at(-1)?.validForMinutes).toBe(10);
  });

  it('answers a registered address, a stranger and a disabled user the same way (no user enumeration)', async () => {
    const { customer } = await known();
    const registered = await t.requestCode(customer.admin.email);
    const stranger = await t.requestCode(t.newEmail('stranger'));
    await t
      .db()
      .query("UPDATE app_user SET status = 'DISABLED' WHERE email = $1", [
        customer.requester.email,
      ]);
    const disabled = await t.requestCode(customer.requester.email);

    const shape = (response: typeof registered.response) => ({
      status: response.status,
      text: response.text,
      headers: Object.keys(response.headers)
        .filter((name) => !['x-request-id', 'date', 'etag'].includes(name))
        .sort(),
    });
    expect(shape(stranger.response)).toEqual(shape(registered.response));
    expect(shape(disabled.response)).toEqual(shape(registered.response));
    // The same work is done for each: a challenge is stored and a code is sent.
    for (const email of [customer.admin.email, customer.requester.email]) {
      expect(t.mailer.lastCodeFor(email)).toMatch(/^\d{6}$/);
    }
    await t
      .db()
      .query("UPDATE app_user SET status = 'ACTIVE' WHERE email = $1", [customer.requester.email]);
  });

  it('keeps the code out of every database table, the audit log and the outbox', async () => {
    const email = t.newEmail('secret-keeper');
    const { code } = await t.requestCode(email);
    const signedIn = await t.api.post('/v1/auth/otp/verify', { body: { email, code } });
    expect(signedIn.status).toBe(200);
    const tables = ['audit_log', 'outbox_event', 'otp_challenge', 'user_session', 'app_user'];
    for (const table of tables) {
      const rows = await t
        .db()
        .query<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM ${table} t`);
      const everything = rows.rows.map((row) => row.row).join('\n');
      expect(everything).not.toContain(`"${code ?? 'x'}"`);
      expect(everything).not.toMatch(new RegExp(`[:\\s"]${code ?? 'x'}[,"}\\s]`));
    }
    const outbox = await t.db().query<{ n: string }>('SELECT count(*) AS n FROM outbox_event');
    expect(outbox.rows[0]?.n).toBe('0');
  });

  it('normalises the address: case and spaces do not make a new destination', async () => {
    const email = t.newEmail('MiXeD');
    await t.requestCode(email.toUpperCase());
    expect(t.mailer.lastCodeFor(email.toLowerCase())).toMatch(/^\d{6}$/);
  });

  it('rejects an invalid body with 422 VALIDATION_FAILED and field errors', async () => {
    const bad: [string, unknown][] = [
      ['a missing email', { purpose: 'LOGIN' }],
      ['a malformed email', { email: 'not-an-email', purpose: 'LOGIN' }],
      ['a missing purpose', { email: 'a@example.test' }],
      ['another purpose', { email: 'a@example.test', purpose: 'LAB_CLAIM' }],
      ['an extra field', { email: 'a@example.test', purpose: 'LOGIN', admin: true }],
      ['an email that is too long', { email: `${'a'.repeat(250)}@example.test`, purpose: 'LOGIN' }],
      ['an array', []],
    ];
    for (const [label, body] of bad) {
      const response = await t.api.post('/v1/auth/otp/request', {
        body: body as object,
        invalidRequest: label,
      });
      expect(response.status, label).toBe(422);
      expect(response.body, label).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((response.body as { errors: unknown[] }).errors.length, label).toBeGreaterThan(0);
    }
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await t.api.post('/v1/auth/otp/request', {
      body: '{"email": ',
      headers: { 'Content-Type': 'application/json' },
      invalidRequest: 'malformed JSON',
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('limits one address to 5 requests per 15 minutes: 429 RATE_LIMITED with Retry-After', async () => {
    const email = t.newEmail('limited');
    for (let i = 0; i < 5; i++) {
      expect((await t.requestCode(email)).response.status).toBe(202);
    }
    const sixth = await t.requestCode(email);
    expect(sixth.response.status).toBe(429);
    expect(sixth.response.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(Number(sixth.response.headers['retry-after'])).toBeGreaterThan(0);
    expect(t.mailer.sent.filter((message) => message.to === email)).toHaveLength(5);
    t.clock.advance(15 * 60_000 + 1000);
    expect((await t.requestCode(email)).response.status).toBe(202);
  });

  it('limits one IP address to 20 requests per hour', async () => {
    const headers = { 'X-Forwarded-For': '192.0.2.99' };
    for (let i = 0; i < 20; i++) {
      const response = await t.api.post('/v1/auth/otp/request', {
        body: { email: t.newEmail('ip'), purpose: 'LOGIN' },
        headers,
      });
      expect(response.status).toBe(202);
    }
    const over = await t.api.post('/v1/auth/otp/request', {
      body: { email: t.newEmail('ip'), purpose: 'LOGIN' },
      headers,
    });
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('answers 500 INTERNAL_ERROR, with no code in it, when the mail cannot be sent', async () => {
    const email = t.newEmail('mailfail');
    t.mailer.failWith = new Error(`SMTP down for ${email}`);
    const writes: string[] = [];
    const capture = (chunk: unknown): boolean => {
      writes.push(String(chunk));
      return true;
    };
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    try {
      const response = await t.api.post('/v1/auth/otp/request', {
        body: { email, purpose: 'LOGIN' },
      });
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(JSON.stringify(response.body)).not.toContain(email);
    } finally {
      out.mockRestore();
      err.mockRestore();
      t.mailer.failWith = undefined;
    }
    const challenge = await t
      .db()
      .query<{ n: string }>('SELECT count(*) AS n FROM otp_challenge WHERE ip_address IS NOT NULL');
    expect(Number(challenge.rows[0]?.n)).toBeGreaterThan(0);
    // Nothing the server logged names the address (the mail error did).
    expect(writes.join('')).not.toContain(email);
  });
});

describe('POST /v1/auth/otp/verify', () => {
  const t = useIdentityApp();
  let fixtures: Awaited<ReturnType<typeof t.fixtures>> | undefined;
  const known = async () => (fixtures ??= await t.fixtures());
  const verify = (email: string, code: string) =>
    t.api.post('/v1/auth/otp/verify', { body: { email, code } });
  const wrong = (code: string | undefined) => (code === '000000' ? '000001' : '000000');

  it('creates the user on first sign-in and returns a full session with a refresh cookie', async () => {
    const email = t.newEmail('first');
    const { code } = await t.requestCode(email);
    const response = await verify(email, code ?? '');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      mfaRequired: false,
      tokenType: 'Bearer',
      expiresIn: 600,
    });
    expect(Object.keys(response.body as object).sort()).toEqual([
      'accessToken',
      'expiresIn',
      'mfaRequired',
      'tokenType',
    ]);
    expect(response.headers['cache-control']).toBe('no-store');

    const user = await t
      .db()
      .query<{ id: string; status: string; email_verified_at: Date | null }>(
        'SELECT id, status, email_verified_at FROM app_user WHERE email = $1',
        [email],
      );
    expect(user.rows[0]).toMatchObject({ status: 'ACTIVE' });
    expect(user.rows[0]?.email_verified_at).not.toBeNull();

    // The access token: EdDSA, 10 minutes, the documented claims.
    const token = (response.body as { accessToken: string }).accessToken;
    const header = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString()) as {
      alg: string;
    };
    expect(header.alg).toBe('EdDSA');
    const claims = jwtPayload(token);
    expect(claims).toMatchObject({
      sub: user.rows[0]?.id,
      amr: ['otp'],
      iss: 'labconnect-api',
      aud: 'labconnect',
    });
    expect(claims.sid).toMatch(/^[0-9a-f-]{36}$/);
    expect((claims.exp as number) - (claims.iat as number)).toBe(600);
    expect(claims).not.toHaveProperty('mfa_at');
    expect(claims).not.toHaveProperty('pre_mfa');
  });

  it('sets the refresh token as an httpOnly, Secure, SameSite=Lax cookie that is not in the body', async () => {
    const email = t.newEmail('cookie');
    const { response } = await t.signIn(email);
    const cookie = refreshCookie(response);
    expect(cookie).not.toBeNull();
    expect(cookie?.attributes).toEqual(
      expect.arrayContaining([
        'Path=/v1/auth',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Max-Age=43200',
      ]),
    );
    // Host-only: no Domain attribute widens it.
    expect(cookie?.attributes.some((attribute) => /^Domain=/i.test(attribute))).toBe(false);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(response.body)).not.toContain(cookie?.value ?? 'x');
    // The database holds only its hash.
    const stored = await t
      .db()
      .query<{ n: string }>(
        "SELECT count(*) AS n FROM user_session WHERE encode(refresh_token_hash, 'escape') LIKE '%' || $1 || '%'",
        [cookie?.value],
      );
    expect(stored.rows[0]?.n).toBe('0');
  });

  it('answers 422 OTP_INVALID for a wrong code, an unknown address and a malformed code alike', async () => {
    const email = t.newEmail('wrongcode');
    const { code } = await t.requestCode(email);
    const wrongCode = await verify(email, wrong(code));
    const stranger = await verify(t.newEmail('nobody'), '123456');
    for (const response of [wrongCode, stranger]) {
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ code: 'OTP_INVALID' });
    }
    const malformed = await t.api.post('/v1/auth/otp/verify', {
      body: { email, code: '12ab56' },
      invalidRequest: 'a code that is not 6 digits',
    });
    expect(malformed.status).toBe(422);
    expect(malformed.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('accepts a code once', async () => {
    const email = t.newEmail('once');
    const { code } = await t.requestCode(email);
    expect((await verify(email, code ?? '')).status).toBe(200);
    const again = await verify(email, code ?? '');
    expect(again.status).toBe(422);
    expect(again.body).toMatchObject({ code: 'OTP_INVALID' });
  });

  it('answers 422 OTP_EXPIRED after 10 minutes', async () => {
    const email = t.newEmail('late');
    const { code } = await t.requestCode(email);
    t.clock.advance(10 * 60_000);
    const response = await verify(email, code ?? '');
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('answers 429 OTP_LOCKED after 5 wrong codes, and then refuses the right one too', async () => {
    const email = t.newEmail('locked');
    const { code } = await t.requestCode(email);
    for (let i = 0; i < 4; i++) {
      expect((await verify(email, wrong(code))).status).toBe(422);
    }
    const fifth = await verify(email, wrong(code));
    expect(fifth.status).toBe(429);
    expect(fifth.body).toMatchObject({ code: 'OTP_LOCKED' });
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(0);
    const rightButLocked = await verify(email, code ?? '');
    expect(rightButLocked.status).toBe(429);
    expect(rightButLocked.body).toMatchObject({ code: 'OTP_LOCKED' });
    // Asking again gives a new challenge with a fresh count.
    const fresh = await t.requestCode(email);
    expect((await verify(email, fresh.code ?? '')).status).toBe(200);
  });

  it('lets exactly one of two simultaneous correct submissions in', async () => {
    const email = t.newEmail('twice');
    const { code } = await t.requestCode(email);
    const results = await Promise.all([verify(email, code ?? ''), verify(email, code ?? '')]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 422]);
    const sessions = await t
      .db()
      .query<{ n: string }>(
        'SELECT count(*) AS n FROM user_session s JOIN app_user u ON u.id = s.user_id WHERE u.email = $1',
        [email],
      );
    expect(sessions.rows[0]?.n).toBe('1');
  });

  it('answers a disabled user exactly as a wrong code (OQ-35)', async () => {
    const { customer } = await known();
    const email = customer.admin.email;
    await t.db().query("UPDATE app_user SET status = 'DISABLED' WHERE email = $1", [email]);
    const { code } = await t.requestCode(email);
    const disabled = await verify(email, code ?? '');
    const ordinary = t.newEmail('plain');
    const other = await t.requestCode(ordinary);
    const wrongCode = await verify(ordinary, wrong(other.code));
    expect(disabled.status).toBe(wrongCode.status);
    const stripped = (response: typeof disabled): Record<string, unknown> => {
      const copy = { ...(response.body as Record<string, unknown>) };
      delete copy.requestId;
      return copy;
    };
    expect(stripped(disabled)).toEqual(stripped(wrongCode));
    expect(refreshCookie(disabled)).toBeNull();
    await t.db().query("UPDATE app_user SET status = 'ACTIVE' WHERE email = $1", [email]);
  });

  it('returns the mfaRequired challenge for a user whose role needs MFA, with no refresh cookie', async () => {
    const { customer } = await known();
    const signedIn = await t.signIn(customer.finance.email);
    expect(signedIn.response.status).toBe(200);
    expect(signedIn.response.body).toMatchObject({
      mfaRequired: true,
      mfaEnrolled: false,
      tokenType: 'Bearer',
      expiresIn: 600,
    });
    expect(refreshCookie(signedIn.response)).toBeNull();
    expect(signedIn.response.headers['set-cookie']).toBeUndefined();
    const claims = jwtPayload(signedIn.accessToken);
    expect(claims).toMatchObject({ pre_mfa: true, amr: ['otp'] });
    expect(claims.sub).toBe(customer.finance.id);
  });

  it('also gives the challenge to every platform role', async () => {
    const { platform } = await known();
    const signedIn = await t.signIn(platform.ops.email);
    expect(signedIn.response.body).toMatchObject({ mfaRequired: true });
  });

  it('gives a full session to a customer admin, whose MFA is optional', async () => {
    const { individual } = await known();
    const signedIn = await t.signIn(individual.admin.email);
    expect(signedIn.response.body).toMatchObject({ mfaRequired: false });
    expect(refreshCookie(signedIn.response)).not.toBeNull();
  });
});
