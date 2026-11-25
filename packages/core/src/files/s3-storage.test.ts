import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { FixedClock } from '../platform/clock.js';
import { FilesError } from './errors.js';
import { createS3Client, S3ObjectStorage } from './s3-storage.js';
import {
  LazyObjectStorage,
  ObjectChangedError,
  ObjectNotFoundError,
  ObjectTooLargeError,
} from './storage.js';

const clock = new FixedClock('2026-11-25T10:00:00Z');
const key = 'quarantine/REPORT_ORIGINAL/01930000-0000-7000-8000-0000000000f1';

/** A real client with throwaway credentials: presigning is local, so no network is used. */
function client(forcePathStyle: boolean): S3Client {
  return createS3Client({
    region: 'ap-south-1',
    endpoint: 'http://localhost:4566',
    forcePathStyle,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
}

describe('S3ObjectStorage presigned PUT', () => {
  it('signs the content type and length, expires in 15 minutes, and adds no checksum', async () => {
    const storage = new S3ObjectStorage(client(true), clock);
    const put = await storage.presignPut({
      bucket: 'labconnect-files',
      key,
      contentType: 'application/pdf',
      sizeBytes: 182_044,
      expiresInSeconds: 900,
    });
    const url = new URL(put.url);
    expect(put.method).toBe('PUT');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
    expect(signed).toContain('content-type');
    expect(signed).toContain('content-length');
    expect(signed).toContain('host');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    // the SDK's default checksum would break a real upload
    expect(
      [...url.searchParams.keys()].filter((name) => name.toLowerCase().includes('checksum')),
    ).toEqual([]);
    expect(put.headers).toEqual({ 'Content-Type': 'application/pdf', 'Content-Length': '182044' });
    expect(put.expiresAt.toISOString()).toBe('2026-11-25T10:15:00.000Z');
  });

  it('uses path-style addressing when asked (LocalStack), virtual-hosted style otherwise', async () => {
    const request = {
      bucket: 'labconnect-files',
      key,
      contentType: 'application/pdf',
      sizeBytes: 10,
      expiresInSeconds: 900,
    };
    const pathStyle = new URL(
      (await new S3ObjectStorage(client(true), clock).presignPut(request)).url,
    );
    expect(pathStyle.host).toBe('localhost:4566');
    expect(pathStyle.pathname).toBe(`/labconnect-files/${key}`);
    const hosted = new URL(
      (await new S3ObjectStorage(client(false), clock).presignPut(request)).url,
    );
    expect(hosted.host).toBe('labconnect-files.localhost:4566');
    expect(hosted.pathname).toBe(`/${key}`);
  });

  it('puts no file name or personal data in the URL', async () => {
    const storage = new S3ObjectStorage(client(true), clock);
    const put = await storage.presignPut({
      bucket: 'labconnect-files',
      key,
      contentType: 'application/pdf',
      sizeBytes: 10,
      expiresInSeconds: 900,
    });
    expect(new URL(put.url).pathname).toBe(`/labconnect-files/${key}`);
  });
});

describe('S3ObjectStorage presigned GET', () => {
  it('asks for an attachment, with the version and type, for 15 minutes', async () => {
    const storage = new S3ObjectStorage(client(true), clock);
    const get = await storage.presignGet({
      bucket: 'labconnect-files',
      key: 'clean/REPORT_ORIGINAL/x',
      versionId: 'v1',
      contentType: 'application/pdf',
      expiresInSeconds: 900,
    });
    const url = new URL(get.url);
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment');
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
    expect(url.searchParams.get('versionId')).toBe('v1');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(get.expiresAt.toISOString()).toBe('2026-11-25T10:15:00.000Z');
  });
});

describe('S3ObjectStorage operations (stubbed client)', () => {
  const stubbed = (respond: (command: unknown) => unknown) => {
    const s3 = client(true);
    const send = vi.fn((command: unknown): Promise<unknown> => {
      try {
        return Promise.resolve(respond(command));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('stub failure'));
      }
    });
    Object.assign(s3, { send });
    return {
      storage: new S3ObjectStorage(s3, clock, {
        serverSideEncryption: 'aws:kms',
        kmsKeyId: 'kms-1',
      }),
      send,
    };
  };
  const awsError = (name: string, status: number) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

  it('heads an object, and answers null when it is missing', async () => {
    const { storage } = stubbed((command) => {
      if (command instanceof HeadObjectCommand && command.input.Key === key) {
        return {
          ContentLength: 12,
          ContentType: 'application/pdf',
          ETag: '"abc"',
          VersionId: 'v9',
        };
      }
      throw awsError('NotFound', 404);
    });
    expect(await storage.head('b', key)).toEqual({
      sizeBytes: 12,
      contentType: 'application/pdf',
      etag: '"abc"',
      versionId: 'v9',
    });
    expect(await storage.head('b', 'other')).toBeNull();
  });

  it('reads an object pinned to its etag and refuses one that is too large without reading it', async () => {
    const { storage, send } = stubbed((command) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      const input = (command as GetObjectCommand).input;
      return {
        ContentLength: input.Key === 'big' ? 100 : 3,
        Body: {
          transformToByteArray: () => Promise.resolve(Uint8Array.from([1, 2, 3])),
          destroy: vi.fn(),
        },
      };
    });
    const bytes = await storage.read('b', key, { maxBytes: 10, ifMatchEtag: '"abc"' });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect((send.mock.calls[0]?.[0] as GetObjectCommand).input.IfMatch).toBe('"abc"');
    await expect(storage.read('b', 'big', { maxBytes: 10 })).rejects.toBeInstanceOf(
      ObjectTooLargeError,
    );
  });

  it('maps a changed object (412) and a missing one (404) on read and copy', async () => {
    const { storage } = stubbed((command) => {
      if (command instanceof GetObjectCommand && command.input.Key === 'gone')
        throw awsError('NoSuchKey', 404);
      throw awsError('PreconditionFailed', 412);
    });
    await expect(storage.read('b', key, { maxBytes: 1, ifMatchEtag: 'x' })).rejects.toBeInstanceOf(
      ObjectChangedError,
    );
    await expect(storage.read('b', 'gone', { maxBytes: 1 })).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
    await expect(
      storage.copy({ bucket: 'b', fromKey: key, toKey: 'clean/x', ifMatchEtag: 'x' }),
    ).rejects.toBeInstanceOf(ObjectChangedError);
  });

  it('copies with the etag condition and SSE-KMS, and returns the new version', async () => {
    const { storage, send } = stubbed(() => ({ VersionId: 'v-clean' }));
    const result = await storage.copy({
      bucket: 'b',
      fromKey: key,
      toKey: 'clean/REPORT_ORIGINAL/x',
      ifMatchEtag: '"abc"',
    });
    expect(result).toEqual({ versionId: 'v-clean' });
    const command = send.mock.calls[0]?.[0] as CopyObjectCommand;
    expect(command.input).toMatchObject({
      Bucket: 'b',
      Key: 'clean/REPORT_ORIGINAL/x',
      CopySource: `b/${key}`,
      CopySourceIfMatch: '"abc"',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'kms-1',
    });
  });

  it('puts a platform-made object with the same SSE-KMS as a copy, and returns the version', async () => {
    const { storage, send } = stubbed(() => ({ VersionId: 'v-img' }));
    const bytes = Uint8Array.from([1, 2, 3]);
    const result = await storage.putObject({
      bucket: 'b',
      key: 'clean/KYC_DOCUMENT/x',
      bytes,
      contentType: 'image/jpeg',
    });
    expect(result).toEqual({ versionId: 'v-img' });
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'b',
      Key: 'clean/KYC_DOCUMENT/x',
      ContentType: 'image/jpeg',
      ContentLength: 3,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'kms-1',
    });
  });

  it('deletes, and treats a missing object as deleted', async () => {
    const { storage, send } = stubbed((command) => {
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      return {};
    });
    await storage.delete('b', key);
    expect(send).toHaveBeenCalledTimes(1);
    const { storage: missing } = stubbed(() => {
      throw awsError('NoSuchKey', 404);
    });
    await expect(missing.delete('b', key)).resolves.toBeUndefined();
  });

  it('reports any other failure as an unavailable gateway without leaking the cause to the client', async () => {
    const { storage } = stubbed(() => {
      throw awsError('InternalError', 500);
    });
    const failure = await storage.head('b', key).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FilesError);
    expect(failure).toMatchObject({ code: 'GATEWAY_UNAVAILABLE', status: 503 });
    expect((failure as FilesError).detail).not.toContain(key);
  });
});

describe('LazyObjectStorage', () => {
  it('builds the real storage only on first use', () => {
    const factory = vi.fn(() => {
      throw new Error('FILES_BUCKET is not set.');
    });
    const lazy = new LazyObjectStorage(factory);
    expect(factory).not.toHaveBeenCalled();
    expect(() => lazy.head('b', 'k')).toThrow('FILES_BUCKET is not set.');
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
