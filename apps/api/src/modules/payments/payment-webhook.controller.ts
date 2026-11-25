import {
  Controller,
  HttpCode,
  Inject,
  Logger,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common';
import { PaymentsRuntime, TenantScope } from '@labconnect/core';
import type { Request } from 'express';
import { DomainError } from '../../common/domain-error.js';
import { getRequestContext } from '../../common/request-context.js';

/** The most a gateway notification may weigh. Bigger is refused before it is read in full. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/**
 * `POST /v1/webhooks/payments/{gateway}`: the gateway's server-to-server callback
 * (`receivePaymentWebhook`, ERROR_HANDLING.md section 3). No bearer token, membership or
 * idempotency key: the adapter authenticates the callback by its signature.
 *
 * What it does, in order: refuse a gateway that is not enabled here with a 404 (the same
 * 404 for a name that does not exist, so nothing is learnt); take the body exactly as it
 * arrived; hand it to the intake in one transaction in the system context (the webhook
 * module is one of the places OQ-30 allows it); and only after that commits answer 200 with
 * an empty body. Whether the signature verified, whether the event was new, and whether any
 * order matches is never in the answer. If the event could not be stored the request
 * fails (500) so that the gateway's retry delivers it again.
 */
@Controller('webhooks/payments')
export class PaymentWebhookController {
  private readonly logger = new Logger('PaymentWebhook');

  constructor(
    @Inject(PaymentsRuntime) private readonly payments: PaymentsRuntime,
    @Inject(TenantScope) private readonly scope: TenantScope,
  ) {}

  @Post(':gateway')
  @HttpCode(200)
  async receive(@Param('gateway') gateway: string, @Req() request: Request): Promise<void> {
    // 404 for anything but the configured gateway, FAKE never being enabled in production
    // (the runtime refused to start otherwise).
    const configured = this.payments.gatewayCode;
    if (gateway !== configured) throw new DomainError('NOT_FOUND');

    const body = await readBody(request);
    const requestId = getRequestContext()?.requestId;
    try {
      // No user and no tenant yet: the notification is stored before anything is matched.
      await this.scope.runAsSystem('payment gateway notification intake', (tx) =>
        this.payments.service.recordGatewayEvent(tx, {
          gateway: configured,
          headers: lowerCaseHeaders(request),
          body,
          ...(requestId !== undefined && { requestId }),
        }),
      );
    } catch (error) {
      // Names the failure, never the request: it carries a payment payload and a signature.
      this.logger.error(
        `Could not store a payment gateway notification (${error instanceof Error ? error.name : 'error'}).`,
      );
      throw error;
    }
  }
}

/** Headers as a plain lower-case map, for verification only. Never stored or logged. */
function lowerCaseHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

/**
 * The raw bytes of the body. JSON and form bodies are not parsed on this route (see
 * `configureApp`), so the stream is still unread; it is read here with a size limit.
 */
async function readBody(request: Request): Promise<Buffer> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_WEBHOOK_BODY_BYTES) throw tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function tooLarge(): PayloadTooLargeException {
  return new PayloadTooLargeException();
}
