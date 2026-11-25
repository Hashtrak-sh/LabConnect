import { describe, expect, it } from 'vitest';
import { FixedClock } from '../platform/clock.js';
import type { FilesConfig } from './keys.js';
import {
  buildScanResultEnvelope,
  deterministicScanEventId,
  FAKE_INFECTED_MARKER,
  FakeMalwareScanner,
  fileIdFromQuarantineKey,
  GUARDDUTY_NOT_CONFIGURED,
  GuardDutyMalwareScanner,
  MalformedScanMessageError,
  parseGuardDutyScanResultEvent,
  parseScanResultMessage,
} from './scanner.js';
import { InMemoryObjectStorage } from './storage.js';

const clock = new FixedClock('2026-11-25T10:00:00Z');
const config: FilesConfig = { bucket: 'b', quarantinePrefix: 'quarantine', cleanPrefix: 'clean' };
const fileId = '01930000-0000-7000-8000-0000000000f1';
const eventId = '01930000-0000-7000-8000-0000000000e1';

describe('FakeMalwareScanner', () => {
  it('is clean by default, infected for the marker or a chosen key, errored for a missing object', async () => {
    const storage = new InMemoryObjectStorage(clock);
    const scanner = new FakeMalwareScanner(storage);
    storage.put('b', 'quarantine/X/clean', Buffer.from('hello'));
    storage.put('b', 'quarantine/X/marker', Buffer.from(`abc ${FAKE_INFECTED_MARKER} def`));
    storage.put('b', 'quarantine/X/chosen', Buffer.from('hello'));
    storage.put('b', 'quarantine/X/broken', Buffer.from('hello'));
    scanner.infect('quarantine/X/chosen');
    scanner.failOn('quarantine/X/broken');

    const verdict = async (key: string) => (await scanner.scan({ bucket: 'b', key })).verdict;
    expect(await verdict('quarantine/X/clean')).toBe('CLEAN');
    expect(await verdict('quarantine/X/marker')).toBe('INFECTED');
    expect(await verdict('quarantine/X/chosen')).toBe('INFECTED');
    expect(await verdict('quarantine/X/broken')).toBe('ERROR');
    expect(await verdict('quarantine/X/absent')).toBe('ERROR');
    expect(scanner.scanned).toHaveLength(5);
  });
});

describe('the GuardDuty adapter is a stub', () => {
  it('throws "not configured" rather than guess an event shape', async () => {
    await expect(new GuardDutyMalwareScanner().scan()).rejects.toThrow(GUARDDUTY_NOT_CONFIGURED);
    expect(() => parseGuardDutyScanResultEvent({ any: 'event' })).toThrow('not configured');
  });
});

describe('scan result messages', () => {
  it('round-trips through the envelope', () => {
    const envelope = buildScanResultEnvelope({ eventId, fileId, verdict: 'INFECTED' }, clock.now());
    expect(envelope).toMatchObject({ id: eventId, type: 'file.scan_result', actor: 'SYSTEM' });
    expect(parseScanResultMessage(JSON.stringify(envelope))).toEqual({
      eventId,
      fileId,
      verdict: 'INFECTED',
    });
  });

  it('ignores a well-formed message of another type', () => {
    expect(
      parseScanResultMessage(JSON.stringify({ id: eventId, type: 'report.stamp' })),
    ).toBeUndefined();
  });

  it.each([
    ['not json', '{'],
    ['not an object', '42'],
    ['null', 'null'],
    ['no id', JSON.stringify({ type: 'file.scan_result', data: { fileId, verdict: 'CLEAN' } })],
    [
      'bad id',
      JSON.stringify({ id: 'x', type: 'file.scan_result', data: { fileId, verdict: 'CLEAN' } }),
    ],
    ['no data', JSON.stringify({ id: eventId, type: 'file.scan_result' })],
    [
      'bad file id',
      JSON.stringify({
        id: eventId,
        type: 'file.scan_result',
        data: { fileId: 'x', verdict: 'CLEAN' },
      }),
    ],
    [
      'bad verdict',
      JSON.stringify({ id: eventId, type: 'file.scan_result', data: { fileId, verdict: 'MAYBE' } }),
    ],
  ])('throws for a malformed scan result (%s)', (_label, body) => {
    expect(() => parseScanResultMessage(body)).toThrow(MalformedScanMessageError);
  });

  it('makes the same event id for the same result and different ones for different results', () => {
    const a = deterministicScanEventId(fileId, 'CLEAN');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicScanEventId(fileId, 'CLEAN')).toBe(a);
    expect(deterministicScanEventId(fileId, 'INFECTED')).not.toBe(a);
    expect(deterministicScanEventId('01930000-0000-7000-8000-0000000000f2', 'CLEAN')).not.toBe(a);
  });

  it('finds the file id in a quarantine key and nowhere else', () => {
    expect(fileIdFromQuarantineKey(config, `quarantine/REPORT_ORIGINAL/${fileId}`)).toBe(fileId);
    expect(fileIdFromQuarantineKey(config, `clean/REPORT_ORIGINAL/${fileId}`)).toBeUndefined();
    expect(
      fileIdFromQuarantineKey(config, 'quarantine/REPORT_ORIGINAL/not-a-uuid'),
    ).toBeUndefined();
  });
});
