import { describe, expect, it } from 'vitest';
import { FixedClock } from '../platform/clock.js';
import { FileService, sanitiseFileName } from './file-service.js';
import {
  ObjectChangedError,
  InMemoryObjectStorage,
  ObjectNotFoundError,
  ObjectTooLargeError,
} from './storage.js';

describe('sanitiseFileName', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['C:\\Users\\Asha Rao\\report.pdf', 'report.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['  spaced   out.pdf ', 'spaced out.pdf'],
    ['a<b>:c|d?.pdf', 'a_b__c_d_.pdf'],
    ['.hidden', 'hidden'],
    ['tab\tand\nnewline.pdf', 'tabandnewline.pdf'],
  ])('turns %j into %j', (input, expected) => {
    expect(sanitiseFileName(input)).toBe(expected);
  });

  it('gives undefined when nothing usable is left, and caps the length', () => {
    expect(sanitiseFileName(undefined)).toBeUndefined();
    expect(sanitiseFileName('///')).toBeUndefined();
    expect(sanitiseFileName('\u0000\u0001')).toBeUndefined();
    expect(sanitiseFileName('a'.repeat(400))).toHaveLength(255);
  });
});

describe('FileService.verifyHash', () => {
  const service = new FileService({} as ConstructorParameters<typeof FileService>[0]);
  it('compares hashes', () => {
    expect(service.verifyHash(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3]))).toBe(true);
    expect(service.verifyHash(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 4]))).toBe(false);
    expect(service.verifyHash(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2]))).toBe(false);
  });
});

describe('InMemoryObjectStorage', () => {
  const clock = new FixedClock('2026-11-25T10:00:00Z');

  it('signs nothing real but records what was asked, with the 15-minute expiry', async () => {
    const storage = new InMemoryObjectStorage(clock);
    const put = await storage.presignPut({
      bucket: 'b',
      key: 'quarantine/X/1',
      contentType: 'application/pdf',
      sizeBytes: 5,
      expiresInSeconds: 900,
    });
    expect(put.method).toBe('PUT');
    expect(put.headers).toEqual({ 'Content-Type': 'application/pdf', 'Content-Length': '5' });
    expect(put.expiresAt.toISOString()).toBe('2026-11-25T10:15:00.000Z');
    expect(storage.presignedPuts).toHaveLength(1);
  });

  it('pins reads and copies to an etag, which changes when an object is replaced', async () => {
    const storage = new InMemoryObjectStorage(clock);
    storage.put('b', 'k', Uint8Array.from([1, 2, 3]), 'application/pdf');
    const head = await storage.head('b', 'k');
    expect(head?.sizeBytes).toBe(3);
    await expect(
      storage.read('b', 'k', { maxBytes: 3, ifMatchEtag: head?.etag ?? '' }),
    ).resolves.toHaveLength(3);
    storage.put('b', 'k', Uint8Array.from([9, 9, 9]));
    await expect(
      storage.read('b', 'k', { maxBytes: 3, ifMatchEtag: head?.etag ?? '' }),
    ).rejects.toBeInstanceOf(ObjectChangedError);
    await expect(
      storage.copy({ bucket: 'b', fromKey: 'k', toKey: 'k2', ifMatchEtag: head?.etag ?? '' }),
    ).rejects.toBeInstanceOf(ObjectChangedError);
    expect(storage.has('b', 'k2')).toBe(false);
  });

  it('refuses to read a larger object than allowed, and a missing one', async () => {
    const storage = new InMemoryObjectStorage(clock);
    storage.put('b', 'k', Uint8Array.from([1, 2, 3]));
    await expect(storage.read('b', 'k', { maxBytes: 2 })).rejects.toBeInstanceOf(
      ObjectTooLargeError,
    );
    await expect(storage.read('b', 'nope', { maxBytes: 2 })).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
    expect(await storage.head('b', 'nope')).toBeNull();
  });

  it('copies and deletes', async () => {
    const storage = new InMemoryObjectStorage(clock);
    storage.put('b', 'a', Uint8Array.from([1]), 'image/png');
    await storage.copy({ bucket: 'b', fromKey: 'a', toKey: 'c' });
    expect(storage.keys('b').sort()).toEqual(['a', 'c']);
    await storage.delete('b', 'a');
    await storage.delete('b', 'a');
    expect(storage.keys('b')).toEqual(['c']);
  });
});
