'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { actionGate } from '@/features/access/access';
import { CLAIM_REVIEW_ROLES } from '@/features/access/roles';
import { cleanEtag, formKey, isUuid, readProblem } from '@/features/common/problem';
import { t } from '@/lib/i18n';
import { api } from '@/lib/api';
import {
  approvalNotes,
  type DecisionOutcome,
  decisionOutcome,
  downloadOutcome,
  isFollowableUrl,
  readRejectReason,
  rejectionNotes,
} from './ops-model';

/** What a decision form shows after it was pressed and did not succeed. */
export interface DecisionState {
  notice?: DecisionOutcome | 'notes-too-long' | 'letter-unavailable' | 'no-letterhead';
  /** The rejection form keeps what was typed. */
  notes?: string;
  key: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function keyOf(form: FormData): string {
  return formKey(form.get('key'));
}

function refused(notice: NonNullable<DecisionState['notice']>, notes?: string): DecisionState {
  return { notice, ...(notes === undefined ? {} : { notes }), key: randomUUID() };
}

const REASON_KEYS = {
  signature: 'ops.reasonSignature',
  letterhead: 'ops.reasonLetterhead',
  certificate: 'ops.reasonCertificate',
  other: 'ops.reasonOther',
} as const;

/**
 * Approves a claim in review (`approveAdminLabClaim`): the claimant becomes the lab's first
 * Checker and the lab becomes claimed. Only Platform Ops (checked here and again by the API); the
 * claim id and its version (`If-Match`) come from the page the Ops user was looking at, and the
 * version means they approve exactly the claim they saw. Whatever the answer, the user lands on
 * the claim's page, which shows its state; a refusal says why on that page.
 */
export async function approveClaimAction(
  _previous: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const gate = await actionGate(CLAIM_REVIEW_ROLES);
  if (!gate.ok) return refused(gate.reason === 'unavailable' ? 'failed' : gate.reason);
  const id = field(form, 'claimId');
  const etag = cleanEtag(field(form, 'etag'));
  if (!isUuid(id)) return refused('not-found');
  if (etag === null) return refused('changed');
  const notes = approvalNotes(form.get('notes'));
  if (notes === null) return refused('notes-too-long');
  const { response, error } = await api(gate.token).POST('/admin/claims/{id}/approve', {
    params: { path: { id }, header: { 'Idempotency-Key': keyOf(form), 'If-Match': etag } },
    body: notes === undefined ? {} : { decisionNotes: notes },
  });
  if (response.ok) redirect(`/admin/claims/${id}?decided=approved`);
  return refused(decisionOutcome(readProblem(response, error)));
}

/**
 * Rejects a claim in review (`rejectAdminLabClaim`), with notes the claimant will see. The
 * reason picked from the list is written at the start of the notes (the API has no field for it).
 */
export async function rejectClaimAction(
  _previous: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const typed = field(form, 'notes');
  const gate = await actionGate(CLAIM_REVIEW_ROLES);
  if (!gate.ok) return refused(gate.reason === 'unavailable' ? 'failed' : gate.reason, typed);
  const id = field(form, 'claimId');
  const etag = cleanEtag(field(form, 'etag'));
  if (!isUuid(id)) return refused('not-found', typed);
  if (etag === null) return refused('changed', typed);
  const reason = readRejectReason(field(form, 'reason'));
  const reasonText = reason === null || reason === 'other' ? null : t(REASON_KEYS[reason]);
  const notes = rejectionNotes(reasonText, typed);
  if (!notes.ok)
    return refused(notes.reason === 'too-long' ? 'notes-too-long' : 'notes-required', typed);
  const { response, error } = await api(gate.token).POST('/admin/claims/{id}/reject', {
    params: { path: { id }, header: { 'Idempotency-Key': keyOf(form), 'If-Match': etag } },
    body: { decisionNotes: notes.value },
  });
  if (response.ok) redirect(`/admin/claims/${id}?decided=rejected`);
  return refused(decisionOutcome(readProblem(response, error)), typed);
}

/**
 * Opens the claim's letterhead: asks for a short-lived download link only now, on this click, and
 * sends the browser to it (the link is an attachment, so the page stays). The link is never put in
 * a page, stored, or logged; it exists for this one response. A form post, so it works without
 * JavaScript and carries the framework's origin check.
 */
export async function openLetterheadAction(
  _previous: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const gate = await actionGate(CLAIM_REVIEW_ROLES);
  if (!gate.ok) return refused(gate.reason === 'unavailable' ? 'failed' : gate.reason);
  const id = field(form, 'claimId');
  if (!isUuid(id)) return refused('not-found');
  const { data, response, error } = await api(gate.token).POST(
    '/admin/claims/{id}/letterhead/download-url',
    { params: { path: { id }, header: { 'Idempotency-Key': keyOf(form) } } },
  );
  if (data !== undefined) {
    if (!isFollowableUrl(data.downloadUrl)) return refused('failed');
    redirect(data.downloadUrl);
  }
  const outcome = downloadOutcome(readProblem(response, error));
  if (outcome === 'no-letterhead') return refused('no-letterhead');
  if (outcome === 'not-clean') return refused('letter-unavailable');
  if (outcome === 'signed-out' || outcome === 'forbidden') return refused(outcome);
  if (outcome === 'rate-limited') return refused('rate-limited');
  return refused('failed');
}
