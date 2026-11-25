import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ProblemExceptionFilter,
  notFoundOutsidePrefix,
} from './common/problem-exception.filter.js';
import { requestContextMiddleware } from './common/request-context.js';

const API_PREFIX = 'v1';

/** HTTP settings shared by the real server and the API tests. */
export function configureApp(app: INestApplication): void {
  // Behind a load balancer every request arrives from the balancer's address, so the client
  // address (the per-IP OTP limit, session and audit records) is read from X-Forwarded-For. Say
  // how many proxies to trust; unset means none, and a client header is never believed.
  const proxies = Number(process.env.API_TRUST_PROXY_HOPS ?? 0);
  if (Number.isInteger(proxies) && proxies > 0) {
    (app as NestExpressApplication).set('trust proxy', proxies);
  }
  // API_CONVENTIONS §4: X-Request-Id echoed or generated on every response, 404s included.
  // Registered first so it runs before routing and body parsing.
  app.use(requestContextMiddleware);
  // Paths outside /v1 never reach Nest's router; answer them with the problem shape too.
  app.use(notFoundOutsidePrefix(API_PREFIX));
  // ERROR_HANDLING §1: every error is the problem shape.
  app.useGlobalFilters(new ProblemExceptionFilter());
  // API_CONVENTIONS: every route lives under /v1.
  app.setGlobalPrefix(API_PREFIX);
}
