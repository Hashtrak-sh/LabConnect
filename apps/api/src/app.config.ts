import type { INestApplication } from '@nestjs/common';

/** HTTP settings shared by the real server and the API tests. */
export function configureApp(app: INestApplication): void {
  // API_CONVENTIONS: every route lives under /v1.
  app.setGlobalPrefix('v1');
}
