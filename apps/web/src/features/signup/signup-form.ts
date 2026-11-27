import { isStateCode } from './indian-states';

/** The sign-up details form (board J1 steps 3 and 4), as typed. */
export interface SignUpValues {
  segment: 'INDIVIDUAL' | 'BUSINESS' | 'INDUSTRY' | 'GOVERNMENT';
  legalName: string;
  displayName: string;
  gstin: string;
  line1: string;
  line2: string;
  city: string;
  district: string;
  stateCode: string;
  pincode: string;
}

export type SignUpField = Exclude<keyof SignUpValues, 'segment'>;

/** Why a field is wrong; the screen turns it into text. */
export type SignUpFieldError =
  'required' | 'too-long' | 'gstin-length' | 'gstin-format' | 'gstin-taken' | 'pincode';

/** `CustomerOrganisationCreate` of the contract. */
export interface OrganisationCreateBody {
  customerSegment: SignUpValues['segment'];
  legalName: string;
  displayName: string;
  gstin?: string;
  registeredAddress: {
    line1: string;
    line2: string | null;
    city: string;
    district: string | null;
    stateCode: string;
    pincode: string;
  };
}

const SEGMENTS = new Set(['INDIVIDUAL', 'BUSINESS', 'INDUSTRY', 'GOVERNMENT']);
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Reads the form; text is trimmed, the GSTIN upper-cased without spaces. */
export function readSignUpForm(form: FormData): SignUpValues {
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const segment = field('segment');
  const individual = segment === 'INDIVIDUAL';
  const legalName = individual ? field('fullName') : field('legalName');
  return {
    segment: (SEGMENTS.has(segment) ? segment : 'BUSINESS') as SignUpValues['segment'],
    legalName,
    displayName: individual ? legalName : field('displayName'),
    gstin: field('gstin').replaceAll(/\s/g, '').toUpperCase(),
    line1: field('line1'),
    line2: field('line2'),
    city: field('city'),
    district: field('district'),
    stateCode: field('stateCode'),
    pincode: field('pincode').replaceAll(/\s/g, ''),
  };
}

/**
 * Checks the details as the API will (FR-ONB-01), so the user hears about a mistake before the
 * request: names, GSTIN (required for an organisation, optional for an individual), and the
 * address the board marks required.
 */
export function checkSignUp(values: SignUpValues): Partial<Record<SignUpField, SignUpFieldError>> {
  const errors: Partial<Record<SignUpField, SignUpFieldError>> = {};
  const individual = values.segment === 'INDIVIDUAL';
  const required = (field: SignUpField, max: number): void => {
    if (values[field] === '') errors[field] = 'required';
    else if (values[field].length > max) errors[field] = 'too-long';
  };
  required('legalName', individual ? 100 : 200);
  if (!individual) required('displayName', 100);
  if (values.gstin === '') {
    if (!individual) errors.gstin = 'required';
  } else if (values.gstin.length !== 15) errors.gstin = 'gstin-length';
  else if (!GSTIN.test(values.gstin)) errors.gstin = 'gstin-format';
  return { ...errors, ...checkAddress(values) };
}

/** The request body for checked values. */
export function organisationBody(values: SignUpValues): OrganisationCreateBody {
  return {
    customerSegment: values.segment,
    legalName: values.legalName,
    displayName: values.displayName,
    ...(values.gstin !== '' && { gstin: values.gstin }),
    registeredAddress: addressBody(values),
  };
}

/** The fields of a postal address (`PostalAddress`), shared by J1 steps 4 and 5. */
export type AddressField = 'line1' | 'line2' | 'city' | 'district' | 'stateCode' | 'pincode';
export type AddressValues = Record<AddressField, string>;

/** Reads an address from a form; text is trimmed, spaces leave the PIN code. */
export function readAddress(form: FormData): AddressValues {
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  return {
    line1: field('line1'),
    line2: field('line2'),
    city: field('city'),
    district: field('district'),
    stateCode: field('stateCode'),
    pincode: field('pincode').replaceAll(/\s/g, ''),
  };
}

/** Checks an address as the API will. */
export function checkAddress(
  values: AddressValues,
): Partial<Record<AddressField, 'required' | 'too-long' | 'pincode'>> {
  const errors: Partial<Record<AddressField, 'required' | 'too-long' | 'pincode'>> = {};
  const length = (field: AddressField, max: number, required: boolean): void => {
    if (required && values[field] === '') errors[field] = 'required';
    else if (values[field].length > max) errors[field] = 'too-long';
  };
  length('line1', 200, true);
  length('line2', 200, false);
  length('city', 100, true);
  length('district', 100, false);
  if (!isStateCode(values.stateCode)) errors.stateCode = 'required';
  if (!/^\d{6}$/.test(values.pincode)) errors.pincode = 'pincode';
  return errors;
}

/** `PostalAddress` for checked values: an empty optional line is `null`. */
export function addressBody(values: AddressValues): OrganisationCreateBody['registeredAddress'] {
  return {
    line1: values.line1,
    line2: values.line2 === '' ? null : values.line2,
    city: values.city,
    district: values.district === '' ? null : values.district,
    stateCode: values.stateCode,
    pincode: values.pincode,
  };
}
