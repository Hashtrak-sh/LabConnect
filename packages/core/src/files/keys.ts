import type { FilePurpose } from '@labconnect/database';

/** Where files live. One bucket, two prefixes (FILES_AND_REPORTS.md section 1). */
export interface FilesConfig {
  bucket: string;
  /** Uploads land here and are scanned here (GuardDuty watches this prefix). Default `quarantine`. */
  quarantinePrefix: string;
  /** Validated files are promoted here. Default `clean`. */
  cleanPrefix: string;
}

export const DEFAULT_QUARANTINE_PREFIX = 'quarantine';
export const DEFAULT_CLEAN_PREFIX = 'clean';

const PREFIX = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export function assertFilesConfig(config: FilesConfig): FilesConfig {
  if (!BUCKET.test(config.bucket)) throw new RangeError('The files bucket name is not valid.');
  for (const prefix of [config.quarantinePrefix, config.cleanPrefix]) {
    if (!PREFIX.test(prefix)) throw new RangeError('A files prefix is not valid.');
  }
  if (
    config.quarantinePrefix === config.cleanPrefix ||
    config.quarantinePrefix.startsWith(`${config.cleanPrefix}/`) ||
    config.cleanPrefix.startsWith(`${config.quarantinePrefix}/`)
  ) {
    throw new RangeError('The quarantine and clean prefixes must be separate.');
  }
  return config;
}

/**
 * `FILES_BUCKET` (required), `FILES_QUARANTINE_PREFIX` and `FILES_CLEAN_PREFIX` (optional).
 * Throws when the bucket is missing, so callers read it lazily, at first use.
 */
export function readFilesConfig(
  env: Record<string, string | undefined> = process.env,
): FilesConfig {
  const bucket = env.FILES_BUCKET;
  if (!bucket) throw new Error('FILES_BUCKET is not set.');
  return assertFilesConfig({
    bucket,
    quarantinePrefix: env.FILES_QUARANTINE_PREFIX || DEFAULT_QUARANTINE_PREFIX,
    cleanPrefix: env.FILES_CLEAN_PREFIX || DEFAULT_CLEAN_PREFIX,
  });
}

/**
 * `<prefix>/<PURPOSE>/<fileId>`: ids only. No file name, no organisation, no user, nothing a
 * person typed (SECURITY_AND_PRIVACY.md, CLAUDE.md section 5). The purpose is an enum value.
 */
export function objectKey(prefix: string, purpose: FilePurpose, fileId: string): string {
  return `${prefix}/${purpose}/${fileId}`;
}

export const quarantineKey = (config: FilesConfig, purpose: FilePurpose, fileId: string): string =>
  objectKey(config.quarantinePrefix, purpose, fileId);

export const cleanKey = (config: FilesConfig, purpose: FilePurpose, fileId: string): string =>
  objectKey(config.cleanPrefix, purpose, fileId);

export const isQuarantineKey = (config: FilesConfig, key: string): boolean =>
  key.startsWith(`${config.quarantinePrefix}/`);

export const isCleanKey = (config: FilesConfig, key: string): boolean =>
  key.startsWith(`${config.cleanPrefix}/`);
