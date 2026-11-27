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
}

/**
 * Creates the customer organisation (board J1 step 4, `createCustomerOrganisation`) as the
 * signed-in user, then makes its new membership the active one (`setActiveMembership`), so the
 * header and the next pages act for it. A problem keeps what the user typed.
 */
export async function createOrganisationAction(
  _previous: SignUpState,
  form: FormData,
): Promise<SignUpState> {
  const values = readSignUpForm(form);
  const errors = checkSignUp(values);
  if (Object.keys(errors).length > 0) return { status: 'invalid', values, errors };

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token === undefined) return { status: 'signed-out', values };
  const client = api(token);

  const { data, response, error } = await client.POST('/customer/organisations', {
    params: { header: { 'Idempotency-Key': randomUUID() } },
    body: organisationBody(values),
  });
  if (data === undefined) {
    if (response.status === 401) return { status: 'signed-out', values };
    if (response.status === 403) return { status: 'forbidden', values };
    if (response.status === 422) {
      const issues = (error as { errors?: { path: string; code: string }[] } | undefined)?.errors;
      const taken = issues?.some((issue) => issue.code === 'GSTIN_TAKEN') === true;
      if (taken) return { status: 'invalid', values, errors: { gstin: 'gstin-taken' } };
    }
    return { status: 'failed', values };
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
  redirect('/sign-up/site');
}
