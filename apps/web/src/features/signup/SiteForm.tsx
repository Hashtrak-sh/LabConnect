'use client';

import { Alert, Button, Field, fieldProps, Input } from '@labconnect/ui';
import Link from 'next/link';
import { startTransition, useActionState } from 'react';
import { AddressFieldset } from './AddressFieldset';
import { createSiteAction, type SiteField, type SiteState } from './site-action';
import { SignUpProgress, type SignUpText } from './SignUpForm';

function errorText(text: SignUpText, error: 'required' | 'too-long' | 'pincode' | undefined) {
  if (error === 'required') return text.errorRequired;
  if (error === 'too-long') return text.errorTooLong;
  if (error === 'pincode') return text.errorPincode;
  return undefined;
}

/**
 * Board J1 step 5, "Your default site": a name and the address of the place samples come from.
 * It becomes the default billing site. "Skip for now" goes straight to "Your account is ready";
 * sites can be added later (J2). No map pin: the contract takes no location (it is geocoded).
 */
export function SiteForm({ text }: { text: SignUpText }) {
  const [state, action, pending] = useActionState<SiteState, FormData>(createSiteAction, {
    status: 'editing',
  });
  const values: Partial<NonNullable<SiteState['values']>> = state.values ?? {};
  const errors: Partial<Record<SiteField, string>> = {};
  for (const [field, error] of Object.entries(state.errors ?? {})) {
    const message = errorText(text, error);
    if (message !== undefined) errors[field as SiteField] = message;
  }
  const nameState = {
    help: text.siteNameHelp,
    required: true,
    ...(errors.name === undefined ? {} : { error: errors.name }),
  };

  return (
    <form
      // Submitted by hand: React's reset after an action would clear the state picker.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => {
          action(data);
        });
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      <SignUpProgress text={text} step={5} />
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-text">{text.siteTitle}</h2>
        <p className="text-text-muted">{text.siteIntro}</p>
      </div>
      {state.status === 'invalid' && <Alert tone="danger">{text.errorSummary}</Alert>}
      {state.status === 'failed' && (
        <Alert tone="danger" title={text.siteFailedTitle}>
          {text.failed}
        </Alert>
      )}
      {state.status === 'signed-out' && (
        <Alert tone="warning">
          {text.signedOut} <Link href="/sign-in">{text.signInAgain}</Link>
        </Alert>
      )}
      {state.status === 'forbidden' && <Alert tone="danger">{text.siteForbidden}</Alert>}

      <Field id="site-name" label={text.siteName} {...nameState}>
        <Input
          {...fieldProps('site-name', nameState)}
          name="name"
          defaultValue={values.name ?? ''}
        />
      </Field>
      <AddressFieldset
        idPrefix="site"
        legend={text.siteAddressLegend}
        text={text}
        values={values}
        errors={errors}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {pending ? text.saving : text.finish}
        </Button>
        <Button asChild variant="link">
          <Link href="/sign-up/done">{text.skip}</Link>
        </Button>
      </div>
    </form>
  );
}
