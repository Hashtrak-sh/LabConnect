import { describe, expect, it } from 'vitest';
import { accreditationVerificationUrl } from './accreditation-url.js';

describe('accreditationVerificationUrl', () => {
  it('fills the certificate number, URL-encoded, into an https template', () => {
    expect(accreditationVerificationUrl('https://nabl.example/c/{certificate_no}', 'TC 12/3')).toBe(
      'https://nabl.example/c/TC%2012%2F3',
    );
    expect(accreditationVerificationUrl('https://nabl.example/c?n={certificateNo}', 'TC-1')).toBe(
      'https://nabl.example/c?n=TC-1',
    );
  });

  it('gives null without a template or when the filled template is not a URL', () => {
    expect(accreditationVerificationUrl(null, 'TC-1')).toBeNull();
    expect(accreditationVerificationUrl('not a url {certificate_no}', 'TC-1')).toBeNull();
  });

  it('gives null for every scheme other than https', () => {
    for (const template of [
      'javascript:alert(1)//{certificate_no}',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://nabl.example/c/{certificate_no}',
      'ftp://nabl.example/{certificate_no}',
      'file:///etc/passwd',
      '//nabl.example/{certificate_no}',
    ]) {
      expect(accreditationVerificationUrl(template, 'TC-1'), template).toBeNull();
    }
  });

  it('refuses a scheme smuggled in through the certificate number', () => {
    expect(accreditationVerificationUrl('{certificate_no}', 'javascript:alert(1)')).toBeNull();
  });
});
