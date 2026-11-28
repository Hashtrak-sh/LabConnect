'use client';

import { Alert, Button, Field, fieldProps, Input } from '@labconnect/ui';
import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import type messages from '../../../messages/en.json';
import { type ClaimState, claimAction, requestLetterheadUploadAction } from './claim-actions';
import { checkLetterhead, LETTERHEAD_TYPES, sniffLetterhead } from './claim-model';

export type ClaimText = typeof messages.claim;

function fill(text: string, values: Record<string, string>): string {
  return text.replaceAll(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

type UploadState =
  | { step: 'idle' }
  | { step: 'working'; label: 'requesting' | 'sending' }
  | { step: 'uploaded'; fileId: string }
  | { step: 'error'; message: string };

/**
 * The letterhead route (board H4 "Manual path"). The browser sends the file straight to the
 * pre-signed URL the API issued (FILES_AND_REPORTS §1: files never pass through the app servers),
 * so this part needs JavaScript; the form below it, which submits the claim for review once the
 * scan has passed, is an ordinary form.
 */
function Letterhead({
  text,
  claimId,
  etag,
  stateKey,
  action,
  pending,
  scanning,
}: {
  text: ClaimText;
  claimId: string;
  etag: string;
  stateKey: string;
  action: (form: FormData) => void;
  pending: boolean;
  scanning: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<UploadState>({ step: 'idle' });

  const reasons: Record<string, string> = {
    type: text.letterType,
    size: text.letterSize,
    empty: text.letterEmpty,
    content: text.letterContent,
    'file-rejected': text.letterRejected,
    'upload-cap': text.letterCap,
    'rate-limited': text.letterBusy,
    'not-open': text.letterNotOpen,
    'in-review': text.letterNotOpen,
    expired: text.letterNotOpen,
    'not-found': text.letterNotOpen,
    'signed-out': text.signedOut,
  };

  async function send() {
    const file = input.current?.files?.[0];
    if (file === undefined) {
      setUpload({ step: 'error', message: text.letterEmpty });
      return;
    }
    // The same limits the server enforces, first, so a wrong file is turned away before it moves.
    const check = checkLetterhead({ contentType: file.type, sizeBytes: file.size });
    if (!check.ok) {
      setUpload({ step: 'error', message: reasons[check.reason] ?? text.failed });
      return;
    }
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (sniffLetterhead(head) !== check.contentType) {
      setUpload({ step: 'error', message: text.letterContent });
      return;
    }
    setUpload({ step: 'working', label: 'requesting' });
    const ticket = await requestLetterheadUploadAction({
      claimId,
      contentType: check.contentType,
      sizeBytes: check.sizeBytes,
    }).catch(() => null);
    if (ticket === null) {
      setUpload({ step: 'error', message: text.failed });
      return;
    }
    if (!ticket.ok) {
      setUpload({ step: 'error', message: reasons[ticket.reason] ?? text.failed });
      return;
    }
    setUpload({ step: 'working', label: 'sending' });
    try {
      // `Content-Length` is set by the browser from the body; the signed Content-Type must match.
      const headers = Object.fromEntries(
        Object.entries(ticket.headers).filter(([name]) => name.toLowerCase() !== 'content-length'),
      );
      const response = await fetch(ticket.uploadUrl, { method: 'PUT', headers, body: file });
      if (!response.ok) throw new Error('upload refused');
    } catch {
      setUpload({ step: 'error', message: text.letterSendFailed });
      return;
    }
    setUpload({ step: 'uploaded', fileId: ticket.fileId });
  }

  const working = upload.step === 'working';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-muted">{text.letterIntro}</p>
      <noscript>
        <Alert tone="info">{text.letterNeedsScript}</Alert>
      </noscript>
      <Field
        id="letterhead-file"
        label={text.letterLabel}
        help={fill(text.letterHelp, { size: '10 MB' })}
        {...(upload.step === 'error' ? { error: upload.message } : {})}
      >
        <Input
          {...fieldProps('letterhead-file', {
            help: fill(text.letterHelp, { size: '10 MB' }),
            ...(upload.step === 'error' ? { error: upload.message } : {}),
          })}
          ref={input}
          type="file"
          accept={LETTERHEAD_TYPES.join(',')}
          className="py-2"
          disabled={upload.step === 'uploaded'}
        />
      </Field>
      {upload.step !== 'uploaded' && (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          loading={working}
          onClick={() => void send()}
        >
          {working
            ? upload.label === 'requesting'
              ? text.letterPreparing
              : text.letterSending
            : text.letterUpload}
        </Button>
      )}
      <p role="status" className="sr-only">
        {working ? (upload.label === 'requesting' ? text.letterPreparing : text.letterSending) : ''}
      </p>
      {upload.step === 'uploaded' && (
        <form action={action} className="flex flex-col gap-3">
          <Alert tone="info" title={text.letterUploadedTitle}>
            {text.letterUploaded}
          </Alert>
          {scanning && <Alert tone="warning">{text.letterScanning}</Alert>}
          <input type="hidden" name="claimId" value={claimId} />
          <input type="hidden" name="etag" value={etag} />
          <input type="hidden" name="key" value={stateKey} />
          <input type="hidden" name="fileId" value={upload.fileId} />
          <Button
            type="submit"
            name="intent"
            value="submit"
            loading={pending}
            className="self-start"
          >
            {text.letterSubmit}
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * A claim waiting for its code (board H4 step 2): the code field, a new code, and the letterhead
 * route. Each outcome the API can give has its own message. The version of the claim as the page
 * loaded it (`etag`) travels in a hidden field and goes back as `If-Match`; so does a key made on
 * the server, renewed after every answer, so one form submitted twice is one operation.
 */
export function ClaimPanel({
  text,
  claimId,
  etag,
  initialKey,
  otpSentTo,
  siteName,
}: {
  text: ClaimText;
  claimId: string;
  etag: string;
  initialKey: string;
  otpSentTo: string | null;
  siteName: string;
}) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(claimAction, {
    key: initialKey,
  });
  const retry = state.retryAt === undefined ? undefined : { time: state.retryAt };
  const codeError =
    state.notice === 'code-invalid'
      ? text.codeInvalid
      : state.notice === 'code-expired'
        ? text.codeExpired
        : undefined;
  const expired = state.notice === 'code-expired';
  const locked = state.notice === 'locked';
  const certError =
    state.notice === 'cert-invalid'
      ? text.certInvalid
      : state.notice === 'cert-not-found'
        ? text.resendNotFound
        : undefined;

  const banner =
    state.notice === 'code-sent' ? (
      <Alert tone="success">{text.codeResent}</Alert>
    ) : state.notice === 'locked' ? (
      <Alert tone="danger" title={text.lockedTitle}>
        {retry === undefined ? text.lockedNoTime : fill(text.locked, retry)}
      </Alert>
    ) : state.notice === 'rate-limited' ? (
      <Alert tone="warning" title={text.rateLimitedTitle}>
        {retry === undefined ? text.rateLimitedNoTime : fill(text.rateLimited, retry)}
      </Alert>
    ) : state.notice === 'cap' ? (
      <Alert tone="warning" title={text.capTitle}>
        {text.cap}
      </Alert>
    ) : state.notice === 'scanning' ? (
      <Alert tone="warning">{text.letterScanning}</Alert>
    ) : state.notice === 'signed-out' ? (
      <Alert tone="warning" title={text.signedOutTitle}>
        <p>{text.signedOut}</p>
        <Link href="/sign-in">{text.signInAgain}</Link>
      </Alert>
    ) : state.notice === 'failed' ? (
      <Alert tone="danger">{text.failed}</Alert>
    ) : state.notice === 'not-found' ? (
      <Alert tone="info">{text.movedOn}</Alert>
    ) : null;

  // The version the last answer gave, else the one the page was read with (`If-Match`).
  const currentEtag = state.etag ?? etag;
  const hidden = (
    <>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="etag" value={currentEtag} />
      <input type="hidden" name="key" value={state.key} />
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {banner}
      {otpSentTo === null ? (
        <Alert tone="info" title={text.noEmailTitle}>
          {text.noEmail}
        </Alert>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <p role="status" className="text-text">
            {fill(text.codeSent, { email: otpSentTo, lab: siteName })}
          </p>
          {hidden}
          <Field
            id="claim-code"
            label={text.codeLabel}
            help={text.codeHelp}
            {...(codeError === undefined ? {} : { error: codeError })}
            required
          >
            <Input
              {...fieldProps('claim-code', {
                help: text.codeHelp,
                ...(codeError === undefined ? {} : { error: codeError }),
                required: true,
              })}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              className="max-w-48 font-mono text-xl tracking-[0.5em]"
              disabled={locked}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            {!expired && (
              <Button
                type="submit"
                name="intent"
                value="verify"
                loading={pending}
                disabled={locked}
              >
                {pending ? text.verifying : text.verify}
              </Button>
            )}
          </div>
        </form>
      )}
      {otpSentTo !== null && (
        <form action={action} className="flex flex-col gap-3 rounded-md border border-border p-4">
          <h2 className="font-medium text-text">{text.resendTitle}</h2>
          <p className="text-sm text-text-muted">{text.resendHelp}</p>
          {hidden}
          <Field
            id="resend-certificate"
            label={text.certLabel}
            {...(certError === undefined ? {} : { error: certError })}
          >
            <Input
              {...fieldProps('resend-certificate', {
                ...(certError === undefined ? {} : { error: certError }),
              })}
              name="certificateNo"
              autoComplete="off"
              maxLength={50}
              className="max-w-sm"
            />
          </Field>
          <Button
            type="submit"
            name="intent"
            value="resend"
            variant={expired ? 'primary' : 'secondary'}
            className="self-start"
          >
            {text.resend}
          </Button>
        </form>
      )}
      <details open={otpSentTo === null || locked} className="rounded-md border border-border p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-text">
          {text.letterSummary}
        </summary>
        <div className="pt-3">
          <Letterhead
            text={text}
            claimId={claimId}
            etag={currentEtag}
            stateKey={state.key}
            action={action}
            pending={pending}
            scanning={state.notice === 'scanning'}
          />
        </div>
      </details>
    </div>
  );
}
