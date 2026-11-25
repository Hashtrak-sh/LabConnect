import { describe, expect, it, vi } from 'vitest';
import {
  GuardDutyEventError,
  GuardDutyMalwareScanner,
  GUARDDUTY_RESULT_STATUSES,
  GUARDDUTY_SCAN_RESULT_DETAIL_TYPE,
  GUARDDUTY_SCAN_STATUSES,
  normaliseEtag,
  parseGuardDutyScanResultEvent,
} from './guardduty.js';
import type { FilesConfig } from './keys.js';
import { handleFilesQueueMessage } from './queue-handler.js';
import type { QueueMessage } from '../platform/queue-consumer.js';
import type { FileScanProcessor } from './scan-processor.js';

const config: FilesConfig = {
  bucket: 'amzn-s3-demo-bucket',
  quarantinePrefix: 'quarantine',
  cleanPrefix: 'clean',
};
const fileId = '01930000-0000-7000-8000-0000000000f1';
const key = `quarantine/REPORT_ORIGINAL/${fileId}`;
const EVENT_ID = '72c7d362-737a-6dce-fc78-9e27a0171419';

/**
 * Fixtures copied from the official AWS documentation, "S3 object scan result":
 * https://docs.aws.amazon.com/guardduty/latest/ug/monitor-with-eventbridge-s3-malware-protection.html
 * (read 2026-11-25). The structure is the documented one; the placeholder values the page
 * shows in red (account, bucket, key, ETag, version id) are replaced by this repository's.
 */
function documentedEvent(
  scanStatus: string,
  scanResultDetails: Record<string, unknown>,
): Record<string, unknown> {
  return {
    version: '0',
    id: EVENT_ID,
    'detail-type': 'GuardDuty Malware Protection Object Scan Result',
    source: 'aws.guardduty',
    account: '111122223333',
    time: '2024-02-28T01:01:01Z',
    region: 'us-east-1',
    resources: [
      'arn:aws:guardduty:us-east-1:111122223333:malware-protection-plan/b4c7f464ab3a4EXAMPLE',
    ],
    detail: {
      schemaVersion: '1.0',
      scanStatus,
      resourceType: 'S3_OBJECT',
      s3ObjectDetails: {
        bucketName: config.bucket,
        objectKey: key,
        eTag: 'ASIAI44QH8DHBEXAMPLE',
        versionId: 'd41d8cd98f00b204e9800998eEXAMPLE',
        s3Throttled: false,
      },
      scanResultDetails,
    },
  };
}

const noThreats = () =>
  documentedEvent('COMPLETED', {
    scanResultStatus: 'NO_THREATS_FOUND',
    threats: null,
    statusReasons: null,
  });
const threatsFound = () =>
  documentedEvent('COMPLETED', {
    scanResultStatus: 'THREATS_FOUND',
    threats: [
      {
        name: 'EICAR-Test-File (not a virus)',
        source: 'AMAZON',
        itemDetails: [
          {
            hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            itemPath: key,
          },
        ],
      },
    ],
    statusReasons: null,
  });
const unsupported = () =>
  documentedEvent('SKIPPED', {
    scanResultStatus: 'UNSUPPORTED',
    threats: null,
    statusReasons: ['PASSWORD_PROTECTED'],
  });
const accessDenied = () =>
  documentedEvent('SKIPPED', {
    scanResultStatus: 'ACCESS_DENIED',
    threats: null,
    statusReasons: ['SSE_C_ENCRYPTED_OBJECT'],
  });
const failed = () =>
  documentedEvent('FAILED', { scanResultStatus: 'FAILED', threats: null, statusReasons: null });

const withDetail = (
  event: Record<string, unknown>,
  change: (detail: Record<string, unknown>) => void,
): Record<string, unknown> => {
  const copy = structuredClone(event);
  change(copy.detail as Record<string, unknown>);
  return copy;
};
const withObject = (
  event: Record<string, unknown>,
  change: (object: Record<string, unknown>) => void,
) =>
  withDetail(event, (detail) => {
    change(detail.s3ObjectDetails as Record<string, unknown>);
  });

describe('parseGuardDutyScanResultEvent: every documented status', () => {
  it.each([
    ['NO_THREATS_FOUND (COMPLETED)', noThreats, 'CLEAN'],
    ['THREATS_FOUND (COMPLETED)', threatsFound, 'INFECTED'],
    ['UNSUPPORTED (SKIPPED)', unsupported, 'ERROR'],
    ['ACCESS_DENIED (SKIPPED)', accessDenied, 'ERROR'],
    ['FAILED (FAILED)', failed, 'ERROR'],
  ] as const)('%s becomes %s', (_name, build, verdict) => {
    const result = parseGuardDutyScanResultEvent(build());
    expect(result).toMatchObject({
      verdict,
      bucket: config.bucket,
      key,
      eventId: EVENT_ID,
      etag: 'ASIAI44QH8DHBEXAMPLE',
      versionId: 'd41d8cd98f00b204e9800998eEXAMPLE',
    });
  });

  it('covers every documented result status and scan status (the table above is complete)', () => {
    expect([...GUARDDUTY_RESULT_STATUSES].sort()).toEqual(
      ['ACCESS_DENIED', 'FAILED', 'NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED'].sort(),
    );
    expect([...GUARDDUTY_SCAN_STATUSES].sort()).toEqual(['COMPLETED', 'FAILED', 'SKIPPED']);
  });

  it('keeps the status reasons (informational) and never makes a skipped scan clean', () => {
    const result = parseGuardDutyScanResultEvent(
      documentedEvent('SKIPPED', {
        scanResultStatus: 'ACCESS_DENIED',
        threats: null,
        statusReasons: ['OBJECT_E_TAG_CHANGED'],
      }),
    );
    expect(result.statusReasons).toEqual(['OBJECT_E_TAG_CHANGED']);
    expect(result.verdict).toBe('ERROR');
  });

  it('accepts an ETag with or without quotes, and a missing version id', () => {
    expect(normaliseEtag('"abc"')).toBe('abc');
    expect(normaliseEtag('W/"abc"')).toBe('abc');
    const quoted = withObject(noThreats(), (object) => {
      object.eTag = '"abc"';
      delete object.versionId;
    });
    expect(parseGuardDutyScanResultEvent(quoted)).toMatchObject({
      etag: 'abc',
      versionId: undefined,
    });
  });
});

describe('parseGuardDutyScanResultEvent: anything else is unparseable', () => {
  const malformed: [string, unknown][] = [
    ['null', null],
    ['an array', []],
    ['a string', 'GuardDuty'],
    ['an empty object', {}],
    ['another source', { ...noThreats(), source: 'aws.s3' }],
    ['another detail-type', { ...noThreats(), 'detail-type': 'GuardDuty Finding' }],
    ['a missing event id', { ...noThreats(), id: undefined }],
    ['an empty event id', { ...noThreats(), id: '' }],
    ['no detail', { ...noThreats(), detail: undefined }],
    ['a detail that is a string', { ...noThreats(), detail: 'x' }],
    [
      'another schema version',
      withDetail(noThreats(), (d) => {
        d.schemaVersion = '2.0';
      }),
    ],
    [
      'another resource type',
      withDetail(noThreats(), (d) => {
        d.resourceType = 'S3_BUCKET';
      }),
    ],
    [
      'an unknown scan status',
      withDetail(noThreats(), (d) => {
        d.scanStatus = 'DONE';
      }),
    ],
    [
      'a lower-case scan status',
      withDetail(noThreats(), (d) => {
        d.scanStatus = 'completed';
      }),
    ],
    [
      'an unknown result status (never clean)',
      withDetail(noThreats(), (d) => {
        d.scanResultDetails = { scanResultStatus: 'CLEAN', threats: null, statusReasons: null };
      }),
    ],
    [
      'an unknown result status that sounds clean',
      withDetail(noThreats(), (d) => {
        d.scanResultDetails = { scanResultStatus: 'NO_THREATS', threats: null };
      }),
    ],
    [
      'no scan result details',
      withDetail(noThreats(), (d) => {
        delete d.scanResultDetails;
      }),
    ],
    [
      'COMPLETED with UNSUPPORTED',
      withDetail(noThreats(), (d) => {
        d.scanResultDetails = { scanResultStatus: 'UNSUPPORTED', threats: null };
      }),
    ],
    [
      'SKIPPED with NO_THREATS_FOUND',
      withDetail(noThreats(), (d) => {
        d.scanStatus = 'SKIPPED';
      }),
    ],
    [
      'FAILED scan status with NO_THREATS_FOUND',
      withDetail(noThreats(), (d) => {
        d.scanStatus = 'FAILED';
      }),
    ],
    [
      'NO_THREATS_FOUND with a threat listed',
      withDetail(noThreats(), (d) => {
        d.scanResultDetails = {
          scanResultStatus: 'NO_THREATS_FOUND',
          threats: [{ name: 'x' }],
          statusReasons: null,
        };
      }),
    ],
    [
      'threats that are not a list',
      withDetail(threatsFound(), (d) => {
        d.scanResultDetails = { scanResultStatus: 'THREATS_FOUND', threats: 'EICAR' };
      }),
    ],
    [
      'status reasons that are not strings',
      withDetail(unsupported(), (d) => {
        d.scanResultDetails = { scanResultStatus: 'UNSUPPORTED', statusReasons: [1] };
      }),
    ],
    [
      'no object details',
      withDetail(noThreats(), (d) => {
        delete d.s3ObjectDetails;
      }),
    ],
    [
      'a missing bucket name',
      withObject(noThreats(), (o) => {
        delete o.bucketName;
      }),
    ],
    [
      'a missing object key',
      withObject(noThreats(), (o) => {
        delete o.objectKey;
      }),
    ],
    [
      'a missing eTag (nothing to bind the verdict to)',
      withObject(noThreats(), (o) => {
        delete o.eTag;
      }),
    ],
    [
      'an empty eTag',
      withObject(noThreats(), (o) => {
        o.eTag = '""';
      }),
    ],
    [
      'a numeric version id',
      withObject(noThreats(), (o) => {
        o.versionId = 7;
      }),
    ],
  ];

  it.each(malformed)('rejects %s', (_name, event) => {
    expect(() => parseGuardDutyScanResultEvent(event)).toThrow(GuardDutyEventError);
  });
});

describe('GuardDutyMalwareScanner: bucket, prefix and file id', () => {
  const scanner = () => new GuardDutyMalwareScanner(() => config);

  it('turns a result for a quarantined file into a message bound to the scanned object', () => {
    const outcome = scanner().toScanMessage(noThreats());
    expect(outcome).toEqual({
      kind: 'message',
      message: {
        eventId: EVENT_ID,
        fileId,
        verdict: 'CLEAN',
        scanned: {
          bucket: config.bucket,
          key,
          etag: 'ASIAI44QH8DHBEXAMPLE',
          versionId: 'd41d8cd98f00b204e9800998eEXAMPLE',
        },
      },
    });
  });

  it('ignores, and counts, an event for another bucket', () => {
    const adapter = scanner();
    const event = withObject(noThreats(), (o) => {
      o.bucketName = 'someone-elses-bucket';
    });
    expect(adapter.toScanMessage(event)).toEqual({ kind: 'ignored', reason: 'WRONG_BUCKET' });
    expect(adapter.ignored.WRONG_BUCKET).toBe(1);
  });

  it('ignores an event for the clean prefix or any other prefix, but not one that merely contains it', () => {
    const adapter = scanner();
    for (const other of [
      `clean/REPORT_ORIGINAL/${fileId}`,
      `other/REPORT_ORIGINAL/${fileId}`,
      `x/quarantine/REPORT_ORIGINAL/${fileId}`,
      `quarantine-old/REPORT_ORIGINAL/${fileId}`,
    ]) {
      const event = withObject(noThreats(), (o) => {
        o.objectKey = other;
      });
      expect(adapter.toScanMessage(event)).toEqual({ kind: 'ignored', reason: 'WRONG_PREFIX' });
    }
    expect(adapter.ignored.WRONG_PREFIX).toBe(4);
  });

  it('ignores a key under the quarantine prefix that does not end in a file id', () => {
    const adapter = scanner();
    const event = withObject(noThreats(), (o) => {
      o.objectKey = 'quarantine/REPORT_ORIGINAL/not-an-id';
    });
    expect(adapter.toScanMessage(event)).toEqual({ kind: 'ignored', reason: 'NOT_A_FILE_KEY' });
    expect(adapter.ignored.NOT_A_FILE_KEY).toBe(1);
  });

  it('does not treat another GuardDuty event type as a scan result', () => {
    const resourceStatus = {
      version: '0',
      id: EVENT_ID,
      'detail-type': 'GuardDuty Malware Protection Resource Status Active',
      source: 'aws.guardduty',
      detail: { schemaVersion: '1.0', resourceStatus: 'ACTIVE' },
    };
    expect(scanner().toScanMessage(resourceStatus)).toEqual({ kind: 'other' });
  });

  it('falls back to a stable event id when the EventBridge id is not a UUID', () => {
    const event = { ...noThreats(), id: 'not-a-uuid' };
    const first = scanner().toScanMessage(event);
    const second = scanner().toScanMessage(event);
    const other = scanner().toScanMessage({ ...noThreats(), id: 'another-one' });
    if (first.kind !== 'message' || second.kind !== 'message' || other.kind !== 'message') {
      throw new Error('expected messages');
    }
    expect(first.message.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.message.eventId).toBe(second.message.eventId);
    expect(first.message.eventId).not.toBe(other.message.eventId);
  });

  it('exports the documented detail-type', () => {
    expect(GUARDDUTY_SCAN_RESULT_DETAIL_TYPE).toBe(
      'GuardDuty Malware Protection Object Scan Result',
    );
  });
});

describe('the lc-files consumer accepts both message kinds', () => {
  const handled = () => {
    const handle = vi.fn(() => Promise.resolve({ outcome: 'unknown_file' as const }));
    // The handler only calls `handle`, so a stand-in with that one method is enough.
    return { processor: { handle } as unknown as FileScanProcessor, handle };
  };
  const body = (value: unknown): QueueMessage => ({
    id: 'm1',
    body: JSON.stringify(value),
    receiptHandle: 'r',
  });
  const guardDuty = () => new GuardDutyMalwareScanner(() => config);

  it('processes a GuardDuty event and acknowledges it', async () => {
    const { processor, handle } = handled();
    const result = await handleFilesQueueMessage(processor, body(noThreats()), {
      guardDuty: guardDuty(),
    });
    expect(result).toBe('acknowledge');
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_ID, fileId, verdict: 'CLEAN' }),
    );
  });

  it('acknowledges an event for another bucket without processing it', async () => {
    const { processor, handle } = handled();
    const event = withObject(noThreats(), (o) => {
      o.bucketName = 'other';
    });
    const adapter = guardDuty();
    expect(await handleFilesQueueMessage(processor, body(event), { guardDuty: adapter })).toBe(
      'acknowledge',
    );
    expect(handle).not.toHaveBeenCalled();
    expect(adapter.ignored.WRONG_BUCKET).toBe(1);
  });

  it('throws for a malformed GuardDuty event so that it ends in the dead-letter queue', async () => {
    const { processor, handle } = handled();
    const event = withDetail(noThreats(), (d) => {
      d.scanStatus = 'MYSTERY';
    });
    await expect(
      handleFilesQueueMessage(processor, body(event), { guardDuty: guardDuty() }),
    ).rejects.toThrow(GuardDutyEventError);
    expect(handle).not.toHaveBeenCalled();
  });

  it('leaves a GuardDuty event when no adapter is configured, and other GuardDuty event types', async () => {
    const { processor, handle } = handled();
    expect(await handleFilesQueueMessage(processor, body(noThreats()))).toBe('leave');
    const other = { source: 'aws.guardduty', 'detail-type': 'GuardDuty Finding', detail: {} };
    expect(await handleFilesQueueMessage(processor, body(other), { guardDuty: guardDuty() })).toBe(
      'leave',
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it('still accepts the platform envelope, unless told not to, and leaves unknown types', async () => {
    const { processor, handle } = handled();
    const envelope = {
      id: EVENT_ID,
      type: 'file.scan_result',
      version: 1,
      occurredAt: '2026-11-25T10:00:00.000Z',
      aggregate: { type: 'file_object', id: fileId },
      actor: 'SYSTEM',
      data: { fileId, verdict: 'CLEAN' },
    };
    expect(await handleFilesQueueMessage(processor, body(envelope))).toBe('acknowledge');
    expect(handle).toHaveBeenCalledTimes(1);
    expect(
      await handleFilesQueueMessage(processor, body(envelope), {
        acceptPlatformEnvelope: false,
      }),
    ).toBe('leave');
    expect(handle).toHaveBeenCalledTimes(1);
    expect(await handleFilesQueueMessage(processor, body({ type: 'report.stamp' }))).toBe('leave');
  });
});
