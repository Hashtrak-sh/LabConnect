import { type PrismaClient, withDbContext } from '@labconnect/database';
import { processOnce } from '../platform/process-once.js';
import type { FileService, ScanDecision, ScanSubject } from './file-service.js';
import { cleanKey, type FilesConfig, quarantineKey } from './keys.js';
import type { ScanResultMessage } from './scanner.js';
import { ObjectNotFoundError, type ObjectStorage, ObjectTooLargeError } from './storage.js';
import { validateContent } from './validation.js';

/** The consumer name `processOnce` records scan results under. */
export const SCAN_CONSUMER = 'files.scan-result';

export type ScanProcessResult =
  /** The decision was written. */
  | { outcome: 'applied'; status: ScanDecision['status'] }
  /** This event id was already processed. Nothing was written. */
  | { outcome: 'duplicate' }
  /** The file had already left `PENDING`/`ERROR` (a different event decided first). Nothing was written. */
  | { outcome: 'already_final' }
  /** No such file (for example a stray object in the quarantine prefix). Acknowledge and move on. */
  | { outcome: 'unknown_file' };

export interface ScanProcessorDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  files: FileService;
  storage: ObjectStorage;
  config: () => FilesConfig;
}

/**
 * Handles one scan result (FILES_AND_REPORTS.md section 1, steps 4 and 5):
 *
 *   1. read the file's facts (short transaction);
 *   2. no transaction: on a `CLEAN` verdict, `head` the object, check the size, read it
 *      (pinned to the etag), validate it, hash it, and only then copy it to the clean prefix
 *      (pinned to the same etag, so a client re-uploading through its still-valid URL cannot
 *      swap the bytes between validation and promotion);
 *   3. one transaction: `processOnce` on the event id, and the compare-and-set status change
 *      with its audit entry and outbox event;
 *   4. no transaction: after a `CLEAN` commit, delete the quarantine object.
 *
 * S3 is never called inside a transaction. Every step is safe to repeat, so any failure is
 * left to message redelivery: a copy that happened without its commit is repeated to the same
 * clean key with the same bytes; a commit without the delete is finished by the next delivery
 * (and, failing that, by the quarantine prefix's lifecycle rule). An `INFECTED` or `REJECTED`
 * object stays in quarantine for the 30-day lifecycle, as FILES_AND_REPORTS.md says.
 *
 * Unreadable or unverifiable states throw (the message is redelivered and ends in the
 * dead-letter queue); a file that is invalid is a normal outcome (`REJECTED`), not an error.
 */
export class FileScanProcessor {
  constructor(private readonly deps: ScanProcessorDeps) {}

  async handle(message: ScanResultMessage): Promise<ScanProcessResult> {
    const { prisma, files } = this.deps;
    const config = this.deps.config();

    const subject = await withDbContext(prisma, { kind: 'system' }, (tx) =>
      files.getScanSubject(tx, message.fileId),
    );
    if (!subject) return { outcome: 'unknown_file' };

    if (subject.scanStatus !== 'PENDING' && subject.scanStatus !== 'ERROR') {
      if (subject.scanStatus === 'CLEAN') await this.deleteQuarantine(subject, config);
      return { outcome: 'already_final' };
    }

    const decision = await this.decide(subject, message.verdict, config);

    const outcome = await withDbContext(prisma, { kind: 'system' }, (tx) =>
      processOnce(tx, SCAN_CONSUMER, message.eventId, (inner) =>
        files.applyScanDecision(inner, subject, decision),
      ),
    );
    if (!outcome.processed) return { outcome: 'duplicate' };
    if (outcome.result === 'stale') {
      // Another decision won. If it was not a `CLEAN` one, the copy made for this decision
      // must not stay in the clean prefix.
      if (decision.status === 'CLEAN') await this.removeStrayCleanCopy(subject, decision.cleanKey);
      return { outcome: 'already_final' };
    }

    if (decision.status === 'CLEAN') await this.deleteQuarantine(subject, config);
    return { outcome: 'applied', status: decision.status };
  }

  private async decide(
    subject: ScanSubject,
    verdict: ScanResultMessage['verdict'],
    config: FilesConfig,
  ): Promise<ScanDecision> {
    if (verdict === 'INFECTED') return { status: 'INFECTED' };
    if (verdict === 'ERROR') return { status: 'ERROR' };

    const { storage } = this.deps;
    const head = await storage.head(subject.bucket, subject.objectKey);
    if (!head)
      return { status: 'REJECTED', reasons: ['OBJECT_MISSING'], detectedContentType: undefined };
    if (head.sizeBytes !== subject.declaredSizeBytes) {
      return { status: 'REJECTED', reasons: ['SIZE_MISMATCH'], detectedContentType: undefined };
    }

    let bytes: Uint8Array;
    try {
      bytes = await storage.read(subject.bucket, subject.objectKey, {
        maxBytes: subject.declaredSizeBytes,
        ifMatchEtag: head.etag,
      });
    } catch (error) {
      if (error instanceof ObjectTooLargeError) {
        return { status: 'REJECTED', reasons: ['SIZE_MISMATCH'], detectedContentType: undefined };
      }
      if (error instanceof ObjectNotFoundError) {
        return { status: 'REJECTED', reasons: ['OBJECT_MISSING'], detectedContentType: undefined };
      }
      throw error; // changed under us, or storage trouble: redeliver
    }

    const validation = validateContent({
      purpose: subject.purpose,
      declaredContentType: subject.declaredContentType,
      declaredSizeBytes: subject.declaredSizeBytes,
      bytes,
    });
    if (!validation.ok) {
      return {
        status: 'REJECTED',
        reasons: validation.reasons,
        detectedContentType: validation.detectedContentType,
      };
    }

    const target = cleanKey(config, subject.purpose, subject.id);
    const copied = await storage.copy({
      bucket: subject.bucket,
      fromKey: subject.objectKey,
      toKey: target,
      ifMatchEtag: head.etag,
    });
    return {
      status: 'CLEAN',
      sha256: validation.sha256,
      detectedContentType: validation.detectedContentType,
      cleanKey: target,
      versionId: copied.versionId,
    };
  }

  private async removeStrayCleanCopy(subject: ScanSubject, key: string): Promise<void> {
    const current = await withDbContext(this.deps.prisma, { kind: 'system' }, (tx) =>
      this.deps.files.getScanSubject(tx, subject.id),
    );
    // A file that is `CLEAN` owns that key (the winner copied the same bytes to it).
    if (current && current.scanStatus !== 'CLEAN') {
      await this.deps.storage.delete(subject.bucket, key);
    }
  }

  /** Best effort: a quarantine object left behind is removed by the prefix's lifecycle rule. */
  private async deleteQuarantine(subject: ScanSubject, config: FilesConfig): Promise<void> {
    try {
      await this.deps.storage.delete(
        subject.bucket,
        quarantineKey(config, subject.purpose, subject.id),
      );
    } catch {
      // Intentionally ignored: nothing about the file's state depends on it.
    }
  }
}
