'use client';

import { Alert, Button, Field, fieldProps, Input } from '@labconnect/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import type messages from '../../../messages/en.json';
import { type StartState, startClaimAction } from './claim-actions';
import { CLAIM_LIMITS } from './claim-model';

export type StartText = typeof messages.claim;

function fill(text: string, values: Record<string, string>): string {
  return text.replaceAll(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/**
 * Board H4 step 1: the NABL certificate number. Submitting it finds the lab and sends the code, so
 * the lab's name appears on the next page, with the claim. Every refusal the API can give has its
 * own message; the 422 is one answer for every kind of "no such lab" (OQ-205), so it says only
 * that no lab was found.
 */
export function StartClaimForm({ text, initialKey }: { text: StartText; initialKey: string }) {
  const [state, action, pending] = useActionState<StartState, FormData>(startClaimAction, {
    certificateNo: '',
    key: initialKey,
  });
  const retry = state.retryAt === undefined ? undefined : { time: state.retryAt };
  const limits = {
    claims: String(CLAIM_LIMITS.openClaims),
    uploads: String(CLAIM_LIMITS.uploadsPerClaim),
  };
  const fieldError =
    state.notice === 'invalid'
      ? text.certInvalid
      : state.notice === 'not-found'
        ? text.notFound
        : undefined;

  const banner =
    state.notice === 'claimed' ? (
      <Alert tone="warning" title={text.claimedTitle}>
        {text.claimed}
      </Alert>
    ) : state.notice === 'other-open' ? (
      <Alert tone="warning" title={text.otherOpenTitle}>
        {text.otherOpen}
      </Alert>
    ) : state.notice === 'own-review' ? (
      <Alert tone="info" title={text.ownReviewTitle}>
        <p>{text.ownReview}</p>
        <Link href="#your-claims">{text.openClaim}</Link>
      </Alert>
    ) : state.notice === 'cap' ? (
      <Alert tone="warning" title={text.capTitle}>
        {fill(text.capStart, limits)}
      </Alert>
    ) : state.notice === 'rate-limited' ? (
      <Alert tone="warning" title={text.rateLimitedTitle}>
        {retry === undefined ? text.rateLimitedNoTime : fill(text.rateLimited, retry)}
      </Alert>
    ) : state.notice === 'staff' ? (
      <Alert tone="warning" title={text.staffTitle}>
        {text.staff}
      </Alert>
    ) : state.notice === 'signed-out' ? (
      <Alert tone="warning" title={text.signedOutTitle}>
        <p>{text.signedOut}</p>
        <Link href="/sign-in">{text.signInAgain}</Link>
      </Alert>
    ) : state.notice === 'failed' ? (
      <Alert tone="danger">{text.failed}</Alert>
    ) : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {banner}
      <input type="hidden" name="key" value={state.key} />
      <Field
        id="certificate-no"
        label={text.certLabel}
        help={text.certHelp}
        {...(fieldError === undefined ? {} : { error: fieldError })}
        required
      >
        <Input
          {...fieldProps('certificate-no', {
            help: text.certHelp,
            ...(fieldError === undefined ? {} : { error: fieldError }),
            required: true,
          })}
          name="certificateNo"
          autoComplete="off"
          maxLength={50}
          defaultValue={state.certificateNo}
          className="max-w-sm"
        />
      </Field>
      <Button type="submit" loading={pending} className="self-start">
        {pending ? text.finding : text.find}
      </Button>
    </form>
  );
}
