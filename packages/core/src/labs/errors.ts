import { CoreError } from '../platform/errors.js';

/** A directory request the contract refuses (`VALIDATION_FAILED`, 422): a bad text or cursor. */
export class LabDirectoryQueryError extends CoreError {
  override name = 'LabDirectoryQueryError';
  constructor(detail: string) {
    super('VALIDATION_FAILED', { detail });
  }
}
