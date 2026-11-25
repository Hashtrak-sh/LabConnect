import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { type DbContext, type FilePurpose, type Prisma, withDbContext } from '@labconnect/database';
import { createCustomer } from '@labconnect/database/test-utils';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AuditService,
  buildScanResultEnvelope,
  consumeFilesQueue,
  DevScanRunner,
  FakeMalwareScanner,
  FAKE_INFECTED_MARKER,
  FileScanProcessor,
  FileService,
  type FilesConfig,
  FilesError,
  FixedClock,
  GuardDutyMalwareScanner,
  InMemoryObjectStorage,
  InMemoryQueueConsumer,
  ObjectChangedError,
  type ObjectStorage,
  OutboxService,
  QUEUES,
  type ReadOptions,
  type UploadTicket,
} from '../../src/index.js';
import { csvBytes, minimalPdf, PNG_BYTES, text } from '../support/files.js';
import { failure, usePlatform } from './support.js';

// P3-06: files, connected as the real roles (tenant = API role, scan processing = worker role).

const config: FilesConfig = {
  bucket: 'labconnect-test',
  quarantinePrefix: 'quarantine',
  cleanPrefix: 'clean',
};
const FILE_NAME = 'Confidential Draft - Asha Rao.pdf';

describe('files', () => {
  const { api, worker, owner, db } = usePlatform();
  const clock = new FixedClock('2026-11-25T10:00:00Z');

  /** Fails the test if storage is called while a database transaction is open. */
  class GuardedStorage extends InMemoryObjectStorage {
    inTransaction = false;
    violations: string[] = [];
    override read(bucket: string, key: string, options: ReadOptions): Promise<Uint8Array> {
      this.check('read');
      return super.read(bucket, key, options);
    }
    override head(bucket: string, key: string) {
      this.check('head');
      return super.head(bucket, key);
    }
    override putObject(request: Parameters<ObjectStorage['putObject']>[0]) {
      this.check('putObject');
      return super.putObject(request);
    }
    override copy(request: Parameters<ObjectStorage['copy']>[0]) {
      this.check('copy');
      return super.copy(request);
    }
    override delete(bucket: string, key: string) {
      this.check('delete');
      return super.delete(bucket, key);
    }
    override presignPut(request: Parameters<ObjectStorage['presignPut']>[0]) {
      this.check('presignPut');
      return super.presignPut(request);
    }
    override presignGet(request: Parameters<ObjectStorage['presignGet']>[0]) {
      this.check('presignGet');
      return super.presignGet(request);
    }
    private check(operation: string): void {
      if (this.inTransaction) this.violations.push(operation);
    }
  }

  function setup() {
    const storage = new GuardedStorage(clock);
    const files = new FileService({
      clock,
      audit: new AuditService(clock),
      outbox: new OutboxService(clock),
      storage,
      config: () => config,
    });
    // The worker client, with a flag that says whether a transaction is open.
    const prisma = {
      $transaction: ((fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) =>
        worker().$transaction(async (tx) => {
          storage.inTransaction = true;
          try {
            return await fn(tx);
          } finally {
            storage.inTransaction = false;
          }
        }, options)) as ReturnType<typeof worker>['$transaction'],
    };
    const processor = new FileScanProcessor({ prisma, files, storage, config: () => config });
    return { storage, files, processor, prisma };
  }

  async function tenants() {
    const a = await owner().$transaction((tx) =>
      createCustomer(tx, { tag: randomUUID().slice(0, 8) }),
    );
    const b = await owner().$transaction((tx) =>
      createCustomer(tx, { tag: randomUUID().slice(0, 8) }),
    );
    const ctx = (org: { organisationId: string; admin: string }): DbContext => ({
      kind: 'tenant',
      orgId: org.organisationId,
      userId: org.admin,
    });
    return { a, b, ctxA: ctx(a), ctxB: ctx(b) };
  }

  const asTenant = <T>(ctx: DbContext, work: (tx: Prisma.TransactionClient) => Promise<T>) =>
    withDbContext(api(), ctx, work);

  /** Requests an upload as tenant A, commits, presigns, and "uploads" the bytes. */
  async function upload(
    s: ReturnType<typeof setup>,
    t: Awaited<ReturnType<typeof tenants>>,
    options: {
      purpose?: FilePurpose;
      contentType?: string;
      declaredSize?: number;
      bytes: Uint8Array;
      fileName?: string;
      labOrgId?: string;
      put?: boolean;
    },
  ): Promise<UploadTicket> {
    const ticket = await asTenant(t.ctxA, (tx) =>
      s.files.requestUpload(tx, {
        purpose: options.purpose ?? 'REPORT_ORIGINAL',
        ownerOrgId: t.a.organisationId,
        labOrgId: options.labOrgId ?? null,
        declaredContentType: options.contentType ?? 'application/pdf',
        declaredSizeBytes: options.declaredSize ?? options.bytes.byteLength,
        fileName: options.fileName ?? FILE_NAME,
        uploadedByUserId: t.a.admin,
      }),
    );
    if (options.put !== false) {
      s.storage.put(
        ticket.bucket,
        ticket.key,
        options.bytes,
        options.contentType ?? 'application/pdf',
      );
    }
    return ticket;
  }

  const scanMessage = (fileId: string, verdict: 'CLEAN' | 'INFECTED' | 'ERROR' = 'CLEAN') => ({
    eventId: randomUUID(),
    fileId,
    verdict,
  });

  const row = async (fileId: string) =>
    (
      await db().query<{
        scan_status: string;
        object_key: string;
        sha256: Buffer | null;
        detected_content_type: string | null;
        validation_errors: { reasons: string[] } | null;
        original_filename: string | null;
        scan_completed_at: Date | null;
      }>(
        `SELECT scan_status, object_key, sha256, detected_content_type, validation_errors,
                original_filename, scan_completed_at FROM file_object WHERE id = $1`,
        [fileId],
      )
    ).rows[0];

  describe('request upload and presign', () => {
    it("records a PENDING file under the quarantine prefix, with an id-only key, for the caller's own organisation", async () => {
      const s = setup();
      const t = await tenants();
      const bytes = minimalPdf();
      const ticket = await upload(s, t, { bytes, put: false });

      expect(ticket.key).toBe(`quarantine/REPORT_ORIGINAL/${ticket.fileId}`);
      expect(ticket.key).not.toContain('Asha');
      const stored = await row(ticket.fileId);
      expect(stored).toMatchObject({
        scan_status: 'PENDING',
        object_key: ticket.key,
        sha256: null,
      });
      expect(stored?.original_filename).toBe(FILE_NAME);
      const owned = await db().query('SELECT owner_org_id FROM file_object WHERE id = $1', [
        ticket.fileId,
      ]);
      expect(owned.rows[0]).toEqual({ owner_org_id: t.a.organisationId });

      const presigned = await s.files.presignUpload(ticket);
      expect(presigned).toMatchObject({
        fileId: ticket.fileId,
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength) },
      });
      expect(presigned.uploadUrl).toContain(ticket.key);
      expect(presigned.expiresAt.toISOString()).toBe('2026-11-25T10:15:00.000Z');
      expect(s.storage.presignedPuts[0]).toMatchObject({
        expiresInSeconds: 900,
        sizeBytes: bytes.byteLength,
      });
      expect(s.storage.violations).toEqual([]);
    });

    it('refuses a type or size the purpose does not allow, and writes nothing', async () => {
      const s = setup();
      const t = await tenants();
      const before = (await db().query('SELECT count(*)::int AS n FROM file_object')).rows[0] as {
        n: number;
      };
      const attempt = (contentType: string, size: number, purpose: FilePurpose = 'IMPORT_SOURCE') =>
        asTenant(t.ctxA, (tx) =>
          s.files.requestUpload(tx, {
            purpose,
            ownerOrgId: t.a.organisationId,
            declaredContentType: contentType,
            declaredSizeBytes: size,
            uploadedByUserId: t.a.admin,
          }),
        );
      await expect(attempt('application/pdf', 100)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(attempt('text/csv', 51 * 1024 * 1024)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(attempt('application/pdf', 100, 'FINANCIAL_DOCUMENT')).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      const after = (await db().query('SELECT count(*)::int AS n FROM file_object')).rows[0] as {
        n: number;
      };
      expect(after.n).toBe(before.n);
    });

    it('does not let a tenant create a file owned by another organisation', async () => {
      const s = setup();
      const t = await tenants();
      const result = await failure(() =>
        asTenant(t.ctxA, (tx) =>
          s.files.requestUpload(tx, {
            purpose: 'KYC_DOCUMENT',
            ownerOrgId: t.b.organisationId,
            declaredContentType: 'application/pdf',
            declaredSizeBytes: 100,
            uploadedByUserId: t.a.admin,
          }),
        ),
      );
      expect(result.state).toBe('42501');
    });
  });

  describe('tenant isolation', () => {
    it('hides a file from another tenant, for download and for reference, until it is shared as a party', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf(), purpose: 'BOOKING_ATTACHMENT' });
      await s.processor.handle(scanMessage(ticket.fileId));
      expect((await row(ticket.fileId))?.scan_status).toBe('CLEAN');

      const asB = (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        asTenant(t.ctxB, work);
      await expect(
        asB((tx) =>
          s.files.requestDownload(tx, { fileId: ticket.fileId, actor: { userId: t.b.admin } }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        asB((tx) => s.files.requireClean(tx, ticket.fileId, ['BOOKING_ATTACHMENT'])),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const visible = await asB((tx) => tx.fileObject.count({ where: { id: ticket.fileId } }));
      expect(visible).toBe(0);

      // The owner still can.
      await expect(
        asTenant(t.ctxA, (tx) =>
          s.files.requestDownload(tx, { fileId: ticket.fileId, actor: { userId: t.a.admin } }),
        ),
      ).resolves.toMatchObject({ fileId: ticket.fileId });
    });

    it('lets the other booking party see the file when it is named as customer or lab', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, {
        bytes: minimalPdf(),
        purpose: 'BOOKING_ATTACHMENT',
        labOrgId: t.b.organisationId,
      });
      await s.processor.handle(scanMessage(ticket.fileId));
      await expect(
        asTenant(t.ctxB, (tx) =>
          s.files.requestDownload(tx, { fileId: ticket.fileId, actor: { userId: t.b.admin } }),
        ),
      ).resolves.toMatchObject({ fileId: ticket.fileId });
    });
  });

  describe('scan result: clean', () => {
    it('validates, hashes, promotes to the clean prefix, and marks the file CLEAN with the right hash', async () => {
      const s = setup();
      const t = await tenants();
      const bytes = minimalPdf();
      const ticket = await upload(s, t, { bytes });

      const result = await s.processor.handle(scanMessage(ticket.fileId));
      expect(result).toEqual({ outcome: 'applied', status: 'CLEAN' });

      const stored = await row(ticket.fileId);
      const cleanKey = `clean/REPORT_ORIGINAL/${ticket.fileId}`;
      expect(stored).toMatchObject({
        scan_status: 'CLEAN',
        object_key: cleanKey,
        detected_content_type: 'application/pdf',
      });
      expect(stored?.sha256?.toString('hex')).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
      expect(stored?.scan_completed_at?.toISOString()).toBe('2026-11-25T10:00:00.000Z');
      expect(s.storage.has(config.bucket, cleanKey)).toBe(true);
      expect(Buffer.from(s.storage.bytesOf(config.bucket, cleanKey) ?? [])).toEqual(
        Buffer.from(bytes),
      );
      // the quarantine copy is gone, the original is not kept twice
      expect(s.storage.has(config.bucket, ticket.key)).toBe(false);
      // no S3 call while a transaction was open
      expect(s.storage.violations).toEqual([]);
    });

    it('validates before it promotes: nothing reaches the clean prefix for an invalid file', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf({ trailerExtra: '/Encrypt 9 0 R' }) });
      await s.processor.handle(scanMessage(ticket.fileId));
      expect(s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'))).toEqual([]);
      expect(s.storage.calls).not.toContain('copy');
    });

    it('does the storage steps in order: head, read, copy, and deletes the quarantine object last', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      s.storage.calls.length = 0;
      await s.processor.handle(scanMessage(ticket.fileId));
      expect(s.storage.calls).toEqual(['head', 'read', 'copy', 'delete']);
    });

    it('writes an audit entry and an outbox event with ids and codes only, never a name or a key', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      await s.processor.handle(scanMessage(ticket.fileId));

      const audit = await db().query<{
        action: string;
        actor_user_id: string | null;
        after: unknown;
      }>(`SELECT action, actor_user_id, after FROM audit_log WHERE entity_id = $1`, [
        ticket.fileId,
      ]);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        action: 'file.scan_completed',
        actor_user_id: null,
        after: { purpose: 'REPORT_ORIGINAL', status: 'CLEAN' },
      });
      const events = await db().query<{ event_type: string; payload: unknown }>(
        `SELECT event_type, payload FROM outbox_event WHERE aggregate_id = $1`,
        [ticket.fileId],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.event_type).toBe('file.available');
      for (const written of [JSON.stringify(audit.rows), JSON.stringify(events.rows)]) {
        expect(written).not.toContain('Asha');
        expect(written).not.toContain('Confidential');
        expect(written).not.toContain('quarantine/');
        expect(written).not.toContain('clean/');
      }
    });
  });

  describe('scan result: infected or invalid', () => {
    it('marks an infected file INFECTED, keeps it in quarantine, and never lets it be downloaded or referenced', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const result = await s.processor.handle(scanMessage(ticket.fileId, 'INFECTED'));
      expect(result).toEqual({ outcome: 'applied', status: 'INFECTED' });

      const stored = await row(ticket.fileId);
      expect(stored).toMatchObject({
        scan_status: 'INFECTED',
        object_key: ticket.key,
        sha256: null,
      });
      expect(stored?.validation_errors).toEqual({ reasons: ['MALWARE_DETECTED'] });
      expect(s.storage.has(config.bucket, ticket.key)).toBe(true);
      expect(s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'))).toEqual([]);

      await expect(
        asTenant(t.ctxA, (tx) =>
          s.files.requestDownload(tx, { fileId: ticket.fileId, actor: { userId: t.a.admin } }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', meta: { reason: 'FILE_NOT_AVAILABLE' } });
      await expect(
        asTenant(t.ctxA, (tx) => s.files.requireClean(tx, ticket.fileId, ['REPORT_ORIGINAL'])),
      ).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN' });
      const event = await db().query<{ event_type: string }>(
        `SELECT event_type FROM outbox_event WHERE aggregate_id = $1`,
        [ticket.fileId],
      );
      expect(event.rows.map((r) => r.event_type)).toEqual(['file.rejected']);
    });

    it('does not decide a file on a scan error, and lets a later result decide it', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      await s.processor.handle(scanMessage(ticket.fileId, 'ERROR'));
      expect((await row(ticket.fileId))?.scan_status).toBe('ERROR');
      await expect(
        asTenant(t.ctxA, (tx) =>
          s.files.requestDownload(tx, { fileId: ticket.fileId, actor: { userId: t.a.admin } }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await s.processor.handle(scanMessage(ticket.fileId, 'CLEAN'));
      expect((await row(ticket.fileId))?.scan_status).toBe('CLEAN');
    });

    it('rejects a file whose size is not the declared size', async () => {
      const s = setup();
      const t = await tenants();
      const bytes = minimalPdf();
      const ticket = await upload(s, t, { bytes, declaredSize: bytes.byteLength - 7 });
      const result = await s.processor.handle(scanMessage(ticket.fileId));
      expect(result).toEqual({ outcome: 'applied', status: 'REJECTED' });
      const stored = await row(ticket.fileId);
      expect(stored?.scan_status).toBe('REJECTED');
      expect(stored?.validation_errors).toEqual({ reasons: ['SIZE_MISMATCH'] });
      expect(s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'))).toEqual([]);
      expect(s.storage.has(config.bucket, ticket.key)).toBe(true);
    });

    it('rejects a file whose bytes are not the declared type', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, {
        bytes: PNG_BYTES,
        purpose: 'KYC_DOCUMENT',
        contentType: 'application/pdf',
      });
      await s.processor.handle(scanMessage(ticket.fileId));
      const stored = await row(ticket.fileId);
      expect(stored?.scan_status).toBe('REJECTED');
      expect(stored?.validation_errors).toEqual({ reasons: ['CONTENT_TYPE_MISMATCH'] });
      expect(stored?.detected_content_type).toBe('image/png');
    });

    it('rejects an encrypted or JavaScript-bearing report PDF and says why', async () => {
      const s = setup();
      const t = await tenants();
      const encrypted = await upload(s, t, {
        bytes: minimalPdf({ trailerExtra: '/Encrypt 9 0 R' }),
      });
      const scripted = await upload(s, t, {
        bytes: minimalPdf({ bodyExtra: '<< /S /JavaScript /JS (x) >>' }),
      });
      await s.processor.handle(scanMessage(encrypted.fileId));
      await s.processor.handle(scanMessage(scripted.fileId));
      expect((await row(encrypted.fileId))?.validation_errors).toEqual({
        reasons: ['PDF_ENCRYPTED'],
      });
      expect((await row(scripted.fileId))?.validation_errors).toEqual({
        reasons: ['PDF_JAVASCRIPT'],
      });
    });

    it('rejects a file that was never uploaded', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf(), put: false });
      await s.processor.handle(scanMessage(ticket.fileId));
      expect((await row(ticket.fileId))?.validation_errors).toEqual({
        reasons: ['OBJECT_MISSING'],
      });
    });

    it('answers a scan result for an unknown file without writing anything', async () => {
      const s = setup();
      expect(await s.processor.handle(scanMessage(randomUUID()))).toEqual({
        outcome: 'unknown_file',
      });
    });
  });

  describe('idempotency and races', () => {
    it('processes a duplicate scan message once', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const message = scanMessage(ticket.fileId);
      const first = await s.processor.handle(message);
      const second = await s.processor.handle(message);
      expect(first).toEqual({ outcome: 'applied', status: 'CLEAN' });
      expect(second.outcome).not.toBe('applied');
      const events = await db().query(`SELECT 1 FROM outbox_event WHERE aggregate_id = $1`, [
        ticket.fileId,
      ]);
      const audits = await db().query(`SELECT 1 FROM audit_log WHERE entity_id = $1`, [
        ticket.fileId,
      ]);
      expect(events.rowCount).toBe(1);
      expect(audits.rowCount).toBe(1);
    });

    it('skips a message whose event id is already recorded, leaving the file as it was', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const message = scanMessage(ticket.fileId);
      await db().query(`INSERT INTO processed_event (consumer, event_id) VALUES ($1, $2)`, [
        'files.scan-result',
        message.eventId,
      ]);
      expect(await s.processor.handle(message)).toEqual({ outcome: 'duplicate' });
      expect((await row(ticket.fileId))?.scan_status).toBe('PENDING');
      const events = await db().query(`SELECT 1 FROM outbox_event WHERE aggregate_id = $1`, [
        ticket.fileId,
      ]);
      expect(events.rowCount).toBe(0);
    });

    it('never leaves an infected file with a copy in the clean prefix when two results race', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      await Promise.all([
        s.processor.handle(scanMessage(ticket.fileId, 'CLEAN')),
        s.processor.handle(scanMessage(ticket.fileId, 'INFECTED')),
      ]);
      const stored = await row(ticket.fileId);
      const cleanCopies = s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'));
      if (stored?.scan_status === 'CLEAN') {
        expect(cleanCopies).toEqual([`clean/REPORT_ORIGINAL/${ticket.fileId}`]);
      } else {
        expect(stored?.scan_status).toBe('INFECTED');
        expect(cleanCopies).toEqual([]);
      }
      const events = await db().query(`SELECT 1 FROM outbox_event WHERE aggregate_id = $1`, [
        ticket.fileId,
      ]);
      expect(events.rowCount).toBe(1);
    });

    it('does not promote bytes that were swapped after the head request: the copy is pinned to the etag', async () => {
      const s = setup();
      const t = await tenants();
      const good = minimalPdf();
      const ticket = await upload(s, t, { bytes: good });
      const evil = minimalPdf({ bodyExtra: '<< /S /JavaScript /JS (x) >>' });
      // A client re-uploads through its still-valid URL right after the worker's head request.
      const originalRead = s.storage.read.bind(s.storage);
      s.storage.read = (bucket, key, options) => {
        s.storage.put(bucket, key, evil, 'application/pdf');
        return originalRead(bucket, key, options);
      };
      await expect(s.processor.handle(scanMessage(ticket.fileId))).rejects.toBeInstanceOf(
        ObjectChangedError,
      );
      expect((await row(ticket.fileId))?.scan_status).toBe('PENDING');
      expect(s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'))).toEqual([]);
    });
  });

  describe('download URL', () => {
    it('is issued only for a CLEAN file, 15 minutes, as an attachment, with an audit entry for report files', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const ask = () =>
        asTenant(t.ctxA, (tx) =>
          s.files.requestDownload(tx, {
            fileId: ticket.fileId,
            actor: { userId: t.a.admin, orgId: t.a.organisationId },
            requestId: 'req-1',
          }),
        );
      await expect(ask()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        meta: { reason: 'FILE_NOT_AVAILABLE' },
      });
      expect(s.storage.presignedGets).toEqual([]);

      await s.processor.handle(scanMessage(ticket.fileId));
      const download = await s.files.presignDownload(await ask());
      expect(download.expiresAt.toISOString()).toBe('2026-11-25T10:15:00.000Z');
      expect(s.storage.presignedGets[0]).toMatchObject({
        key: `clean/REPORT_ORIGINAL/${ticket.fileId}`,
        expiresInSeconds: 900,
        contentType: 'application/pdf',
      });
      const audits = await db().query<{
        action: string;
        actor_user_id: string;
        request_id: string;
      }>(
        `SELECT action, actor_user_id, request_id FROM audit_log WHERE entity_id = $1 AND action = 'file.download_url'`,
        [ticket.fileId],
      );
      expect(audits.rows).toEqual([
        { action: 'file.download_url', actor_user_id: t.a.admin, request_id: 'req-1' },
      ]);
    });

    it('does not audit downloads of a purpose that is not Restricted', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, {
        bytes: csvBytes(),
        purpose: 'IMPORT_SOURCE',
        contentType: 'text/csv',
      });
      await s.processor.handle(scanMessage(ticket.fileId));
      await asTenant(t.ctxA, (tx) =>
        s.files.requestDownload(tx, { fileId: ticket.fileId, actor: { userId: t.a.admin } }),
      );
      const audits = await db().query(
        `SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'file.download_url'`,
        [ticket.fileId],
      );
      expect(audits.rowCount).toBe(0);
    });

    it('answers NOT_FOUND for an id that does not exist', async () => {
      const s = setup();
      const t = await tenants();
      await expect(
        asTenant(t.ctxA, (tx) =>
          s.files.requestDownload(tx, { fileId: randomUUID(), actor: { userId: t.a.admin } }),
        ),
      ).rejects.toBeInstanceOf(FilesError);
    });
  });

  describe('references (requireClean)', () => {
    it('accepts a clean file of the expected purpose and refuses everything else', async () => {
      const s = setup();
      const t = await tenants();
      const pending = await upload(s, t, { bytes: minimalPdf() });
      const clean = await upload(s, t, { bytes: minimalPdf() });
      await s.processor.handle(scanMessage(clean.fileId));
      const as = (id: string, purposes: FilePurpose[]) =>
        asTenant(t.ctxA, (tx) => s.files.requireClean(tx, id, purposes));

      await expect(as(pending.fileId, ['REPORT_ORIGINAL'])).rejects.toMatchObject({
        code: 'FILE_NOT_CLEAN',
      });
      await expect(as(clean.fileId, ['KYC_DOCUMENT'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(as(randomUUID(), ['REPORT_ORIGINAL'])).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const ok = await as(clean.fileId, ['REPORT_ORIGINAL']);
      expect(ok).toMatchObject({
        id: clean.fileId,
        purpose: 'REPORT_ORIGINAL',
        detectedContentType: 'application/pdf',
      });
      expect(
        s.files.verifyHash(ok.sha256, createHash('sha256').update(minimalPdf()).digest()),
      ).toBe(true);
    });
  });

  describe('the database refuses to rewrite a file', () => {
    it('lets only the scan job (system) change the stored object or the status, and never again once decided', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });

      // A tenant cannot mark its own upload clean.
      const byTenant = await failure(() =>
        asTenant(t.ctxA, (tx) =>
          tx.fileObject.update({ where: { id: ticket.fileId }, data: { scanStatus: 'CLEAN' } }),
        ),
      );
      expect(byTenant.state).toBe('LC003');
      // Not even with the database owner's connection.
      await expect(
        db().query(`UPDATE file_object SET sha256 = '\\x00' WHERE id = $1`, [ticket.fileId]),
      ).rejects.toMatchObject({ code: 'LC003' });
      // The name may be edited.
      await asTenant(t.ctxA, (tx) =>
        tx.fileObject.update({
          where: { id: ticket.fileId },
          data: { originalFilename: 'renamed.pdf' },
        }),
      );

      await s.processor.handle(scanMessage(ticket.fileId));
      const afterClean = (target: string, value: string) =>
        failure(() =>
          withDbContext(worker(), { kind: 'system' }, (tx) =>
            tx.$executeRawUnsafe(
              `UPDATE file_object SET ${target} = ${value} WHERE id = '${ticket.fileId}'`,
            ),
          ),
        );
      expect((await afterClean('scan_status', `'INFECTED'`)).state).toBe('LC003');
      expect((await afterClean('object_key', `'clean/other/key'`)).state).toBe('LC003');
      expect((await afterClean('sha256', `'\\x00'::bytea`)).state).toBe('LC003');
      expect((await row(ticket.fileId))?.scan_status).toBe('CLEAN');
    });

    it('does not let a rejected file become clean', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      await s.processor.handle(scanMessage(ticket.fileId, 'INFECTED'));
      const revive = await failure(() =>
        withDbContext(worker(), { kind: 'system' }, (tx) =>
          tx.fileObject.update({ where: { id: ticket.fileId }, data: { scanStatus: 'CLEAN' } }),
        ),
      );
      expect(revive.state).toBe('LC003');
      // and the service itself will not decide it again
      expect(await s.processor.handle(scanMessage(ticket.fileId, 'CLEAN'))).toEqual({
        outcome: 'already_final',
      });
      expect((await row(ticket.fileId))?.scan_status).toBe('INFECTED');
    });
  });

  describe('the worker consumer, end to end', () => {
    it('turns a scan-result message on the queue into an available file, and acknowledges it', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const queue = new InMemoryQueueConsumer();
      const body = JSON.stringify(buildScanResultEnvelope(scanMessage(ticket.fileId), clock.now()));
      queue.send(QUEUES.files, body);
      // the same message delivered twice, as SQS may
      queue.send(QUEUES.files, body);

      const result = await consumeFilesQueue(queue, s.processor);
      expect(result).toEqual({ received: 2, acknowledged: 2, failed: 0, left: 0 });
      expect((await row(ticket.fileId))?.scan_status).toBe('CLEAN');
      expect(queue.pending(QUEUES.files)).toBe(0);
      const events = await db().query(`SELECT 1 FROM outbox_event WHERE aggregate_id = $1`, [
        ticket.fileId,
      ]);
      expect(events.rowCount).toBe(1);
    });

    it('leaves a failed message for redelivery, and finishes it then', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const queue = new InMemoryQueueConsumer();
      queue.send(
        QUEUES.files,
        JSON.stringify(buildScanResultEnvelope(scanMessage(ticket.fileId), clock.now())),
      );

      // storage fails on the first delivery
      const realHead = s.storage.head.bind(s.storage);
      let fail = true;
      s.storage.head = (bucket, key) =>
        fail ? Promise.reject(new Error('S3 is down')) : realHead(bucket, key);
      expect(await consumeFilesQueue(queue, s.processor)).toMatchObject({
        failed: 1,
        acknowledged: 0,
      });
      expect((await row(ticket.fileId))?.scan_status).toBe('PENDING');
      expect(queue.pending(QUEUES.files)).toBe(1);

      fail = false;
      queue.redeliver(QUEUES.files);
      expect(await consumeFilesQueue(queue, s.processor)).toMatchObject({
        failed: 0,
        acknowledged: 1,
      });
      expect((await row(ticket.fileId))?.scan_status).toBe('CLEAN');
    });

    it('leaves messages it does not understand instead of deleting them', async () => {
      const s = setup();
      const queue = new InMemoryQueueConsumer();
      queue.send(QUEUES.files, JSON.stringify({ id: randomUUID(), type: 'report.stamp' }));
      queue.send(QUEUES.files, 'not json');
      const result = await consumeFilesQueue(queue, s.processor);
      expect(result).toEqual({ received: 2, acknowledged: 0, failed: 1, left: 1 });
      expect(queue.pending(QUEUES.files)).toBe(2);
    });
  });

  describe('GuardDuty results, end to end', () => {
    // Event structure as documented at
    // https://docs.aws.amazon.com/guardduty/latest/ug/monitor-with-eventbridge-s3-malware-protection.html
    const guardDutyEvent = (
      ticket: UploadTicket,
      options: {
        etag: string;
        scanStatus?: string;
        resultStatus?: string;
        id?: string;
        bucket?: string;
        key?: string;
        threats?: unknown;
      },
    ) => ({
      version: '0',
      id: options.id ?? randomUUID(),
      'detail-type': 'GuardDuty Malware Protection Object Scan Result',
      source: 'aws.guardduty',
      account: '111122223333',
      time: '2026-11-25T10:00:00Z',
      region: 'ap-south-1',
      resources: ['arn:aws:guardduty:ap-south-1:111122223333:malware-protection-plan/b4c7f464'],
      detail: {
        schemaVersion: '1.0',
        scanStatus: options.scanStatus ?? 'COMPLETED',
        resourceType: 'S3_OBJECT',
        s3ObjectDetails: {
          bucketName: options.bucket ?? config.bucket,
          objectKey: options.key ?? ticket.key,
          eTag: options.etag,
          versionId: 'v1',
          s3Throttled: false,
        },
        scanResultDetails: {
          scanResultStatus: options.resultStatus ?? 'NO_THREATS_FOUND',
          threats: options.threats ?? null,
          statusReasons: null,
        },
      },
    });

    const etagOf = async (s: ReturnType<typeof setup>, ticket: UploadTicket) =>
      (await s.storage.head(ticket.bucket, ticket.key))?.etag.replaceAll('"', '') ?? '';

    async function deliver(s: ReturnType<typeof setup>, events: unknown[]) {
      const queue = new InMemoryQueueConsumer();
      for (const event of events) queue.send(QUEUES.files, JSON.stringify(event));
      const guardDuty = new GuardDutyMalwareScanner(() => config);
      const result = await consumeFilesQueue(
        queue,
        s.processor,
        { maxMessages: 10 },
        { guardDuty, acceptPlatformEnvelope: false },
      );
      return { result, guardDuty, queue };
    }

    it('NO_THREATS_FOUND makes the file CLEAN, with the right hash', async () => {
      const s = setup();
      const t = await tenants();
      const bytes = minimalPdf();
      const ticket = await upload(s, t, { bytes });
      const event = guardDutyEvent(ticket, { etag: await etagOf(s, ticket) });
      const { result, queue } = await deliver(s, [event]);
      expect(result).toEqual({ received: 1, acknowledged: 1, failed: 0, left: 0 });
      expect(queue.pending(QUEUES.files)).toBe(0);
      const stored = await row(ticket.fileId);
      expect(stored).toMatchObject({
        scan_status: 'CLEAN',
        object_key: `clean/REPORT_ORIGINAL/${ticket.fileId}`,
      });
      expect(stored?.sha256?.toString('hex')).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
      expect(s.storage.violations).toEqual([]);
    });

    it('THREATS_FOUND makes the file INFECTED and keeps it out of the clean prefix', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const event = guardDutyEvent(ticket, {
        etag: await etagOf(s, ticket),
        resultStatus: 'THREATS_FOUND',
        threats: [{ name: 'EICAR-Test-File (not a virus)', source: 'AMAZON' }],
      });
      await deliver(s, [event]);
      expect((await row(ticket.fileId))?.scan_status).toBe('INFECTED');
      expect(s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'))).toEqual([]);
      expect(s.storage.has(config.bucket, ticket.key)).toBe(true);
    });

    it.each([
      ['UNSUPPORTED', 'SKIPPED'],
      ['ACCESS_DENIED', 'SKIPPED'],
      ['FAILED', 'FAILED'],
    ])(
      '%s is a scan error: not clean, and a later result can still decide the file',
      async (resultStatus, scanStatus) => {
        const s = setup();
        const t = await tenants();
        const ticket = await upload(s, t, { bytes: minimalPdf() });
        const etag = await etagOf(s, ticket);
        await deliver(s, [guardDutyEvent(ticket, { etag, resultStatus, scanStatus })]);
        expect((await row(ticket.fileId))?.scan_status).toBe('ERROR');
        expect(s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'))).toEqual([]);

        await deliver(s, [guardDutyEvent(ticket, { etag })]);
        expect((await row(ticket.fileId))?.scan_status).toBe('CLEAN');
      },
    );

    it('does not promote an object that was replaced between the scan and the processing', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const scannedEtag = await etagOf(s, ticket);
      // The client re-uploads through its still-valid URL after GuardDuty scanned the first object.
      const replacement = minimalPdf({ bodyExtra: '<< /S /JavaScript /JS (x) >>' });
      s.storage.put(ticket.bucket, ticket.key, replacement, 'application/pdf');

      await deliver(s, [guardDutyEvent(ticket, { etag: scannedEtag })]);
      expect((await row(ticket.fileId))?.scan_status).toBe('ERROR');
      expect(s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'))).toEqual([]);

      // GuardDuty scans the replacement too; that result, with its own ETag, decides.
      await deliver(s, [guardDutyEvent(ticket, { etag: await etagOf(s, ticket) })]);
      const stored = await row(ticket.fileId);
      expect(stored?.scan_status).toBe('REJECTED'); // the replacement is not the declared size
      expect(stored?.validation_errors?.reasons).toContain('SIZE_MISMATCH');
    });

    it('does not apply a verdict that names another key (another purpose) than the file', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const otherKey = `quarantine/KYC_DOCUMENT/${ticket.fileId}`;
      await deliver(s, [guardDutyEvent(ticket, { etag: await etagOf(s, ticket), key: otherKey })]);
      expect((await row(ticket.fileId))?.scan_status).toBe('ERROR');
    });

    it('processes a duplicate event once', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const event = guardDutyEvent(ticket, { etag: await etagOf(s, ticket) });
      const { result } = await deliver(s, [event, event]);
      expect(result).toMatchObject({ received: 2, acknowledged: 2, failed: 0 });
      expect((await row(ticket.fileId))?.scan_status).toBe('CLEAN');
      const events = await db().query(`SELECT 1 FROM outbox_event WHERE aggregate_id = $1`, [
        ticket.fileId,
      ]);
      expect(events.rowCount).toBe(1);
      const processed = await db().query(
        `SELECT 1 FROM processed_event WHERE consumer = 'files.scan-result' AND event_id = $1::uuid`,
        [event.id],
      );
      expect(processed.rowCount).toBe(1); // the EventBridge event id is the idempotency key
    });

    it('ignores, and counts, events for another bucket or the clean prefix, leaving the file PENDING', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const etag = await etagOf(s, ticket);
      const { result, guardDuty } = await deliver(s, [
        guardDutyEvent(ticket, { etag, bucket: 'another-bucket' }),
        guardDutyEvent(ticket, { etag, key: `clean/REPORT_ORIGINAL/${ticket.fileId}` }),
      ]);
      expect(result).toEqual({ received: 2, acknowledged: 2, failed: 0, left: 0 });
      expect(guardDuty.ignored).toMatchObject({ WRONG_BUCKET: 1, WRONG_PREFIX: 1 });
      expect((await row(ticket.fileId))?.scan_status).toBe('PENDING');
    });

    it('refuses the platform envelope when only GuardDuty may decide (production wiring)', async () => {
      const s = setup();
      const t = await tenants();
      const ticket = await upload(s, t, { bytes: minimalPdf() });
      const envelope = buildScanResultEnvelope(scanMessage(ticket.fileId), clock.now());
      const { result } = await deliver(s, [envelope]);
      expect(result).toMatchObject({ acknowledged: 0, left: 1 });
      expect((await row(ticket.fileId))?.scan_status).toBe('PENDING');
    });
  });

  describe('images: EXIF stripped and re-encoded before promotion', () => {
    const exifJpeg = async () =>
      sharp({ create: { width: 64, height: 32, channels: 3, background: '#3366aa' } })
        .withExif({
          IFD0: { Make: 'LabConnectTestCamera' },
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '12/1 58/1 0/1',
            GPSLongitudeRef: 'E',
            GPSLongitude: '77/1 35/1 0/1',
          },
        })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();

    it('stores the re-encoded bytes, with their hash and size, and no EXIF or GPS', async () => {
      const s = setup();
      const t = await tenants();
      const original = await exifJpeg();
      const ticket = await upload(s, t, {
        bytes: original,
        purpose: 'KYC_DOCUMENT',
        contentType: 'image/jpeg',
      });
      s.storage.calls.length = 0;
      expect(await s.processor.handle(scanMessage(ticket.fileId))).toEqual({
        outcome: 'applied',
        status: 'CLEAN',
      });
      expect(s.storage.calls).toEqual(['head', 'read', 'putObject', 'delete']);

      const stored = await row(ticket.fileId);
      const cleanKey = `clean/KYC_DOCUMENT/${ticket.fileId}`;
      expect(stored).toMatchObject({
        scan_status: 'CLEAN',
        object_key: cleanKey,
        detected_content_type: 'image/jpeg',
      });
      const out = s.storage.bytesOf(config.bucket, cleanKey);
      if (!out) throw new Error('no clean object');
      const meta = await sharp(out).metadata();
      expect(meta.exif).toBeUndefined();
      expect(Buffer.from(out).toString('latin1')).not.toContain('LabConnectTestCamera');
      expect([meta.width, meta.height]).toEqual([32, 64]); // orientation applied to the pixels

      // The hash and the size are those of the stored object, not of what was uploaded.
      expect(stored?.sha256?.toString('hex')).toBe(createHash('sha256').update(out).digest('hex'));
      expect(stored?.sha256?.toString('hex')).not.toBe(
        createHash('sha256').update(original).digest('hex'),
      );
      const size = await db().query<{ size_bytes: string }>(
        `SELECT size_bytes::text FROM file_object WHERE id = $1`,
        [ticket.fileId],
      );
      expect(Number(size.rows[0]?.size_bytes)).toBe(out.byteLength);
      expect(out.byteLength).not.toBe(original.byteLength);

      // Audit and outbox say which size is which.
      const audit = await db().query<{ after: Record<string, unknown> }>(
        `SELECT after FROM audit_log WHERE entity_id = $1`,
        [ticket.fileId],
      );
      expect(audit.rows[0]?.after).toMatchObject({
        status: 'CLEAN',
        reencoded: true,
        storedSizeBytes: out.byteLength,
        uploadedSizeBytes: original.byteLength,
      });
      const events = await db().query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM outbox_event WHERE aggregate_id = $1`,
        [ticket.fileId],
      );
      expect(JSON.stringify(events.rows[0]?.payload)).toContain('"reencoded":true');
      // The quarantine original is deleted, exactly as for other types.
      expect(s.storage.has(config.bucket, ticket.key)).toBe(false);
      expect(s.storage.violations).toEqual([]);
    });

    it('rejects a decompression bomb with a reason code and promotes nothing', async () => {
      const s = setup();
      const t = await tenants();
      // A tiny, valid PNG header that declares 60000 x 60000 pixels.
      const header = Buffer.alloc(13);
      header.writeUInt32BE(60_000, 0);
      header.writeUInt32BE(60_000, 4);
      header[8] = 8;
      const chunk = (type: string, data: Buffer) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
      };
      const bomb = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', Buffer.alloc(8)),
        chunk('IEND', Buffer.alloc(0)),
      ]);
      const ticket = await upload(s, t, {
        bytes: bomb,
        purpose: 'KYC_DOCUMENT',
        contentType: 'image/png',
      });
      await s.processor.handle(scanMessage(ticket.fileId));
      const stored = await row(ticket.fileId);
      expect(stored?.scan_status).toBe('REJECTED');
      expect(stored?.validation_errors?.reasons).toEqual(['IMAGE_TOO_LARGE']);
      expect(s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'))).toEqual([]);
    });

    it('rejects a corrupt image, a PDF sent as a JPEG, and a HEIC (not decodable here)', async () => {
      const s = setup();
      const t = await tenants();
      const good = await exifJpeg();
      const corrupt = await upload(s, t, {
        bytes: good.subarray(0, good.length / 2),
        purpose: 'KYC_DOCUMENT',
        contentType: 'image/jpeg',
      });
      const renamed = await upload(s, t, {
        bytes: minimalPdf(),
        purpose: 'KYC_DOCUMENT',
        contentType: 'image/jpeg',
      });
      const heic = await upload(s, t, {
        bytes: Buffer.concat([
          Buffer.from([0, 0, 0, 24]),
          Buffer.from('ftypheic', 'latin1'),
          Buffer.alloc(12),
        ]),
        purpose: 'RECEIPT_PHOTO',
        contentType: 'image/heic',
      });
      for (const ticket of [corrupt, renamed, heic]) {
        await s.processor.handle(scanMessage(ticket.fileId));
      }
      expect((await row(corrupt.fileId))?.validation_errors?.reasons).toEqual(['IMAGE_INVALID']);
      expect((await row(renamed.fileId))?.validation_errors?.reasons).toContain(
        'CONTENT_TYPE_MISMATCH',
      );
      expect((await row(heic.fileId))?.validation_errors?.reasons).toEqual([
        'IMAGE_FORMAT_UNSUPPORTED',
      ]);
      for (const ticket of [corrupt, renamed, heic]) {
        expect((await row(ticket.fileId))?.scan_status).toBe('REJECTED');
      }
      expect(s.storage.keys(config.bucket).filter((key) => key.startsWith('clean/'))).toEqual([]);
    });
  });

  describe('the dev-only scan (fake scanner)', () => {
    it('makes a local upload available, rejects the marker, and waits for a file that has not arrived', async () => {
      const s = setup();
      const t = await tenants();
      const scanner = new FakeMalwareScanner(s.storage);
      const runner = new DevScanRunner(
        { prisma: s.prisma, storage: s.storage, scanner, processor: s.processor },
        { NODE_ENV: 'development' },
      );
      const clean = await upload(s, t, { bytes: minimalPdf() });
      const infected = await upload(s, t, {
        bytes: text(`a,b\n${FAKE_INFECTED_MARKER},1\n`),
        purpose: 'IMPORT_SOURCE',
        contentType: 'text/csv',
      });
      const missing = await upload(s, t, { bytes: minimalPdf(), put: false });

      const result = await runner.runOnce(500);
      expect(result.failed).toBe(0);
      expect((await row(clean.fileId))?.scan_status).toBe('CLEAN');
      expect((await row(infected.fileId))?.scan_status).toBe('INFECTED');
      expect((await row(missing.fileId))?.scan_status).toBe('PENDING');

      // Running again changes nothing.
      const again = await runner.runOnce(500);
      expect(again.scanned).toBe(0);
    });
  });
});
