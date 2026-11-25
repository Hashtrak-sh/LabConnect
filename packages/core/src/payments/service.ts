import { type Prisma, type PrismaClient, withDbContext } from '@labconnect/database';
import {
  createPaymentAttempt,
  openPaymentCheckout,
  type CreateAttemptInput,
  type CreateAttemptResult,
  type OpenCheckoutInput,
  type OpenCheckoutResult,
} from './attempts.js';
import { recordGatewayEvent } from './intake.js';
import { processGatewayEvent } from './processing.js';
import type {
  IntakeResult,
  PaymentServiceDeps,
  ProcessResult,
  RecordGatewayEventInput,
} from './types.js';

export const DEFAULT_PAYMENT_EVENT_BATCH_SIZE = 25;

export interface ProcessPendingOptions {
  batchSize?: number;
  /** Row ids not to select. The pass adds every row it takes, so repeated passes of one run do not retry a failing row. */
  skipIds?: Set<string>;
}

export interface ProcessPendingResult {
  processed: number;
  ignored: number;
  /** Needs a person (the exception path). */
  exceptions: number;
  /** A transient error: rolled back, still `RECEIVED`, retried on a later run. */
  retried: number;
}

/**
 * The payments module's public commands (MODULE_BOUNDARIES.md: `PaymentService`), over the
 * deps the app wires. Framework-free; the API wraps `startPayment` and the webhook, the
 * worker wraps `processPending`.
 */
export class PaymentService {
  constructor(private readonly deps: PaymentServiceDeps) {}

  get gatewayCode(): PaymentServiceDeps['gateway']['code'] {
    return this.deps.gateway.code;
  }

  /** Phase 1 of starting a payment, in the caller's tenant transaction. See `createPaymentAttempt`. */
  createAttempt(
    tx: Prisma.TransactionClient,
    input: CreateAttemptInput,
  ): Promise<CreateAttemptResult> {
    return createPaymentAttempt(this.deps, tx, input);
  }

  /** Phase 2, in its own tenant transaction. See `openPaymentCheckout`. */
  openCheckout(
    tx: Prisma.TransactionClient,
    input: OpenCheckoutInput,
  ): Promise<OpenCheckoutResult> {
    return openPaymentCheckout(this.deps, tx, input);
  }

  /** Webhook intake, in the system context. See `recordGatewayEvent`. */
  recordGatewayEvent(
    tx: Prisma.TransactionClient,
    input: RecordGatewayEventInput,
  ): Promise<IntakeResult> {
    return recordGatewayEvent(this.deps, tx, input);
  }

  /** Processes one stored notification, in the system context. See `processGatewayEvent`. */
  processGatewayEvent(tx: Prisma.TransactionClient, rowId: string): Promise<ProcessResult> {
    return processGatewayEvent(this.deps, tx, rowId);
  }

  /**
   * The worker pass: processes stored notifications that are `RECEIVED`, oldest first, one
   * transaction each in the system context (`FOR UPDATE SKIP LOCKED` is the claim, so two
   * workers never take the same row). A failing row is rolled back on its own and counted;
   * it does not stop the others. Only `RECEIVED` rows are taken: a row marked `FAILED` is an
   * exception for a person and is never retried automatically.
   */
  async processPending(
    prisma: Pick<PrismaClient, '$transaction'>,
    options: ProcessPendingOptions = {},
  ): Promise<ProcessPendingResult> {
    const batchSize = options.batchSize ?? DEFAULT_PAYMENT_EVENT_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError('batchSize must be a positive integer.');
    }
    const seen = options.skipIds ?? new Set<string>();
    const result: ProcessPendingResult = { processed: 0, ignored: 0, exceptions: 0, retried: 0 };
    for (let handled = 0; handled < batchSize; handled += 1) {
      let claimed: string | undefined;
      try {
        const outcome = await withDbContext(
          prisma,
          { kind: 'system' },
          async (tx) => {
            const next = await tx.$queryRaw<{ id: string }[]>`
              SELECT id::text AS id FROM gateway_webhook_event
               WHERE processing_status = 'RECEIVED' AND signature_valid
                 AND id <> ALL (${[...seen]}::text[]::uuid[])
               ORDER BY received_at, id
               LIMIT 1
                 FOR UPDATE SKIP LOCKED`;
            const id = next[0]?.id;
            if (id === undefined) return undefined;
            claimed = id;
            seen.add(id);
            return this.processGatewayEvent(tx, id);
          },
          { maxWait: 30_000, timeout: 120_000 },
        );
        if (outcome === undefined) break;
        if (outcome.status === 'PROCESSED') result.processed += 1;
        else if (outcome.status === 'FAILED') result.exceptions += 1;
        else if (outcome.status === 'IGNORED') result.ignored += 1;
      } catch {
        // Only the error's existence is kept: it can carry payment data, so it is not logged here.
        if (claimed !== undefined) result.retried += 1;
        else throw new Error('Reading the stored gateway notifications failed.');
      }
    }
    return result;
  }
}
