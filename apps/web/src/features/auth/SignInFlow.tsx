'use client';

import { Alert, Button, Field, fieldProps, Input } from '@labconnect/ui';
import Link from 'next/link';
import { type ReactNode, useActionState, useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { type SignInState, signInAction } from './sign-in-actions';

export type SignInText = Record<
  | 'emailLabel'
  | 'emailHelp'
  | 'sendCode'
  | 'sending'
  | 'newHere'
  | 'codeSent'
  | 'codeLabel'
  | 'codeHelp'
  | 'verify'
  | 'verifying'
  | 'resendIn'
  | 'resend'
  | 'sendNew'
  | 'otherEmail'
  | 'codeInvalid'
  | 'codeExpired'
  | 'lockedTitle'
  | 'locked'
  | 'lockedNoTime'
  | 'rateLimitedTitle'
  | 'rateLimited'
  | 'rateLimitedNoTime'
  | 'emailInvalid'
  | 'failed'
  | 'mfaTitle'
  | 'mfaIntro'
  | 'mfaLabel'
  | 'mfaHelp'
  | 'mfaSubmit'
  | 'mfaInvalid'
  | 'mfaLockedTitle'
  | 'mfaLocked'
  | 'mfaLockedNoTime'
  | 'enrolTitle'
  | 'enrolText',
  string
>;

const RESEND_AFTER_SECONDS = 60;

/** "priya@example.com" → "p•••••@example.com" (G1: the code-sent line never shows the full address). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email.slice(0, 1)}•••••${email.slice(at)}`;
}

function fill(text: string, values: Record<string, string>): string {
  return text.replaceAll(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** A one-time-code box: digits, paste and autofill (`one-time-code`), 16 px, spaced for reading. */
function CodeInput({
  id,
  error,
  help,
  autoComplete,
}: {
  id: string;
  error?: string;
  help: string;
  autoComplete: string;
}) {
  return (
    <Input
      {...fieldProps(id, { help, ...(error === undefined ? {} : { error }), required: true })}
      name="code"
      inputMode="numeric"
      autoComplete={autoComplete}
      pattern="[0-9 ]*"
      maxLength={7}
      className="max-w-48 font-mono text-xl tracking-[0.5em]"
      autoFocus
    />
  );
}

/**
 * The sign-in steps of board G1: email, the emailed code (with resend after a minute), and the
 * authenticator step for roles that need it. Every state of the board has its notice; notices
 * are announced. The tokens never reach this component: the server action keeps them in
 * HTTP-only cookies and redirects back to where the user came from.
 */
export function SignInFlow({
  text,
  next,
  footer,
}: {
  text: SignInText;
  /** Where to go after sign-in instead of the page the user came from (sign-up only). */
  next?: '/sign-up';
  /** Shown under the email step, for example the link to the other of sign-in and sign-up. */
  footer?: ReactNode;
}) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, {
    step: 'email',
    email: '',
  });
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (state.step === 'code' && state.notice === 'code-sent') setWait(RESEND_AFTER_SECONDS);
  }, [state]);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => {
      setWait((seconds) => seconds - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [wait]);

  const retry = state.retryAt === undefined ? undefined : { time: state.retryAt };
  const banner =
    state.notice === 'locked' ? (
      <Alert tone="danger" title={text.lockedTitle}>
        {retry === undefined ? text.lockedNoTime : fill(text.locked, retry)}
      </Alert>
    ) : state.notice === 'rate-limited' ? (
      <Alert tone="warning" title={text.rateLimitedTitle}>
        {retry === undefined ? text.rateLimitedNoTime : fill(text.rateLimited, retry)}
      </Alert>
    ) : state.notice === 'mfa-locked' ? (
      <Alert tone="danger" title={text.mfaLockedTitle}>
        {retry === undefined ? text.mfaLockedNoTime : fill(text.mfaLocked, retry)}
      </Alert>
    ) : state.notice === 'failed' ? (
      <Alert tone="danger">{text.failed}</Alert>
    ) : null;

  if (state.step === 'enrol') {
    return (
      <Alert tone="warning" title={t('enrol.signInTitle')}>
        <p>{t('enrol.signInText')}</p>
        <Button asChild className="self-start">
          <Link href="/sign-in/authenticator">{t('enrol.signInLink')}</Link>
        </Button>
      </Alert>
    );
  }

  if (state.step === 'mfa') {
    const error = state.notice === 'mfa-invalid' ? text.mfaInvalid : undefined;
    return (
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{text.mfaTitle}</h2>
          <p className="text-text-muted">{text.mfaIntro}</p>
        </div>
        {banner}
        <input type="hidden" name="email" value={state.email} />
        <Field
          id="mfa-code"
          label={text.mfaLabel}
          help={text.mfaHelp}
          {...(error === undefined ? {} : { error })}
          required
        >
          <CodeInput
            id="mfa-code"
            help={text.mfaHelp}
            {...(error === undefined ? {} : { error })}
            autoComplete="one-time-code"
          />
        </Field>
        <Button type="submit" name="intent" value="mfa" loading={pending} className="self-start">
          {pending ? text.verifying : text.mfaSubmit}
        </Button>
      </form>
    );
  }

  if (state.step === 'code') {
    const error =
      state.notice === 'code-invalid'
        ? text.codeInvalid
        : state.notice === 'code-expired'
          ? text.codeExpired
          : undefined;
    const expired = state.notice === 'code-expired';
    return (
      <form action={action} className="flex flex-col gap-4">
        <p role="status" className="text-text">
          {fill(text.codeSent, { email: maskEmail(state.email) })}
        </p>
        {banner}
        <input type="hidden" name="email" value={state.email} />
        <Field
          id="otp-code"
          label={text.codeLabel}
          help={text.codeHelp}
          {...(error === undefined ? {} : { error })}
          required
        >
          <CodeInput
            id="otp-code"
            help={text.codeHelp}
            {...(error === undefined ? {} : { error })}
            autoComplete="one-time-code"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          {!expired && (
            <Button type="submit" name="intent" value="verify" loading={pending}>
              {pending ? text.verifying : text.verify}
            </Button>
          )}
          <Button
            type="submit"
            name="intent"
            value="resend"
            variant={expired ? 'primary' : 'secondary'}
            disabled={!expired && wait > 0}
            formNoValidate
          >
            {expired
              ? text.sendNew
              : wait > 0
                ? fill(text.resendIn, { time: `0:${String(wait).padStart(2, '0')}` })
                : text.resend}
          </Button>
          <Button type="submit" name="intent" value="restart" variant="link" formNoValidate>
            {text.otherEmail}
          </Button>
        </div>
      </form>
    );
  }

  const emailError = state.notice === 'email-invalid' ? text.emailInvalid : undefined;
  return (
    <form action={action} className="flex flex-col gap-4">
      {banner}
      <Field
        id="sign-in-email"
        label={text.emailLabel}
        help={text.emailHelp}
        {...(emailError === undefined ? {} : { error: emailError })}
        required
      >
        <Input
          {...fieldProps('sign-in-email', {
            help: text.emailHelp,
            ...(emailError === undefined ? {} : { error: emailError }),
            required: true,
          })}
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          autoFocus
        />
      </Field>
      {next !== undefined && <input type="hidden" name="next" value={next} />}
      <Button type="submit" name="intent" value="send" loading={pending} className="self-start">
        {pending ? text.sending : text.sendCode}
      </Button>
      {footer}
    </form>
  );
}
