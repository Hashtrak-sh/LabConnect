'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { formIdempotencyKey, idempotencyKeyAfter } from '@/lib/idempotency';
import { ACCESS_COOKIE } from '@/lib/session';
import {
  type AddressField,
  addressBody,
  type AddressValues,
  checkAddress,
  readAddress,
} from './signup-form';

export type SiteField = AddressField | 'name';

export interface SiteState {
  status: 'editing' | 'invalid' | 'failed' | 'signed-out' | 'forbidden';
  values?: AddressValues & { name: string };
  errors?: Partial<Record<SiteField, 'required' | 'too-long' | 'pincode'>>;
  /** The `Idempotency-Key` for the next submit (`idempotencyKeyAfter` says when it changes). */
  idempotencyKey?: string;
}

/**
 * Board J1 step 5: the customer's first site (`createCustomerSite`), made the default billing
 * site. The map pin of the board is not part of the contract (the address is geocoded after it is
 * saved), so only the name and the address are sent. The form keeps one `Idempotency-Key` until
 * the API's answer ends the attempt, so a double submit is one site.
 */
export async function createSiteAction(_previous: SiteState, form: FormData): Promise<SiteState> {
  const raw = form.get('name');
  const name = typeof raw === 'string' ? raw.trim() : '';
  const address = readAddress(form);
  const values = { ...address, name };
  const errors: SiteState['errors'] = { ...checkAddress(address) };
  if (name === '') errors.name = 'required';
  else if (name.length > 100) errors.name = 'too-long';
  const key = formIdempotencyKey(form);
  if (Object.keys(errors).length > 0) {
    return { status: 'invalid', values, errors, idempotencyKey: key };
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token === undefined) return { status: 'signed-out', values, idempotencyKey: key };
  const { response } = await api(token).POST('/customer/sites', {
    params: { header: { 'Idempotency-Key': key } },
    body: { name, address: addressBody(address), isDefaultBilling: true },
  });
  if (response.status === 201) redirect('/sign-up/done');
  const next = { values, idempotencyKey: idempotencyKeyAfter(response.status, key) };
  if (response.status === 401) return { status: 'signed-out', ...next };
  if (response.status === 403) return { status: 'forbidden', ...next };
  return { status: 'failed', ...next };
}
