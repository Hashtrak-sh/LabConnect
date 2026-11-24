import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
}

@Injectable()
export class HealthService {
  /** Liveness only. Dependency checks (database, Redis, queues) come with Phase 3. */
  check(): HealthStatus {
    return { status: 'ok' };
  }
}
