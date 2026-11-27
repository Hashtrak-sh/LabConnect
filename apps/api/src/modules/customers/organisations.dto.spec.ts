import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import { parseCustomerOrganisationCreate } from './organisations.dto.js';

function issues(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return (error.errors ?? []).map((issue) => issue.path);
    throw error;
  }
  throw new Error('expected a validation error');
}

const ADDRESS = {
  line1: ' Plot 22 ',
  line2: '',
  city: 'Gurugram',
  district: null,
  stateCode: 'hr',
  pincode: '122050',
};

describe('parseCustomerOrganisationCreate', () => {
  it('trims names, keeps an individual without GSTIN, and cleans the address', () => {
    expect(
      parseCustomerOrganisationCreate({
        customerSegment: 'INDIVIDUAL',
        legalName: ' Priya Sharma ',
        displayName: 'Priya',
        registeredAddress: ADDRESS,
      }),
    ).toEqual({
      customerSegment: 'INDIVIDUAL',
      legalName: 'Priya Sharma',
      displayName: 'Priya',
      registeredAddress: {
        line1: 'Plot 22',
        line2: null,
        city: 'Gurugram',
        district: null,
        stateCode: 'HR',
        pincode: '122050',
      },
    });
  });

  it('needs a GSTIN for every segment but INDIVIDUAL', () => {
    for (const segment of ['BUSINESS', 'INDUSTRY', 'GOVERNMENT']) {
      expect(
        issues(() =>
          parseCustomerOrganisationCreate({
            customerSegment: segment,
            legalName: 'A',
            displayName: 'A',
          }),
        ),
      ).toEqual(['gstin']);
    }
  });

  it('reports every problem at once, including fields the contract does not have', () => {
    expect(
      issues(() =>
        parseCustomerOrganisationCreate({
          customerSegment: 'PERSON',
          legalName: 'x'.repeat(201),
          displayName: '   ',
          gstin: '06AAAAA0000A1Z',
          userId: 'someone-else',
          registeredAddress: { line1: 'A', city: 'B', stateCode: 'HR', pincode: '1220', extra: 1 },
        }),
      ).sort(),
    ).toEqual([
      'customerSegment',
      'displayName',
      'gstin',
      'legalName',
      'registeredAddress.district',
      'registeredAddress.extra',
      'registeredAddress.line2',
      'registeredAddress.pincode',
      'userId',
    ]);
    expect(issues(() => parseCustomerOrganisationCreate(null))).toEqual(['']);
  });
});
