import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { START, useIdentityApp } from '../support/identity-app.js';
import { useClaimLabs } from '../support/claim-labs.js';

// startLabClaim and verifyLabClaimOtp over HTTP, held to the contract, on a real database
// (I1-LAB-01, I1-LAB-02).

describe('lab claims: POST /v1/lab/claims and POST /v1/lab/claims/{id}/verify-otp', () => {
  const t = useIdentityApp();
  const makeLab = useClaimLabs(t, new Date(START));

  let fixtures: Awaited<ReturnType<typeof t.fixtures>> | undefined;
  const known = async () => (fixtures ??= await t.fixtures());

  const lab = makeLab;
  /** A new user with no membership, signed in through the API. */
  const newUser = async (label = 'claimant') => {
    const email = t.newEmail(label);
    const session = await t.signIn(email);
    return { email, token: session.accessToken };
  };
  const start = (token: string, body: unknown) =>
    t.api.post('/v1/lab/claims', { token, body: body as object });
  const verify = (token: string, id: string, code: string, ifMatch: string | undefined) =>
    t.api.post(`/v1/lab/claims/${id}/verify-otp`, {
      token,
      body: { code },
      ...(ifMatch !== undefined && { headers: { 'If-Match': ifMatch } }),
    });
  const wrong = (code: string): string => (code === '000000' ? '000001' : '000000');
  const claimIdOf = (response: { body: unknown }) => (response.body as { id: string }).id;

  /** Everything the process writes to the console, stdout/stderr and Nest's logger. */
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
    t.mailer.failWith = undefined;
  });

  describe('startLabClaim', () => {
    it('answers 201 with the claim, the masked address and an ETag, and mails the code to the NABL address only', async () => {
      const claimable = await lab({ email: 'Quality.Head@Example-Lab.co.in' });
      const user = await newUser();
      const response = await start(user.token, { certificateNo: claimable.certificateNo });

      expect(response.status).toBe(201);
      expect(response.headers.etag).toBe('"0"');
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        status: 'PENDING_OTP',
        method: 'EMAIL_OTP',
        labSite: { id: claimable.siteId, siteCode: claimable.siteCode, name: claimable.siteName },
        otpSentTo: 'q***@***.in',
        createdAt: START.replace('Z', '.000Z'),
        reviewedAt: null,
        decisionNotes: null,
      });
      expect(response.text).not.toContain('quality.head');
      expect(response.text).not.toContain('example-lab');
      expect(t.mailer.claimSent).toHaveLength(1);
      expect(t.mailer.claimSent[0]).toMatchObject({
        to: 'quality.head@example-lab.co.in',
        validForMinutes: 10,
      });
      expect(t.mailer.claimSent[0]?.code).toMatch(/^\d{6}$/);
      expect(response.text).not.toContain(t.mailer.claimSent[0]?.code ?? 'x');
      // It is a claim code, not a sign-in code.
      expect(t.mailer.sent.filter((m) => m.to === 'quality.head@example-lab.co.in')).toEqual([]);
    });

    it('answers 200 with the same claim and a new code when the caller starts again', async () => {
      const claimable = await lab();
      const user = await newUser();
      const first = await start(user.token, { certificateNo: claimable.certificateNo });
      const again = await start(user.token, { certificateNo: claimable.certificateNo });
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.headers.etag).toBe('"0"');
      expect(claimIdOf(again)).toBe(claimIdOf(first));
      const codes = t.mailer.claimSent.filter((m) => m.to === claimable.email?.toLowerCase());
      expect(codes).toHaveLength(2);
    });

    it('lets a user who already belongs to a customer organisation claim a lab', async () => {
      const { customer } = await known();
      const claimable = await lab();
      const session = await t.signIn(customer.admin.email);
      const response = await start(session.accessToken, { certificateNo: claimable.certificateNo });
      expect(response.status).toBe(201);
    });

    it('never takes the address, the organisation or the user from the request: unknown fields are 422 and nothing is sent', async () => {
      const claimable = await lab();
      const user = await newUser();
      const before = t.mailer.claimSent.length;
      const bodies: [string, unknown][] = [
        ['an email address', { certificateNo: claimable.certificateNo, email: 'me@evil.test' }],
        ['otpSentTo', { certificateNo: claimable.certificateNo, otpSentTo: 'me@evil.test' }],
        [
          'an organisation',
          { certificateNo: claimable.certificateNo, organisationId: randomUUID() },
        ],
        ['a user', { certificateNo: claimable.certificateNo, requestedByUserId: randomUUID() }],
        ['no certificate', {}],
        ['a certificate that is not a string', { certificateNo: 1234 }],
        ['an empty certificate', { certificateNo: '' }],
        ['a blank certificate', { certificateNo: '   ' }],
        ['a certificate that is too long', { certificateNo: 'x'.repeat(51) }],
        ['an array', [claimable.certificateNo]],
      ];
      for (const [label, body] of bodies) {
        const response = await t.api.post('/v1/lab/claims', {
          token: user.token,
          body: body as object,
          invalidRequest: label,
        });
        expect(response.status, label).toBe(422);
        expect(response.body, label).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(response.text, label).not.toContain('evil.test');
      }
      expect(t.mailer.claimSent).toHaveLength(before);
      const rows = await t
        .db()
        .query('SELECT 1 FROM lab_claim_request WHERE organisation_id = $1', [
          claimable.organisationId,
        ]);
      expect(rows.rowCount).toBe(0);
    });

    it('rejects malformed JSON with 400', async () => {
      const user = await newUser();
      const response = await t.api.post('/v1/lab/claims', {
        token: user.token,
        body: '{"certificateNo": ',
        headers: { 'Content-Type': 'application/json' },
        invalidRequest: 'malformed JSON',
      });
      expect(response.status).toBe(400);
    });

    it('answers 401 without a token and with a bad one', async () => {
      const claimable = await lab();
      for (const options of [{}, { token: 'not-a-token' }]) {
        const response = await t.api.post('/v1/lab/claims', {
          ...options,
          body: { certificateNo: claimable.certificateNo },
        });
        expect(response.status).toBe(401);
        expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      }
    });

    it('answers 403 FORBIDDEN to platform staff (RR-5) before it looks anything up', async () => {
      const { platform } = await known();
      const claimable = await lab();
      const ops = await t.signInWithMfa(platform.ops.email);
      const response = await start(ops.accessToken, { certificateNo: claimable.certificateNo });
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      // It does not even tell staff whether the certificate exists.
      const unknown = await start(ops.accessToken, { certificateNo: 'NO-SUCH-CERTIFICATE' });
      expect(unknown.status).toBe(403);
      const rows = await t
        .db()
        .query('SELECT 1 FROM lab_claim_request WHERE requested_by_user_id = $1', [
          platform.ops.id,
        ]);
      expect(rows.rowCount).toBe(0);
    });

    it('answers 422 VALIDATION_FAILED with the same body for an unknown, expired, suspended and hidden certificate', async () => {
      const user = await newUser();
      const expired = await lab({ accreditationStatus: 'EXPIRED' });
      const suspended = await lab({ accreditationStatus: 'SUSPENDED' });
      const hidden = await lab();
      await t
        .db()
        .query("UPDATE lab_site SET listing_status = 'HIDDEN' WHERE id = $1", [hidden.siteId]);
      const answers: unknown[] = [];
      for (const certificateNo of [
        'NO-SUCH-CERTIFICATE',
        expired.certificateNo,
        suspended.certificateNo,
        hidden.certificateNo,
      ]) {
        const response = await start(user.token, { certificateNo });
        expect(response.status, certificateNo).toBe(422);
        const body = response.body as { requestId: string; detail: string; errors: unknown[] };
        expect(body).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(body.errors).toEqual([
          expect.objectContaining({ path: 'certificateNo', code: 'UNKNOWN_CERTIFICATE' }),
        ]);
        answers.push({ detail: body.detail, errors: body.errors });
      }
      expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    });

    it('answers 409 INVALID_STATE_TRANSITION for a claimed organisation, with currentState and nothing else of it', async () => {
      const claimed = await lab({ onboarded: true });
      const user = await newUser();
      const response = await start(user.token, { certificateNo: claimed.certificateNo });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'CLAIMED' },
      });
      expect(response.text).not.toContain(claimed.organisationId);
    });

    it("answers 409 for another user's open claim, without saying whose, and sends no code", async () => {
      const claimable = await lab();
      const owner = await newUser('owner');
      const rival = await newUser('rival');
      const first = await start(owner.token, { certificateNo: claimable.certificateNo });
      const sent = t.mailer.claimSent.length;
      const response = await start(rival.token, { certificateNo: claimable.certificateNo });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'CLAIM_PENDING' },
      });
      expect(response.text).not.toContain(claimIdOf(first));
      expect(response.text).not.toContain(owner.email);
      expect(t.mailer.claimSent).toHaveLength(sent);
    });

    it("answers 409 PENDING_REVIEW for the caller's own claim that waits for review", async () => {
      const claimable = await lab();
      const user = await newUser();
      const first = await start(user.token, { certificateNo: claimable.certificateNo });
      const code = t.mailer.lastClaimCodeFor(claimable.email?.toLowerCase() ?? '') ?? '';
      expect((await verify(user.token, claimIdOf(first), code, '"0"')).status).toBe(200);
      const again = await start(user.token, { certificateNo: claimable.certificateNo });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ meta: { currentState: 'PENDING_REVIEW' } });
    });

    it('lets exactly one of two simultaneous claims of one organisation win', async () => {
      const claimable = await lab();
      const [a, b] = await Promise.all([newUser('a'), newUser('b')]);
      const [ra, rb] = await Promise.all([
        start(a.token, { certificateNo: claimable.certificateNo }),
        start(b.token, { certificateNo: claimable.certificateNo }),
      ]);
      expect([ra.status, rb.status].sort()).toEqual([201, 409]);
      const rows = await t
        .db()
        .query('SELECT 1 FROM lab_claim_request WHERE organisation_id = $1', [
          claimable.organisationId,
        ]);
      expect(rows.rowCount).toBe(1);
      expect(
        t.mailer.claimSent.filter((m) => m.to === claimable.email?.toLowerCase()),
      ).toHaveLength(1);
    });

    it('opens a MANUAL claim with otpSentTo null and sends nothing when the NABL data has no address', async () => {
      const claimable = await lab({ email: null });
      const user = await newUser();
      const before = t.mailer.claimSent.length;
      const response = await start(user.token, { certificateNo: claimable.certificateNo });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        status: 'PENDING_OTP',
        method: 'MANUAL',
        otpSentTo: null,
      });
      expect(response.headers.etag).toBe('"0"');
      expect(t.mailer.claimSent).toHaveLength(before);
      const again = await start(user.token, { certificateNo: claimable.certificateNo });
      expect(again.status).toBe(200);
      expect(t.mailer.claimSent).toHaveLength(before);
    });

    it('answers 429 RATE_LIMITED with Retry-After after 5 codes to one address in 15 minutes', async () => {
      const shared = 'shared.inbox@lab-group.example.test';
      const first = await lab({ email: shared });
      const second = await lab({ email: shared });
      const a = await newUser('a');
      const b = await newUser('b');
      for (let i = 0; i < 5; i++) {
        expect((await start(a.token, { certificateNo: first.certificateNo })).status).toBe(
          i === 0 ? 201 : 200,
        );
      }
      const limited = await start(b.token, { certificateNo: second.certificateNo });
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(t.mailer.claimSent.filter((m) => m.to === shared)).toHaveLength(5);
      const rows = await t
        .db()
        .query('SELECT 1 FROM lab_claim_request WHERE organisation_id = $1', [
          second.organisationId,
        ]);
      expect(rows.rowCount).toBe(0);
      t.clock.advance(15 * 60_000 + 1_000);
      // The access token lives 10 minutes: sign in again.
      const later = await t.signIn(b.email);
      expect((await start(later.accessToken, { certificateNo: second.certificateNo })).status).toBe(
        201,
      );
    });

    it('keeps the claim open and lets the caller continue when the email cannot be sent', async () => {
      const claimable = await lab({ email: 'unreachable.person@down.example.test' });
      const user = await newUser();
      t.mailer.failWith = new Error('SMTP refused unreachable.person@down.example.test');
      const failed = await start(user.token, { certificateNo: claimable.certificateNo });
      expect(failed.status).toBe(500);
      expect(failed.body).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(failed.text).not.toContain('unreachable.person');
      const rows = await t
        .db()
        .query<{ id: string; status: string }>(
          'SELECT id, status FROM lab_claim_request WHERE organisation_id = $1',
          [claimable.organisationId],
        );
      expect(rows.rows).toEqual([{ id: expect.any(String) as string, status: 'PENDING_OTP' }]);

      t.mailer.failWith = undefined;
      const retried = await start(user.token, { certificateNo: claimable.certificateNo });
      expect(retried.status).toBe(200);
      expect(claimIdOf(retried)).toBe(rows.rows[0]?.id);
      const code = t.mailer.lastClaimCodeFor('unreachable.person@down.example.test') ?? '';
      const verified = await verify(user.token, rows.rows[0]?.id ?? '', code, '"0"');
      expect(verified.status).toBe(200);
      // The address of the failed send is not in any log line either.
      expect(lines.join('\n')).not.toContain('unreachable.person');
    });
  });

  describe('verifyLabClaimOtp', () => {
    const opened = async (options: Parameters<typeof lab>[0] = {}) => {
      const claimable = await lab(options);
      const user = await newUser();
      const response = await start(user.token, { certificateNo: claimable.certificateNo });
      const id = claimIdOf(response);
      const code = t.mailer.lastClaimCodeFor(claimable.email?.toLowerCase() ?? '') ?? '';
      return { claimable, user, id, code, response };
    };

    it('answers 200: PENDING_REVIEW, the address still masked and a new ETag', async () => {
      const { user, id, code, claimable } = await opened({ email: 'lab.head@verify.example.in' });
      const response = await verify(user.token, id, code, '"0"');
      expect(response.status).toBe(200);
      expect(response.headers.etag).toBe('"1"');
      expect(response.body).toMatchObject({
        id,
        status: 'PENDING_REVIEW',
        method: 'EMAIL_OTP',
        otpSentTo: 'l***@***.in',
        reviewedAt: null,
        decisionNotes: null,
        labSite: { id: claimable.siteId },
      });
      expect(response.text).not.toContain('lab.head');
      expect(response.text).not.toContain(code);
      const org = await t
        .db()
        .query<{ claim_status: string }>('SELECT claim_status FROM organisation WHERE id = $1', [
          claimable.organisationId,
        ]);
      expect(org.rows[0]?.claim_status).toBe('UNCLAIMED');
    });

    it('answers 400 when If-Match is missing or is not one strong ETag, and spends no attempt', async () => {
      const { user, id, code } = await opened();
      for (const ifMatch of [undefined, '', '0', '"x"', 'W/"0"', '*', '"0", "1"']) {
        const response = await t.api.post(`/v1/lab/claims/${id}/verify-otp`, {
          token: user.token,
          body: { code: wrong(code) },
          ...(ifMatch !== undefined && { headers: { 'If-Match': ifMatch } }),
          invalidRequest: 'a missing or malformed If-Match must give 400',
        });
        expect(response.status, String(ifMatch)).toBe(400);
      }
      const attempts = await t
        .db()
        .query<{ attempts: number }>(
          'SELECT attempts FROM otp_challenge WHERE context_id = $1 ORDER BY created_at DESC LIMIT 1',
          [id],
        );
      expect(attempts.rows[0]?.attempts).toBe(0);
      expect((await verify(user.token, id, code, '"0"')).status).toBe(200);
    });

    it('answers 412 CONCURRENT_MODIFICATION for a stale If-Match, before a guess is counted', async () => {
      const { user, id, code } = await opened();
      const response = await verify(user.token, id, wrong(code), '"5"');
      expect(response.status).toBe(412);
      expect(response.body).toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
      const attempts = await t
        .db()
        .query<{ attempts: number }>(
          'SELECT attempts FROM otp_challenge WHERE context_id = $1 ORDER BY created_at DESC LIMIT 1',
          [id],
        );
      expect(attempts.rows[0]?.attempts).toBe(0);
    });

    it('answers 409 INVALID_STATE_TRANSITION for a claim that is already verified, whatever If-Match says', async () => {
      const { user, id, code } = await opened();
      expect((await verify(user.token, id, code, '"0"')).status).toBe(200);
      for (const ifMatch of ['"0"', '"1"', '"9"']) {
        const response = await verify(user.token, id, code, ifMatch);
        expect(response.status, ifMatch).toBe(409);
        expect(response.body).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          meta: { currentState: 'PENDING_REVIEW' },
        });
      }
    });

    it('answers 404 for an unknown claim and for a claim of another user, in the same words', async () => {
      const { id, code } = await opened();
      const stranger = await newUser('stranger');
      const foreign = await verify(stranger.token, id, code, '"0"');
      const unknown = await verify(stranger.token, randomUUID(), code, '"0"');
      expect(foreign.status).toBe(404);
      expect(unknown.status).toBe(404);
      // Everything but the request id, which differs per request by design.
      const strip = (body: unknown) => ({ ...(body as Record<string, unknown>), requestId: '' });
      expect(strip(foreign.body)).toEqual(strip(unknown.body));
    });

    it('answers 422 OTP_INVALID for a wrong code and counts it, then 429 OTP_LOCKED at the fifth', async () => {
      const { user, id, code } = await opened();
      for (let i = 1; i <= 4; i++) {
        const response = await verify(user.token, id, wrong(code), '"0"');
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({ code: 'OTP_INVALID' });
      }
      const locked = await verify(user.token, id, wrong(code), '"0"');
      expect(locked.status).toBe(429);
      expect(locked.body).toMatchObject({ code: 'OTP_LOCKED' });
      // Even the right code is refused now; a new code (start again) is the way out.
      const refused = await verify(user.token, id, code, '"0"');
      expect(refused.status).toBe(429);
    });

    it('answers 422 OTP_EXPIRED after 10 minutes', async () => {
      const { user, id, code } = await opened();
      t.clock.advance(10 * 60_000 + 1_000);
      const later = await t.signIn(user.email);
      const response = await verify(later.accessToken, id, code, '"0"');
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ code: 'OTP_EXPIRED' });
    });

    it('answers 422 for a body that is not exactly a 6-digit code, and for an id that is not a UUID', async () => {
      const { user, id } = await opened();
      const bodies: [string, unknown][] = [
        ['no code', {}],
        ['five digits', { code: '12345' }],
        ['letters', { code: 'abcdef' }],
        ['a number', { code: 123456 }],
        ['an extra field', { code: '123456', email: 'me@evil.test' }],
      ];
      for (const [label, body] of bodies) {
        const response = await t.api.post(`/v1/lab/claims/${id}/verify-otp`, {
          token: user.token,
          body: body as object,
          headers: { 'If-Match': '"0"' },
          invalidRequest: label,
        });
        expect(response.status, label).toBe(422);
      }
      const response = await t.api.post('/v1/lab/claims/not-a-uuid/verify-otp', {
        token: user.token,
        body: { code: '123456' },
        headers: { 'If-Match': '"0"' },
        invalidRequest: 'an id that is not a UUID',
      });
      expect(response.status).toBe(422);
    });

    it('answers 401 without a token', async () => {
      const { id } = await opened();
      const response = await t.api.post(`/v1/lab/claims/${id}/verify-otp`, {
        body: { code: '123456' },
        headers: { 'If-Match': '"0"' },
      });
      expect(response.status).toBe(401);
    });

    it('lets two simultaneous correct submissions through once: 200 and 409', async () => {
      const { user, id, code } = await opened();
      const results = await Promise.all([
        verify(user.token, id, code, '"0"'),
        verify(user.token, id, code, '"0"'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });

  describe('what the code and the address never touch', () => {
    it('keeps them out of every log line, the audit log, the outbox and the database tables', async () => {
      const address = 'confidential.person@hidden-lab.example.test';
      const claimable = await lab({ email: address });
      const user = await newUser();
      const first = await start(user.token, { certificateNo: claimable.certificateNo });
      const id = claimIdOf(first);
      const stale = t.mailer.lastClaimCodeFor(address) ?? '';
      await start(user.token, { certificateNo: claimable.certificateNo });
      const code = t.mailer.lastClaimCodeFor(address) ?? '';
      await verify(user.token, id, wrong(code), '"0"');
      const done = await verify(user.token, id, code, '"0"');
      expect(done.status).toBe(200);

      const output = lines.join('\n');
      expect(output).not.toContain('confidential.person');
      expect(output).not.toContain('hidden-lab');
      for (const secret of new Set([stale, code]))
        expect(output).not.toMatch(new RegExp(`\\b${secret}\\b`));

      for (const table of ['audit_log', 'outbox_event', 'otp_challenge', 'lab_claim_request']) {
        const rows = await t
          .db()
          .query<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM ${table} t`);
        const everything = rows.rows.map((r) => r.row).join('\n');
        // lab_site_private is the one table that holds the address, and it is not in this list.
        expect(everything, table).not.toContain('confidential.person');
        for (const secret of new Set([stale, code])) {
          expect(everything, table).not.toMatch(new RegExp(`["\\s:]${secret}["\\s,}]`));
        }
      }
    });
  });
});
