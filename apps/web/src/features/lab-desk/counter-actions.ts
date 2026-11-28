'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { actionGate } from '@/features/access/access';
import { cleanEtag, formKey, isUuid, readProblem } from '@/features/common/problem';
import { api } from '@/lib/api';
import { COUNTER_ROLES } from './desk-model';

export type CounterNotice =
  'signed-out' | 'forbidden' | 'expired' | 'slot' | 'changed' | 'not-found' | 'failed';

export interface CounterState {
  notice?: CounterNotice;
  key: string;
}

function noticeOf(status: number, code: string | undefined): CounterNotice {
  if (status === 401) return 'signed-out';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return code === 'SLOT_UNAVAILABLE' ? 'slot' : 'expired';
  if (status === 412) return 'changed';
  return 'failed';
}

/**
 * The customer's answer (board C4): `acceptBookingCounter` (T-07) or `declineBookingCounter`
 * (T-08), with the version the page showed (`If-Match`) and the form's idempotency key.
 */
export async function answerCounterAction(
  _previous: CounterState,
  form: FormData,
): Promise<CounterState> {
  const refused = (notice: CounterNotice): CounterState => ({ notice, key: randomUUID() });
  const gate = await actionGate(COUNTER_ROLES);
  if (!gate.ok) return refused(gate.reason === 'unavailable' ? 'failed' : gate.reason);
  const id = form.get('bookingId');
  const etag = cleanEtag(form.get('etag'));
  const answer = form.get('answer');
  if (!isUuid(id)) return refused('not-found');
  if (etag === null) return refused('changed');
  if (answer !== 'accept' && answer !== 'decline') return refused('failed');
  const path =
    answer === 'accept' ? '/bookings/{id}/counter/accept' : '/bookings/{id}/counter/decline';
  const { response, error } = await api(gate.token).POST(path, {
    params: {
      path: { id },
      header: { 'Idempotency-Key': formKey(form.get('key')), 'If-Match': etag },
    },
  });
  if (response.ok)
    redirect(`/bookings/${id}/counter?answered=${answer === 'accept' ? 'accepted' : 'declined'}`);
  const problem = readProblem(response, error);
  return refused(noticeOf(problem.status, problem.code));
}
