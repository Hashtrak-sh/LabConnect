import { describe, expect, it } from 'vitest';
import {
  authenticateSession,
  completeMfaSignIn,
  confirmTotpEnrolment,
  base32Decode,
  IDENTITY_POLICY,
  loadMe,
  recordMfaVerified,
  signInWithVerifiedEmail,
  startTotpEnrolment,
  totpAt,
  assertStepUp,
  IdentityError,
} from '../../src/index.js';
import {
  META,
  addMember,
  createCustomer,
  createPlatformTeam,
  createUser,
  uniqueEmail,
  useIdentity,
} from './identity-support.js';

// P3-03: sign-in, first-time users, MFA-gated sessions and /me against the real tables.

describe('sign-in after a verified email', () => {
  const { db, deps, clock, asSystem, asUser, owner } = useIdentity();

  const signIn = (email: string) =>
    asSystem((tx) => signInWithVerifiedEmail(tx, deps, { email, meta: META }));

  it('creates a customer on first sign-in: ACTIVE, email verified, a full session, no membership', async () => {
    const email = uniqueEmail('new.customer');
    const outcome = await signIn(email.toUpperCase());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome).toMatchObject({ userCreated: true, mfaRequired: false, mfaEnrolled: false });
    expect(outcome.issued.refreshToken).toBeTypeOf('string');
    expect(outcome.issued.session.activeMembershipId).toBeNull();

    const user = await db().query<{
      email: string;
      status: string;
      email_verified_at: Date;
      full_name: string;
      last_login_at: Date;
    }>('SELECT * FROM app_user WHERE id = $1', [outcome.userId]);
    expect(user.rows[0]).toMatchObject({ email, status: 'ACTIVE', full_name: email.split('@')[0] });
    expect(user.rows[0]?.email_verified_at.toISOString()).toBe(clock.now().toISOString());

    const audit = await db().query<{ action: string; actor_user_id: string; after: unknown }>(
      `SELECT action, actor_user_id, after FROM audit_log
        WHERE actor_user_id = $1 ORDER BY occurred_at, action`,
      [outcome.userId],
    );
    expect(audit.rows.map((row) => row.action).sort()).toEqual(['auth.signin', 'user.create']);
    expect(JSON.stringify(audit.rows)).not.toContain(email);
    expect(JSON.stringify(audit.rows)).not.toContain(outcome.issued.refreshToken ?? 'x');
  });

  it('signs an existing user in without creating another, on their oldest membership', async () => {
    const customer = await owner((tx) => createCustomer(tx));
    const second = await owner((tx) => createCustomer(tx, { segment: 'INDIVIDUAL' }));
    await owner((tx) =>
      addMember(tx, customer.requester ?? '', second.organisationId, 'CUSTOMER_ADMIN'),
    );
    const email = (
      await db().query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [
        customer.requester,
      ])
    ).rows[0]?.email;
    const outcome = await signIn(email ?? '');
    expect(outcome).toMatchObject({ ok: true, userCreated: false, mfaRequired: false });
    if (!outcome.ok) return;
    expect(outcome.userId).toBe(customer.requester);
    const me = await asUser(outcome.userId, (tx) =>
      loadMe(tx, {
        userId: outcome.userId,
        sessionMembershipId: outcome.issued.session.activeMembershipId,
      }),
    );
    expect(me.memberships).toHaveLength(2);
    expect(me.activeMembershipId).toBe(me.memberships[0]?.id);
    expect(me.memberships[0]?.organisation.id).toBe(customer.organisationId);
    expect(me.memberships[0]?.roles).toEqual(['CUSTOMER_REQUESTER']);
    expect(me.permissions.length).toBeGreaterThan(0);
    expect(me.user.mfaEnrolled).toBe(false);
    const count = await db().query<{ n: string }>(
      'SELECT count(*) AS n FROM app_user WHERE email = $1',
      [email],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('gives a user whose role requires MFA a partial session: no refresh token, 10 minutes', async () => {
    const customer = await owner((tx) => createCustomer(tx));
    const email = (
      await db().query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [
        customer.finance,
      ])
    ).rows[0]?.email;
    const outcome = await signIn(email ?? '');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome).toMatchObject({ mfaRequired: true, mfaEnrolled: false });
    expect(outcome.issued.refreshToken).toBeNull();
    expect(outcome.issued.session.expiresAt.toISOString()).toBe(
      new Date(clock.now().getTime() + 600_000).toISOString(),
    );
    // The row holds a hash nobody has: no token was handed out for it.
    const row = await db().query<{ refresh_token_hash: Buffer }>(
      'SELECT refresh_token_hash FROM user_session WHERE id = $1',
      [outcome.issued.session.rowId],
    );
    expect(row.rows[0]?.refresh_token_hash).toHaveLength(32);
  });

  it('requires MFA for every platform role', async () => {
    const team = await owner((tx) => createPlatformTeam(tx));
    for (const userId of [team.ops, team.steward, team.finance, team.admin]) {
      const email = (
        await db().query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [userId])
      ).rows[0]?.email;
      expect(await signIn(email ?? '')).toMatchObject({ ok: true, mfaRequired: true });
    }
  });

  it('does not require MFA for an optional role, even with a factor set up', async () => {
    const customer = await owner((tx) => createCustomer(tx));
    const email = (
      await db().query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [
        customer.admin,
      ])
    ).rows[0]?.email;
    const first = await signIn(email ?? '');
    if (!first.ok) throw new Error('sign-in failed');
    await asUser(customer.admin, async (tx) => {
      const enrolment = await startTotpEnrolment(tx, deps, { userId: customer.admin, meta: META });
      const code = totpAt(base32Decode(enrolment.secret), clock.now().getTime());
      await confirmTotpEnrolment(tx, deps, { userId: customer.admin, code, meta: META });
    });
    expect(await signIn(email ?? '')).toMatchObject({
      ok: true,
      mfaRequired: false,
      mfaEnrolled: true,
    });
  });

  it('ignores a membership that is deactivated or whose role was revoked', async () => {
    const customer = await owner((tx) => createCustomer(tx));
    await owner(async (tx) => {
      const membership = await tx.membership.findFirstOrThrow({
        where: { userId: customer.finance },
      });
      await tx.membershipRole.updateMany({
        where: { membershipId: membership.id },
        data: { revokedAt: clock.now() },
      });
    });
    const email = (
      await db().query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [
        customer.finance,
      ])
    ).rows[0]?.email;
    expect(await signIn(email ?? '')).toMatchObject({ ok: true, mfaRequired: false });
  });

  it('refuses a disabled user without saying why', async () => {
    const userId = await owner((tx) =>
      createUser(tx, { email: uniqueEmail('off'), fullName: 'Off' }),
    );
    await db().query("UPDATE app_user SET status = 'DISABLED' WHERE id = $1", [userId]);
    const email = (
      await db().query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [userId])
    ).rows[0]?.email;
    const before = await db().query<{ n: string }>('SELECT count(*) AS n FROM user_session');
    expect(await signIn(email ?? '')).toEqual({ ok: false, reason: 'DISABLED' });
    const after = await db().query<{ n: string }>('SELECT count(*) AS n FROM user_session');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('lets an invited user in without activating them', async () => {
    const email = uniqueEmail('invited');
    const userId = await owner((tx) => createUser(tx, { email, fullName: 'Invited' }));
    await db().query(
      "UPDATE app_user SET status = 'INVITED', email_verified_at = NULL WHERE id = $1",
      [userId],
    );
    expect(await signIn(email)).toMatchObject({ ok: true, userCreated: false });
    const row = await db().query<{ status: string; email_verified_at: Date | null }>(
      'SELECT status, email_verified_at FROM app_user WHERE id = $1',
      [userId],
    );
    expect(row.rows[0]?.status).toBe('INVITED');
    expect(row.rows[0]?.email_verified_at).not.toBeNull();
  });

  it('creates one user when two first sign-ins race', async () => {
    const email = uniqueEmail('race');
    const results = await Promise.all([signIn(email), signIn(email)]);
    expect(results.every((result) => result.ok)).toBe(true);
    const count = await db().query<{ n: string }>(
      'SELECT count(*) AS n FROM app_user WHERE email = $1',
      [email],
    );
    expect(count.rows[0]?.n).toBe('1');
    expect(results.filter((result) => result.ok && result.userCreated)).toHaveLength(1);
  });

  describe('completing MFA and step-up', () => {
    const setup = async () => {
      const customer = await owner((tx) => createCustomer(tx));
      const email = (
        await db().query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [
          customer.finance,
        ])
      ).rows[0]?.email;
      const outcome = await signIn(email ?? '');
      if (!outcome.ok) throw new Error('sign-in failed');
      const userId = customer.finance ?? '';
      const enrolment = await asUser(userId, (tx) =>
        startTotpEnrolment(tx, deps, { userId, meta: META }),
      );
      const secret = base32Decode(enrolment.secret);
      return { userId, outcome, secret, partial: outcome.issued.session };
    };

    it('replaces the partial session by a full one with a fresh MFA time, and revokes the partial one', async () => {
      const { userId, secret, partial } = await setup();
      const confirmCode = totpAt(secret, clock.now().getTime());
      await asUser(userId, (tx) =>
        confirmTotpEnrolment(tx, deps, { userId, code: confirmCode, meta: META }),
      );
      clock.advance(IDENTITY_POLICY.totpPeriodSeconds * 1000);

      const issued = await asUser(userId, (tx) =>
        completeMfaSignIn(tx, deps, { partial, meta: META }),
      );
      expect(issued).not.toBeNull();
      expect(issued?.refreshToken).toBeTypeOf('string');
      expect(issued?.session.sessionId).not.toBe(partial.sessionId);
      expect(issued?.session.mfaVerifiedAt?.toISOString()).toBe(clock.now().toISOString());
      expect(issued?.session.activeMembershipId).toBe(partial.activeMembershipId);

      // The partial token's session is gone.
      expect(
        await asSystem((tx) =>
          authenticateSession(tx, deps, { userId, sessionId: partial.sessionId }),
        ),
      ).toBeNull();
      expect(
        await asSystem((tx) =>
          authenticateSession(tx, deps, { userId, sessionId: issued?.session.sessionId ?? '' }),
        ),
      ).not.toBeNull();
      const old = await db().query<{ revoked_reason: string }>(
        'SELECT revoked_reason FROM user_session WHERE id = $1',
        [partial.rowId],
      );
      expect(old.rows[0]?.revoked_reason).toBe('MFA_COMPLETED');

      // A partial session cannot be completed twice.
      expect(
        await asUser(userId, (tx) => completeMfaSignIn(tx, deps, { partial, meta: META })),
      ).toBeNull();
    });

    it('keeps the step-up clock in the database: fresh for 5 minutes, then STEP_UP_REQUIRED', async () => {
      const { userId, outcome } = await setup();
      const live = outcome.issued.session;
      const stepUpState = async () =>
        asSystem(async (tx) => {
          const session = await authenticateSession(tx, deps, {
            userId,
            sessionId: live.sessionId,
          });
          if (!session) throw new Error('no session');
          try {
            assertStepUp(session, clock);
            return 'OK';
          } catch (error) {
            return (error as IdentityError).code;
          }
        });
      expect(await stepUpState()).toBe('STEP_UP_REQUIRED');
      const updated = await asUser(userId, (tx) => recordMfaVerified(tx, deps, live));
      expect(updated?.mfaVerifiedAt?.toISOString()).toBe(clock.now().toISOString());
      expect(await stepUpState()).toBe('OK');
      clock.advance(300_000);
      expect(await stepUpState()).toBe('OK');
      clock.advance(1000);
      expect(await stepUpState()).toBe('STEP_UP_REQUIRED');
    });
  });
});
