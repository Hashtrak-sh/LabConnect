import { randomUUID } from 'node:crypto';
import { FAKE_SIGNATURE_HEADER, type FakeNotification } from '@labconnect/core';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { usePaymentsApp } from '../support/payments-app.js';

// receivePaymentWebhook over HTTP, held to the contract, on a real database as app_rw.

describe('POST /v1/webhooks/payments/{gateway}', () => {
  const t = usePaymentsApp();

  const post = (note: { headers: Record<string, string>; body: Buffer }, gateway = 'FAKE') =>
    t.http().post(`/v1/webhooks/payments/${gateway}`, {
      headers: { 'Content-Type': 'application/json', ...pick(note.headers) },
      body: note.body.toString('utf8'),
    });

  /** Only the headers the fake's scheme uses, plus the content type (what a gateway would send). */
  const pick = (headers: Record<string, string>) =>
    Object.fromEntries(Object.entries(headers).filter(([name]) => name.startsWith('x-fake-')));

  /** An ACCEPTED booking the customer has started to pay. */
  const pending = async () => {
    const bookingId = await t.placeBooking('ACCEPTED', {
      payment_due_at: new Date(t.clock.now().getTime() + 24 * 3_600_000),
    });
    const caller = t.callers.customerAdmin();
    const userId = t.world().users.customerAdmin;
    const service = t.runtime().service;
    const created = await t.as(caller, (tx) =>
      service.createAttempt(tx, {
        bookingId,
        idempotencyKey: randomUUID(),
        initiatedByUserId: userId,
      }),
    );
    await t.as(caller, (tx) =>
      service.openCheckout(tx, {
        paymentOrderId: created.attempt.id,
        userId,
        customer: { name: 'C', email: 'c@example.test' },
        returnUrl: 'https://app.example.test/payments/return',
      }),
    );
    const ref = t.gateway().orderRefFor(created.attempt.id) ?? '';
    return { bookingId, orderId: created.attempt.id, ref };
  };

  const events = (eventId: string) =>
    t.rows<{ signature_valid: boolean; processing_status: string; error: string | null }>(
      `SELECT signature_valid, processing_status::text AS processing_status, error
         FROM gateway_webhook_event WHERE event_id = $1`,
      [eventId],
    );
  const status = async (bookingId: string) =>
    (
      await t.rows<{ status: string }>('SELECT status::text AS status FROM booking WHERE id = $1', [
        bookingId,
      ])
    )[0]?.status;

  it('persists a signed capture, answers 200 with no body, and the worker then moves the booking', async () => {
    const { bookingId, ref } = await pending();
    const note: FakeNotification = t.gateway().completePayment(ref, { eventId: 'http-cap-1' });
    const response = await post(note);
    expect(response.status).toBe(200);
    expect(response.text).toBe('');
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(await events('http-cap-1')).toEqual([
      { signature_valid: true, processing_status: 'RECEIVED', error: null },
    ]);
    // Acknowledged and stored, but not processed by the request.
    expect(await status(bookingId)).toBe('ACCEPTED');
    const result = await t.runtime().service.processPending(t.worker());
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(await status(bookingId)).toBe('PAID');
  });

  it('answers a duplicate delivery the same way and stores it once', async () => {
    const { ref } = await pending();
    const note = t.gateway().completePayment(ref, { eventId: 'http-dup-1' });
    const first = await post(note);
    const second = await post(note);
    expect([second.status, second.text]).toEqual([first.status, first.text]);
    expect(await events('http-dup-1')).toHaveLength(1);
  });

  it('answers a forged signature exactly like a genuine one, and stores it as untrusted', async () => {
    const { bookingId, ref } = await pending();
    const note = t.gateway().completePayment(ref, { eventId: 'http-forged-1' });
    const forged = {
      ...note,
      headers: { ...note.headers, [FAKE_SIGNATURE_HEADER]: 'ab'.repeat(32) },
    };
    const genuine = await post(
      t.gateway().buildNotification({
        type: 'PAYMENT_FAILED',
        merchantReference: randomUUID(),
        amountPaise: 1n,
      }),
    );
    const response = await post(forged);
    expect(response.status).toBe(genuine.status);
    expect(response.text).toBe(genuine.text);
    expect(Object.keys(response.headers).sort()).toEqual(Object.keys(genuine.headers).sort());
    expect(await events('http-forged-1')).toHaveLength(0); // its claimed id was not trusted
    await t.runtime().service.processPending(t.worker());
    expect(await status(bookingId)).toBe('ACCEPTED');
    const untrusted = await t.rows<{ n: string }>(
      `SELECT count(*) AS n FROM gateway_webhook_event WHERE signature_valid = false AND processing_status = 'IGNORED'`,
    );
    expect(Number(untrusted[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('does not reveal whether a reference exists', async () => {
    const { ref } = await pending();
    const known = await post(t.gateway().completePayment(ref, { eventId: 'http-known-1' }));
    const unknown = await post(
      t.gateway().buildNotification({
        type: 'PAYMENT_CAPTURED',
        merchantReference: randomUUID(),
        amountPaise: 118_000n,
        eventId: 'http-unknown-1',
      }),
    );
    expect([unknown.status, unknown.text]).toEqual([known.status, known.text]);
    await t.runtime().service.processPending(t.worker());
    expect(await events('http-unknown-1')).toEqual([
      { signature_valid: true, processing_status: 'FAILED', error: 'UNKNOWN_REFERENCE' },
    ]);
  });

  it('stores a body that is not valid JSON instead of answering 400', async () => {
    const response = await t.http().post('/v1/webhooks/payments/FAKE', {
      headers: { 'Content-Type': 'application/json' },
      body: '{"fakeEvents": [',
    });
    expect(response.status).toBe(200);
    expect(response.text).toBe('');
  });

  it('accepts other content types and an empty body, and keeps the bytes exactly', async () => {
    const note = t.gateway().buildNotification({
      type: 'PAYMENT_FAILED',
      merchantReference: randomUUID(),
      amountPaise: 5n,
      eventId: 'http-text-1',
    });
    const asText = await t.http().post('/v1/webhooks/payments/FAKE', {
      headers: { ...pick(note.headers), 'Content-Type': 'text/plain' },
      body: note.body.toString('utf8'),
    });
    expect(asText.status).toBe(200);
    expect(await events('http-text-1')).toHaveLength(1); // the signature covered those exact bytes
    const empty = await t
      .http()
      .post('/v1/webhooks/payments/FAKE', { headers: { 'Content-Type': 'application/json' } });
    expect(empty.status).toBe(200);
  });

  it('answers 404 for a gateway that is not enabled here, without touching the database', async () => {
    const response = await post(
      t
        .gateway()
        .buildNotification({ type: 'PAYMENT_FAILED', merchantReference: 'x', amountPaise: 1n }),
      'ICICI',
    );
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(JSON.stringify(response.body)).not.toMatch(/fake|adapter|secret/i);
  });

  it('answers 404 for a name that is no gateway at all', async () => {
    const response = await t.http().post('/v1/webhooks/payments/nope', {
      body: '{}',
      invalidRequest: 'a path value outside the GatewayCode enum must give the same 404',
    });
    expect(response.status).toBe(404);
  });

  it('refuses a body over the limit with a problem body (a transport error the contract does not list)', async () => {
    // Plain supertest on purpose: the contract lists no 413 for this operation (ERROR_HANDLING §3
    // answers transport errors generically), so contractRequest() would call it a violation.
    const response = await request(t.server())
      .post('/v1/webhooks/payments/FAKE')
      .set('Content-Type', 'application/octet-stream')
      .send('x'.repeat(300 * 1024));
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('fails with 500, and stores nothing, when the event cannot be persisted, so the gateway retries', async () => {
    const { ref } = await pending();
    const note = t.gateway().completePayment(ref, { eventId: 'http-fail-1' });
    const spy = vi.spyOn(t.api(), '$transaction').mockRejectedValueOnce(new Error('database down'));
    try {
      const response = await post(note);
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(JSON.stringify(response.body)).not.toContain('database down');
    } finally {
      spy.mockRestore();
    }
    expect(await events('http-fail-1')).toHaveLength(0);
    // The retry is accepted.
    expect((await post(note)).status).toBe(200);
    expect(await events('http-fail-1')).toHaveLength(1);
  });

  it('needs no bearer token, membership or idempotency key (the contract says none)', async () => {
    const response = await post(
      t.gateway().buildNotification({
        type: 'PAYMENT_FAILED',
        merchantReference: randomUUID(),
        amountPaise: 1n,
      }),
    );
    expect(response.status).toBe(200);
  });
});
