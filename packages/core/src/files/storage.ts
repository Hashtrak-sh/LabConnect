import { createHash } from 'node:crypto';
import type { Clock } from '../platform/clock.js';

/** Upload and download URLs live 15 minutes (FILES_AND_REPORTS.md sections 1 and 2, BR-066). */
export const URL_TTL_SECONDS = 15 * 60;

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | undefined;
  /** Changes whenever the object is replaced. Used to pin validation, hashing and copy to one object. */
  etag: string;
  versionId: string | undefined;
}

export interface PresignPutRequest {
  bucket: string;
  key: string;
  /** Signed: the upload must send exactly this `Content-Type`. */
  contentType: string;
  /** Signed: the upload must send exactly this `Content-Length`. */
  sizeBytes: number;
  expiresInSeconds: number;
}

/** The shape of the contract's `FileUploadUrl` without the `fileId`. */
export interface PresignedPut {
  url: string;
  method: 'PUT';
  /** The headers the client must send unchanged; they are conditions of the signature. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface PresignGetRequest {
  bucket: string;
  key: string;
  versionId?: string | undefined;
  /** Content type the download is served with. */
  contentType?: string | undefined;
  expiresInSeconds: number;
}

export interface PresignedGet {
  url: string;
  expiresAt: Date;
}

export interface CopyRequest {
  bucket: string;
  fromKey: string;
  toKey: string;
  /** The copy fails (`ObjectChangedError`) unless the source still has this etag. */
  ifMatchEtag?: string;
}

export interface ReadOptions {
  /** The read fails (`ObjectTooLargeError`) if the object is larger, before the body is read. */
  maxBytes: number;
  /** The read fails (`ObjectChangedError`) unless the object still has this etag. */
  ifMatchEtag?: string;
}

export class ObjectNotFoundError extends Error {
  override name = 'ObjectNotFoundError';
  constructor() {
    super('The object does not exist.');
  }
}

export class ObjectTooLargeError extends Error {
  override name = 'ObjectTooLargeError';
  constructor() {
    super('The object is larger than the allowed maximum.');
  }
}

/** The object was replaced between the head request and the read or copy that pinned its etag. */
export class ObjectChangedError extends Error {
  override name = 'ObjectChangedError';
  constructor() {
    super('The object changed while it was being processed.');
  }
}

/**
 * The object store (S3). Everything here may be slow or fail, so none of it is called inside
 * a database transaction (see `FileService`). Messages never contain object keys of report
 * files beyond what a caller chooses to log: callers log ids only.
 */
export interface ObjectStorage {
  presignPut(request: PresignPutRequest): Promise<PresignedPut>;
  presignGet(request: PresignGetRequest): Promise<PresignedGet>;
  /** `null` when the object does not exist. */
  head(bucket: string, key: string): Promise<ObjectHead | null>;
  read(bucket: string, key: string, options: ReadOptions): Promise<Uint8Array>;
  /** Returns the version id of the new object when the bucket is versioned. */
  copy(request: CopyRequest): Promise<{ versionId: string | undefined }>;
  /** Idempotent: deleting a missing object is not an error. */
  delete(bucket: string, key: string): Promise<void>;
}

/**
 * Builds the real storage at first use, so the API and the worker boot (and their tests run)
 * with no AWS configuration; a missing setting fails the first file operation instead.
 */
export class LazyObjectStorage implements ObjectStorage {
  private instance: ObjectStorage | undefined;

  constructor(private readonly factory: () => ObjectStorage) {}

  private get real(): ObjectStorage {
    this.instance ??= this.factory();
    return this.instance;
  }

  presignPut(request: PresignPutRequest): Promise<PresignedPut> {
    return this.real.presignPut(request);
  }
  presignGet(request: PresignGetRequest): Promise<PresignedGet> {
    return this.real.presignGet(request);
  }
  head(bucket: string, key: string): Promise<ObjectHead | null> {
    return this.real.head(bucket, key);
  }
  read(bucket: string, key: string, options: ReadOptions): Promise<Uint8Array> {
    return this.real.read(bucket, key, options);
  }
  copy(request: CopyRequest): Promise<{ versionId: string | undefined }> {
    return this.real.copy(request);
  }
  delete(bucket: string, key: string): Promise<void> {
    return this.real.delete(bucket, key);
  }
}

interface StoredObject {
  bytes: Uint8Array;
  contentType: string | undefined;
  etag: string;
}

/**
 * A bucket in memory, for tests and local runs without S3. It keeps what was `put`, signs
 * nothing real (URLs are `https://storage.invalid/...` with a fake signature) and records
 * every presigned request in `presignedPuts` and `presignedGets` so tests can inspect them.
 */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  private revision = 0;
  readonly presignedPuts: PresignPutRequest[] = [];
  readonly presignedGets: PresignGetRequest[] = [];
  /** Every call, in order, as `<method> <key>`, so a test can assert the order of operations. */
  readonly calls: string[] = [];

  constructor(private readonly clock: Clock) {}

  /** Puts an object as a client upload would. Replaces an existing one (and its etag). */
  put(bucket: string, key: string, bytes: Uint8Array, contentType?: string): void {
    this.revision += 1;
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
    this.objects.set(this.id(bucket, key), {
      bytes: Uint8Array.from(bytes),
      contentType,
      etag: `"${digest}-${String(this.revision)}"`,
    });
  }

  has(bucket: string, key: string): boolean {
    return this.objects.has(this.id(bucket, key));
  }

  keys(bucket: string): string[] {
    const prefix = `${bucket}/`;
    return [...this.objects.keys()]
      .filter((id) => id.startsWith(prefix))
      .map((id) => id.slice(prefix.length));
  }

  bytesOf(bucket: string, key: string): Uint8Array | undefined {
    return this.objects.get(this.id(bucket, key))?.bytes;
  }

  presignPut(request: PresignPutRequest): Promise<PresignedPut> {
    this.calls.push('presignPut');
    this.presignedPuts.push(request);
    return Promise.resolve({
      url: `https://storage.invalid/${request.bucket}/${request.key}?X-Fake-Signature=FAKE&X-Fake-Expires=${String(request.expiresInSeconds)}`,
      method: 'PUT',
      headers: {
        'Content-Type': request.contentType,
        'Content-Length': String(request.sizeBytes),
      },
      expiresAt: new Date(this.clock.now().getTime() + request.expiresInSeconds * 1000),
    });
  }

  presignGet(request: PresignGetRequest): Promise<PresignedGet> {
    this.calls.push('presignGet');
    this.presignedGets.push(request);
    return Promise.resolve({
      url: `https://storage.invalid/${request.bucket}/${request.key}?X-Fake-Signature=FAKE&response-content-disposition=attachment`,
      expiresAt: new Date(this.clock.now().getTime() + request.expiresInSeconds * 1000),
    });
  }

  head(bucket: string, key: string): Promise<ObjectHead | null> {
    this.calls.push('head');
    const found = this.objects.get(this.id(bucket, key));
    if (!found) return Promise.resolve(null);
    return Promise.resolve({
      sizeBytes: found.bytes.byteLength,
      contentType: found.contentType,
      etag: found.etag,
      versionId: undefined,
    });
  }

  read(bucket: string, key: string, options: ReadOptions): Promise<Uint8Array> {
    this.calls.push('read');
    const found = this.objects.get(this.id(bucket, key));
    if (!found) return Promise.reject(new ObjectNotFoundError());
    if (options.ifMatchEtag !== undefined && options.ifMatchEtag !== found.etag) {
      return Promise.reject(new ObjectChangedError());
    }
    if (found.bytes.byteLength > options.maxBytes) return Promise.reject(new ObjectTooLargeError());
    return Promise.resolve(Uint8Array.from(found.bytes));
  }

  copy(request: CopyRequest): Promise<{ versionId: string | undefined }> {
    this.calls.push('copy');
    const found = this.objects.get(this.id(request.bucket, request.fromKey));
    if (!found) return Promise.reject(new ObjectNotFoundError());
    if (request.ifMatchEtag !== undefined && request.ifMatchEtag !== found.etag) {
      return Promise.reject(new ObjectChangedError());
    }
    this.put(request.bucket, request.toKey, found.bytes, found.contentType);
    return Promise.resolve({ versionId: undefined });
  }

  delete(bucket: string, key: string): Promise<void> {
    this.calls.push('delete');
    this.objects.delete(this.id(bucket, key));
    return Promise.resolve();
  }

  private id(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }
}
