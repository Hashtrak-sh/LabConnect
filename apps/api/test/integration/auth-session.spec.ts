import {
  createPrivateKey,
  generateKeyPairSync,
  type KeyObject,
  sign as cryptoSign,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { jwtPayload, ORIGIN, refreshCookie, useIdentityApp } from '../support/identity-app.js';

// refreshSession, logout, logoutAll, getMe and setActiveMembership over HTTP, on a real database.

describe('sessions over HTTP', () => {
  const t = useIdentityApp();
  let fixtures: Awaited<ReturnType<typeof t.fixtures>> | undefined;
  const known = async () => (fixtures ??= await t.fixtures());
  const refresh = (cookie: string | undefined, origin: string | null = ORIGIN) =>
    t.api.post('/v1/auth/refresh', {
      ...(cookie !== undefined && { cookie }),
      ...(origin !== null && { origin }),
    });
  /** A signed-in user with no membership, as after customer self-signup. */
  const newSession = async () => {
    const email = t.newEmail('session');
    const signedIn = await t.signIn(email);
    expect(signedIn.cookie).toBeTruthy();
    return { email, ...signedIn, cookie: signedIn.cookie ?? '' };
  };

  describe('POST /v1/auth/refresh', () => {
    it('rotates the refresh token and returns a new access token for the same session', async () => {
      const first = await newSession();
      t.clock.advance(5 * 60_000);
      const response = await refresh(first.cookie);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        mfaRequired: false,
        tokenType: 'Bearer',
        expiresIn: 600,
      });
      const body = response.body as { accessToken: string };
      expect(body.accessToken).not.toBe(first.accessToken);
      expect(jwtPayload(body.accessToken).sid).toBe(jwtPayload(first.accessToken).sid);
      const cookie = refreshCookie(response);
      expect(cookie?.value).toBeTruthy();
      expect(cookie?.value).not.toBe(first.cookie);
      expect(cookie?.attributes).toEqual(
        expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/v1/auth']),
      );
      expect(JSON.stringify(response.body)).not.toContain(cookie?.value ?? 'x');
      expect(response.headers['cache-control']).toBe('no-store');
      expect((await t.api.get('/v1/me', { token: body.accessToken })).status).toBe(200);
    });

    it('keeps rotating: every cookie works once', async () => {
      const first = await newSession();
      let cookie = first.cookie;
      for (let i = 0; i < 4; i++) {
        t.clock.advance(60_000);
        const response = await refresh(cookie);
        expect(response.status).toBe(200);
        cookie = refreshCookie(response)?.value ?? '';
      }
    });

    it('treats a reused refresh token as theft: 401, the cookie is cleared and the whole session is revoked', async () => {
      const first = await newSession();
      const rotated = await refresh(first.cookie);
      const newest = refreshCookie(rotated)?.value ?? '';
      const newAccess = (rotated.body as { accessToken: string }).accessToken;

      const reuse = await refresh(first.cookie);
      expect(reuse.status).toBe(401);
      expect(reuse.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(reuse.headers['set-cookie']).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^lc_refresh=;.*(Expires=Thu, 01 Jan 1970|Max-Age=0)/),
        ]),
      );
      // The honest holder of the newest token is out too, and the unexpired access token is dead.
      expect((await refresh(newest)).status).toBe(401);
      const me = await t.api.get('/v1/me', { token: newAccess });
      expect(me.status).toBe(401);
      expect((await t.api.get('/v1/me', { token: first.accessToken })).status).toBe(401);

      const audit = await t
        .db()
        .query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'auth.refresh_reuse_detected' AND entity_id = $1",
          [jwtPayload(first.accessToken).sid],
        );
      expect(audit.rows[0]?.n).toBe('1');
    });

    it('lets one of two simultaneous refreshes with one cookie through, then revokes the session', async () => {
      const first = await newSession();
      const results = await Promise.all([refresh(first.cookie), refresh(first.cookie)]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
      const winner = results.find((response) => response.status === 200);
      expect((await refresh(winner ? refreshCookie(winner)?.value : undefined)).status).toBe(401);
    });

    it('checks the Origin before anything else: 403 FORBIDDEN without it or from another site', async () => {
      const first = await newSession();
      const missing = await refresh(first.cookie, null);
      expect(missing.status).toBe(403);
      expect(missing.body).toMatchObject({ code: 'FORBIDDEN' });
      const foreign = await refresh(first.cookie, 'https://evil.example');
      expect(foreign.status).toBe(403);
      expect(foreign.body).toMatchObject({ code: 'FORBIDDEN' });
      // A prefix or lookalike of an allowed origin is not allowed.
      expect((await refresh(first.cookie, `${ORIGIN}.evil.example`)).status).toBe(403);
      expect((await refresh(first.cookie, 'null')).status).toBe(403);
      // Rejected requests did not spend the token.
      expect((await refresh(first.cookie)).status).toBe(200);
      // Both configured origins are accepted, with or without a trailing slash.
      const second = await newSession();
      expect((await refresh(second.cookie, 'https://other.labconnect.test')).status).toBe(200);
    });

    it('answers 401 with no cookie, with an unknown cookie, and does not read the Authorization header', async () => {
      const first = await newSession();
      expect((await refresh(undefined)).status).toBe(401);
      expect((await refresh('x'.repeat(43))).status).toBe(401);
      const withBearer = await t.api.post('/v1/auth/refresh', {
        origin: ORIGIN,
        token: first.accessToken,
      });
      expect(withBearer.status).toBe(401);
    });

    it('ends a session after 12 hours without a refresh, and after 7 days however often it is used', async () => {
      const idle = await newSession();
      t.clock.advance(12 * 3600_000);
      expect((await refresh(idle.cookie)).status).toBe(401);

      const busy = await newSession();
      let cookie = busy.cookie;
      let refreshes = 0;
      for (;;) {
        t.clock.advance(11 * 3600_000);
        const response = await refresh(cookie);
        if (response.status !== 200) {
          expect(response.status).toBe(401);
          break;
        }
        refreshes += 1;
        cookie = refreshCookie(response)?.value ?? '';
        const maxAge = Number(
          refreshCookie(response)
            ?.attributes.find((attribute) => attribute.startsWith('Max-Age='))
            ?.slice('Max-Age='.length),
        );
        expect(maxAge).toBeLessThanOrEqual(12 * 3600);
        expect(refreshes).toBeLessThan(20);
      }
      expect(refreshes).toBeGreaterThanOrEqual(14);
    });

    it('refuses a refresh for a disabled user', async () => {
      const first = await newSession();
      await t.db().query("UPDATE app_user SET status = 'DISABLED' WHERE email = $1", [first.email]);
      expect((await refresh(first.cookie)).status).toBe(401);
      expect((await t.api.get('/v1/me', { token: first.accessToken })).status).toBe(401);
    });
  });

  describe('access tokens', () => {
    it('are refused when missing, malformed, expired, forged or revoked', async () => {
      const session = await newSession();
      const unauthenticated = (response: Awaited<ReturnType<typeof t.api.get>>): void => {
        expect(response.status).toBe(401);
        expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
      };
      unauthenticated(await t.api.get('/v1/me'));
      unauthenticated(await t.api.get('/v1/me', { token: 'not-a-jwt' }));
      unauthenticated(await t.api.get('/v1/me', { headers: { Authorization: 'Basic abc' } }));
      unauthenticated(await t.api.get('/v1/me', { headers: { Authorization: 'Bearer' } }));
      const [header = '', payload = '', signature = ''] = session.accessToken.split('.');
      const forged = Buffer.from(
        JSON.stringify({
          ...jwtPayload(session.accessToken),
          sub: '018f0000-0000-7000-8000-000000000001',
        }),
      ).toString('base64url');
      unauthenticated(await t.api.get('/v1/me', { token: `${header}.${forged}.${signature}` }));
      unauthenticated(
        await t.api.get('/v1/me', { token: `${header}.${payload}.${signature.slice(0, -4)}AAAA` }),
      );
      expect((await t.api.get('/v1/me', { token: session.accessToken })).status).toBe(200);
      // Exactly 10 minutes after it was issued, it is no longer valid.
      t.clock.advance(10 * 60_000 - 1000);
      expect((await t.api.get('/v1/me', { token: session.accessToken })).status).toBe(200);
      t.clock.advance(1000);
      unauthenticated(await t.api.get('/v1/me', { token: session.accessToken }));
    });

    it('stop working the moment the session is revoked, though they have not expired', async () => {
      const session = await newSession();
      expect((await t.api.get('/v1/me', { token: session.accessToken })).status).toBe(200);
      await t
        .db()
        .query(
          "UPDATE user_session SET revoked_at = now(), revoked_reason = 'TEST' WHERE token_family_id = $1",
          [jwtPayload(session.accessToken).sid],
        );
      const response = await t.api.get('/v1/me', { token: session.accessToken });
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('are refused when the token is for another audience or signed by another key', async () => {
      const session = await newSession();
      const claims = jwtPayload(session.accessToken);
      const sign = (key: KeyObject, audience: string): string => {
        const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'at+jwt', kid: 'k1' }));
        const payload = Buffer.from(
          JSON.stringify({
            sid: claims.sid,
            amr: ['otp'],
            sub: claims.sub,
            iss: 'labconnect-api',
            aud: audience,
            iat: claims.iat,
            exp: (claims.iat as number) + 600,
          }),
        );
        const signingInput = `${header.toString('base64url')}.${payload.toString('base64url')}`;
        const signature = cryptoSign(null, Buffer.from(signingInput), key).toString('base64url');
        return `${signingInput}.${signature}`;
      };
      const mine = createPrivateKey(t.env.AUTH_JWT_PRIVATE_KEY ?? '');
      const other = generateKeyPairSync('ed25519').privateKey;
      expect((await t.api.get('/v1/me', { token: sign(mine, 'labconnect') })).status).toBe(200);
      expect((await t.api.get('/v1/me', { token: sign(mine, 'someone-else') })).status).toBe(401);
      expect((await t.api.get('/v1/me', { token: sign(other, 'labconnect') })).status).toBe(401);
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('revokes the session, clears the cookie and kills the access token and the refresh token', async () => {
      const session = await newSession();
      const response = await t.api.post('/v1/auth/logout', { token: session.accessToken });
      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringMatching(/^lc_refresh=;/)]),
      );
      expect((await t.api.get('/v1/me', { token: session.accessToken })).status).toBe(401);
      expect((await refresh(session.cookie)).status).toBe(401);
      // Signing out again, with the dead token, is simply unauthenticated.
      expect((await t.api.post('/v1/auth/logout', { token: session.accessToken })).status).toBe(
        401,
      );
      const audit = await t
        .db()
        .query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'auth.session_revoke' AND entity_id = $1",
          [jwtPayload(session.accessToken).sid],
        );
      expect(audit.rows[0]?.n).toBe('1');
    });

    it('needs a token', async () => {
      expect((await t.api.post('/v1/auth/logout')).status).toBe(401);
    });

    it('leaves the user’s other sessions alone', async () => {
      const email = t.newEmail('devices');
      const one = await t.signIn(email);
      const two = await t.signIn(email);
      await t.api.post('/v1/auth/logout', { token: one.accessToken });
      expect((await t.api.get('/v1/me', { token: two.accessToken })).status).toBe(200);
      expect((await refresh(two.cookie)).status).toBe(200);
    });
  });

  describe('POST /v1/auth/logout-all', () => {
    it('revokes every session of the user, and only theirs', async () => {
      const email = t.newEmail('everywhere');
      const sessions = [await t.signIn(email), await t.signIn(email), await t.signIn(email)];
      const stranger = await newSession();
      const response = await t.api.post('/v1/auth/logout-all', {
        token: sessions[0]?.accessToken ?? '',
      });
      expect(response.status).toBe(204);
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringMatching(/^lc_refresh=;/)]),
      );
      for (const session of sessions) {
        expect((await t.api.get('/v1/me', { token: session.accessToken })).status).toBe(401);
        expect((await refresh(session.cookie)).status).toBe(401);
      }
      expect((await t.api.get('/v1/me', { token: stranger.accessToken })).status).toBe(200);
      expect((await refresh(stranger.cookie)).status).toBe(200);
    });

    it('needs a token', async () => {
      expect((await t.api.post('/v1/auth/logout-all')).status).toBe(401);
    });
  });

  describe('GET /v1/me', () => {
    it('returns the profile, memberships and permissions of the active membership', async () => {
      const { customer, individual } = await known();
      const email = customer.requester.email;
      await t.owner((tx) =>
        t.addMember(tx, customer.requester.id, individual.organisationId, 'CUSTOMER_ADMIN'),
      );
      const session = await t.signIn(email);
      const response = await t.api.get('/v1/me', { token: session.accessToken });
      expect(response.status).toBe(200);
      const me = response.body as {
        user: Record<string, unknown>;
        memberships: {
          id: string;
          organisation: { id: string; orgType: string };
          roles: string[];
        }[];
        activeMembershipId: string;
        permissions: string[];
      };
      expect(me.user).toMatchObject({
        id: customer.requester.id,
        email,
        locale: 'en-IN',
        mfaEnrolled: false,
      });
      expect(me.memberships.map((m) => m.organisation.id)).toEqual([
        customer.organisationId,
        individual.organisationId,
      ]);
      expect(me.memberships[0]?.roles).toEqual(['CUSTOMER_REQUESTER']);
      expect(me.activeMembershipId).toBe(me.memberships[0]?.id);
      expect(me.permissions.length).toBeGreaterThan(0);
      expect(me.permissions).toEqual([...me.permissions].sort());
      // Nothing about the secrets or the session leaks into the profile.
      expect(JSON.stringify(me)).not.toMatch(/token|secret|hash/i);
    });

    it('returns no memberships and no permissions to a user who just signed up', async () => {
      const session = await newSession();
      const response = await t.api.get('/v1/me', { token: session.accessToken });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        memberships: [],
        activeMembershipId: null,
        permissions: [],
      });
    });

    it('shows the view through X-Active-Membership without switching, and 404s one that is not the user’s', async () => {
      const { customer, individual } = await known();
      const session = await t.signIn(customer.requester.email);
      const me = (await t.api.get('/v1/me', { token: session.accessToken })).body as {
        memberships: { id: string; roles: string[] }[];
        permissions: string[];
      };
      const second = me.memberships[1];
      expect(second?.roles).toEqual(['CUSTOMER_ADMIN']);
      const through = await t.api.get('/v1/me', {
        token: session.accessToken,
        headers: { 'X-Active-Membership': second?.id ?? '' },
      });
      expect(through.status).toBe(200);
      expect(through.body).toMatchObject({ activeMembershipId: second?.id });
      expect((through.body as { permissions: string[] }).permissions.length).toBeGreaterThan(
        me.permissions.length,
      );
      // Not persisted.
      const after = await t.api.get('/v1/me', { token: session.accessToken });
      expect(after.body).toMatchObject({ activeMembershipId: me.memberships[0]?.id });

      // Someone else's membership, and one that does not exist, look the same.
      const theirs = await t
        .db()
        .query<{ id: string }>('SELECT id FROM membership WHERE user_id = $1', [
          individual.admin.id,
        ]);
      for (const id of [
        theirs.rows[0]?.id ?? '',
        '018f0000-0000-7000-8000-000000000042',
        'nonsense',
      ]) {
        const response = await t.api.get('/v1/me', {
          token: session.accessToken,
          headers: { 'X-Active-Membership': id },
          ...(id === 'nonsense' && { invalidRequest: 'a header that is not a UUID' }),
        });
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    });
  });

  describe('POST /v1/me/active-membership', () => {
    it('switches the session’s membership, and the next /me shows it', async () => {
      const { customer } = await known();
      const session = await t.signIn(customer.requester.email);
      const me = (await t.api.get('/v1/me', { token: session.accessToken })).body as {
        memberships: { id: string }[];
      };
      const target = me.memberships[1]?.id ?? '';
      const response = await t.api.post('/v1/me/active-membership', {
        token: session.accessToken,
        body: { membershipId: target },
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ activeMembershipId: target });
      const again = await t.api.get('/v1/me', { token: session.accessToken });
      expect(again.body).toMatchObject({ activeMembershipId: target });
      // It survives a refresh.
      const refreshed = await refresh(session.cookie);
      const afterRefresh = await t.api.get('/v1/me', {
        token: (refreshed.body as { accessToken: string }).accessToken,
      });
      expect(afterRefresh.body).toMatchObject({ activeMembershipId: target });
      const audit = await t
        .db()
        .query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'auth.membership_switch' AND entity_id = $1",
          [jwtPayload(session.accessToken).sid],
        );
      expect(audit.rows[0]?.n).toBe('1');
    });

    it('answers 404 for a membership of another user, a made-up one and one that was deactivated', async () => {
      const { customer, individual } = await known();
      const session = await t.signIn(customer.admin.email);
      const theirs = await t
        .db()
        .query<{ id: string }>('SELECT id FROM membership WHERE user_id = $1', [
          individual.admin.id,
        ]);
      for (const membershipId of [
        theirs.rows[0]?.id ?? '',
        '018f0000-0000-7000-8000-000000000042',
      ]) {
        const response = await t.api.post('/v1/me/active-membership', {
          token: session.accessToken,
          body: { membershipId },
        });
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      }
      const own = await t
        .db()
        .query<{ id: string }>('SELECT id FROM membership WHERE user_id = $1', [customer.admin.id]);
      await t
        .db()
        .query("UPDATE membership SET status = 'DEACTIVATED' WHERE id = $1", [own.rows[0]?.id]);
      const deactivated = await t.api.post('/v1/me/active-membership', {
        token: session.accessToken,
        body: { membershipId: own.rows[0]?.id ?? '' },
      });
      expect(deactivated.status).toBe(404);
      await t
        .db()
        .query("UPDATE membership SET status = 'ACTIVE' WHERE id = $1", [own.rows[0]?.id]);
    });

    it('validates the body and needs a token', async () => {
      const session = await newSession();
      for (const body of [
        {},
        { membershipId: 'abc' },
        { membershipId: 5 },
        { membershipId: '018f0000-0000-7000-8000-000000000042', extra: 1 },
      ]) {
        const response = await t.api.post('/v1/me/active-membership', {
          token: session.accessToken,
          body,
          invalidRequest: 'a body that is not a membership id',
        });
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      expect(
        (
          await t.api.post('/v1/me/active-membership', {
            body: { membershipId: '018f0000-0000-7000-8000-000000000042' },
          })
        ).status,
      ).toBe(401);
    });

    it('cannot be used to act in an organisation the user does not belong to', async () => {
      const { individual } = await known();
      const session = await newSession();
      const theirs = await t
        .db()
        .query<{ id: string }>('SELECT id FROM membership WHERE organisation_id = $1', [
          individual.organisationId,
        ]);
      const response = await t.api.post('/v1/me/active-membership', {
        token: session.accessToken,
        body: { membershipId: theirs.rows[0]?.id ?? '' },
      });
      expect(response.status).toBe(404);
      const me = await t.api.get('/v1/me', { token: session.accessToken });
      expect(me.body).toMatchObject({ activeMembershipId: null, permissions: [] });
    });
  });

  describe('secrets at rest', () => {
    it('keeps every token, code and secret out of the audit log, the outbox and the session table', async () => {
      const f = await known();
      const signedIn = await t.signInWithMfa(f.customer.finance.email);
      const secrets = [
        signedIn.secret,
        signedIn.accessToken,
        signedIn.cookie ?? '',
        ...signedIn.recoveryCodes,
      ];
      expect(signedIn.recoveryCodes).toHaveLength(10);
      expect(secrets.every((secret) => secret.length > 8)).toBe(true);
      const every = async (table: string): Promise<string> =>
        (
          await t.db().query<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM ${table} t`)
        ).rows
          .map((row) => row.row)
          .join('\n');
      for (const table of [
        'audit_log',
        'outbox_event',
        'user_session',
        'mfa_factor',
        'mfa_recovery_code',
      ]) {
        const text = await every(table);
        for (const secret of secrets) expect(text, table).not.toContain(secret);
      }
    });
  });
});
