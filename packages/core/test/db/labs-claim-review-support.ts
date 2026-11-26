import { randomUUID } from 'node:crypto';
import { type Prisma, type ScanStatus, uuidv7, withDbContext } from '@labconnect/database';
import { createPlatformTeam } from '@labconnect/database/test-utils';
import type { RoleCode } from '@labconnect/shared';
import { expect } from 'vitest';
import {
  AuditService,
  buildCurrentActor,
  type ClaimReviewDeps,
  CoreError,
  type CurrentActor,
  FileService,
  type FilesConfig,
  InMemoryObjectStorage,
  type LetterheadDeps,
  OutboxService,
  type RequestMeta,
  requestClaimLetterheadUpload,
  startLabClaim,
  submitLabClaimLetterhead,
  TenantScope,
  verifyLabClaimOtp,
} from '../../src/index.js';
import { CLAIM_META, type Claimant, useClaimWorld } from './labs-claims-support.js';
import { START } from './identity-support.js';

const files: FilesConfig = {
  bucket: 'labconnect-test',
  quarantinePrefix: 'quarantine',
  cleanPrefix: 'clean',
};

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface Reviewable {
  organisationId: string;
  siteId: string;
  certificateNo: string;
  claimId: string;
  claimant: Claimant;
  method: 'EMAIL_OTP' | 'MANUAL';
  fileId: string | null;
  /** The address the NABL data holds for the site (never in any output of the review). */
  nablEmail: string | null;
}

export interface StateOfTheWorld {
  claims: unknown;
  organisation: unknown;
  memberships: string;
  audit: string;
  outbox: string;
  userMemberships: unknown;
}

/**
 * The world of the claim review tests: the claim world, the Ops team of the platform, a way to
 * build a claim in any state, and a snapshot to prove that a refused operation wrote nothing.
 */
export function useClaimReviewWorld() {
  const w = useClaimWorld();
  const storage = new InMemoryObjectStorage(w.clock);
  const audit = new AuditService(w.clock);
  const outbox = new OutboxService(w.clock);
  const fileService = new FileService({
    clock: w.clock,
    audit,
    outbox,
    storage,
    config: () => files,
  });
  const letterheadDeps: LetterheadDeps = { ...w.deps, files: fileService };
  const review: ClaimReviewDeps = { clock: w.clock, audit, outbox, files: fileService };
  /** Built when first used: the database clients exist only once the tests run. */
  const scope = {
    run: <T>(actor: CurrentActor, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
      new TenantScope(w.api(), audit).run(actor, work),
  };

  let ipCounter = 0;
  const freshMeta = (): RequestMeta => ({
    ...CLAIM_META,
    ipAddress: `192.0.2.${String((ipCounter++ % 250) + 1)}`,
  });

  // ---------------------------------------------------------------- the platform team and actors

  const sessionFor = (userId: string) => ({
    userId,
    sessionId: randomUUID(),
    mfaVerifiedAt: new Date(START),
  });

  const actorOf = async (
    userId: string,
    organisationId: string,
    roles: RoleCode[],
    orgType: 'PLATFORM' | 'LAB' | 'CUSTOMER',
    siteIds: string[] = [],
  ): Promise<CurrentActor> => {
    const membership = await w
      .db()
      .query<{ id: string }>(
        'SELECT id FROM membership WHERE user_id = $1 AND organisation_id = $2',
        [userId, organisationId],
      );
    const id = membership.rows[0]?.id;
    if (id === undefined) throw new Error('the user has no membership there');
    return buildCurrentActor(sessionFor(userId), {
      id,
      organisationId,
      orgType,
      orgStatus: 'ACTIVE',
      roles,
      siteIds,
    });
  };

  let team: Awaited<ReturnType<typeof createPlatformTeam>> | undefined;
  const platformActors = async (): Promise<{
    ops: CurrentActor;
    finance: CurrentActor;
    steward: CurrentActor;
    admin: CurrentActor;
    otherOps: CurrentActor;
  }> => {
    team ??= await w.owner((tx) => createPlatformTeam(tx));
    const t = team;
    const second = await w.owner((tx) =>
      createPlatformTeam(tx, { tag: `second-${randomUUID().slice(0, 6)}` }),
    );
    return {
      ops: await actorOf(t.ops, t.organisationId, ['PLATFORM_OPS'], 'PLATFORM'),
      finance: await actorOf(t.finance, t.organisationId, ['PLATFORM_FINANCE'], 'PLATFORM'),
      steward: await actorOf(t.steward, t.organisationId, ['PLATFORM_DATA_STEWARD'], 'PLATFORM'),
      admin: await actorOf(t.admin, t.organisationId, ['PLATFORM_ADMIN'], 'PLATFORM'),
      otherOps: await actorOf(second.ops, second.organisationId, ['PLATFORM_OPS'], 'PLATFORM'),
    };
  };

  /** Runs `work` as the actor, as the API does: the `platform` context for platform staff. */
  const as = <T>(
    actor: CurrentActor,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> => scope.run(actor, work);

  // ---------------------------------------------------------------- building claims

  const settle = (fileId: string, status: ScanStatus): Promise<unknown> =>
    withDbContext(w.worker(), { kind: 'system' }, (tx) =>
      tx.fileObject.update({
        where: { id: fileId },
        data:
          status === 'CLEAN'
            ? {
                scanStatus: 'CLEAN',
                sha256: new Uint8Array(32).fill(7),
                detectedContentType: 'application/pdf',
              }
            : { scanStatus: status },
      }),
    );

  /** A claim in `PENDING_REVIEW`, made through the lab-side functions. */
  const reviewable = async (
    options: { manual?: boolean; claimant?: Claimant } = {},
  ): Promise<Reviewable> => {
    const lab = await w.lab(options.manual === true ? { email: null } : {});
    const claimant = options.claimant ?? (await w.claimant());
    const started = await w.asSystem((tx) =>
      startLabClaim(tx, w.deps, { actor: claimant.actor, siteId: lab.siteId, meta: freshMeta() }),
    );
    const claimId = started.claim.id;
    let fileId: string | null = null;
    if (options.manual === true) {
      const outcome = await w.asSystem((tx) =>
        requestClaimLetterheadUpload(tx, letterheadDeps, {
          actor: claimant.actor,
          claimId,
          contentType: 'application/pdf',
          sizeBytes: 150_000,
          fileName: 'Signed letter from Asha Rao.pdf',
          meta: CLAIM_META,
        }),
      );
      if (!outcome.ok) throw new Error('the claim expired');
      fileId = outcome.ticket.fileId;
      await settle(fileId, 'CLEAN');
      const submitted = await w.asSystem((tx) =>
        submitLabClaimLetterhead(tx, letterheadDeps, {
          actor: claimant.actor,
          claimId,
          ifMatch: 0,
          fileId: outcome.ticket.fileId,
          meta: CLAIM_META,
        }),
      );
      if (!submitted.ok) throw new Error('the claim expired');
    } else {
      const delivery = started.delivery;
      if (delivery === null) throw new Error('no code was sent');
      const verified = await w.asSystem((tx) =>
        verifyLabClaimOtp(tx, w.deps, {
          actor: claimant.actor,
          claimId,
          ifMatch: 0,
          code: delivery.code,
          meta: CLAIM_META,
        }),
      );
      if (!verified.ok) throw new Error('the code was refused');
    }
    return {
      organisationId: lab.organisationId,
      siteId: lab.siteId,
      certificateNo: lab.certificateNo,
      claimId,
      claimant,
      method: options.manual === true ? 'MANUAL' : 'EMAIL_OTP',
      fileId,
      nablEmail: lab.email,
    };
  };

  /** A claim row written directly (the owner connection), to reach states the flow cannot. */
  const insertClaim = async (input: {
    organisationId: string;
    siteId: string;
    userId: string;
    status: 'PENDING_OTP' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
    method?: 'EMAIL_OTP' | 'MANUAL';
    createdAt?: Date;
    fileId?: string | null;
  }): Promise<string> => {
    const id = uuidv7(w.clock.now().getTime());
    const created = input.createdAt ?? w.clock.now();
    await w.db().query(
      `INSERT INTO lab_claim_request
         (id, organisation_id, lab_site_id, requested_by_user_id, method, status, authorisation_file_id,
          created_at, updated_at, created_by_user_id, lock_version)
       VALUES ($1, $2, $3, $4, $5::claim_method, $6::claim_request_status, $7, $8, $8, $4, 0)`,
      [
        id,
        input.organisationId,
        input.siteId,
        input.userId,
        input.method ?? 'EMAIL_OTP',
        input.status,
        input.fileId ?? null,
        created,
      ],
    );
    return id;
  };

  const claimRow = async (claimId: string) =>
    (
      await w.db().query<{
        status: string;
        method: string;
        lock_version: number;
        reviewed_by_user_id: string | null;
        reviewed_at: Date | null;
        decision_notes: string | null;
        authorisation_file_id: string | null;
        created_at: Date;
      }>(
        `SELECT status, method, lock_version, reviewed_by_user_id, reviewed_at, decision_notes,
                authorisation_file_id, created_at
           FROM lab_claim_request WHERE id = $1`,
        [claimId],
      )
    ).rows[0];

  const lockVersionOf = async (claimId: string): Promise<number> =>
    (await claimRow(claimId))?.lock_version ?? -1;

  const organisationRow = async (organisationId: string) =>
    (
      await w
        .db()
        .query<{ claim_status: string; lock_version: number; status: string }>(
          'SELECT claim_status, lock_version, status FROM organisation WHERE id = $1',
          [organisationId],
        )
    ).rows[0];

  const membershipsOf = async (organisationId: string) =>
    (
      await w.db().query<{
        id: string;
        user_id: string;
        status: string;
        roles: string[];
        sites: string[];
        created_by_user_id: string | null;
      }>(
        `SELECT m.id, m.user_id, m.status::text, m.created_by_user_id,
                COALESCE((SELECT array_agg(r.role::text) FROM membership_role r
                           WHERE r.membership_id = m.id AND r.revoked_at IS NULL), '{}') AS roles,
                COALESCE((SELECT array_agg(s.lab_site_id::text) FROM membership_site s
                           WHERE s.membership_id = m.id AND s.revoked_at IS NULL), '{}') AS sites
           FROM membership m WHERE m.organisation_id = $1 ORDER BY m.created_at`,
        [organisationId],
      )
    ).rows;

  /** Everything an approval or rejection could write, for "nothing was written". */
  const snapshot = async (input: {
    organisationId: string;
    userId: string;
  }): Promise<StateOfTheWorld> => {
    const one = async (sql: string, params: unknown[] = []) =>
      (await w.db().query<{ v: string }>(sql, params)).rows[0]?.v ?? '';
    return {
      claims: (
        await w
          .db()
          .query(
            `SELECT to_jsonb(c)::text AS row FROM lab_claim_request c WHERE organisation_id = $1 ORDER BY id`,
            [input.organisationId],
          )
      ).rows,
      organisation: (
        await w
          .db()
          .query('SELECT to_jsonb(o)::text AS row FROM organisation o WHERE id = $1', [
            input.organisationId,
          ])
      ).rows,
      memberships: await one(
        `SELECT (SELECT count(*) FROM membership)::text || '/' ||
                (SELECT count(*) FROM membership_role)::text || '/' ||
                (SELECT count(*) FROM membership_site)::text AS v`,
      ),
      audit: await one('SELECT count(*)::text AS v FROM audit_log'),
      outbox: await one('SELECT count(*)::text AS v FROM outbox_event'),
      userMemberships: (
        await w
          .db()
          .query('SELECT id FROM membership WHERE user_id = $1 ORDER BY id', [input.userId])
      ).rows,
    };
  };

  /** The error a call rejects with, as `{ code, status, meta }`. */
  const refused = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      if (error instanceof CoreError) {
        return { code: error.code, status: error.status, meta: error.meta };
      }
      throw error;
    }
    return expect.fail('expected the call to be refused');
  };

  /** Asserts the call is refused as expected and that nothing in the database changed. */
  const refusedWritingNothing = async (
    subject: { organisationId: string; claimant: Claimant },
    work: () => Promise<unknown>,
    expected: { code: string; status: number; meta?: unknown },
  ) => {
    const input = { organisationId: subject.organisationId, userId: subject.claimant.id };
    const before = await snapshot(input);
    const error = await refused(work());
    expect(error).toMatchObject(expected);
    expect(await snapshot(input)).toEqual(before);
    return error;
  };

  return {
    ...w,
    storage,
    review,
    scope,
    fileService,
    letterheadDeps,
    freshMeta,
    platformActors,
    actorOf,
    as,
    settle,
    reviewable,
    insertClaim,
    claimRow,
    lockVersionOf,
    organisationRow,
    membershipsOf,
    snapshot,
    refused,
    refusedWritingNothing,
  };
}
