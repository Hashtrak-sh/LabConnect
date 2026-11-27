import type { CustomerSiteChanges, CustomerSiteInput, SiteContact } from '@labconnect/core';
import type { MdStatus } from '@labconnect/database';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';
import { address, GSTIN, isObject, optionalText, text } from './organisations.dto.js';

// Bodies and queries of the customer site operations (`CustomerSiteCreate`, `CustomerSiteUpdate`,
// `listCustomerSites`, `components/schemas/customer.yaml`), checked by hand against the contract:
// objects have `additionalProperties: false`, and no field names an organisation.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = new Set(['ACTIVE', 'INACTIVE']);
const CREATE_FIELDS = new Set(['name', 'address', 'gstin', 'contact', 'isDefaultBilling']);
const UPDATE_FIELDS = new Set([...CREATE_FIELDS, 'status']);
const CONTACT_FIELDS = new Set(['name', 'email', 'phone']);

function fail(issues: ProblemIssue[]): never {
  throw new DomainError('VALIDATION_FAILED', {
    detail: 'Some fields are missing or not valid.',
    errors: issues,
  });
}

function unknownFields(
  raw: Record<string, unknown>,
  allowed: Set<string>,
  issues: ProblemIssue[],
  at = '',
): void {
  for (const field of Object.keys(raw)) {
    if (!allowed.has(field)) {
      issues.push({
        path: at === '' ? field : `${at}.${field}`,
        code: 'UNKNOWN_FIELD',
        message: 'This field is not allowed.',
      });
    }
  }
}

function contact(raw: unknown, issues: ProblemIssue[]): SiteContact | null {
  if (!isObject(raw)) {
    issues.push({ path: 'contact', code: 'INVALID_TYPE', message: 'contact is an object.' });
    return null;
  }
  unknownFields(raw, CONTACT_FIELDS, issues, 'contact');
  const result: SiteContact = {};
  if ('name' in raw) result.name = optionalText(raw.name, 'contact.name', 100, issues);
  if ('phone' in raw) result.phone = optionalText(raw.phone, 'contact.phone', 20, issues);
  if ('email' in raw) {
    const email = optionalText(raw.email, 'contact.email', 254, issues);
    if (email !== null && !EMAIL.test(email)) {
      issues.push({
        path: 'contact.email',
        code: 'INVALID_FORMAT',
        message: 'Give an email address.',
      });
    }
    result.email = email;
  }
  return result;
}

function gstin(value: unknown, issues: ProblemIssue[]): string | null {
  if (typeof value === 'string' && GSTIN.test(value)) return value;
  issues.push({
    path: 'gstin',
    code: 'INVALID_FORMAT',
    message: 'A GSTIN has 15 characters in upper case, for example 09AAAAA0000A1Z5.',
  });
  return null;
}

function flag(value: unknown, path: string, issues: ProblemIssue[]): boolean | null {
  if (typeof value === 'boolean') return value;
  issues.push({ path, code: 'INVALID_TYPE', message: `${path} is true or false.` });
  return null;
}

/** `CustomerSiteCreate`: every problem at once, as `422 VALIDATION_FAILED`. */
export function parseCustomerSiteCreate(body: unknown): CustomerSiteInput {
  if (!isObject(body)) {
    fail([{ path: '', code: 'INVALID_TYPE', message: 'The body is a JSON object.' }]);
  }
  const issues: ProblemIssue[] = [];
  unknownFields(body, CREATE_FIELDS, issues);
  const name = text(body.name, 'name', 1, 100, issues);
  if (body.address === undefined) {
    issues.push({ path: 'address', code: 'REQUIRED', message: 'The address is required.' });
  }
  const where = body.address === undefined ? null : address(body.address, issues, 'address');
  const site: Partial<CustomerSiteInput> = {};
  if (body.gstin !== undefined) {
    const value = gstin(body.gstin, issues);
    if (value !== null) site.gstin = value;
  }
  if (body.contact !== undefined) {
    const value = contact(body.contact, issues);
    if (value !== null) site.contact = value;
  }
  if (body.isDefaultBilling !== undefined) {
    const value = flag(body.isDefaultBilling, 'isDefaultBilling', issues);
    if (value !== null) site.isDefaultBilling = value;
  }
  if (issues.length > 0 || name === null || where === null) fail(issues);
  return { ...site, name, address: where };
}

/** `CustomerSiteUpdate`: at least one field; `null` clears `gstin` or `contact`. */
export function parseCustomerSiteUpdate(body: unknown): CustomerSiteChanges {
  if (!isObject(body)) {
    fail([{ path: '', code: 'INVALID_TYPE', message: 'The body is a JSON object.' }]);
  }
  const issues: ProblemIssue[] = [];
  unknownFields(body, UPDATE_FIELDS, issues);
  if (Object.keys(body).length === 0) {
    issues.push({ path: '', code: 'REQUIRED', message: 'Give at least one field to change.' });
  }
  const changes: CustomerSiteChanges = {};
  if (body.name !== undefined) {
    const value = text(body.name, 'name', 1, 100, issues);
    if (value !== null) changes.name = value;
  }
  if (body.address !== undefined) {
    const value = address(body.address, issues, 'address');
    if (value !== null) changes.address = value;
  }
  if (body.gstin !== undefined) {
    if (body.gstin === null) changes.gstin = null;
    else {
      const value = gstin(body.gstin, issues);
      if (value !== null) changes.gstin = value;
    }
  }
  if (body.contact !== undefined) {
    if (body.contact === null) changes.contact = null;
    else {
      const value = contact(body.contact, issues);
      if (value !== null) changes.contact = value;
    }
  }
  if (body.isDefaultBilling !== undefined) {
    const value = flag(body.isDefaultBilling, 'isDefaultBilling', issues);
    if (value !== null) changes.isDefaultBilling = value;
  }
  if (body.status !== undefined) {
    if (typeof body.status === 'string' && STATUSES.has(body.status)) {
      changes.status = body.status as MdStatus;
    } else {
      issues.push({
        path: 'status',
        code: 'INVALID_VALUE',
        message: 'The status is ACTIVE or INACTIVE.',
      });
    }
  }
  if (issues.length > 0) fail(issues);
  return changes;
}

function single(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : '';
}

/** `status`, `cursor` and `limit` (1 to 100) of `listCustomerSites`. */
export function parseCustomerSiteListQuery(query: Record<string, unknown>): {
  status?: MdStatus;
  cursor?: string;
  limit?: number;
} {
  const issues: ProblemIssue[] = [];
  const result: { status?: MdStatus; cursor?: string; limit?: number } = {};
  for (const field of Object.keys(query)) {
    if (!['status', 'cursor', 'limit'].includes(field)) {
      issues.push({
        path: field,
        code: 'UNKNOWN_FIELD',
        message: 'This parameter is not allowed.',
      });
    }
  }
  const status = single(query.status);
  if (status !== undefined) {
    if (STATUSES.has(status)) result.status = status as MdStatus;
    else
      issues.push({
        path: 'status',
        code: 'INVALID_VALUE',
        message: 'The status is ACTIVE or INACTIVE.',
      });
  }
  const cursor = single(query.cursor);
  if (cursor !== undefined) {
    if (cursor === '') {
      issues.push({ path: 'cursor', code: 'INVALID_VALUE', message: 'The cursor is empty.' });
    } else result.cursor = cursor;
  }
  const limit = single(query.limit);
  if (limit !== undefined) {
    const parsed = /^\d{1,4}$/.test(limit) ? Number(limit) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      issues.push({
        path: 'limit',
        code: 'INVALID_VALUE',
        message: 'The limit is a whole number from 1 to 100.',
      });
    } else result.limit = parsed;
  }
  if (issues.length > 0) fail(issues);
  return result;
}

/** The site id of the path: not a UUID is `422`, as for the other ids of the API. */
export function requireSiteId(id: string): string {
  if (UUID.test(id)) return id.toLowerCase();
  throw new DomainError('VALIDATION_FAILED', {
    detail: 'The site id is not valid.',
    errors: [{ path: 'id', code: 'INVALID_VALUE', message: 'Give a UUID.' }],
  });
}
