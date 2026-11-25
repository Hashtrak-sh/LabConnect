import { createHash } from 'node:crypto';
import type { EventEnvelope } from '../platform/events.js';
import { type FilesConfig, isQuarantineKey } from './keys.js';
import { ObjectNotFoundError, type ObjectStorage } from './storage.js';

/**
 * The outcome of a malware scan of one quarantined object: the platform's own type, not
 * GuardDuty's. `ERROR` means the scan did not complete (the scanner failed or timed out),
 * which is never treated as clean.
 */
export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'ERROR';

export interface ScanResult {
  bucket: string;
  key: string;
  verdict: ScanVerdict;
}

/** Scans one object. Anything that is not a definite `CLEAN` must come back as another verdict. */
export interface MalwareScanner {
  scan(object: { bucket: string; key: string }): Promise<ScanResult>;
}

/** The text a test (or a curious developer) puts in a file to make `FakeMalwareScanner` call it infected. */
export const FAKE_INFECTED_MARKER = 'LABCONNECT-FAKE-MALWARE-TEST-STRING';
const FAKE_SCAN_SAMPLE_BYTES = 1024 * 1024;

/**
 * Deterministic scanner for tests and local development: an object is infected when its
 * first megabyte contains `FAKE_INFECTED_MARKER` or its key was passed to `infect`, errored
 * when its key was passed to `failOn` or it is missing, and clean otherwise. It is not a
 * security control and `createDevScanJob` refuses to run in production.
 */
export class FakeMalwareScanner implements MalwareScanner {
  private readonly infected = new Set<string>();
  private readonly failing = new Set<string>();
  readonly scanned: string[] = [];

  constructor(private readonly storage: ObjectStorage) {}

  infect(key: string): void {
    this.infected.add(key);
  }

  failOn(key: string): void {
    this.failing.add(key);
  }

  async scan(object: { bucket: string; key: string }): Promise<ScanResult> {
    this.scanned.push(object.key);
    const result = (verdict: ScanVerdict): ScanResult => ({ ...object, verdict });
    if (this.failing.has(object.key)) return result('ERROR');
    if (this.infected.has(object.key)) return result('INFECTED');
    try {
      const sample = await this.storage.read(object.bucket, object.key, {
        maxBytes: FAKE_SCAN_SAMPLE_BYTES * 64,
      });
      const head = Buffer.from(sample.subarray(0, FAKE_SCAN_SAMPLE_BYTES));
      return result(head.includes(FAKE_INFECTED_MARKER) ? 'INFECTED' : 'CLEAN');
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return result('ERROR');
      throw error;
    }
  }
}

// --------------------------------------------------------------------------- GuardDuty

/**
 * STUB. GuardDuty Malware Protection for S3 on the quarantine prefix is the chosen scanner
 * (ADR-010, FILES_AND_REPORTS.md section 1 step 3), but no document gives the shape of its
 * result event or says how it reaches the `lc-files` queue (only "The result event →
 * `lc-files` queue"). Inventing the event's fields from memory could mark an infected file
 * clean, so this adapter does nothing and says so. OQ-116 records the gap. Until it is
 * built, files become available only through the dev-only scan job (`createDevScanJob`,
 * refused in production), which means that no file can become available in production yet.
 */
export class GuardDutyMalwareScanner implements MalwareScanner {
  scan(): Promise<ScanResult> {
    return Promise.reject(new Error(GUARDDUTY_NOT_CONFIGURED));
  }
}

export const GUARDDUTY_NOT_CONFIGURED =
  'GuardDuty Malware Protection for S3 is not configured: the result event is not specified yet (OQ-116).';

/** STUB. See `GuardDutyMalwareScanner`. Throws for every input. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the stub keeps the shape of the parser it stands for
export function parseGuardDutyScanResultEvent(_event: unknown): ScanResult {
  throw new Error(GUARDDUTY_NOT_CONFIGURED);
}

// --------------------------------------------------------------------------- queue message

/** Event type of a scan result on the `lc-files` queue. */
export const FILE_SCAN_RESULT_EVENT = 'file.scan_result';

export interface ScanResultMessage {
  /** The id `processOnce` deduplicates on. One per scan result; a redelivery carries the same one. */
  eventId: string;
  fileId: string;
  verdict: ScanVerdict;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERDICTS: ReadonlySet<string> = new Set<ScanVerdict>(['CLEAN', 'INFECTED', 'ERROR']);

export class MalformedScanMessageError extends Error {
  override name = 'MalformedScanMessageError';
}

/**
 * The scan-result message is an `EventEnvelope` of type `file.scan_result` whose `data` is
 * `{ fileId, verdict }`. Whatever turns the scanner's output into a queue message (OQ-116)
 * produces this; the consumer needs nothing else from the scanner.
 */
export function buildScanResultEnvelope(
  message: ScanResultMessage,
  occurredAt: Date,
): EventEnvelope {
  return {
    id: message.eventId,
    type: FILE_SCAN_RESULT_EVENT,
    version: 1,
    occurredAt: occurredAt.toISOString(),
    aggregate: { type: 'file_object', id: message.fileId },
    actor: 'SYSTEM',
    data: { fileId: message.fileId, verdict: message.verdict },
  };
}

/**
 * Parses a queue body. Returns `undefined` for a well-formed message of another type (the
 * `lc-files` queue will also carry validation and stamping messages), and throws
 * `MalformedScanMessageError` for a `file.scan_result` message that cannot be used, which
 * the consumer leaves undeleted so it ends in the dead-letter queue and is noticed.
 */
export function parseScanResultMessage(body: string): ScanResultMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new MalformedScanMessageError('The message is not JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new MalformedScanMessageError('The message is not an object.');
  }
  const envelope = parsed as Partial<Record<keyof EventEnvelope, unknown>>;
  if (envelope.type !== FILE_SCAN_RESULT_EVENT) return undefined;
  const data = envelope.data as { fileId?: unknown; verdict?: unknown } | null | undefined;
  if (
    typeof envelope.id !== 'string' ||
    !UUID.test(envelope.id) ||
    typeof data !== 'object' ||
    data === null ||
    typeof data.fileId !== 'string' ||
    !UUID.test(data.fileId) ||
    typeof data.verdict !== 'string' ||
    !VERDICTS.has(data.verdict)
  ) {
    throw new MalformedScanMessageError('The scan result message is incomplete.');
  }
  return { eventId: envelope.id, fileId: data.fileId, verdict: data.verdict as ScanVerdict };
}

/**
 * A stable event id for a scan result that has none of its own (the dev scan job): a UUID
 * made from the file id and the verdict, so the same result always has the same id and
 * `processOnce` records it once.
 */
export function deterministicScanEventId(fileId: string, verdict: ScanVerdict): string {
  const hex = createHash('sha256')
    .update(`${FILE_SCAN_RESULT_EVENT}:${fileId}:${verdict}`)
    .digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The file id inside a quarantine key (`<quarantine prefix>/<PURPOSE>/<fileId>`), for the
 * adapter that turns a scanner event (which names an object) into a scan-result message.
 */
export function fileIdFromQuarantineKey(config: FilesConfig, key: string): string | undefined {
  if (!isQuarantineKey(config, key)) return undefined;
  const last = key.split('/').at(-1);
  return last !== undefined && UUID.test(last) ? last.toLowerCase() : undefined;
}
