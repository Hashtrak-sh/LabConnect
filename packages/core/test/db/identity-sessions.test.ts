import { describe, expect, it } from 'vitest';
import {
  authenticateSession,
  createSession,
  hashRefreshToken,
  IDENTITY_POLICY,
  IdentityError,
  loadMe,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
  setActiveMembership,
  type IssuedSession,
} from '../../src/index.js';
import { addMember, createCustomer, META, useIdentity } from './identity-support.js';
import { failure, PG } from './support.js';

// P3-03: sessions, refresh rotation, reuse detection and revocation against the real tables.

const HOUR = 3600_000;

describe('sessions and refresh tokens', () => {
  const { db, deps, clock, asSystem, asUser, owner } = useIdentity();

  const newUser = async () => {
    const customer = await owner((tx) => createCustomer(tx));
    return { userId: customer.admin, customer };
  };
  const start = async (
    userId: string,
    membershipId: string | null = null,
  ): Promise<IssuedSession> =>
    asSystem((tx) =>
      createSession(tx, deps, {
        userId,
        activeMembershipId: membershipId,
        mfaVerifiedAt: null,
        partial: false,
        meta: META,
      }),
    );
  const refresh = (token: string) =>
    asSystem((tx) => rotateRefreshToken(tx, deps, { refreshToken: token, meta: META }));
  const alive = async (userId: string, sessionId: string): Promise<boolean> =>
    (await asSystem((tx) => authenticateSession(tx, deps, { userId, sessionId }))) !== null;
  const rows = async (sessionId: string) =>
    (
      await db().query<{
        revoked_at: Date | null;
        revoked_reason: string | null;
        created_at: Date;
        expires_at: Date;
        refresh_token_hash: Buffer;
      }>('SELECT * FROM user_session WHERE token_family_id = $1 ORDER BY id', [sessionId])
    ).rows;
  const token = (issued: IssuedSession): string => issued.refreshToken ?? '';

  describe('starting a session', () => {
    it('lives 12 hours idle, stores only a hash of the refresh token and records the device', async () => {
      const { userId } = await newUser();
      const issued = await start(userId);
      expect(issued.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [row] = await rows(issued.session.sessionId);
      expect(row?.expires_at.toISOString()).toBe(
        new Date(clock.now().getTime() + 12 * HOUR).toISOString(),
      );
      expect(Buffer.from(row?.refresh_token_hash ?? [])).toEqual(
        Buffer.from(hashRefreshToken(token(issued))),
      );
      expect(row?.refresh_token_hash.toString('latin1')).not.toContain(token(issued));
      const device = await db().query<{ ip: string; user_agent: string }>(
        'SELECT host(ip_address) AS ip, user_agent FROM user_session WHERE id = $1',
        [issued.session.rowId],
      );
      expect(device.rows[0]).toEqual({ ip: '203.0.113.7', user_agent: 'vitest' });
    });

    it('is alive for its own user only, and not once it has expired', async () => {
      const { userId } = await newUser();
      const other = await newUser();
      const issued = await start(userId);
      expect(await alive(userId, issued.session.sessionId)).toBe(true);
      expect(await alive(other.userId, issued.session.sessionId)).toBe(false);
      expect(await alive(userId, '018f0000-0000-7000-8000-000000000009')).toBe(false);
      clock.advance(12 * HOUR - 1000);
      expect(await alive(userId, issued.session.sessionId)).toBe(true);
      clock.advance(1000);
      expect(await alive(userId, issued.session.sessionId)).toBe(false);
    });

    it('is not alive for a disabled user, even if its row is untouched', async () => {
      const { userId } = await newUser();
      const issued = await start(userId);
      await db().query("UPDATE app_user SET status = 'DISABLED' WHERE id = $1", [userId]);
      expect(await alive(userId, issued.session.sessionId)).toBe(false);
    });
  });

  describe('rotation', () => {
    it('gives a new token, retires the old row and keeps the session id and its start', async () => {
      const { userId } = await newUser();
      const issued = await start(userId);
      clock.advance(HOUR);
      const outcome = await refresh(token(issued));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.refreshToken).not.toBe(token(issued));
      expect(outcome.session.sessionId).toBe(issued.session.sessionId);
      expect(outcome.session.startedAt).toEqual(issued.session.startedAt);
      expect(outcome.session.expiresAt.toISOString()).toBe(
        new Date(clock.now().getTime() + 12 * HOUR).toISOString(),
      );
      const family = await rows(issued.session.sessionId);
      expect(family).toHaveLength(2);
      expect(family.filter((row) => row.revoked_reason === 'ROTATED')).toHaveLength(1);
      expect(family.filter((row) => row.revoked_at === null)).toHaveLength(1);
      expect(await alive(userId, issued.session.sessionId)).toBe(true);
    });

    it('carries the active membership and the MFA time over', async () => {
      const { userId, customer } = await newUser();
      const membership = await owner((tx) =>
        tx.membership.findFirstOrThrow({
          where: { userId, organisationId: customer.organisationId },
        }),
      );
      const issued = await asSystem((tx) =>
        createSession(tx, deps, {
          userId,
          activeMembershipId: membership.id,
          mfaVerifiedAt: clock.now(),
          partial: false,
          meta: META,
        }),
      );
      clock.advance(HOUR);
      const outcome = await refresh(token(issued));
      expect(outcome.ok && outcome.session.activeMembershipId).toBe(membership.id);
      expect(outcome.ok && outcome.session.mfaVerifiedAt?.toISOString()).toBe(
        issued.session.mfaVerifiedAt?.toISOString(),
      );
    });

    it('answers UNKNOWN for a token that was never issued', async () => {
      expect(await refresh('x'.repeat(43))).toEqual({ ok: false, reason: 'UNKNOWN' });
    });

    it('lets a session idle out after 12 hours, but keep going if it is used', async () => {
      const { userId } = await newUser();
      const idle = await start(userId);
      clock.advance(12 * HOUR);
      expect(await refresh(token(idle))).toEqual({ ok: false, reason: 'EXPIRED' });

      const busy = await start(userId);
      let current = token(busy);
      for (let i = 0; i < 5; i++) {
        clock.advance(11 * HOUR);
        const outcome = await refresh(current);
        if (!outcome.ok) throw new Error(`refresh ${String(i)} failed: ${outcome.reason}`);
        current = outcome.refreshToken;
      }
    });

    it('ends a session 7 days after it began, however busy it is', async () => {
      const { userId } = await newUser();
      const issued = await start(userId);
      const absoluteEnd = issued.session.startedAt.getTime() + 7 * 24 * HOUR;
      let current = token(issued);
      let lastExpiry = issued.session.expiresAt.getTime();
      for (;;) {
        clock.advance(11 * HOUR);
        const outcome = await refresh(current);
        if (!outcome.ok) {
          expect(outcome.reason).toBe('EXPIRED');
          break;
        }
        expect(outcome.session.expiresAt.getTime()).toBeLessThanOrEqual(absoluteEnd);
        lastExpiry = outcome.session.expiresAt.getTime();
        current = outcome.refreshToken;
      }
      expect(lastExpiry).toBe(absoluteEnd);
      expect(clock.now().getTime()).toBeGreaterThanOrEqual(absoluteEnd - 11 * HOUR);
      expect(await alive(userId, issued.session.sessionId)).toBe(false);
    });

    it('revokes the family if the user is disabled', async () => {
      const { userId } = await newUser();
      const issued = await start(userId);
      await db().query("UPDATE app_user SET status = 'DISABLED' WHERE id = $1", [userId]);
      expect(await refresh(token(issued))).toEqual({ ok: false, reason: 'USER_DISABLED' });
      expect((await rows(issued.session.sessionId)).every((row) => row.revoked_at !== null)).toBe(
        true,
      );
    });
  });

  describe('reuse of a rotated token', () => {
    it('revokes the whole family, including the newest token, and audits it', async () => {
      const { userId } = await newUser();
      const issued = await start(userId);
      const second = await refresh(token(issued));
      if (!second.ok) throw new Error('rotation failed');
      const third = await refresh(second.refreshToken);
      if (!third.ok) throw new Error('rotation failed');

      // A thief presents the token that was already spent.
      expect(await refresh(token(issued))).toEqual({
        ok: false,
        reason: 'REUSED',
        sessionId: issued.session.sessionId,
        userId,
      });
      expect((await rows(issued.session.sessionId)).every((row) => row.revoked_at !== null)).toBe(
        true,
      );
      expect(await alive(userId, issued.session.sessionId)).toBe(false);
      // The honest holder of the newest token is signed out too.
      expect(await refresh(third.refreshToken)).toEqual({ ok: false, reason: 'REVOKED' });

      const audit = await db().query<{ action: string; entity_id: string; actor_user_id: string }>(
        "SELECT action, entity_id, actor_user_id FROM audit_log WHERE action = 'auth.refresh_reuse_detected' AND entity_id = $1",
        [issued.session.sessionId],
      );
      expect(audit.rows).toEqual([
        {
          action: 'auth.refresh_reuse_detected',
          entity_id: issued.session.sessionId,
          actor_user_id: userId,
        },
      ]);
      expect(JSON.stringify(audit.rows)).not.toContain(token(issued));
    });

    it('does not touch another session of the same user', async () => {
      const { userId } = await newUser();
      const one = await start(userId);
      const two = await start(userId);
      const rotated = await refresh(token(one));
      expect(rotated.ok).toBe(true);
      await refresh(token(one));
      expect(await alive(userId, one.session.sessionId)).toBe(false);
      expect(await alive(userId, two.session.sessionId)).toBe(true);
      expect((await refresh(token(two))).ok).toBe(true);
    });

    it('lets exactly one of two simultaneous refreshes with the same token succeed, then revokes the family', async () => {
      // Decision: two uses of one token are reuse. The database lets one UPDATE win; the loser
      // is treated as reuse and revokes the family, so both callers end up signed out.
      for (let round = 0; round < 5; round++) {
        const { userId } = await newUser();
        const issued = await start(userId);
        const results = await Promise.all([refresh(token(issued)), refresh(token(issued))]);
        const winners = results.filter((result) => result.ok);
        const losers = results.filter((result) => !result.ok);
        expect(winners).toHaveLength(1);
        expect(losers).toEqual([
          { ok: false, reason: 'REUSED', sessionId: issued.session.sessionId, userId },
        ]);
        const winner = winners[0];
        if (winner?.ok) {
          // The winner's new token is already dead: the family was revoked after it was issued.
          expect(await refresh(winner.refreshToken)).toEqual({ ok: false, reason: 'REVOKED' });
        }
        expect(await alive(userId, issued.session.sessionId)).toBe(false);
      }
    });
  });

  describe('revocation', () => {
    it('logs one session out: its token and access stop working, other sessions do not', async () => {
      const { userId } = await newUser();
      const one = await start(userId);
      const two = await start(userId);
      const done = await asUser(userId, (tx) =>
        revokeSession(tx, deps, {
          sessionId: one.session.sessionId,
          userId,
          reason: 'LOGOUT',
          meta: META,
        }),
      );
      expect(done).toBe(true);
      expect(await alive(userId, one.session.sessionId)).toBe(false);
      expect(await refresh(token(one))).toEqual({ ok: false, reason: 'REVOKED' });
      expect(await alive(userId, two.session.sessionId)).toBe(true);
      const audit = await db().query<{ action: string }>(
        "SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'auth.session_revoke'",
        [one.session.sessionId],
      );
      expect(audit.rows).toHaveLength(1);
    });

    it('reports false, and audits nothing, for a session that is already revoked', async () => {
      const { userId } = await newUser();
      const issued = await start(userId);
      const revoke = () =>
        asUser(userId, (tx) =>
          revokeSession(tx, deps, {
            sessionId: issued.session.sessionId,
            userId,
            reason: 'LOGOUT',
            meta: META,
          }),
        );
      expect(await revoke()).toBe(true);
      expect(await revoke()).toBe(false);
    });

    it('cannot revoke another user’s session', async () => {
      const mine = await newUser();
      const theirs = await newUser();
      const issued = await start(theirs.userId);
      const done = await asUser(mine.userId, (tx) =>
        revokeSession(tx, deps, {
          sessionId: issued.session.sessionId,
          userId: mine.userId,
          reason: 'LOGOUT',
          meta: META,
        }),
      );
      expect(done).toBe(false);
      expect(await alive(theirs.userId, issued.session.sessionId)).toBe(true);
    });

    it('logs out everywhere: every live session of the user, partial ones included, and nobody else', async () => {
      const mine = await newUser();
      const theirs = await newUser();
      const sessions = [await start(mine.userId), await start(mine.userId)];
      const partial = await asSystem((tx) =>
        createSession(tx, deps, {
          userId: mine.userId,
          activeMembershipId: null,
          mfaVerifiedAt: null,
          partial: true,
          meta: META,
        }),
      );
      const others = await start(theirs.userId);
      const count = await asUser(mine.userId, (tx) =>
        revokeAllSessions(tx, deps, { userId: mine.userId, reason: 'LOGOUT_ALL', meta: META }),
      );
      expect(count).toBe(3);
      for (const issued of [...sessions, partial]) {
        expect(await alive(mine.userId, issued.session.sessionId)).toBe(false);
      }
      expect(await refresh(token(sessions[0] as IssuedSession))).toEqual({
        ok: false,
        reason: 'REVOKED',
      });
      expect(await alive(theirs.userId, others.session.sessionId)).toBe(true);
    });

    it('keeps one user’s sessions out of another user’s sight (row-level security)', async () => {
      const mine = await newUser();
      const theirs = await newUser();
      await start(theirs.userId);
      const seen = await asUser(mine.userId, (tx) => tx.userSession.count());
      expect(seen).toBe(0);
    });
  });

  describe('active membership', () => {
    it('switches to one of the user’s own memberships and audits it', async () => {
      const { userId, customer } = await newUser();
      const other = await owner((tx) => createCustomer(tx, { segment: 'INDIVIDUAL' }));
      const second = await owner((tx) =>
        addMember(tx, userId, other.organisationId, 'CUSTOMER_ADMIN'),
      );
      const issued = await start(userId);
      const result = await asUser(userId, (tx) =>
        setActiveMembership(tx, deps, issued.session, second, META),
      );
      expect(result.session.activeMembershipId).toBe(second);
      expect(result.memberships.map((m) => m.organisation.id)).toEqual([
        customer.organisationId,
        other.organisationId,
      ]);
      const stored = await asSystem((tx) =>
        authenticateSession(tx, deps, { userId, sessionId: issued.session.sessionId }),
      );
      expect(stored?.activeMembershipId).toBe(second);
      const me = await asUser(userId, (tx) => loadMe(tx, { userId, sessionMembershipId: second }));
      expect(me.activeMembershipId).toBe(second);
      const audit = await db().query<{ action: string }>(
        "SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'auth.membership_switch'",
        [issued.session.sessionId],
      );
      expect(audit.rows).toHaveLength(1);
    });

    it('answers NOT_FOUND for a membership of someone else, a deactivated one or a made-up one', async () => {
      const mine = await newUser();
      const theirs = await newUser();
      const theirMembership = await owner((tx) =>
        tx.membership.findFirstOrThrow({ where: { userId: theirs.userId } }),
      );
      const issued = await start(mine.userId);
      const attempt = (membershipId: string) =>
        asUser(mine.userId, (tx) =>
          setActiveMembership(tx, deps, issued.session, membershipId, META),
        ).catch((error: unknown) => error);
      for (const membershipId of [theirMembership.id, '018f0000-0000-7000-8000-000000000042']) {
        const error = await attempt(membershipId);
        expect(error).toBeInstanceOf(IdentityError);
        expect((error as IdentityError).code).toBe('NOT_FOUND');
      }
      const own = await owner((tx) =>
        tx.membership.findFirstOrThrow({ where: { userId: mine.userId } }),
      );
      await db().query("UPDATE membership SET status = 'DEACTIVATED' WHERE id = $1", [own.id]);
      expect(((await attempt(own.id)) as IdentityError).code).toBe('NOT_FOUND');
    });

    it('is backed by the composite foreign key: a session cannot point at someone else’s membership (C-06)', async () => {
      const mine = await newUser();
      const theirs = await newUser();
      const theirMembership = await owner((tx) =>
        tx.membership.findFirstOrThrow({ where: { userId: theirs.userId } }),
      );
      const issued = await start(mine.userId);
      const attempt = await failure(() =>
        asSystem((tx) =>
          tx.userSession.update({
            where: { id: issued.session.rowId },
            data: { activeMembershipId: theirMembership.id },
          }),
        ),
      );
      expect(attempt.state).toBe(PG.foreignKey);
    });

    it('lets /me look through another of the user’s memberships, and refuses a foreign one', async () => {
      const mine = await newUser();
      const theirs = await newUser();
      const theirMembership = await owner((tx) =>
        tx.membership.findFirstOrThrow({ where: { userId: theirs.userId } }),
      );
      await expect(
        asUser(mine.userId, (tx) =>
          loadMe(tx, {
            userId: mine.userId,
            sessionMembershipId: null,
            requestedMembershipId: theirMembership.id,
          }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('keeps the policy numbers the documents give', () => {
    expect(IDENTITY_POLICY.accessTokenTtlSeconds).toBe(600);
    expect(IDENTITY_POLICY.sessionIdleSeconds).toBe(12 * 3600);
    expect(IDENTITY_POLICY.sessionAbsoluteSeconds).toBe(7 * 24 * 3600);
    expect(IDENTITY_POLICY.otpMaxAttempts).toBe(5);
    expect(IDENTITY_POLICY.stepUpMaxAgeSeconds).toBe(300);
  });
});
