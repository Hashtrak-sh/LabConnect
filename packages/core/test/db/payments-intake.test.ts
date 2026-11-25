import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FAKE_SIGNATURE_HEADER, payloadContext } from '../../src/index.js';
import { FAKE_SECRET, usePaymentsHarness } from './payments-support.js';

// P3-09: webhook intake. Persist once, verify through the adapter, never process, never trust.

describe('gateway webhook intake', () => {
  const h = usePaymentsHarness();

  const pending = async () => {
    const bookingId = await h.acceptedBooking();
    const { orderId } = await h.startPayment(bookingId);
    const ref = h.gateway.orderRefFor(orderId) ?? '';
    return { bookingId, orderId, ref };
  };

  it('stores a valid notification once, as RECEIVED, with an outbox event and nothing processed', async () => {
    const { bookingId, orderId, ref } = await pending();
    const note = h.gateway.completePayment(ref, { eventId: 'intake-valid-1' });
    const result = await h.deliver(note);
    expect(result).toEqual({ outcome: 'ACCEPTED', stored: 1, duplicates: 0 });
    const rows = await h.eventRows(`WHERE event_id = 'intake-valid-1'`);
    expect(rows).toEqual([
      expect.objectContaining({
        event_type: 'PAYMENT_CAPTURED',
        signature_valid: true,
        processing_status: 'RECEIVED',
        error: null,
      }),
    ]);
    const events = await h.rows<{ payload: { data: Record<string, unknown> } }>(
      `SELECT payload FROM outbox_event WHERE event_type = 'payment.gateway_event_received' AND aggregate_id = $1`,
      [rows[0]?.id],
    );
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]?.payload.data ?? {}).sort()).toEqual([
      'eventType',
      'gateway',
      'gatewayEventRowId',
    ]);
    // Intake only stores: the order and the booking have not moved.
    expect((await h.orderRow(orderId))?.status).toBe('PENDING');
    expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
    expect(await h.t09Count(bookingId)).toBe(0);
  });

  it('stores a duplicate delivery once', async () => {
    const { ref } = await pending();
    const note = h.gateway.completePayment(ref, { eventId: 'intake-dup-1' });
    expect((await h.deliver(note)).outcome).toBe('ACCEPTED');
    expect(await h.deliver(note)).toEqual({ outcome: 'DUPLICATE', stored: 0, duplicates: 1 });
    expect(await h.eventRows(`WHERE event_id = 'intake-dup-1'`)).toHaveLength(1);
    const events = await h.rows(
      `SELECT 1 FROM outbox_event o JOIN gateway_webhook_event g ON g.id = o.aggregate_id
        WHERE g.event_id = 'intake-dup-1' AND o.event_type = 'payment.gateway_event_received'`,
    );
    expect(events).toHaveLength(1);
  });

  it('stores concurrent duplicates once', async () => {
    const { ref } = await pending();
    const note = h.gateway.completePayment(ref, { eventId: 'intake-race-1' });
    const results = await Promise.all(Array.from({ length: 8 }, () => h.deliver(note)));
    expect(results.filter((r) => r.outcome === 'ACCEPTED')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'DUPLICATE')).toHaveLength(7);
    expect(await h.eventRows(`WHERE event_id = 'intake-race-1'`)).toHaveLength(1);
  });

  it('stores one row per event of a multi-event notification, each under its own id', async () => {
    const { orderId } = await pending();
    const note = h.gateway.buildNotification(
      {
        type: 'PAYMENT_FAILED',
        merchantReference: orderId,
        amountPaise: 118_000n,
        eventId: 'multi-a',
      },
      {
        type: 'PAYMENT_FAILED',
        merchantReference: orderId,
        amountPaise: 118_000n,
        eventId: 'multi-b',
      },
    );
    expect(await h.deliver(note)).toEqual({ outcome: 'ACCEPTED', stored: 2, duplicates: 0 });
    expect(await h.deliver(note)).toEqual({ outcome: 'DUPLICATE', stored: 0, duplicates: 2 });
    expect((await h.eventRows(`WHERE event_id LIKE 'multi-%'`)).map((r) => r.event_id)).toEqual([
      'multi-a',
      'multi-b',
    ]);
  });

  it('stores a notification with an invalid signature as untrusted, once, and never processes it', async () => {
    const { bookingId, orderId, ref } = await pending();
    const note = h.gateway.completePayment(ref, { eventId: 'intake-bad-sig' });
    const forged = {
      headers: { ...note.headers, [FAKE_SIGNATURE_HEADER]: 'ab'.repeat(32) },
      body: note.body,
    };
    expect(await h.deliver(forged)).toEqual({ outcome: 'REJECTED', stored: 1, duplicates: 0 });
    // The same bytes again: not stored twice.
    expect((await h.deliver(forged)).outcome).toBe('DUPLICATE');
    const bodyHash = createHash('sha256').update(note.body).digest('hex').slice(0, 40);
    const rows = await h.eventRows(`WHERE event_id = 'invalid:${bodyHash}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ signature_valid: false, processing_status: 'IGNORED' });
    // Its claimed event id was not used: a later genuine notification with that id is still accepted.
    expect(await h.eventRows(`WHERE event_id = 'intake-bad-sig'`)).toHaveLength(0);
    expect((await h.deliver(note)).outcome).toBe('ACCEPTED');
    // Nothing the forged body said happened, even after a worker pass over everything waiting.
    const forgedRow = rows[0];
    expect(forgedRow).toMatchObject({ event_type: 'UNVERIFIED', error: 'SIGNATURE_INVALID' });
    await h.processAll();
    expect((await h.eventRows(`WHERE id = '${forgedRow?.id ?? ''}'`))[0]?.processing_status).toBe(
      'IGNORED',
    );
    expect(await h.bookingStatus(bookingId)).toBe('PAID'); // only the genuine one moved it
    expect((await h.orderRow(orderId))?.status).toBe('CAPTURED');
  });

  it('stores a tampered, a stale and a wrong-secret notification as untrusted', async () => {
    const { ref } = await pending();
    const good = h.gateway.completePayment(ref, { eventId: 'intake-tamper' });
    const tampered = {
      headers: good.headers,
      body: Buffer.from(
        good.body.toString().replace('"fakeAmountPaise":"118000"', '"fakeAmountPaise":"1"'),
      ),
    };
    expect(tampered.body.equals(good.body)).toBe(false);
    const stale = h.gateway.signBody(good.body, Math.floor(h.clock.now().getTime() / 1000) - 3600);
    const other = new (
      h.gateway.constructor as new (o: {
        clock: typeof h.clock;
        secret: string;
      }) => typeof h.gateway
    )({
      clock: h.clock,
      secret: `${FAKE_SECRET}-other`,
    }).signBody(good.body);
    for (const note of [tampered, stale, other]) {
      // The two with the same body share one untrusted row (keyed by the body's hash).
      expect(['REJECTED', 'DUPLICATE']).toContain((await h.deliver(note)).outcome);
    }
    expect(await h.eventRows(`WHERE event_id = 'intake-tamper'`)).toHaveLength(0);
  });

  it('stores an authentic body with nothing usable as IGNORED', async () => {
    const note = h.gateway.signBody(Buffer.from('{"fakeEvents":[]}', 'utf8'));
    expect((await h.deliver(note)).outcome).toBe('REJECTED');
    const rows = await h.eventRows(`WHERE event_type = 'UNPARSED'`);
    expect(
      rows.some((r) => r.error === 'NO_USABLE_EVENTS' && r.processing_status === 'IGNORED'),
    ).toBe(true);
  });

  it('keeps the first body when the same event id comes back with other content, and audits it', async () => {
    const { orderId } = await pending();
    const one = h.gateway.buildNotification({
      type: 'PAYMENT_CAPTURED',
      merchantReference: orderId,
      amountPaise: 118_000n,
      eventId: 'conflict-1',
    });
    const two = h.gateway.buildNotification({
      type: 'PAYMENT_CAPTURED',
      merchantReference: orderId,
      amountPaise: 5n,
      eventId: 'conflict-1',
    });
    await h.deliver(one);
    expect((await h.deliver(two)).outcome).toBe('DUPLICATE');
    const [row] = await h.eventRows(`WHERE event_id = 'conflict-1'`);
    const audit = await h.rows(
      `SELECT 1 FROM audit_log WHERE action = 'payment.webhook_conflict' AND entity_id = $1`,
      [row?.id],
    );
    expect(audit).toHaveLength(1);
    // An exact repeat is not a conflict.
    await h.deliver(one);
    expect(
      await h.rows(
        `SELECT 1 FROM audit_log WHERE action = 'payment.webhook_conflict' AND entity_id = $1`,
        [row?.id],
      ),
    ).toHaveLength(1);
  });

  it('refuses a notification addressed to a gateway that is not the configured one', async () => {
    const note = h.gateway.buildNotification({
      type: 'PAYMENT_FAILED',
      merchantReference: 'x',
      amountPaise: 1n,
    });
    await expect(
      import('@labconnect/database').then(({ withDbContext }) =>
        withDbContext(h.api(), { kind: 'system' }, (tx) =>
          h.service.recordGatewayEvent(tx, {
            gateway: 'ICICI',
            headers: note.headers,
            body: note.body,
          }),
        ),
      ),
    ).rejects.toThrow(RangeError);
  });

  it('stores the raw body encrypted, bound to its row, and readable back', async () => {
    const { ref } = await pending();
    const note = h.gateway.completePayment(ref, { eventId: 'intake-enc-1' });
    await h.deliver(note);
    const [row] = await h.rows<{ id: string; payload_ciphertext: Buffer; payload_sha256: Buffer }>(
      `SELECT id::text AS id, payload_ciphertext, payload_sha256 FROM gateway_webhook_event WHERE event_id = 'intake-enc-1'`,
    );
    expect(row?.payload_ciphertext.includes(Buffer.from('fakeAmountPaise'))).toBe(false);
    expect(row?.payload_ciphertext.includes(Buffer.from('fake_pay_'))).toBe(false);
    const plain = Buffer.from(
      await h.cipher.decrypt(
        row?.payload_ciphertext ?? Buffer.alloc(0),
        payloadContext(row?.id ?? ''),
      ),
    );
    expect(plain.equals(note.body)).toBe(true);
    // Copied to another row it no longer decrypts.
    await expect(
      h.cipher.decrypt(row?.payload_ciphertext ?? Buffer.alloc(0), payloadContext('other')),
    ).rejects.toThrow();
    expect(row?.payload_sha256.equals(createHash('sha256').update(note.body).digest())).toBe(true);
  });

  it('keeps secrets, signatures and raw payloads out of every table it writes', async () => {
    const { orderId, ref } = await pending();
    const note = h.gateway.completePayment(ref, { eventId: 'intake-secrets-1' });
    await h.deliver(note);
    await h.deliver({
      headers: { ...note.headers, [FAKE_SIGNATURE_HEADER]: 'cd'.repeat(32) },
      body: note.body,
    });
    await h.processAll();
    const signature = note.headers[FAKE_SIGNATURE_HEADER] ?? '';
    const forbidden = [
      FAKE_SECRET,
      signature,
      'fakeAmountPaise',
      'fakeMerchantReference',
      'customer@example.test',
    ];
    const dumps = await Promise.all([
      h.rows<{ t: string }>(
        `SELECT row_to_json(g)::text AS t FROM (SELECT id, gateway, event_id, event_type, signature_valid, processing_status, error FROM gateway_webhook_event) g`,
      ),
      h.rows<{ t: string }>(`SELECT row_to_json(a)::text AS t FROM audit_log a`),
      h.rows<{ t: string }>(`SELECT row_to_json(o)::text AS t FROM outbox_event o`),
      h.rows<{ t: string }>(`SELECT row_to_json(p)::text AS t FROM payment_transaction p`),
      h.rows<{ t: string }>(
        `SELECT row_to_json(p)::text AS t FROM payment_order p WHERE id = '${orderId}'`,
      ),
    ]);
    for (const dump of dumps) {
      for (const row of dump) {
        for (const word of forbidden) expect(row.t).not.toContain(word);
      }
    }
  });
});
