import type { INestApplication } from '@nestjs/common';
import {
  ProblemExceptionFilter,
  notFoundOutsidePrefix,
} from './common/problem-exception.filter.js';
import { requestContextMiddleware } from './common/request-context.js';

const API_PREFIX = 'v1';

/** HTTP settings shared by the real server and the API tests. */
export function configureApp(app: INestApplication): void {
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
