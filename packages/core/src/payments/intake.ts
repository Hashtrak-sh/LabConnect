import { createHash } from 'node:crypto';
import { type Prisma, uuidv7 } from '@labconnect/database';
import {
  GATEWAY_EVENT_AGGREGATE,
  PAYMENT_EVENTS,
  type IntakeResult,
  type PaymentServiceDeps,
  type RecordGatewayEventInput,
} from './types.js';
import type { GatewayEvent } from './gateway.js';

const MAX_EVENT_ID = 100;

/** The context that ties an encrypted body to its row (authenticated data of the cipher). */
export function payloadContext(rowId: string): string {
  return `gateway_webhook_event:${rowId}`;
}

interface NewRow {
  eventId: string;
  eventType: string;
  signatureValid: boolean;
  /** Set for a row that is stored but never processed. */
  rejection?: string;
}

/**
 * Webhook intake (PAYMENTS_AND_LEDGER.md section 2; ICICI_PAYMENT_INTEGRATION.md section 4;
 * ERROR_HANDLING.md section 3; contract `receivePaymentWebhook`).
 *
 * Stores the raw body, encrypted and hashed, as one `gateway_webhook_event` row per event in
 * it, and says nothing else: it neither moves a payment order nor touches a booking. The
 * caller acknowledges the gateway only after this transaction commits.
 *
 * - The adapter verifies the signature (the platform never judges a signature itself). A
 *   notification that is not authentic is still stored, once, as `signature_valid = false`
 *   with status `IGNORED` and a synthetic event id made from the body's hash, so a replay of
 *   the same bytes is not stored twice. It is never processed.
 * - Each authentic event is stored under the gateway's own event id. `ON CONFLICT DO NOTHING`
 *   on (`gateway`, `event_id`) makes a duplicate, including two racing in parallel, a
 *   no-op. A second delivery with the same id but different bytes changes nothing and writes
 *   an audit row (`payment.webhook_conflict`).
 * - Newly stored authentic events raise `payment.gateway_event_received` (ids only) in the
 *   same transaction. The worker finds them by their `RECEIVED` status.
 *
 * Run it in the system context (`withDbContext(prisma, { kind: 'system' }, ...)`):
 * `gateway_webhook_event` is readable and writable only there (OQ-30). Nothing sent by the
 * caller is trusted: headers are used to verify and then dropped, never stored or logged.
 */
export async function recordGatewayEvent(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  input: RecordGatewayEventInput,
): Promise<IntakeResult> {
  if (input.gateway !== deps.gateway.code) {
    throw new RangeError('The gateway of the notification is not the configured gateway.');
  }
  const hash = createHash('sha256').update(input.body).digest();
  const syntheticId = (prefix: string): string => `${prefix}:${hash.toString('hex').slice(0, 40)}`;

  let verification: Awaited<ReturnType<typeof deps.gateway.verifyAndParseWebhook>>;
  try {
    verification = await deps.gateway.verifyAndParseWebhook({
      headers: input.headers,
      body: input.body,
    });
  } catch {
    // An adapter that throws is treated as "not authentic": the gateway still gets its 2xx.
    verification = { valid: false, events: [] };
  }

  const rows: NewRow[] = [];
  if (!verification.valid) {
    rows.push({
      eventId: syntheticId('invalid'),
      eventType: 'UNVERIFIED',
      signatureValid: false,
      rejection: 'SIGNATURE_INVALID',
    });
  } else if (verification.events.length === 0) {
    rows.push({
      eventId: syntheticId('unparsed'),
      eventType: 'UNPARSED',
      signatureValid: true,
      rejection: 'NO_USABLE_EVENTS',
    });
  } else {
    const seen = new Set<string>();
    for (const event of verification.events) {
      if (!eventIdIsUsable(event) || seen.has(event.gatewayEventId)) {
        rows.push({
          eventId: syntheticId('badid'),
          eventType: 'UNPARSED',
          signatureValid: true,
          rejection: 'EVENT_ID_UNUSABLE',
        });
        continue;
      }
      seen.add(event.gatewayEventId);
      rows.push({
        eventId: event.gatewayEventId,
        eventType: event.type,
        signatureValid: true,
      });
    }
  }

  let stored = 0;
  let duplicates = 0;
  let received = 0;
  const now = deps.clock.now();
  for (const row of rows) {
    const id = uuidv7(now.getTime());
    const ciphertext = Buffer.from(await deps.cipher.encrypt(input.body, payloadContext(id)));
    const processed = row.rejection === undefined ? null : now;
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO gateway_webhook_event
        (id, gateway, event_id, event_type, signature_valid, received_at, payload_ciphertext,
         payload_sha256, processing_status, processed_at, error)
      VALUES (${id}::uuid, ${input.gateway}::gateway_code, ${row.eventId}, ${row.eventType},
              ${row.signatureValid}, ${now}, ${ciphertext}, ${hash},
              ${row.rejection === undefined ? 'RECEIVED' : 'IGNORED'}::webhook_processing_status,
              ${processed}, ${row.rejection ?? null})
      ON CONFLICT (gateway, event_id) DO NOTHING
      RETURNING id::text AS id`;
    if (inserted.length === 0) {
      duplicates += 1;
      await auditConflict(deps, tx, input, row.eventId, hash);
      continue;
    }
    stored += 1;
    if (row.rejection === undefined) {
      received += 1;
      await deps.outbox.enqueue(tx, {
        type: PAYMENT_EVENTS.gatewayEventReceived,
        aggregate: { type: GATEWAY_EVENT_AGGREGATE, id },
        actor: 'SYSTEM',
        data: { gatewayEventRowId: id, gateway: input.gateway, eventType: row.eventType },
      });
    }
  }

  const outcome =
    received > 0 ? 'ACCEPTED' : stored > 0 || duplicates === 0 ? 'REJECTED' : 'DUPLICATE';
  return { outcome, stored, duplicates };
}

function eventIdIsUsable(event: GatewayEvent): boolean {
  return event.gatewayEventId.length > 0 && event.gatewayEventId.length <= MAX_EVENT_ID;
}

/** The same event id arrived again with other bytes: keep the first, leave a trace of the second. */
async function auditConflict(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  input: RecordGatewayEventInput,
  eventId: string,
  hash: Buffer,
): Promise<void> {
  const existing = await tx.$queryRaw<{ id: string; same: boolean }[]>`
    SELECT id::text AS id, payload_sha256 = ${hash} AS same
      FROM gateway_webhook_event
     WHERE gateway = ${input.gateway}::gateway_code AND event_id = ${eventId}`;
  const row = existing[0];
  if (!row || row.same) return;
  await deps.audit.record(tx, {
    actor: 'SYSTEM',
    action: 'payment.webhook_conflict',
    entityType: GATEWAY_EVENT_AGGREGATE,
    entityId: row.id,
    reason: 'A notification with a known event id arrived with different content.',
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
  });
}
