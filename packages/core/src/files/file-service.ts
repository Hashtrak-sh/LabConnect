import { type FilePurpose, type Prisma, type ScanStatus, uuidv7 } from '@labconnect/database';
import type { AuditActor, AuditService } from '../platform/audit.js';
import type { Clock } from '../platform/clock.js';
import type { OutboxService } from '../platform/outbox.js';
import { FilesError, fileNotFound } from './errors.js';
import { type FilesConfig, quarantineKey } from './keys.js';
import { assertUploadAllowed, AUDITED_DOWNLOAD_PURPOSES } from './purposes.js';
import { type ObjectStorage, URL_TTL_SECONDS } from './storage.js';
import type { RejectionReason } from './validation.js';

export interface FileServiceDeps {
  clock: Clock;
  audit: AuditService;
  outbox: OutboxService;
  storage: ObjectStorage;
  /** Read at first use, so the API boots (and its tests run) with no bucket configured. */
  config: () => FilesConfig;
}

export interface RequestUploadInput {
  purpose: FilePurpose;
  /**
   * The organisation that owns the file, taken by the calling module from the authenticated
   * membership, never from the request body (CLAUDE.md section 5). Row-level security only
   * lets a tenant insert a file it owns; `null` is for platform-owned files (platform context).
   */
  ownerOrgId: string | null;
  /** The other parties who may see the file (a booking's customer and lab), when the owner is one of them. */
  customerOrgId?: string | null;
  labOrgId?: string | null;
  declaredContentType: string;
  declaredSizeBytes: number;
  /** The name the client gave the file. Sanitised, stored, never put in a key, a log or an event. */
  fileName?: string | undefined;
  uploadedByUserId: string;
}

/** What `presignUpload` needs, and nothing a client may keep: it is not part of any response. */
export interface UploadTicket {
  fileId: string;
  bucket: string;
  key: string;
  contentType: string;
  sizeBytes: number;
}

/** The contract's `FileUploadUrl` (files.yaml). */
export interface FileUploadUrl {
  fileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface DownloadRequest {
  fileId: string;
  actor: AuditActor | 'SYSTEM';
  requestId?: string | undefined;
}

export interface DownloadTicket {
  fileId: string;
  purpose: FilePurpose;
  bucket: string;
  key: string;
  versionId: string | undefined;
  contentType: string;
}

/** The contract's `FileDownloadUrl` (files.yaml). */
export interface FileDownloadUrl {
  downloadUrl: string;
  expiresAt: Date;
}

/** A visible, clean file, as a domain command may reference it. */
export interface CleanFile {
  id: string;
  purpose: FilePurpose;
  sha256: Buffer;
  sizeBytes: number;
  detectedContentType: string;
  ownerOrgId: string | null;
}

/** The facts about a file that the scan step needs. */
export interface ScanSubject {
  id: string;
  purpose: FilePurpose;
  bucket: string;
  objectKey: string;
  declaredContentType: string;
  declaredSizeBytes: number;
  scanStatus: ScanStatus;
}

export type ScanDecision =
  | {
      status: 'CLEAN';
      sha256: Buffer;
      detectedContentType: string;
      cleanKey: string;
      versionId: string | undefined;
      /**
       * Set only for an image, whose stored object is the re-encoded one: `sizeBytes` and
       * `sha256` are those of the stored bytes, and `originalSizeBytes` is what the user
       * uploaded. Unset for every other type (stored size = declared size = uploaded size).
       */
      reencoded?: { sizeBytes: number; originalSizeBytes: number };
    }
  | { status: 'INFECTED' }
  | { status: 'ERROR' }
  | {
      status: 'REJECTED';
      reasons: RejectionReason[];
      detectedContentType: string | undefined;
    };

export type ApplyScanResult = 'applied' | 'stale';

/** Statuses a scan decision may still change. `CLEAN`, `INFECTED` and `REJECTED` are final. */
export const OPEN_SCAN_STATUSES: ScanStatus[] = ['PENDING', 'ERROR'];

const MAX_FILE_NAME = 255;

/**
 * File names are shown back to people and used in `Content-Disposition`-like places, so they
 * are reduced to a plain base name: no directories, no control characters, no characters
 * that are special in paths or headers. `undefined` when nothing usable is left.
 */
export function sanitiseFileName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const base = name.split(/[\\/]/).at(-1) ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- removing control characters is the point
    .replaceAll(/[\u0000-\u001f\u007f]/g, '')
    .replaceAll(/[<>:"|?*]/g, '_')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, MAX_FILE_NAME)
    .trim();
  return cleaned === '' ? undefined : cleaned;
}

/**
 * Files: upload URLs, the state of a file through scan and validation, download URLs
 * (FILES_AND_REPORTS.md). Framework-free; depends only on `platform`.
 *
 * Every function that touches the database takes the caller's transaction and never calls
 * S3; every function that calls S3 takes no transaction. A caller therefore does:
 *
 *   const ticket = await withDbContext(prisma, context, (tx) => files.requestUpload(tx, input));
 *   const upload = await files.presignUpload(ticket);              // after the commit
 *
 *   const ticket = await withDbContext(prisma, context, (tx) => files.requestDownload(tx, request));
 *   const download = await files.presignDownload(ticket);          // after the commit
 *
 * The row is committed before any URL exists, so a URL never points at an object whose row
 * could still roll back. If the process dies between the commit and the presign, the row
 * stays `PENDING` with no object, which harms nothing (it can never become `CLEAN`).
 *
 * Who may use a file is decided by the module that owns the thing the file is attached to
 * (TENANT_ISOLATION.md rule 8: file access is never granted from `file_object` alone). This
 * service adds only what the database enforces: row-level security (owner and booking
 * parties) and the status check.
 *
 * Immutability: there is no function here that deletes a file row or overwrites its object.
 * A file leaves `PENDING` or `ERROR` once (`applyScanDecision` is compare-and-set on the
 * status) and a `CLEAN` file's key, hash and size are never written again; migration
 * `file_object_frozen` makes the database refuse it too. A new version of a report is a new
 * file row with a new key. The reports module must still refuse to bind or release a file that
 * is not `CLEAN` (`requireClean`), and never offer a way to replace the file of a released version.
 */
export class FileService {
  constructor(private readonly deps: FileServiceDeps) {}

  // ------------------------------------------------------------------ upload

  /**
   * Checks the declared type and size against the purpose's rule, then records the file as
   * `PENDING` with a server-generated key under the quarantine prefix. Returns the ticket
   * for `presignUpload`; commit the transaction first.
   */
  async requestUpload(
    tx: Prisma.TransactionClient,
    input: RequestUploadInput,
  ): Promise<UploadTicket> {
    assertUploadAllowed(input.purpose, input.declaredContentType, input.declaredSizeBytes);
    const config = this.deps.config();
    const id = uuidv7(this.deps.clock.now().getTime());
    const key = quarantineKey(config, input.purpose, id);

    await tx.fileObject.create({
      data: {
        id,
        ownerOrgId: input.ownerOrgId,
        customerOrgId: input.customerOrgId ?? null,
        labOrgId: input.labOrgId ?? null,
        purpose: input.purpose,
        bucket: config.bucket,
        objectKey: key,
        originalFilename: sanitiseFileName(input.fileName) ?? null,
        declaredContentType: input.declaredContentType,
        sizeBytes: BigInt(input.declaredSizeBytes),
        scanStatus: 'PENDING',
        uploadedByUserId: input.uploadedByUserId,
        // `retention_class` "maps to retention config", which the documents do not define (OQ-119).
        retentionClass: input.purpose,
        createdByUserId: input.uploadedByUserId,
      },
    });
    return {
      fileId: id,
      bucket: config.bucket,
      key,
      contentType: input.declaredContentType,
      sizeBytes: input.declaredSizeBytes,
    };
  }

  /** The pre-signed PUT of FILES_AND_REPORTS.md section 1, step 1. Call after the commit. */
  async presignUpload(ticket: UploadTicket): Promise<FileUploadUrl> {
    const put = await this.deps.storage.presignPut({
      bucket: ticket.bucket,
      key: ticket.key,
      contentType: ticket.contentType,
      sizeBytes: ticket.sizeBytes,
      expiresInSeconds: URL_TTL_SECONDS,
    });
    return {
      fileId: ticket.fileId,
      uploadUrl: put.url,
      method: put.method,
      headers: put.headers,
      expiresAt: put.expiresAt,
    };
  }

  // ------------------------------------------------------------------ download

  /**
   * Finds a file the caller may see (row-level security) that is `CLEAN`, writes an audit
   * entry for Restricted purposes, and returns the ticket for `presignDownload`. A file the
   * caller cannot see and a file that is not `CLEAN` both answer `NOT_FOUND`.
   *
   * The owning module must already have decided that this caller may open this file; this
   * check is no substitute for that (see the class comment).
   */
  async requestDownload(
    tx: Prisma.TransactionClient,
    request: DownloadRequest,
  ): Promise<DownloadTicket> {
    const row = await tx.fileObject.findUnique({
      where: { id: request.fileId },
      select: {
        id: true,
        purpose: true,
        bucket: true,
        objectKey: true,
        objectVersionId: true,
        scanStatus: true,
        detectedContentType: true,
        declaredContentType: true,
      },
    });
    if (!row) throw fileNotFound();
    if (row.scanStatus !== 'CLEAN') {
      throw new FilesError('NOT_FOUND', {
        reason: 'FILE_NOT_AVAILABLE',
        detail: 'The file was not found.',
      });
    }
    if (AUDITED_DOWNLOAD_PURPOSES.has(row.purpose)) {
      await this.deps.audit.record(tx, {
        actor: request.actor,
        action: 'file.download_url',
        entityType: 'file_object',
        entityId: row.id,
        after: { purpose: row.purpose },
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      });
    }
    return {
      fileId: row.id,
      purpose: row.purpose,
      bucket: row.bucket,
      key: row.objectKey,
      versionId: row.objectVersionId ?? undefined,
      contentType: row.detectedContentType ?? row.declaredContentType,
    };
  }

  /** A 15-minute GET with `Content-Disposition: attachment` (FILES_AND_REPORTS.md section 2). Call after the commit. */
  async presignDownload(ticket: DownloadTicket): Promise<FileDownloadUrl> {
    const get = await this.deps.storage.presignGet({
      bucket: ticket.bucket,
      key: ticket.key,
      versionId: ticket.versionId,
      contentType: ticket.contentType,
      expiresInSeconds: URL_TTL_SECONDS,
    });
    return { downloadUrl: get.url, expiresAt: get.expiresAt };
  }

  // ------------------------------------------------------------------ references

  /**
   * For domain commands that name a file (`fileId`): the file must be visible to the caller
   * (else `NOT_FOUND`), of one of the expected purposes, and `CLEAN` (else `FILE_NOT_CLEAN`,
   * FILES_AND_REPORTS.md section 1, step 6). A file of the wrong purpose answers `NOT_FOUND`
   * too, so one purpose's file cannot be smuggled into another's slot.
   */
  async requireClean(
    tx: Prisma.TransactionClient,
    fileId: string,
    expectedPurposes: readonly FilePurpose[],
  ): Promise<CleanFile> {
    const row = await tx.fileObject.findUnique({ where: { id: fileId } });
    if (!row || !expectedPurposes.includes(row.purpose)) throw fileNotFound();
    if (row.scanStatus !== 'CLEAN' || row.sha256 === null || row.detectedContentType === null) {
      throw new FilesError('FILE_NOT_CLEAN', {
        reason: 'FILE_NOT_AVAILABLE',
        detail: 'The file has not passed its scan and checks.',
      });
    }
    return {
      id: row.id,
      purpose: row.purpose,
      sha256: Buffer.from(row.sha256),
      sizeBytes: Number(row.sizeBytes),
      detectedContentType: row.detectedContentType,
      ownerOrgId: row.ownerOrgId,
    };
  }

  /**
   * Whether the bytes still match the hash recorded when the file was validated: for the
   * stamping and verification tasks, which read the file and must prove it is the file that
   * was approved. Constant-time comparison.
   */
  verifyHash(expected: Uint8Array, actual: Uint8Array): boolean {
    if (expected.byteLength !== actual.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < expected.byteLength; index += 1) {
      difference |= (expected[index] ?? 0) ^ (actual[index] ?? 0);
    }
    return difference === 0;
  }

  // ------------------------------------------------------------------ scan result

  /** Reads what the scan step needs. Run as `system`. `null` for an unknown file. */
  async getScanSubject(tx: Prisma.TransactionClient, fileId: string): Promise<ScanSubject | null> {
    const row = await tx.fileObject.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        purpose: true,
        bucket: true,
        objectKey: true,
        declaredContentType: true,
        sizeBytes: true,
        scanStatus: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      purpose: row.purpose,
      bucket: row.bucket,
      objectKey: row.objectKey,
      declaredContentType: row.declaredContentType,
      declaredSizeBytes: Number(row.sizeBytes),
      scanStatus: row.scanStatus,
    };
  }

  /**
   * Records the outcome of the scan and validation, in the caller's transaction: the status,
   * hash, detected type and (for `CLEAN`) the clean key move in one UPDATE that matches only
   * a file still `PENDING` or `ERROR` at the key the decision was made for, so two decisions
   * racing on one file cannot both win. Returns `'stale'` when it lost. Writes an audit entry
   * and an outbox event (`file.available` or `file.rejected`) that carry ids, the purpose
   * and reason codes, never a name, a key or contents. Run as `system`.
   */
  async applyScanDecision(
    tx: Prisma.TransactionClient,
    subject: ScanSubject,
    decision: ScanDecision,
  ): Promise<ApplyScanResult> {
    const completedAt = this.deps.clock.now();
    const data: Prisma.FileObjectUpdateManyMutationInput = {
      scanStatus: decision.status,
      scanCompletedAt: completedAt,
    };
    switch (decision.status) {
      case 'CLEAN':
        data.sha256 = new Uint8Array(decision.sha256);
        data.detectedContentType = decision.detectedContentType;
        data.objectKey = decision.cleanKey;
        data.objectVersionId = decision.versionId ?? null;
        // A re-encoded image: the column holds the size of the stored object (written once,
        // here, with the hash and the key; the frozen-columns trigger forbids a later change).
        if (decision.reencoded) data.sizeBytes = BigInt(decision.reencoded.sizeBytes);
        break;
      case 'REJECTED':
        data.validationErrors = { reasons: decision.reasons };
        if (decision.detectedContentType !== undefined) {
          data.detectedContentType = decision.detectedContentType;
        }
        break;
      case 'INFECTED':
        data.validationErrors = { reasons: ['MALWARE_DETECTED'] };
        break;
      case 'ERROR':
        data.validationErrors = { reasons: ['SCAN_ERROR'] };
        break;
    }

    const updated = await tx.fileObject.updateMany({
      where: {
        id: subject.id,
        scanStatus: { in: OPEN_SCAN_STATUSES },
        objectKey: subject.objectKey,
      },
      data,
    });
    if (updated.count === 0) return 'stale';

    await this.deps.audit.record(tx, {
      actor: 'SYSTEM',
      action: 'file.scan_completed',
      entityType: 'file_object',
      entityId: subject.id,
      after: {
        purpose: subject.purpose,
        status: decision.status,
        ...(decision.status === 'REJECTED' ? { reasons: decision.reasons } : {}),
        ...(decision.status === 'CLEAN' && decision.reencoded
          ? {
              reencoded: true,
              storedSizeBytes: decision.reencoded.sizeBytes,
              uploadedSizeBytes: decision.reencoded.originalSizeBytes,
            }
          : {}),
      },
    });
    if (
      decision.status === 'CLEAN' ||
      decision.status === 'REJECTED' ||
      decision.status === 'INFECTED'
    ) {
      await this.deps.outbox.enqueue(tx, {
        type: decision.status === 'CLEAN' ? 'file.available' : 'file.rejected',
        aggregate: { type: 'file_object', id: subject.id },
        actor: 'SYSTEM',
        data: {
          fileId: subject.id,
          purpose: subject.purpose,
          status: decision.status,
          ...(decision.status === 'REJECTED' ? { reasons: decision.reasons } : {}),
          ...(decision.status === 'CLEAN' && decision.reencoded
            ? { reencoded: true, storedSizeBytes: decision.reencoded.sizeBytes }
            : {}),
        },
      });
    }
    return 'applied';
  }
}
