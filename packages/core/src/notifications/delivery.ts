import { type Prisma, type PrismaClient, withDbContext } from '@labconnect/database';
import { loadUserContact } from '../identity/recipients.js';
import type { Clock } from '../platform/clock.js';
import { type EmailMessage, type EmailSender, EmailSendError } from './email-sender.js';
import { renderEmailFor } from './stored-templates.js';
import { TEMPLATE_VARIABLES, type TemplateData, type TemplateVariable } from './templates.js';

export const DEFAULT_DELIVERY_BATCH_SIZE = 25;
/** An email that fails this many times is marked FAILED and left for a person. */
export const DEFAULT_DELIVERY_MAX_ATTEMPTS = 5;
/**
 * How long a claimed email is reserved for its sender. A second worker does not take it before
 * this has passed, so the send (a network call of seconds) must be much shorter.
 */
export const DEFAULT_DELIVERY_LEASE_MS = 10 * 60 * 1000;
const BACKOFF_BASE_MS = 2 * 60 * 1000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;
const MAX_ERROR_LENGTH = 300;

export interface DeliveryDeps {
  /** The worker's client (role `app_worker`). */
  prisma: Pick<PrismaClient, '$transaction'>;
  clock: Clock;
  sender: EmailSender;
  /** The web app's base URL (`https://app.example`): links in emails are this plus a path of ids. */
  webBaseUrl: string;
}

export interface DeliveryOptions {
  batchSize?: number;
  maxAttempts?: number;
  leaseMs?: number;
}

export interface DeliveryResult {
  sent: number;
  /** The send failed; the email stays QUEUED for a later pass. */
  retried: number;
  /** The send failed for the last time (or permanently); the email is now FAILED. */
  failed: number;
  /** Not sent on purpose: the user is gone or disabled, or there is no email template. */
  suppressed: number;
}

/** Backoff after the n-th failed attempt: 2, 4, 8, ... minutes, at most an hour. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), BACKOFF_MAX_MS);
}

/** What a failure leaves in `notification.error`: the error's kind, never a message body or an address. */
function describeFailure(error: unknown): string {
  const kind = error instanceof Error ? error.name : 'Error';
  const detail = error instanceof EmailSendError ? error.message : 'the send failed';
  return `${kind}: ${detail}`.slice(0, MAX_ERROR_LENGTH);
}

/** Reads the stored payload as template data: only known variable names, only strings. */
export function templateDataFromPayload(payload: unknown, webBaseUrl: string): TemplateData {
  const source =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const data: Partial<Record<TemplateVariable, string>> = {};
  for (const name of TEMPLATE_VARIABLES) {
    const value = source[name];
    if (typeof value === 'string' && value !== '') data[name] = value;
  }
  if (data.actionUrl !== undefined) {
    data.actionUrl = data.actionUrl.startsWith('/')
      ? `${webBaseUrl.replace(/\/+$/, '')}${data.actionUrl}`
      : data.actionUrl;
  }
  return data;
}

interface Claimed {
  id: string;
  attempts: number;
  message: EmailMessage;
}

type Claim =
  | { kind: 'none' }
  | { kind: 'suppressed' }
  | { kind: 'exhausted' }
  | { kind: 'send'; claim: Claimed };

interface QueuedRow {
  id: string;
  recipient_user_id: string;
  event_code: string;
  template_version: number;
  payload: unknown;
  delivery_attempts: number;
}

/**
 * The delivery pass: sends the emails that notification rows are waiting for. Run by the worker
 * every few seconds.
 *
 * Structure, for each email, in three steps that never hold a database transaction open
 * across the network call:
 * 1. Claim (one short system transaction): `SELECT ... WHERE channel = 'EMAIL' AND status =
 *    'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= now) ORDER BY created_at, id
 *    LIMIT 1 FOR UPDATE SKIP LOCKED`. While it holds the row lock the transaction counts the
 *    attempt, moves `next_attempt_at` a lease into the future, reads the recipient's address and
 *    renders the message, then commits. The lease is the claim: another worker's select skips the
 *    row while it is locked and, after the commit, does not see it as due until the lease ends.
 *    (`timers.ts` solves the same problem by keeping the transaction open through the handler;
 *    that is right for a database-only handler and wrong for a network call.)
 * 2. Send, outside any transaction, through the `EmailSender` port.
 * 3. Mark (one short system transaction): SENT with the provider's id, or, on failure, QUEUED
 *    again with `next_attempt_at` after a backoff, or FAILED when the attempts are used up or the
 *    provider refused the message for good. Both updates only touch a row that is still QUEUED.
 *
 * Guarantees and the edge: a row marked SENT is never selected again, so it is never sent twice by
 * the pass. The one window left is a crash (or a lease that runs out during a very slow send)
 * between a successful send and step 3: the row is still QUEUED, so after the lease it is sent
 * again. Delivery is at least once; the message carries the notification id in a header to make
 * a duplicate recognisable. The attempt is counted at claim time, so a worker that keeps crashing
 * on one row cannot loop for ever: at the cap the row becomes FAILED without a send.
 *
 * Failures store the kind of error, truncated; never the message body, the address or the
 * provider's response.
 */
export async function runEmailDeliveries(
  deps: DeliveryDeps,
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const batchSize = options.batchSize ?? DEFAULT_DELIVERY_BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_DELIVERY_MAX_ATTEMPTS;
  const leaseMs = options.leaseMs ?? DEFAULT_DELIVERY_LEASE_MS;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize must be a positive integer.');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer.');
  }
  if (!Number.isInteger(leaseMs) || leaseMs < 1000) {
    throw new RangeError('leaseMs must be at least 1000.');
  }

  const result: DeliveryResult = { sent: 0, retried: 0, failed: 0, suppressed: 0 };
  for (let handled = 0; handled < batchSize; handled += 1) {
    const claimed = await withDbContext(
      deps.prisma,
      { kind: 'system' },
      (tx) => claimNext(tx, deps, maxAttempts, leaseMs),
      { maxWait: 30_000, timeout: 60_000 },
    );
    if (claimed.kind === 'none') break;
    if (claimed.kind === 'suppressed') {
      result.suppressed += 1;
      continue;
    }
    if (claimed.kind === 'exhausted') {
      result.failed += 1;
      continue;
    }

    const { claim } = claimed;
    let sendError: unknown;
    let providerMessageId: string | null = null;
    try {
      providerMessageId = (await deps.sender.send(claim.message)).providerMessageId;
    } catch (error) {
      sendError = error;
    }

    const now = deps.clock.now();
    if (sendError === undefined) {
      await withDbContext(deps.prisma, { kind: 'system' }, async (tx) => {
        await tx.notification.updateMany({
          where: { id: claim.id, status: 'QUEUED' },
          data: {
            status: 'SENT',
            sentAt: now,
            providerMessageId,
            error: null,
            nextAttemptAt: null,
          },
        });
      });
      result.sent += 1;
      continue;
    }

    const permanent = sendError instanceof EmailSendError && sendError.permanent;
    const final = permanent || claim.attempts >= maxAttempts;
    await withDbContext(deps.prisma, { kind: 'system' }, async (tx) => {
      await tx.notification.updateMany({
        where: { id: claim.id, status: 'QUEUED' },
        data: {
          status: final ? 'FAILED' : 'QUEUED',
          error: describeFailure(sendError),
          nextAttemptAt: final ? null : new Date(now.getTime() + backoffMs(claim.attempts)),
        },
      });
    });
    if (final) result.failed += 1;
    else result.retried += 1;
  }
  return result;
}

async function claimNext(
  tx: Prisma.TransactionClient,
  deps: DeliveryDeps,
  maxAttempts: number,
  leaseMs: number,
): Promise<Claim> {
  const now = deps.clock.now();
  const rows = await tx.$queryRaw<QueuedRow[]>`
    SELECT id::text AS id, recipient_user_id::text AS recipient_user_id, event_code,
           template_version, payload, delivery_attempts
      FROM notification
     WHERE channel = 'EMAIL' AND status = 'QUEUED'
       AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
     ORDER BY created_at, id
     LIMIT 1
       FOR UPDATE SKIP LOCKED`;
  const row = rows[0];
  if (!row) return { kind: 'none' };

  if (row.delivery_attempts >= maxAttempts) {
    await tx.notification.update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        error: 'Abandoned: the attempts were used up without a recorded outcome.',
        nextAttemptAt: null,
      },
    });
    return { kind: 'exhausted' };
  }

  const contact = await loadUserContact(tx, row.recipient_user_id);
  const rendered =
    contact && contact.status !== 'DISABLED'
      ? await renderEmailFor(tx, {
          eventCode: row.event_code,
          templateVersion: row.template_version,
          data: templateDataFromPayload(row.payload, deps.webBaseUrl),
        })
      : null;
  if (!contact || contact.status === 'DISABLED' || !rendered) {
    await tx.notification.update({
      where: { id: row.id },
      data: {
        status: 'SUPPRESSED',
        error:
          !contact || contact.status === 'DISABLED'
            ? 'The recipient cannot receive email.'
            : 'No email template.',
        nextAttemptAt: null,
      },
    });
    return { kind: 'suppressed' };
  }

  const attempts = row.delivery_attempts + 1;
  await tx.notification.update({
    where: { id: row.id },
    data: { deliveryAttempts: attempts, nextAttemptAt: new Date(now.getTime() + leaseMs) },
  });
  return {
    kind: 'send',
    claim: {
      id: row.id,
      attempts,
      message: {
        to: contact.email,
        subject: rendered.content.subject,
        text: rendered.content.text,
        html: rendered.content.html,
        notificationId: row.id,
      },
    },
  };
}
