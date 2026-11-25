import { type PrismaClient, withDbContext } from '@labconnect/database';
import type { FileScanProcessor } from './scan-processor.js';
import { deterministicScanEventId, type MalwareScanner } from './scanner.js';
import type { ObjectStorage } from './storage.js';

/** Set to `true` to let the worker scan quarantined uploads itself. Local development only. */
export const DEV_AUTO_SCAN_VARIABLE = 'FILES_DEV_AUTO_SCAN';

export class DevScanForbiddenError extends Error {
  override name = 'DevScanForbiddenError';
}

/**
 * The dev-only scan path stands in for GuardDuty, which is not built yet (OQ-116), and its
 * scanner is a fake. It must never run where real files are handled, so it refuses to start
 * unless `NODE_ENV` is explicitly `development` or `test`: `production` is refused, and so is
 * an unset or unknown value (a deployment that forgot `NODE_ENV` must not get a fake scanner).
 * A local worker therefore needs `NODE_ENV=development`.
 */
export function assertDevScanAllowed(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new DevScanForbiddenError(
      `The dev-only file scan needs NODE_ENV=development or test (it is ${env.NODE_ENV ?? 'unset'}).`,
    );
  }
}

/**
 * Whether the dev scan is switched on. `false` unless `FILES_DEV_AUTO_SCAN=true`; when it is
 * switched on in an environment that is not development or test, throws
 * (`DevScanForbiddenError`) so the worker refuses to start instead of quietly ignoring it.
 */
export function isDevScanEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env[DEV_AUTO_SCAN_VARIABLE] !== 'true') return false;
  assertDevScanAllowed(env);
  return true;
}

export const FILES_SCANNER_VARIABLE = 'FILES_SCANNER';
export type FilesScannerMode = 'guardduty' | 'fake';

/**
 * Which scanner the worker trusts: `guardduty` (the default, and the only one that may run
 * in production: results come from GuardDuty Malware Protection for S3 through the queue) or
 * `fake` (development and test only). Fails fast, so a worker does not start in a state
 * that would be unsafe:
 *   - `fake` outside `NODE_ENV` development or test (production, unset or unknown) throws
 *     `DevScanForbiddenError`; production never runs with the fake scanner, not even by a
 *     forgotten variable;
 *   - an unknown value throws;
 *   - `FILES_DEV_AUTO_SCAN=true` with an explicit `FILES_SCANNER=guardduty` is a contradiction
 *     and throws; with `FILES_SCANNER` unset it selects `fake` (and is itself refused outside
 *     development and test).
 */
export function readFilesScannerMode(
  env: Record<string, string | undefined> = process.env,
): FilesScannerMode {
  const raw = env[FILES_SCANNER_VARIABLE];
  const devScan = env[DEV_AUTO_SCAN_VARIABLE] === 'true';
  let mode: FilesScannerMode;
  if (raw === undefined || raw === '') {
    mode = devScan ? 'fake' : 'guardduty';
  } else if (raw === 'guardduty' || raw === 'fake') {
    mode = raw;
  } else {
    throw new RangeError(`${FILES_SCANNER_VARIABLE} must be "guardduty" or "fake".`);
  }
  if (mode === 'fake') assertDevScanAllowed(env);
  if (devScan && mode !== 'fake') {
    throw new RangeError(
      `${DEV_AUTO_SCAN_VARIABLE}=true needs ${FILES_SCANNER_VARIABLE}=fake (or leave it unset).`,
    );
  }
  return mode;
}

export interface DevScanDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  storage: ObjectStorage;
  scanner: MalwareScanner;
  processor: FileScanProcessor;
}

export interface DevScanRunResult {
  scanned: number;
  failed: number;
}

/**
 * Local development: finds uploads still `PENDING` whose object has arrived (a head check),
 * asks the scanner (the fake, in practice) and feeds the verdict through the same
 * `FileScanProcessor` the queue consumer uses, so a local upload goes through the real
 * validation, hashing and promotion. The constructor re-checks `NODE_ENV`, so a runner cannot
 * even be built in production. Never used by tests of the production path.
 */
export class DevScanRunner {
  constructor(
    private readonly deps: DevScanDeps,
    env: Record<string, string | undefined> = process.env,
  ) {
    assertDevScanAllowed(env);
  }

  async runOnce(batchSize = 50): Promise<DevScanRunResult> {
    const { prisma, storage, scanner, processor } = this.deps;
    const pending = await withDbContext(prisma, { kind: 'system' }, (tx) =>
      tx.fileObject.findMany({
        where: { scanStatus: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
        select: { id: true, bucket: true, objectKey: true },
      }),
    );
    let scanned = 0;
    let failed = 0;
    for (const file of pending) {
      try {
        const head = await storage.head(file.bucket, file.objectKey);
        if (!head) continue; // not uploaded yet
        const result = await scanner.scan({ bucket: file.bucket, key: file.objectKey });
        await processor.handle({
          eventId: deterministicScanEventId(file.id, result.verdict),
          fileId: file.id,
          verdict: result.verdict,
        });
        scanned += 1;
      } catch {
        failed += 1; // counted, not logged: the next pass tries again
      }
    }
    return { scanned, failed };
  }
}
