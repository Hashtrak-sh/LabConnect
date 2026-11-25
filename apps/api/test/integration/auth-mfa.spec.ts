import { describe, expect, it } from 'vitest';
import { jwtPayload, refreshCookie, useIdentityApp } from '../support/identity-app.js';

// startMfaEnrolment, confirmMfaEnrolment and verifyMfa over HTTP, on a real database.

describe('MFA over HTTP', () => {
  const t = useIdentityApp();
  let fixtures: Awaited<ReturnType<typeof t.fixtures>> | undefined;
  const known = async () => (fixtures ??= await t.fixtures());
  /** An MFA-required user who has signed in and holds a partial token. */
  const partialSession = async (which: 'finance' | 'ops' = 'finance') => {
    const f = await t.fixtures();
    const person = which === 'finance' ? f.customer.finance : f.platform.ops;
    const signedIn = await t.signIn(person.email);
    expect(signedIn.mfaRequired).toBe(true);
    return { person, token: signedIn.accessToken };
  };
  const wrong = (code: string) => (code === '000000' ? '000001' : '000000');

  describe('POST /v1/auth/mfa/enrol', () => {
    it('creates a pending factor and returns its secret and otpauth URI (201), with a partial session', async () => {
      const { person, token } = await partialSession();
      const response = await t.api.post('/v1/auth/mfa/enrol', { token });
      expect(response.status).toBe(201);
      const body = response.body as { secret: string; otpauthUri: string };
      expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
      const uri = new URL(body.otpauthUri);
      expect(uri.protocol).toBe('otpauth:');
      expect(uri.searchParams.get('secret')).toBe(body.secret);
      expect(decodeURIComponent(uri.pathname)).toContain(person.email);
      expect(response.headers['cache-control']).toBe('no-store');

      const factor = await t
        .db()
        .query<{ verified_at: Date | null; secret_ciphertext: Buffer }>(
          'SELECT verified_at, secret_ciphertext FROM mfa_factor WHERE user_id = $1',
          [person.id],
        );
      expect(factor.rows).toHaveLength(1);
      expect(factor.rows[0]?.verified_at).toBeNull();
      expect(factor.rows[0]?.secret_ciphertext.toString('latin1')).not.toContain(body.secret);
    });

    it('also works with a full session', async () => {
      const { individual } = await known();
      const { accessToken } = await t.signIn(individual.admin.email);
      expect((await t.api.post('/v1/auth/mfa/enrol', { token: accessToken })).status).toBe(201);
    });

    it('answers 409 INVALID_STATE_TRANSITION once a factor is verified', async () => {
      const { token } = await partialSession();
      await t.enrol(token);
      const again = await t.api.post('/v1/auth/mfa/enrol', { token });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    });

    it('needs a token', async () => {
      const response = await t.api.post('/v1/auth/mfa/enrol');
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });

  describe('POST /v1/auth/mfa/enrol/confirm', () => {
    it('activates the factor and returns 10 recovery codes once, stored only as hashes', async () => {
      const { person, token } = await partialSession();
      const { confirmed, recoveryCodes } = await t.enrol(token);
      expect(confirmed.status).toBe(200);
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      expect(confirmed.headers['set-cookie']).toBeUndefined(); // it issues no session

      const stored = await t
        .db()
        .query<{ row: string }>(
          'SELECT row_to_json(t)::text AS row FROM mfa_recovery_code t WHERE user_id = $1',
          [person.id],
        );
      expect(stored.rows).toHaveLength(10);
      const text = stored.rows.map((row) => row.row).join('\n');
      for (const code of recoveryCodes) expect(text).not.toContain(code);
      const user = await t
        .db()
        .query<{ mfa_enrolled_at: Date | null }>(
          'SELECT mfa_enrolled_at FROM app_user WHERE id = $1',
          [person.id],
        );
      expect(user.rows[0]?.mfa_enrolled_at).not.toBeNull();
    });

    it('answers 422 OTP_INVALID for a wrong code and leaves the factor pending', async () => {
      const { person, token } = await partialSession();
      const started = await t.api.post('/v1/auth/mfa/enrol', { token });
      const secret = (started.body as { secret: string }).secret;
      const response = await t.api.post('/v1/auth/mfa/enrol/confirm', {
        token,
        body: { code: wrong(t.totpNow(secret)) },
      });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ code: 'OTP_INVALID' });
      const factor = await t
        .db()
        .query<{ verified_at: Date | null }>(
          'SELECT verified_at FROM mfa_factor WHERE user_id = $1',
          [person.id],
        );
      expect(factor.rows[0]?.verified_at).toBeNull();
    });

    it('answers 404 NOT_FOUND when nothing is pending', async () => {
      const { token } = await partialSession();
      const response = await t.api.post('/v1/auth/mfa/enrol/confirm', {
        token,
        body: { code: '123456' },
      });
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('answers 429 OTP_LOCKED after 5 wrong codes, with Retry-After', async () => {
      const { token } = await partialSession();
      const started = await t.api.post('/v1/auth/mfa/enrol', { token });
      const secret = (started.body as { secret: string }).secret;
      let last = await t.api.post('/v1/auth/mfa/enrol/confirm', {
        token,
        body: { code: wrong(t.totpNow(secret)) },
      });
      for (let i = 1; i < 5; i++) {
        last = await t.api.post('/v1/auth/mfa/enrol/confirm', {
          token,
          body: { code: wrong(t.totpNow(secret)) },
        });
      }
      expect(last.status).toBe(429);
      expect(last.body).toMatchObject({ code: 'OTP_LOCKED' });
      expect(Number(last.headers['retry-after'])).toBe(900);
      const right = await t.api.post('/v1/auth/mfa/enrol/confirm', {
        token,
        body: { code: t.totpNow(secret) },
      });
      expect(right.status).toBe(429);
    });

    it('validates the body', async () => {
      const { token } = await partialSession();
      for (const body of [{}, { code: '12345' }, { code: 123456 }, { code: '123456', extra: 1 }]) {
        const response = await t.api.post('/v1/auth/mfa/enrol/confirm', {
          token,
          body,
          invalidRequest: 'a body that is not a TOTP code',
        });
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
    });
  });

  describe('POST /v1/auth/mfa/verify', () => {
    it('completes sign-in: a partial session becomes a full one, with a refresh cookie and MFA recorded', async () => {
      const { person, token } = await partialSession();
      const { secret } = await t.enrol(token);
      t.clock.advance(30_000);
      const response = await t.api.post('/v1/auth/mfa/verify', {
        token,
        body: { code: t.totpNow(secret) },
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        mfaRequired: false,
        tokenType: 'Bearer',
        expiresIn: 600,
      });
      const cookie = refreshCookie(response);
      expect(cookie?.attributes).toEqual(
        expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/v1/auth']),
      );
      const full = (response.body as { accessToken: string }).accessToken;
      const claims = jwtPayload(full);
      expect(claims).toMatchObject({ sub: person.id, amr: ['otp', 'totp'] });
      expect(claims.mfa_at).toBe(Math.floor(t.clock.now().getTime() / 1000));
      expect(claims).not.toHaveProperty('pre_mfa');
      expect(claims.sid).not.toBe(jwtPayload(token).sid);

      // The new token works as a full session; the partial one is finished.
      expect((await t.api.get('/v1/me', { token: full })).status).toBe(200);
      expect((await t.api.get('/v1/me', { token })).status).toBe(401);
      expect(
        (await t.api.post('/v1/auth/mfa/verify', { token, body: { code: t.totpNow(secret, 1) } }))
          .status,
      ).toBe(401);
    });

    it('does not accept the code that confirmed the enrolment again (replay)', async () => {
      const { token } = await partialSession();
      const started = await t.api.post('/v1/auth/mfa/enrol', { token });
      const secret = (started.body as { secret: string }).secret;
      const code = t.totpNow(secret);
      await t.api.post('/v1/auth/mfa/enrol/confirm', { token, body: { code } });
      const replay = await t.api.post('/v1/auth/mfa/verify', { token, body: { code } });
      expect(replay.status).toBe(422);
      expect(replay.body).toMatchObject({ code: 'OTP_INVALID' });
      expect(refreshCookie(replay)).toBeNull();
      t.clock.advance(30_000);
      const fresh = await t.api.post('/v1/auth/mfa/verify', {
        token,
        body: { code: t.totpNow(secret) },
      });
      expect(fresh.status).toBe(200);
    });

    it('does not accept a code twice, and accepts a code one step either side', async () => {
      const { person, secret } = await (async () => {
        const f = await t.fixtures();
        const signedIn = await t.signInWithMfa(f.customer.finance.email);
        return { person: f.customer.finance, secret: signedIn.secret };
      })();
      t.clock.advance(60_000);
      const again = await t.signIn(person.email);
      const code = t.totpNow(secret);
      expect(
        (await t.api.post('/v1/auth/mfa/verify', { token: again.accessToken, body: { code } }))
          .status,
      ).toBe(200);
      const second = await t.signIn(person.email);
      const replay = await t.api.post('/v1/auth/mfa/verify', {
        token: second.accessToken,
        body: { code },
      });
      expect(replay.status).toBe(422);
      // The code of the previous step is within the window but older than the one used.
      const older = await t.api.post('/v1/auth/mfa/verify', {
        token: second.accessToken,
        body: { code: t.totpNow(secret, -1) },
      });
      expect(older.status).toBe(422);
      // The next step is fine.
      const next = await t.api.post('/v1/auth/mfa/verify', {
        token: second.accessToken,
        body: { code: t.totpNow(secret, 1) },
      });
      expect(next.status).toBe(200);
    });

    it('answers 403 MFA_ENROLMENT_REQUIRED when the user has no verified factor', async () => {
      const { token } = await partialSession();
      const response = await t.api.post('/v1/auth/mfa/verify', { token, body: { code: '123456' } });
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'MFA_ENROLMENT_REQUIRED' });
    });

    it('answers 422 OTP_INVALID for a wrong code and 429 OTP_LOCKED after five', async () => {
      const f = await t.fixtures();
      const first = await t.signInWithMfa(f.customer.finance.email);
      t.clock.advance(60_000);
      const { accessToken } = await t.signIn(f.customer.finance.email);
      const attempt = () =>
        t.api.post('/v1/auth/mfa/verify', {
          token: accessToken,
          body: { code: wrong(t.totpNow(first.secret)) },
        });
      for (let i = 0; i < 4; i++) {
        const response = await attempt();
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({ code: 'OTP_INVALID' });
      }
      const locked = await attempt();
      expect(locked.status).toBe(429);
      expect(locked.body).toMatchObject({ code: 'OTP_LOCKED' });
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
      const right = await t.api.post('/v1/auth/mfa/verify', {
        token: accessToken,
        body: { code: t.totpNow(first.secret) },
      });
      expect(right.status).toBe(429);
      t.clock.advance(15 * 60_000 + 1000);
      expect(
        (
          await t.api.post('/v1/auth/mfa/verify', {
            token: accessToken,
            body: { code: t.totpNow(first.secret) },
          })
        ).status,
      ).toBe(401); // the partial session has meanwhile expired (10 minutes)
    });

    it('is a step-up with a full session: a new access token carries a fresh mfa_at', async () => {
      const { individual } = await known();
      const signedIn = await t.signIn(individual.admin.email);
      const { secret } = await t.enrol(signedIn.accessToken);
      expect(jwtPayload(signedIn.accessToken)).not.toHaveProperty('mfa_at');
      t.clock.advance(60_000);
      const response = await t.api.post('/v1/auth/mfa/verify', {
        token: signedIn.accessToken,
        body: { code: t.totpNow(secret) },
      });
      expect(response.status).toBe(200);
      expect(refreshCookie(response)).toBeNull(); // same session, same refresh token
      const claims = jwtPayload((response.body as { accessToken: string }).accessToken);
      expect(claims).toMatchObject({
        amr: ['otp', 'totp'],
        sid: jwtPayload(signedIn.accessToken).sid,
      });
      expect(claims.mfa_at).toBe(Math.floor(t.clock.now().getTime() / 1000));
      const row = await t
        .db()
        .query<{ mfa_verified_at: Date | null }>(
          'SELECT mfa_verified_at FROM user_session WHERE token_family_id = $1 AND revoked_at IS NULL',
          [claims.sid],
        );
      expect(row.rows[0]?.mfa_verified_at?.toISOString()).toBe(t.clock.now().toISOString());
    });

    it('needs a token and a valid body', async () => {
      expect((await t.api.post('/v1/auth/mfa/verify', { body: { code: '123456' } })).status).toBe(
        401,
      );
      const { token } = await partialSession();
      const response = await t.api.post('/v1/auth/mfa/verify', {
        token,
        body: { code: 'abc' },
        invalidRequest: 'a code that is not 6 digits',
      });
      expect(response.status).toBe(422);
    });
  });

  describe('what a partial session may do', () => {
    it('can call only /auth/mfa/* and /auth/logout', async () => {
      const { token } = await partialSession('ops');
      const me = await t.api.get('/v1/me', { token });
      expect(me.status).toBe(401);
      expect(me.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      const switchOrg = await t.api.post('/v1/me/active-membership', {
        token,
        body: { membershipId: '018f0000-0000-7000-8000-000000000001' },
      });
      expect(switchOrg.status).toBe(401);
      expect((await t.api.post('/v1/auth/logout-all', { token })).status).toBe(401);
      expect((await t.api.post('/v1/auth/mfa/enrol', { token })).status).toBe(201);
      expect((await t.api.post('/v1/auth/logout', { token })).status).toBe(204);
      // Logged out: even the MFA endpoints are closed now.
      expect((await t.api.post('/v1/auth/mfa/enrol', { token })).status).toBe(401);
    });
  });
});
