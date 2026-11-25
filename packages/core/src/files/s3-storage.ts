import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Clock } from '../platform/clock.js';
import { FilesError } from './errors.js';
import {
  type CopyRequest,
  type ObjectHead,
  ObjectChangedError,
  ObjectNotFoundError,
  type ObjectStorage,
  ObjectTooLargeError,
  type PresignedGet,
  type PutObjectRequest,
  type PresignedPut,
  type PresignGetRequest,
  type PresignPutRequest,
  type ReadOptions,
} from './storage.js';

export interface S3ClientSettings {
  region?: string | undefined;
  /** Set for LocalStack or another S3-compatible service. Leave unset for AWS. */
  endpoint?: string | undefined;
  /** LocalStack needs path-style addressing (`http://host/bucket/key`). AWS does not. */
  forcePathStyle?: boolean | undefined;
  /** Fixed credentials, for tests. Unset uses the default provider chain. */
  credentials?: { accessKeyId: string; secretAccessKey: string } | undefined;
}

/**
 * The S3 client with the settings the signed URLs depend on. Credentials come from the
 * default provider chain (the task role in AWS, `AWS_ACCESS_KEY_ID` locally).
 *
 * `requestChecksumCalculation: 'WHEN_REQUIRED'` matters: the SDK's default (`WHEN_SUPPORTED`)
 * adds `x-amz-checksum-crc32` of an empty body to a presigned PUT, and S3 then rejects the
 * client's real upload with a checksum mismatch.
 */
export function createS3Client(settings: S3ClientSettings = {}): S3Client {
  return new S3Client({
    ...(settings.region === undefined ? {} : { region: settings.region }),
    ...(settings.endpoint === undefined ? {} : { endpoint: settings.endpoint }),
    ...(settings.credentials === undefined ? {} : { credentials: settings.credentials }),
    forcePathStyle: settings.forcePathStyle ?? false,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export interface S3ObjectStorageOptions {
  /**
   * Server-side encryption of the objects this adapter writes by copy: the clean copy is
   * SSE-KMS (FILES_AND_REPORTS.md section 1, step 5). `undefined` writes without the header,
   * which is for local S3 emulators only.
   */
  serverSideEncryption?: 'aws:kms' | undefined;
  /** The KMS key for SSE-KMS. Unset means the bucket's default key. */
  kmsKeyId?: string | undefined;
}

type ErrorLike = { name?: string; $metadata?: { httpStatusCode?: number } };

const isStatus = (error: unknown, ...statuses: number[]): boolean =>
  statuses.includes((error as ErrorLike).$metadata?.httpStatusCode ?? 0);
const isNamed = (error: unknown, ...names: string[]): boolean =>
  names.includes((error as ErrorLike).name ?? '');

/**
 * The S3 adapter of `ObjectStorage`. The bucket and keys come from the caller (the file row
 * and `FilesConfig`), never from here. Presigning is a local computation (no network call).
 */
export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly clock: Clock,
    private readonly options: S3ObjectStorageOptions = {},
  ) {}

  async presignPut(request: PresignPutRequest): Promise<PresignedPut> {
    const command = new PutObjectCommand({
      Bucket: request.bucket,
      Key: request.key,
      ContentType: request.contentType,
      ContentLength: request.sizeBytes,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: request.expiresInSeconds,
      // Both are conditions of the signature: S3 refuses an upload whose type or length differs.
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      method: 'PUT',
      headers: {
        'Content-Type': request.contentType,
        'Content-Length': String(request.sizeBytes),
      },
      expiresAt: new Date(this.clock.now().getTime() + request.expiresInSeconds * 1000),
    };
  }

  async presignGet(request: PresignGetRequest): Promise<PresignedGet> {
    const command = new GetObjectCommand({
      Bucket: request.bucket,
      Key: request.key,
      ...(request.versionId === undefined ? {} : { VersionId: request.versionId }),
      ResponseContentDisposition: 'attachment',
      ...(request.contentType === undefined ? {} : { ResponseContentType: request.contentType }),
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: request.expiresInSeconds });
    return {
      url,
      expiresAt: new Date(this.clock.now().getTime() + request.expiresInSeconds * 1000),
    };
  }

  async head(bucket: string, key: string): Promise<ObjectHead | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        sizeBytes: out.ContentLength ?? 0,
        contentType: out.ContentType,
        etag: out.ETag ?? '',
        versionId: out.VersionId,
      };
    } catch (error) {
      if (isNamed(error, 'NotFound', 'NoSuchKey') || isStatus(error, 404)) return null;
      throw storageFailure(error);
    }
  }

  async read(bucket: string, key: string, options: ReadOptions): Promise<Uint8Array> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(options.ifMatchEtag === undefined ? {} : { IfMatch: options.ifMatchEtag }),
        }),
      );
      if ((out.ContentLength ?? 0) > options.maxBytes) {
        // Drop the body without reading it.
        // In Node the body is a stream; the SDK's type does not say so.
        (out.Body as unknown as { destroy?: () => void } | undefined)?.destroy?.();
        throw new ObjectTooLargeError();
      }
      if (!out.Body) throw new ObjectNotFoundError();
      const bytes = await out.Body.transformToByteArray();
      if (bytes.byteLength > options.maxBytes) throw new ObjectTooLargeError();
      return bytes;
    } catch (error) {
      if (error instanceof ObjectTooLargeError || error instanceof ObjectNotFoundError) throw error;
      if (isNamed(error, 'NoSuchKey') || isStatus(error, 404)) throw new ObjectNotFoundError();
      if (isNamed(error, 'PreconditionFailed') || isStatus(error, 412)) {
        throw new ObjectChangedError();
      }
      throw storageFailure(error);
    }
  }

  async copy(request: CopyRequest): Promise<{ versionId: string | undefined }> {
    try {
      const out = await this.client.send(
        new CopyObjectCommand({
          Bucket: request.bucket,
          Key: request.toKey,
          CopySource: `${request.bucket}/${encodeKey(request.fromKey)}`,
          ...(request.ifMatchEtag === undefined ? {} : { CopySourceIfMatch: request.ifMatchEtag }),
          MetadataDirective: 'COPY',
          ...(this.options.serverSideEncryption === undefined
            ? {}
            : { ServerSideEncryption: this.options.serverSideEncryption }),
          ...(this.options.kmsKeyId === undefined ? {} : { SSEKMSKeyId: this.options.kmsKeyId }),
        }),
      );
      return { versionId: out.VersionId };
    } catch (error) {
      if (isNamed(error, 'NoSuchKey') || isStatus(error, 404)) throw new ObjectNotFoundError();
      if (isNamed(error, 'PreconditionFailed') || isStatus(error, 412)) {
        throw new ObjectChangedError();
      }
      throw storageFailure(error);
    }
  }

  async putObject(request: PutObjectRequest): Promise<{ versionId: string | undefined }> {
    try {
      const out = await this.client.send(
        new PutObjectCommand({
          Bucket: request.bucket,
          Key: request.key,
          Body: request.bytes,
          ContentType: request.contentType,
          ContentLength: request.bytes.byteLength,
          ...(this.options.serverSideEncryption === undefined
            ? {}
            : { ServerSideEncryption: this.options.serverSideEncryption }),
          ...(this.options.kmsKeyId === undefined ? {} : { SSEKMSKeyId: this.options.kmsKeyId }),
        }),
      );
      return { versionId: out.VersionId };
    } catch (error) {
      throw storageFailure(error);
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      if (isNamed(error, 'NoSuchKey') || isStatus(error, 404)) return;
      throw storageFailure(error);
    }
  }
}

/**
 * The S3 storage the API and the worker use. Settings from the environment:
 * `AWS_REGION`; `FILES_S3_ENDPOINT` (LocalStack, optional; the SDK also honours
 * `AWS_ENDPOINT_URL`); `FILES_S3_FORCE_PATH_STYLE=true` (LocalStack); `FILES_KMS_KEY_ID`
 * (SSE-KMS key of the clean copy, optional); `FILES_S3_SSE_KMS=false` (local emulators only:
 * no encryption header). Credentials come from the default provider chain.
 */
export function createS3StorageFromEnv(
  clock: Clock,
  env: Record<string, string | undefined> = process.env,
): S3ObjectStorage {
  const client = createS3Client({
    region: env.AWS_REGION || undefined,
    endpoint: env.FILES_S3_ENDPOINT || undefined,
    forcePathStyle: env.FILES_S3_FORCE_PATH_STYLE === 'true',
  });
  return new S3ObjectStorage(client, clock, {
    serverSideEncryption: env.FILES_S3_SSE_KMS === 'false' ? undefined : 'aws:kms',
    kmsKeyId: env.FILES_KMS_KEY_ID || undefined,
  });
}

/** `CopySource` is a URL path: each key segment is percent-encoded, the slashes stay. */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function storageFailure(cause: unknown): FilesError {
  return new FilesError('GATEWAY_UNAVAILABLE', {
    reason: 'STORAGE_UNAVAILABLE',
    detail: 'File storage is not available. Try again.',
    cause,
  });
}
