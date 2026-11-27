'use client';

import { Alert, Button, Field, fieldProps, Input, Textarea } from '@labconnect/ui';
import { useActionState } from 'react';
import { createLeadAction, type LeadState } from './lead-action';

export interface LeadFormText {
  whatLabel: string;
  whatHelp: string;
  emailLabel: string;
  emailHelp: string;
  required: string;
  submit: string;
  sending: string;
  cancel: string;
  sentTitle: string;
  sentText: string;
  errorEmail: string;
  errorWhat: string;
  failed: string;
  rateLimited: string;
  labNotFound: string;
}

interface Props {
  kind: 'REQUEST_LAB' | 'NO_RESULT';
  labSiteId?: string;
  /** For `NO_RESULT`: the search criteria (no location), sent with the lead. */
  criteria?: Record<string, string | number>;
  /** The search text, prefilled into "What do you want tested?". */
  initialWhat: string;
  cancelHref: string;
  text: LeadFormText;
}

/**
 * The request form of board H3: what to test and an email, with the states the board draws:
 * validation per field, sending, sent, rate limited (the text is kept) and a generic failure.
 */
export function LeadForm({ kind, labSiteId, criteria, initialWhat, cancelHref, text }: Props) {
  const [state, action, pending] = useActionState<LeadState, FormData>(createLeadAction, {
    status: 'idle',
  });

  if (state.status === 'sent') {
    return (
      <Alert tone="success" title={text.sentTitle}>
        {text.sentText}
      </Alert>
    );
  }

  const values = state.values ?? { what: initialWhat, email: '' };
  const what = {
    ...(initialWhat === '' ? {} : { help: text.whatHelp }),
    ...(state.errors?.what ? { error: text.errorWhat } : {}),
  };
  const email = {
    help: text.emailHelp,
    ...(state.errors?.email ? { error: text.errorEmail } : {}),
  };
  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="kind" value={kind} />
      {labSiteId !== undefined && <input type="hidden" name="labSiteId" value={labSiteId} />}
      {criteria !== undefined && (
        <input type="hidden" name="criteria" value={JSON.stringify(criteria)} />
      )}
      {state.status === 'rate-limited' && <Alert tone="warning">{text.rateLimited}</Alert>}
      {state.status === 'failed' && <Alert tone="danger">{text.failed}</Alert>}
      {state.status === 'lab-not-found' && <Alert tone="danger">{text.labNotFound}</Alert>}
      <Field id="lead-what" {...what} required requiredLabel={text.required} label={text.whatLabel}>
        <Textarea
          {...fieldProps('lead-what', { ...what, required: true })}
          name="what"
          defaultValue={values.what}
          maxLength={200}
          rows={3}
        />
      </Field>
      <Field
        id="lead-email"
        {...email}
        required
        requiredLabel={text.required}
        label={text.emailLabel}
      >
        <Input
          {...fieldProps('lead-email', { ...email, required: true })}
          name="contactEmail"
          type="email"
          autoComplete="email"
          defaultValue={values.email}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {pending ? text.sending : text.submit}
        </Button>
        <Button asChild variant="secondary">
          <a href={cancelHref}>{text.cancel}</a>
        </Button>
      </div>
    </form>
  );
}
