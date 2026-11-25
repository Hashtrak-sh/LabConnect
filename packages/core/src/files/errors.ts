import { CoreError, type CoreErrorOptions } from '../platform/errors.js';

/**
 * Why a files operation failed, as a stable machine-readable `meta.reason`. The HTTP
 * `code` always comes from the catalogue of ERROR_HANDLING.md; the reasons below say
 * which rule was broken without adding codes the catalogue does not have.
 */
export const FILES_ERROR_REASONS = [
  /** The purpose is not one a client may upload (system-generated purposes). */
  'PURPOSE_NOT_UPLOADABLE',
  /** The declared content type is not in the allow-list of the purpose. */
  'CONTENT_TYPE_NOT_ALLOWED',
  /** The declared size is not a positive integer, or exceeds the limit of the purpose. */
  'SIZE_LIMIT_EXCEEDED',
  /** The file does not exist, or the caller cannot see it. */
  'FILE_NOT_FOUND',
  /** The file exists and is visible but is not `CLEAN` (scan pending, infected, rejected, errored). */
  'FILE_NOT_AVAILABLE',
  /** The object store did not answer, or refused (a retry may help). */
  'STORAGE_UNAVAILABLE',
] as const;

export type FilesErrorReason = (typeof FILES_ERROR_REASONS)[number];

export interface FilesErrorOptions extends CoreErrorOptions {
  reason: FilesErrorReason;
}

/**
 * The typed error of the files module: a `CoreError`, so the API's exception filter turns it
 * into the problem body. Only catalogued codes are used: `VALIDATION_FAILED`, `NOT_FOUND`,
 * `FILE_NOT_CLEAN`, `GATEWAY_UNAVAILABLE`. It never carries a file name, an object key or a URL.
 */
export class FilesError extends CoreError {
  override name = 'FilesError';
  readonly reason: FilesErrorReason;

  constructor(code: ConstructorParameters<typeof CoreError>[0], options: FilesErrorOptions) {
    const { reason, meta, ...rest } = options;
    super(code, { ...rest, meta: { ...meta, reason } });
    this.reason = reason;
  }
}

/** True for a `FilesError`, also when it comes from another copy of the package. */
export function isFilesError(value: unknown): value is FilesError {
  return (
    value instanceof FilesError ||
    (value instanceof Error &&
      value.name === 'FilesError' &&
      typeof (value as { code?: unknown }).code === 'string')
  );
}

/** One answer for "no such file" and "a file you may not see": the caller cannot tell them apart. */
export const fileNotFound = (): FilesError =>
  new FilesError('NOT_FOUND', { reason: 'FILE_NOT_FOUND', detail: 'The file was not found.' });
