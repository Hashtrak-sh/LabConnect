'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { formIdempotencyKey, idempotencyKeyAfter } from '@/lib/idempotency';
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
  /** The `Idempotency-Key` for the next submit (`idempotencyKeyAfter` says when it changes). */
  idempotencyKey?: string;
}

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
  const key = formIdempotencyKey(form);
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
    const problem = error as
      { code?: string; errors?: { path: string; code: string }[] } | undefined;
    // The key was used before for a request that differed only in the session's active
    // membership: this form already created the organisation and switched to it (the answer was
    // lost on the way back). Show where the user stands instead of offering to create another.
    if (response.status === 422 && problem?.code === 'IDEMPOTENCY_KEY_REUSED') {
      revalidatePath('/', 'layout');
      redirect('/sign-up');
    }
    const next = { values, idempotencyKey: idempotencyKeyAfter(response.status, key) };
    if (response.status === 401) return { status: 'signed-out', ...next };
    if (response.status === 403) return { status: 'forbidden', ...next };
    if (response.status === 422) {
      const taken = problem?.errors?.some((issue) => issue.code === 'GSTIN_TAKEN') === true;
      if (taken) return { status: 'invalid', errors: { gstin: 'gstin-taken' }, ...next };
    }
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
