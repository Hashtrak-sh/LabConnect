import { describe, expect, it } from 'vitest';
import { checkSignUp, organisationBody, readSignUpForm } from './signup-form';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const ADDRESS = {
  line1: ' Plot 22, Phase II ',
  line2: '',
  city: 'Gurugram',
  district: '',
  stateCode: 'HR',
  pincode: '122 050',
};

describe('sign-up details (J1 step 4)', () => {
  it('uses the full name of an individual as both names, and leaves out an empty GSTIN', () => {
    const values = readSignUpForm(
      form({ segment: 'INDIVIDUAL', fullName: ' Priya Sharma ', ...ADDRESS }),
    );
    expect(checkSignUp(values)).toEqual({});
    expect(organisationBody(values)).toEqual({
      customerSegment: 'INDIVIDUAL',
      legalName: 'Priya Sharma',
      displayName: 'Priya Sharma',
      registeredAddress: {
        line1: 'Plot 22, Phase II',
        line2: null,
        city: 'Gurugram',
        district: null,
        stateCode: 'HR',
        pincode: '122050',
      },
    });
  });

  it('needs a GSTIN for an organisation and upper-cases it', () => {
    const missing = readSignUpForm(
      form({ segment: 'BUSINESS', legalName: 'A Ltd', displayName: 'A', ...ADDRESS }),
    );
    expect(checkSignUp(missing)).toEqual({ gstin: 'required' });
    const typed = readSignUpForm(
      form({
        segment: 'BUSINESS',
        legalName: 'A Ltd',
        displayName: 'A',
        gstin: '06aaaaa 0000a1z5',
        ...ADDRESS,
      }),
    );
    expect(typed.gstin).toBe('06AAAAA0000A1Z5');
    expect(checkSignUp(typed)).toEqual({});
  });

  it('names each wrong field: short GSTIN, bad PIN code, unknown state, missing names and address', () => {
    const values = readSignUpForm(
      form({ segment: 'INDUSTRY', gstin: '06AAAAA0000A1Z', stateCode: 'XX', pincode: '1220' }),
    );
    expect(checkSignUp(values)).toEqual({
      legalName: 'required',
      displayName: 'required',
      gstin: 'gstin-length',
      line1: 'required',
      city: 'required',
      stateCode: 'required',
      pincode: 'pincode',
    });
  });
});
