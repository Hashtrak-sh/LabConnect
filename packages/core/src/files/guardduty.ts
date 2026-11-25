import { createHash } from 'node:crypto';
import { type FilesConfig, isQuarantineKey } from './keys.js';
import {
  deterministicScanEventId,
  fileIdFromQuarantineKey,
  type ScanResult,
  type ScanResultMessage,
  type ScanVerdict,
} from './scanner.js';

/*
 * GuardDuty Malware Protection for S3: the scan result adapter (P3-06, ADR-010, OQ-116).
 *
 * Source of the event shape: the official AWS documentation, read on 2026-11-25:
 *   - https://docs.aws.amazon.com/guardduty/latest/ug/monitor-with-eventbridge-s3-malware-protection.html
 *     (section "S3 object scan result": the event pattern, the sample events for
 *     NO_THREATS_FOUND, THREATS_FOUND, UNSUPPORTED, ACCESS_DENIED and FAILED)
 *   - https://docs.aws.amazon.com/guardduty/latest/ug/monitoring-malware-protection-s3-scans-gdu.html
 *     (section "S3 object potential scan status and result status": the status values and the
 *     table of `statusReasons`)
 *
 * What the documentation states, and what this file relies on:
 *   - delivery: GuardDuty publishes to the default EventBridge bus of the bucket owner's
 *     account; `source` is "aws.guardduty" and `detail-type` is
 *     "GuardDuty Malware Protection Object Scan Result";
 *   - top-level fields `version`, `id`, `detail-type`, `source`, `account`, `time`, `region`,
 *     `resources`, and `detail` with `schemaVersion` "1.0", `scanStatus`, `resourceType`
 *     ("S3_OBJECT"), `s3ObjectDetails` { `bucketName`, `objectKey`, `eTag`, `versionId`,
 *     `s3Throttled` } and `scanResultDetails` { `scanResultStatus`, `threats`, `statusReasons` };
 *   - `scanStatus` is one of COMPLETED, SKIPPED, FAILED;
 *   - `scanResultStatus` is one of NO_THREATS_FOUND, THREATS_FOUND (scanStatus COMPLETED),
 *     UNSUPPORTED, ACCESS_DENIED (scanStatus SKIPPED), FAILED (scanStatus FAILED);
 *   - `statusReasons` is a list of strings (only for SKIPPED), among them OBJECT_E_TAG_CHANGED
 *     (the object changed between the start of the scan and the read: "The subsequent upload
 *     or new version will be scanned").
 *
 * Not stated by the documentation (so not assumed): whether `eTag` carries the surrounding
 * double quotes S3 uses in its own headers (both forms are accepted and compared without
 * quotes); whether `objectKey` is URL-encoded (a key is only ever used after it matches the
 * platform's own key format of ASCII letters, digits, `-`, `_` and `/`, so an encoded key
 * simply does not match and is ignored); whether `versionId` is present for an unversioned
 * bucket (optional here); the full list of `statusReasons` (any string is accepted and only
 * informs, it never changes a verdict); the delivery guarantee (EventBridge delivers at least
 * once, so the event `id` is the idempotency key).
 */

export const GUARDDUTY_SOURCE = 'aws.guardduty';
export const GUARDDUTY_SCAN_RESULT_DETAIL_TYPE = 'GuardDuty Malware Protection Object Scan Result';

export const GUARDDUTY_SCAN_STATUSES = ['COMPLETED', 'SKIPPED', 'FAILED'] as const;
export type GuardDutyScanStatus = (typeof GUARDDUTY_SCAN_STATUSES)[number];

export const GUARDDUTY_RESULT_STATUSES = [
  'NO_THREATS_FOUND',
  'THREATS_FOUND',
  'UNSUPPORTED',
  'ACCESS_DENIED',
  'FAILED',
] as const;
export type GuardDutyResultStatus = (typeof GUARDDUTY_RESULT_STATUSES)[number];

/** Which result statuses the documentation allows with each scan status. */
const RESULTS_OF: Record<GuardDutyScanStatus, readonly GuardDutyResultStatus[]> = {
  COMPLETED: ['NO_THREATS_FOUND', 'THREATS_FOUND'],
  SKIPPED: ['UNSUPPORTED', 'ACCESS_DENIED'],
  FAILED: ['FAILED'],
};

/**
 * The only mapping to a platform verdict. `CLEAN` comes from exactly one documented value;
 * every other documented value that is not an infection is `ERROR` (the scan did not say the
 * object is safe; a re-scan is possible, OQ-115). A value that is not documented never gets
 * here: the parser rejects the event.
 */
function verdictOf(status: GuardDutyResultStatus): ScanVerdict {
  switch (status) {
    case 'NO_THREATS_FOUND':
      return 'CLEAN';
    case 'THREATS_FOUND':
      return 'INFECTED';
    case 'UNSUPPORTED':
    case 'ACCESS_DENIED':
    case 'FAILED':
      return 'ERROR';
  }
}

/** A scan result that GuardDuty made: the platform's `ScanResult` plus what binds it to one object. */
export interface GuardDutyScanResult extends ScanResult {
  /** The EventBridge event id. EventBridge delivers at least once; a redelivery has the same id. */
  eventId: string;
  /** The ETag of the object that was scanned, without quotes. */
  etag: string;
  versionId: string | undefined;
  scanStatus: GuardDutyScanStatus;
  resultStatus: GuardDutyResultStatus;
  /** `statusReasons` of a skipped scan (informational). */
  statusReasons: string[];
}

/** The event is not the documented structure. Never a verdict. */
export class GuardDutyEventError extends Error {
  override name = 'GuardDutyEventError';
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function record(value: unknown, what: string): Raw {
  if (!isRecord(value)) throw new GuardDutyEventError(`${what} is not an object.`);
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GuardDutyEventError(`${what} is not a non-empty string.`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new GuardDutyEventError(`${what} is not a documented value.`);
  return found;
}

/** S3 returns ETags in double quotes (and a weak one as `W/"..."`); the event may or may not. */
export function normaliseEtag(etag: string): string {
  return etag.replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
}

/**
 * Parses and validates one GuardDuty "Object Scan Result" EventBridge event into the
 * platform's scan result. Strict: an event that is not the documented structure, has a
 * value outside the documented ones, or contradicts itself (for example `COMPLETED` with
 * `UNSUPPORTED`, or `NO_THREATS_FOUND` with a threat attached) throws `GuardDutyEventError`.
 * Pure. Does not look at the bucket or the key's prefix (see `GuardDutyMalwareScanner`).
 */
export function parseGuardDutyScanResultEvent(raw: unknown): GuardDutyScanResult {
  const event = record(raw, 'The event');
  if (event.source !== GUARDDUTY_SOURCE)
    throw new GuardDutyEventError('The source is not GuardDuty.');
  if (event['detail-type'] !== GUARDDUTY_SCAN_RESULT_DETAIL_TYPE) {
    throw new GuardDutyEventError('The detail-type is not an object scan result.');
  }
  const eventId = text(event.id, 'The event id');
  const detail = record(event.detail, 'The detail');
  if (detail.schemaVersion !== '1.0') {
    throw new GuardDutyEventError('The detail schema version is not 1.0.');
  }
  if (detail.resourceType !== 'S3_OBJECT') {
    throw new GuardDutyEventError('The resource type is not S3_OBJECT.');
  }
  const scanStatus = oneOf(detail.scanStatus, GUARDDUTY_SCAN_STATUSES, 'The scan status');

  const object = record(detail.s3ObjectDetails, 'The object details');
  const bucket = text(object.bucketName, 'The bucket name');
  const key = text(object.objectKey, 'The object key');
  const etag = normaliseEtag(text(object.eTag, 'The eTag'));
  if (etag.length === 0) throw new GuardDutyEventError('The eTag is empty.');
  const versionRaw = object.versionId;
  if (versionRaw !== undefined && versionRaw !== null && typeof versionRaw !== 'string') {
    throw new GuardDutyEventError('The version id is not a string.');
  }
  const versionId =
    typeof versionRaw === 'string' && versionRaw.length > 0 ? versionRaw : undefined;

  const result = record(detail.scanResultDetails, 'The scan result details');
  const resultStatus = oneOf(
    result.scanResultStatus,
    GUARDDUTY_RESULT_STATUSES,
    'The scan result status',
  );
  if (!RESULTS_OF[scanStatus].includes(resultStatus)) {
    throw new GuardDutyEventError('The scan status and the result status contradict each other.');
  }
  const threats = result.threats;
  if (threats !== undefined && threats !== null && !Array.isArray(threats)) {
    throw new GuardDutyEventError('The threats are not a list.');
  }
  if (resultStatus === 'NO_THREATS_FOUND' && Array.isArray(threats) && threats.length > 0) {
    throw new GuardDutyEventError('No threats found, but a threat is listed.');
  }
  const reasons = result.statusReasons;
  if (reasons !== undefined && reasons !== null) {
    if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== 'string')) {
      throw new GuardDutyEventError('The status reasons are not a list of strings.');
    }
  }

  return {
    bucket,
    key,
    verdict: verdictOf(resultStatus),
    eventId,
    etag,
    versionId,
    scanStatus,
    resultStatus,
    statusReasons: (reasons as string[] | null | undefined) ?? [],
  };
}

/** Why a well-formed result was not for this platform's files. Counted, not an error. */
export type IgnoredScanReason = 'WRONG_BUCKET' | 'WRONG_PREFIX' | 'NOT_A_FILE_KEY';

export type GuardDutyMessageOutcome =
  | { kind: 'message'; message: ScanResultMessage }
  | { kind: 'ignored'; reason: IgnoredScanReason }
  /** A GuardDuty event of another detail-type (resource status, post-scan action). */
  | { kind: 'other' };

/** `source` of a queue body that is an EventBridge event from GuardDuty. */
export function isGuardDutyEvent(parsedBody: unknown): boolean {
  return isRecord(parsedBody) && parsedBody.source === GUARDDUTY_SOURCE;
}

/**
 * The GuardDuty adapter (ADR-010). GuardDuty scans on upload by itself and reports through
 * EventBridge, so there is nothing to call: this class turns a result event into the
 * platform's scan-result message. It only accepts results for the configured bucket and the
 * quarantine prefix, and derives the file id from the key. The message carries the scanned
 * object's bucket, key, ETag and version, which `FileScanProcessor` compares with the object
 * it reads, so a verdict is never applied to an object other than the one that was scanned
 * (OQ-116).
 */
export class GuardDutyMalwareScanner {
  /** How many well-formed events were ignored, by reason. */
  readonly ignored: Record<IgnoredScanReason, number> = {
    WRONG_BUCKET: 0,
    WRONG_PREFIX: 0,
    NOT_A_FILE_KEY: 0,
  };

  constructor(private readonly config: () => FilesConfig) {}

  /**
   * `raw` is the parsed JSON of the queue message body. Throws `GuardDutyEventError` for a
   * scan result that is not the documented structure.
   */
  toScanMessage(raw: unknown): GuardDutyMessageOutcome {
    if (isRecord(raw) && raw['detail-type'] !== GUARDDUTY_SCAN_RESULT_DETAIL_TYPE) {
      if (raw.source === GUARDDUTY_SOURCE) return { kind: 'other' };
    }
    const result = parseGuardDutyScanResultEvent(raw);
    const config = this.config();
    if (result.bucket !== config.bucket) return this.ignore('WRONG_BUCKET');
    if (!isQuarantineKey(config, result.key)) return this.ignore('WRONG_PREFIX');
    const fileId = fileIdFromQuarantineKey(config, result.key);
    if (fileId === undefined) return this.ignore('NOT_A_FILE_KEY');
    return {
      kind: 'message',
      message: {
        eventId: eventIdOf(result.eventId, fileId, result.verdict),
        fileId,
        verdict: result.verdict,
        scanned: {
          bucket: result.bucket,
          key: result.key,
          etag: result.etag,
          ...(result.versionId === undefined ? {} : { versionId: result.versionId }),
        },
      },
    };
  }

  private ignore(reason: IgnoredScanReason): GuardDutyMessageOutcome {
    this.ignored[reason] += 1;
    return { kind: 'ignored', reason };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `processOnce` records the id as a `uuid`. The EventBridge event id is one (the documented
 * examples are); when it is not, falls back to an id made from the file, the verdict and the
 * event id, which is still stable across redeliveries of the same event.
 */
function eventIdOf(eventId: string, fileId: string, verdict: ScanVerdict): string {
  if (UUID.test(eventId)) return eventId.toLowerCase();
  const digest = createHash('sha256').update(eventId).digest('hex').slice(0, 8);
  return deterministicScanEventId(fileId, verdict, digest);
}
