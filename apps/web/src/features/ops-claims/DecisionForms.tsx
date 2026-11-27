'use client';

import { Alert, Button, Field, fieldProps, Select, Textarea } from '@labconnect/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import type messages from '../../../messages/en.json';
import {
  approveClaimAction,
  type DecisionState,
  openLetterheadAction,
  rejectClaimAction,
} from './ops-actions';
import { REJECT_REASONS } from './ops-model';

export type OpsText = typeof messages.ops;

/** One refusal as a banner. Every state the claim operations can answer has its own words. */
function Notice({
  state,
  text,
  reloadHref,
}: {
  state: DecisionState;
  text: OpsText;
  reloadHref: string;
}) {
  switch (state.notice) {
    case undefined:
      return null;
    case 'forbidden':
      return (
        <Alert tone="danger" title={text.forbiddenTitle}>
          {text.forbidden}
        </Alert>
      );
    case 'changed':
      return (
        <Alert tone="warning" title={text.changedTitle}>
          <p>{text.changed}</p>
          <Link href={reloadHref}>{text.reload}</Link>
        </Alert>
      );
    case 'already-decided':
      return (
        <Alert tone="warning" title={text.decidedTitle}>
          <p>{text.decided}</p>
          <Link href={reloadHref}>{text.reload}</Link>
        </Alert>
      );
    case 'busy':
      return <Alert tone="warning">{text.busy}</Alert>;
    case 'not-found':
      return <Alert tone="danger">{text.notFound}</Alert>;
    case 'letterhead-missing':
      return <Alert tone="danger">{text.letterheadMissing}</Alert>;
    case 'file-not-clean':
    case 'letter-unavailable':
      return <Alert tone="warning">{text.letterNotReady}</Alert>;
    case 'no-letterhead':
      return <Alert tone="info">{text.noLetterhead}</Alert>;
    case 'notes-required':
      return null; // shown on the field
    case 'notes-too-long':
      return <Alert tone="danger">{text.notesTooLong}</Alert>;
    case 'claimant-blocked':
      return (
        <Alert tone="danger" title={text.blockedTitle}>
          {text.blocked}
        </Alert>
      );
    case 'rate-limited':
      return <Alert tone="warning">{text.rateLimited}</Alert>;
    case 'signed-out':
      return (
        <Alert tone="warning" title={text.signedOutTitle}>
          <p>{text.signedOut}</p>
          <Link href="/sign-in">{text.signInAgain}</Link>
        </Alert>
      );
    default:
      return <Alert tone="danger">{text.failed}</Alert>;
  }
}

function Hidden({ claimId, etag, stateKey }: { claimId: string; etag: string; stateKey: string }) {
  return (
    <>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="etag" value={etag} />
      <input type="hidden" name="key" value={stateKey} />
    </>
  );
}

/**
 * The confirm step of an approval. It says what approving does, as board J9 and the contract word
 * it, right above the button. The claim's version travels in a hidden field (`If-Match`) and so
 * does the idempotency key made when the page was rendered, so a double click is one decision.
 */
export function ApproveForm({
  text,
  claimId,
  etag,
  initialKey,
  cancelHref,
}: {
  text: OpsText;
  claimId: string;
  etag: string;
  initialKey: string;
  cancelHref: string;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(approveClaimAction, {
    key: initialKey,
  });
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{text.approveTitle}</h2>
      <p>{text.approveEffect}</p>
      <Notice state={state} text={text} reloadHref={cancelHref} />
      <Hidden claimId={claimId} etag={etag} stateKey={state.key} />
      <Field id="approve-notes" label={text.approveNotesLabel} help={text.approveNotesHelp}>
        <Textarea
          {...fieldProps('approve-notes', { help: text.approveNotesHelp })}
          name="notes"
          maxLength={2000}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending}>
          {pending ? text.approving : text.approveConfirm}
        </Button>
        <Button asChild variant="secondary">
          <Link href={cancelHref}>{text.cancel}</Link>
        </Button>
      </div>
    </form>
  );
}

/** The rejection (board J9 "Reject this claim?"): a reason from the list and notes the lab sees. */
export function RejectForm({
  text,
  claimId,
  etag,
  initialKey,
  cancelHref,
}: {
  text: OpsText;
  claimId: string;
  etag: string;
  initialKey: string;
  cancelHref: string;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(rejectClaimAction, {
    key: initialKey,
  });
  const reasonLabels: Record<(typeof REJECT_REASONS)[number], string> = {
    signature: text.reasonSignature,
    letterhead: text.reasonLetterhead,
    certificate: text.reasonCertificate,
    other: text.reasonOther,
  };
  const notesError = state.notice === 'notes-required' ? text.notesRequired : undefined;
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{text.rejectTitle}</h2>
      <p>{text.rejectEffect}</p>
      <Notice state={state} text={text} reloadHref={cancelHref} />
      <Hidden claimId={claimId} etag={etag} stateKey={state.key} />
      <Field id="reject-reason" label={text.reasonLabel} help={text.reasonHelp}>
        <Select {...fieldProps('reject-reason', { help: text.reasonHelp })} name="reason">
          {REJECT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {reasonLabels[reason]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        id="reject-notes"
        label={text.notesLabel}
        help={text.notesHelp}
        {...(notesError === undefined ? {} : { error: notesError })}
        required
      >
        <Textarea
          {...fieldProps('reject-notes', {
            help: text.notesHelp,
            ...(notesError === undefined ? {} : { error: notesError }),
            required: true,
          })}
          name="notes"
          required
          maxLength={2000}
          defaultValue={state.notes ?? ''}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="destructive" loading={pending}>
          {pending ? text.rejecting : text.rejectConfirm}
        </Button>
        <Button asChild variant="secondary">
          <Link href={cancelHref}>{text.cancel}</Link>
        </Button>
      </div>
    </form>
  );
}

/** "Review letter": a link to the letterhead is asked for on this click, not before. */
export function LetterheadButton({
  text,
  claimId,
  initialKey,
}: {
  text: OpsText;
  claimId: string;
  initialKey: string;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(openLetterheadAction, {
    key: initialKey,
  });
  return (
    <form action={action} className="flex flex-col gap-3">
      <Notice state={state} text={text} reloadHref={`/admin/claims/${claimId}`} />
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="key" value={state.key} />
      <Button type="submit" variant="secondary" loading={pending} className="self-start">
        {text.reviewLetter}
      </Button>
      <p className="text-sm text-text-muted">{text.reviewLetterHelp}</p>
    </form>
  );
}
