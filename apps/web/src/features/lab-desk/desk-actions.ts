'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { actionGate } from '@/features/access/access';
import { cleanEtag, formKey, isUuid, readProblem } from '@/features/common/problem';
import { api } from '@/lib/api';
import {
  type CounterLine,
  DECIDER_ROLES,
  type DecisionNotice,
  decisionNotice,
  readCounter,
} from './desk-model';

/** What a decision form shows after it was pressed and did not succeed. */
export interface DecisionState {
  notice?: DecisionNotice;
  /** Fields to mark (counter and reject): `message`, `reason`, `nothing`, `qty:<lineId>`. */
  errors?: string[];
  /** What was typed, kept across a refusal. */
  values?: Record<string, string>;
  key: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function refused(
  notice: DecisionNotice | undefined,
  extra: Omit<DecisionState, 'key' | 'notice'> = {},
): DecisionState {
  return { ...(notice === undefined ? {} : { notice }), ...extra, key: randomUUID() };
}

/** The checks every decision shares: a Checker, a booking id and the version it was shown at. */
async function prepare(form: FormData) {
  const gate = await actionGate(DECIDER_ROLES);
  if (!gate.ok) {
    return {
      ok: false as const,
      state: refused(gate.reason === 'unavailable' ? 'failed' : gate.reason),
    };
  }
  const id = field(form, 'bookingId');
  const etag = cleanEtag(field(form, 'etag'));
  if (!isUuid(id)) return { ok: false as const, state: refused('not-found') };
  if (etag === null) return { ok: false as const, state: refused('changed') };
  return {
    ok: true as const,
    token: gate.token,
    id,
    headers: { 'Idempotency-Key': formKey(form.get('key')), 'If-Match': etag },
  };
}

/** `acceptBooking` (T-03). On success the Checker lands on the booking, which shows its state. */
export async function acceptAction(
  _previous: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const ready = await prepare(form);
  if (!ready.ok) return ready.state;
  const { response, error } = await api(ready.token).POST('/bookings/{id}/accept', {
    params: { path: { id: ready.id }, header: ready.headers },
  });
  if (response.ok) redirect(`/lab/bookings/${ready.id}?decided=accepted`);
  return refused(decisionNotice(readProblem(response, error)));
}

/** `rejectBooking` (T-05): a REJECTION_REASON code and a message the customer sees. */
export async function rejectAction(
  _previous: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const values = { reason: field(form, 'reason'), message: field(form, 'message') };
  const errors: string[] = [];
  if (values.reason === '') errors.push('reason');
  if (values.message.trim() === '' || values.message.length > 2000) errors.push('message');
  if (errors.length > 0) return refused(undefined, { errors, values });
  const ready = await prepare(form);
  if (!ready.ok) return { ...ready.state, values };
  const { response, error } = await api(ready.token).POST('/bookings/{id}/reject', {
    params: { path: { id: ready.id }, header: ready.headers },
    body: { reasonCode: values.reason, notes: values.message.trim() },
  });
  if (response.ok) redirect(`/lab/bookings/${ready.id}?decided=rejected`);
  return refused(decisionNotice(readProblem(response, error)), { values });
}

/**
 * `counterBooking` (T-04): another slot and/or more sample per line, and a message; never a
 * price (BR-017). The lines (id, unit, current quantity) travel in hidden fields from the page.
 */
export async function counterAction(
  _previous: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const lines: CounterLine[] = form
    .getAll('line')
    .filter((value): value is string => typeof value === 'string')
    .map((value) => {
      const [lineId = '', unitCode = '', current = ''] = value.split('|');
      return { lineId, unitCode, current: Number(current) };
    })
    .filter((line) => isUuid(line.lineId) && Number.isFinite(line.current));
  const quantities = Object.fromEntries(
    lines.map((line) => [line.lineId, field(form, `qty:${line.lineId}`)]),
  );
  const values: Record<string, string> = {
    slotId: field(form, 'slotId'),
    message: field(form, 'message'),
    ...Object.fromEntries(Object.entries(quantities).map(([id, qty]) => [`qty:${id}`, qty])),
  };
  const slotId = values.slotId ?? '';
  if (slotId !== '' && !isUuid(slotId)) return refused('invalid', { values });
  const current = field(form, 'currentSlotId');
  const counter = readCounter(
    { slotId, message: values.message ?? '', quantities },
    lines,
    isUuid(current) ? current : null,
  );
  if (!counter.ok) return refused(undefined, { errors: counter.errors, values });
  const ready = await prepare(form);
  if (!ready.ok) return { ...ready.state, values };
  const { response, error } = await api(ready.token).POST('/bookings/{id}/counter', {
    params: { path: { id: ready.id }, header: ready.headers },
    body: counter.body,
  });
  if (response.ok) redirect(`/lab/bookings/${ready.id}?decided=countered`);
  return refused(decisionNotice(readProblem(response, error)), { values });
}
