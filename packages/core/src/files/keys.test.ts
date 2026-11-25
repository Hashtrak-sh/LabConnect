import { describe, expect, it } from 'vitest';
import {
  assertFilesConfig,
  cleanKey,
  type FilesConfig,
  isCleanKey,
  isQuarantineKey,
  quarantineKey,
  readFilesConfig,
} from './keys.js';

const config: FilesConfig = {
  bucket: 'labconnect-files',
  quarantinePrefix: 'quarantine',
  cleanPrefix: 'clean',
};
const id = '01930000-0000-7000-8000-0000000000f1';

describe('object keys', () => {
  it('are the prefix, the purpose and the file id, nothing else', () => {
    expect(quarantineKey(config, 'REPORT_ORIGINAL', id)).toBe(`quarantine/REPORT_ORIGINAL/${id}`);
    expect(cleanKey(config, 'KYC_DOCUMENT', id)).toBe(`clean/KYC_DOCUMENT/${id}`);
  });

  it('contain only the prefix, an upper-case enum value and a UUID (no names, no personal data)', () => {
    for (const key of [
      quarantineKey(config, 'DISPUTE_EVIDENCE', id),
      cleanKey(config, 'RECEIPT_PHOTO', id),
    ]) {
      expect(key).toMatch(/^[a-z]+\/[A-Z_]+\/[0-9a-f-]{36}$/);
    }
  });

  it('tell the two prefixes apart', () => {
    expect(isQuarantineKey(config, quarantineKey(config, 'KYC_DOCUMENT', id))).toBe(true);
    expect(isQuarantineKey(config, cleanKey(config, 'KYC_DOCUMENT', id))).toBe(false);
    expect(isCleanKey(config, cleanKey(config, 'KYC_DOCUMENT', id))).toBe(true);
    // a prefix is a path segment, not a string prefix
    expect(isQuarantineKey(config, `quarantined/x/${id}`)).toBe(false);
  });
});

describe('files config', () => {
  it('reads the bucket and uses the default prefixes', () => {
    expect(readFilesConfig({ FILES_BUCKET: 'my-bucket' })).toEqual({
      bucket: 'my-bucket',
      quarantinePrefix: 'quarantine',
      cleanPrefix: 'clean',
    });
  });

  it('fails clearly when the bucket is missing', () => {
    expect(() => readFilesConfig({})).toThrow('FILES_BUCKET is not set.');
  });

  it('refuses a bad bucket, bad prefixes, and prefixes that overlap', () => {
    expect(() => assertFilesConfig({ ...config, bucket: 'Bad_Bucket' })).toThrow(RangeError);
    expect(() => assertFilesConfig({ ...config, quarantinePrefix: '../x' })).toThrow(RangeError);
    expect(() => assertFilesConfig({ ...config, cleanPrefix: 'quarantine' })).toThrow('separate');
    expect(() => assertFilesConfig({ ...config, cleanPrefix: 'quarantine/clean' })).toThrow(
      'separate',
    );
  });
});
