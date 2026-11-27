'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';
import {
  checkSignUp,
  organisationBody,
  readSignUpForm,
  type SignUpField,
  type SignUpFieldError,
  type SignUpValues,
} from './signup-form';

export interface SignUpState {
  status: 'editing' | 'invalid' | 'failed' | 'signed-out' | 'forbidden';
  values?: SignUpValues;
  errors?: Partial<Record<SignUpField, SignUpFieldError>>;
  /**
   * The `Idempotency-Key` for the next submit. A new one after every answer of the API: the API
   * stores 422 answers under their key, so a corrected form sent with the old key would be
   * refused as a reused key.
   */
  idempotencyKey?: string;
}

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Creates the customer organisation (board J1 step 4, `createCustomerOrganisation`) as the
 * signed-in user, then makes its new membership the active one (`setActiveMembership`), so the
 * header and the next pages act for it. A problem keeps what the user typed.
 *
 * The form sends one `Idempotency-Key` until the API has answered (a hidden field), so a double
 * submit or a retry after a lost answer creates one organisation: the API replays the first 201.
 */
export async function createOrganisationAction(
  _previous: SignUpState,
  form: FormData,
): Promise<SignUpState> {
  const values = readSignUpForm(form);
  const errors = checkSignUp(values);
  const sent = form.get('idempotencyKey');
  const key = typeof sent === 'string' && KEY.test(sent) ? sent : randomUUID();
  // Checked here, before the API: the key was not used, so it stays.
  if (Object.keys(errors).length > 0) {
    return { status: 'invalid', values, errors, idempotencyKey: key };
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token === undefined) return { status: 'signed-out', values, idempotencyKey: key };
  const client = api(token);

  const { data, response, error } = await client.POST('/customer/organisations', {
    params: { header: { 'Idempotency-Key': key } },
    body: organisationBody(values),
  });
  if (data === undefined) {
    const next = { values, idempotencyKey: randomUUID() };
    if (response.status === 401) return { status: 'signed-out', ...next };
    if (response.status === 403) return { status: 'forbidden', ...next };
    if (response.status === 422) {
      const issues = (error as { errors?: { path: string; code: string }[] } | undefined)?.errors;
      const taken = issues?.some((issue) => issue.code === 'GSTIN_TAKEN') === true;
      if (taken) return { status: 'invalid', errors: { gstin: 'gstin-taken' }, ...next };
    }
    // 409: the same key is still being worked on (a second submit while the first runs). Keep
    // the key, so the next try gets the first one's answer instead of creating another.
    if (response.status === 409) return { status: 'failed', values, idempotencyKey: key };
    return { status: 'failed', ...next };
  }

  // Switch to the new organisation. If this fails, the account exists anyway: the user can
  // switch later, so the sign-up still counts as done.
  const me = await client.GET('/me');
  const membership = me.data?.memberships.find(
    (candidate) => candidate.organisation.id === data.id,
  );
  if (membership !== undefined) {
    await client.POST('/me/active-membership', {
      params: { header: { 'Idempotency-Key': randomUUID() } },
      body: { membershipId: membership.id },
    });
  }
  revalidatePath('/', 'layout');
  redirect('/sign-up/done');
}
