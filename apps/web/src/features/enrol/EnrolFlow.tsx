'use client';

import { Alert, Button, Field, fieldProps, Input } from '@labconnect/ui';
import Link from 'next/link';
import { type ReactNode, useActionState, useEffect, useState } from 'react';
import { type EnrolState, enrolAction } from './enrol-actions';
import type messages from '../../../messages/en.json';

export type EnrolText = typeof messages.enrol;

function fill(text: string, values: Record<string, string>): string {
  return text.replaceAll(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** The four steps of board G2, with the current one marked (not by colour alone). */
function Steps({ text, current }: { text: EnrolText; current: 1 | 2 | 3 | 4 }) {
  const labels = [text.stepWhy, text.stepScan, text.stepConfirm, text.stepCodes];
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
      {labels.map((label, index) => {
        const number = index + 1;
        return (
          <li
            key={label}
            aria-current={number === current ? 'step' : undefined}
            className={number === current ? 'font-semibold text-text' : undefined}
          >
            <span className="tabular-nums">{number}</span> {label}
            {number === current && <span className="sr-only"> {text.stepCurrent}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The QR code: the path was drawn on the server from the `otpauth` address; this only paints it. */
function QrImage({ qr, label }: { qr: NonNullable<EnrolState['qr']>; label: string }) {
  const size = String(qr.size);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-56 max-w-full rounded-md border border-border bg-surface-raised"
    >
      <path d={qr.d} className="fill-text" />
    </svg>
  );
}

/**
 * A button that needs JavaScript (copy, download). Without it the button does nothing, so it is
 * only rendered once the page has hydrated.
 */
function Enhancement({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready ? <>{children}</> : null;
}

function CopyButton({ value, label, done }: { value: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
          });
        }}
      >
        {label}
      </Button>
      <span role="status" className="sr-only">
        {copied ? done : ''}
      </span>
    </>
  );
}

function DownloadButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        const url = URL.createObjectURL(new Blob([value], { type: 'text/plain' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'labconnect-recovery-codes.txt';
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      {label}
    </Button>
  );
}

/**
 * Authenticator enrolment (board G2): why, scan, confirm, recovery codes. The secret, the QR code
 * and the codes exist only in this component's state, which the server action returns; a reload
 * or a return to the page from the browser's back-forward cache starts again at "why" and never
 * asks the API for a second key by itself.
 */
export function EnrolFlow({ text, initialKey }: { text: EnrolText; initialKey: string }) {
  const [state, action, pending] = useActionState<EnrolState, FormData>(enrolAction, {
    step: 'why',
    key: initialKey,
  });

  // A page restored from the back-forward cache must not show a secret or codes again.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pageshow', onShow);
    };
  }, []);

  const retry = state.retryAt === undefined ? undefined : { time: state.retryAt };
  const banner =
    state.notice === 'failed' ? (
      <Alert tone="danger">{text.failed}</Alert>
    ) : state.notice === 'already-enrolled' ? (
      <Alert tone="info" title={text.alreadyTitle}>
        <p>{text.alreadyText}</p>
        <p>{text.lostText}</p>
      </Alert>
    ) : state.notice === 'no-pending' ? (
      <Alert tone="info" title={text.noPendingTitle}>
        <p>{text.noPendingText}</p>
      </Alert>
    ) : state.notice === 'rate-limited' ? (
      <Alert tone="warning" title={text.rateLimitedTitle}>
        {retry === undefined ? text.rateLimitedNoTime : fill(text.rateLimited, retry)}
      </Alert>
    ) : null;

  if (state.step === 'codes') {
    const codes = state.recoveryCodes ?? [];
    const joined = codes.join('\n');
    const error = state.notice === 'save-first' ? text.saveFirst : undefined;
    return (
      <form action={action} className="flex flex-col gap-4">
        <Steps text={text} current={4} />
        <h2 className="text-lg font-semibold">{text.codesTitle}</h2>
        <Alert tone="warning">{text.codesWarning}</Alert>
        <ul
          aria-label={text.codesTitle}
          className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-border bg-surface p-4 font-mono text-lg sm:grid-cols-5"
        >
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Enhancement>
            <DownloadButton value={joined} label={text.download} />
            <CopyButton value={joined} label={text.copy} done={text.copied} />
          </Enhancement>
        </div>
        <input type="hidden" name="key" value={state.key} />
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input
              type="checkbox"
              name="saved"
              required
              className="size-5 accent-brand-primary"
              aria-describedby={error === undefined ? undefined : 'saved-error'}
              aria-invalid={error === undefined ? undefined : true}
            />
            <span>{text.savedLabel}</span>
          </label>
          {error !== undefined && (
            <p id="saved-error" role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <p className="text-text-muted">{text.afterText}</p>
        <Button type="submit" name="intent" value="finish" loading={pending} className="self-start">
          {text.continue}
        </Button>
      </form>
    );
  }

  if (state.step === 'scan' && state.qr !== undefined) {
    const error = state.notice === 'code-invalid' ? text.codeInvalid : undefined;
    const locked = state.notice === 'locked';
    return (
      <form action={action} className="flex flex-col gap-4">
        <Steps text={text} current={2} />
        <h2 className="text-lg font-semibold">{text.scanTitle}</h2>
        <p className="text-text-muted">{text.scanText}</p>
        {state.notice === 'failed' && <Alert tone="danger">{text.failed}</Alert>}
        {locked && (
          <Alert tone="danger" title={text.lockedTitle}>
            {retry === undefined ? text.lockedNoTime : fill(text.locked, retry)}
          </Alert>
        )}
        {state.notice === 'rate-limited' && (
          <Alert tone="warning" title={text.rateLimitedTitle}>
            {retry === undefined ? text.rateLimitedNoTime : fill(text.rateLimited, retry)}
          </Alert>
        )}
        <QrImage qr={state.qr} label={text.qrLabel} />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text">{text.keyLabel}</p>
          <p
            id="setup-key"
            className="break-words font-mono text-lg tracking-wide"
            // The key is read aloud as groups, not as one long word.
            aria-label={text.keyLabel}
          >
            {state.groupedSecret}
          </p>
          <Enhancement>
            <div className="flex items-center gap-2">
              <CopyButton
                value={(state.groupedSecret ?? '').replaceAll(' ', '')}
                label={text.copyKey}
                done={text.copied}
              />
            </div>
          </Enhancement>
        </div>
        <h2 className="text-lg font-semibold">{text.confirmTitle}</h2>
        <input type="hidden" name="key" value={state.key} />
        <Field
          id="enrol-code"
          label={text.codeLabel}
          help={text.codeHelp}
          {...(error === undefined ? {} : { error })}
          required
        >
          <Input
            {...fieldProps('enrol-code', {
              help: text.codeHelp,
              ...(error === undefined ? {} : { error }),
              required: true,
            })}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            className="max-w-48 font-mono text-xl tracking-[0.5em]"
          />
        </Field>
        <Button
          type="submit"
          name="intent"
          value="confirm"
          loading={pending}
          disabled={locked}
          className="self-start"
        >
          {pending ? text.confirming : text.confirm}
        </Button>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Steps text={text} current={1} />
      <h2 className="text-lg font-semibold">{text.whyTitle}</h2>
      <p className="text-text-muted">{text.whyText}</p>
      {banner}
      <input type="hidden" name="key" value={state.key} />
      {state.notice === 'already-enrolled' || state.notice === 'no-pending' ? (
        <Button asChild variant="secondary" className="self-start">
          <Link href="/sign-in">{text.toSignIn}</Link>
        </Button>
      ) : (
        <>
          <p className="text-sm text-text-muted">{text.restartWarning}</p>
          <Button
            type="submit"
            name="intent"
            value="start"
            loading={pending}
            className="self-start"
          >
            {pending ? text.starting : text.start}
          </Button>
        </>
      )}
    </form>
  );
}
