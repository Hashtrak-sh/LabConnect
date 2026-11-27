'use client';

import { Alert, Button, Field, fieldProps, Input } from '@labconnect/ui';
import Link from 'next/link';
import { startTransition, useActionState, useState } from 'react';
import type messages from '../../../messages/en.json';
import { AddressFieldset } from './AddressFieldset';
import { createOrganisationAction, type SignUpState } from './signup-action';
import type { AddressField, SignUpField, SignUpFieldError, SignUpValues } from './signup-form';

export type SignUpText = (typeof messages)['signUp'];

type Kind = 'organisation' | 'individual';

function fill(text: string, values: Record<string, string>): string {
  return text.replaceAll(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** The J1 progress line: steps 1 and 2 (email, code) are done once the user is signed in. */
export function SignUpProgress({ text, step }: { text: SignUpText; step: 1 | 2 | 3 | 4 | 5 }) {
  const steps = [text.stepEmail, text.stepCode, text.stepKind, text.stepDetails, text.stepSite];
  return (
    <nav aria-label={text.progressLabel}>
      <p className="mb-2 text-sm text-text-muted">
        {fill(text.stepOf, { step: String(step), total: String(steps.length) })}
      </p>
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {steps.map((label, index) => {
          const number = index + 1;
          const done = number < step;
          const current = number === step;
          return (
            <li
              key={label}
              aria-current={current ? 'step' : undefined}
              className={current ? 'font-semibold text-text' : 'text-text-muted'}
            >
              <span aria-hidden="true">{done ? '✓' : String(number)}</span> {label}
              {done && <span className="sr-only"> ({text.done})</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function errorText(text: SignUpText, error: SignUpFieldError | undefined, value: string) {
  switch (error) {
    case undefined:
      return undefined;
    case 'required':
      return text.errorRequired;
    case 'too-long':
      return text.errorTooLong;
    case 'gstin-length':
      return fill(text.errorGstinLength, { count: String(value.length) });
    case 'gstin-format':
      return text.errorGstinFormat;
    case 'gstin-taken':
      return text.errorGstinTaken;
    case 'pincode':
      return text.errorPincode;
  }
}

/**
 * Board J1 steps 3 and 4 for a signed-in user without a customer organisation: individual or
 * organisation, then the details, then "Your account is ready". Steps 5 (default site) and 6
 * (invite people) come with the site and invitation APIs (I2-CUS-03, I2-CUS-04).
 */
export function SignUpForm({
  text,
  idempotencyKey,
}: {
  text: SignUpText;
  /** The first `Idempotency-Key`, made on the server (the browser has no UUID source over plain HTTP). */
  idempotencyKey: string;
}) {
  const [state, action, pending] = useActionState<SignUpState, FormData>(createOrganisationAction, {
    status: 'editing',
  });
  const [kind, setKind] = useState<Kind | null>(
    state.values === undefined
      ? null
      : state.values.segment === 'INDIVIDUAL'
        ? 'individual'
        : 'organisation',
  );
  const [choice, setChoice] = useState<Kind>('organisation');
  // Controlled: React resets a form after its action, and a select or radio group would fall back
  // to its first default instead of what the user chose.
  const [segment, setSegment] = useState<SignUpValues['segment']>('BUSINESS');

  if (kind === null) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setKind(choice);
        }}
      >
        <SignUpProgress text={text} step={3} />
        <h2 className="text-xl font-semibold text-text">{text.kindTitle}</h2>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium text-text">{text.kindLegend}</legend>
          {(
            [
              ['organisation', text.organisation, text.organisationHelp],
              ['individual', text.individual, text.individualHelp],
            ] as const
          ).map(([value, label, help]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border-strong bg-surface-raised p-4 has-checked:border-2 has-checked:border-brand"
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={choice === value}
                onChange={() => {
                  setChoice(value);
                }}
                className="mt-1 size-4"
                aria-describedby={`kind-${value}-help`}
              />
              <span className="flex flex-col">
                <span className="font-medium text-text">{label}</span>
                <span id={`kind-${value}-help`} className="text-sm text-text-muted">
                  {help}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" className="self-start">
          {text.continue}
        </Button>
      </form>
    );
  }

  const individual = kind === 'individual';
  const values: Partial<SignUpValues> = state.values ?? {};
  const errors = state.errors ?? {};
  const error = (field: SignUpField) => errorText(text, errors[field], values[field] ?? '');
  const text1 = (
    field: SignUpField,
    label: string,
    options: { help?: string; required?: boolean; autoComplete?: string; inputMode?: 'numeric' },
  ) => {
    const id = `signup-${field}`;
    const message = error(field);
    const state = {
      ...(options.help === undefined ? {} : { help: options.help }),
      ...(message === undefined ? {} : { error: message }),
      required: options.required === true,
    };
    return (
      <Field id={id} label={label} {...state}>
        <Input
          {...fieldProps(id, state)}
          name={field === 'legalName' && individual ? 'fullName' : field}
          defaultValue={values[field] ?? ''}
          {...(options.autoComplete === undefined ? {} : { autoComplete: options.autoComplete })}
          {...(options.inputMode === undefined ? {} : { inputMode: options.inputMode })}
        />
      </Field>
    );
  };
  const addressErrors: Partial<Record<AddressField, string>> = {};
  for (const field of ['line1', 'line2', 'city', 'district', 'stateCode', 'pincode'] as const) {
    const message = error(field);
    if (message !== undefined) addressErrors[field] = message;
  }

  return (
    <form
      // Submitted by hand, not with `action`: React resets a form after its action, which would
      // clear the state picker and the type radios when the server sends back errors.
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
      <SignUpProgress text={text} step={4} />
      <input type="hidden" name="idempotencyKey" value={state.idempotencyKey ?? idempotencyKey} />
      <h2 className="text-xl font-semibold text-text">
        {individual ? text.personTitle : text.orgTitle}
      </h2>
      {state.status === 'invalid' && <Alert tone="danger">{text.errorSummary}</Alert>}
      {state.status === 'failed' && (
        <Alert tone="danger" title={text.failedTitle}>
          {text.failed}
        </Alert>
      )}
      {state.status === 'signed-out' && (
        <Alert tone="warning">
          {text.signedOut} <Link href="/sign-up">{text.signInAgain}</Link>
        </Alert>
      )}
      {state.status === 'forbidden' && <Alert tone="danger">{text.forbidden}</Alert>}

      {individual ? (
        <>
          <input type="hidden" name="segment" value="INDIVIDUAL" />
          {text1('legalName', text.fullName, {
            help: text.fullNameHelp,
            required: true,
            autoComplete: 'name',
          })}
          {text1('gstin', text.gstinOptional, { help: text.gstinHelp })}
        </>
      ) : (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-text">
              {text.typeLegend} <span className="text-danger">*</span>
            </legend>
            <div className="flex flex-wrap gap-4">
              {(['BUSINESS', 'INDUSTRY', 'GOVERNMENT'] as const).map((option) => (
                <label key={option} className="flex items-center gap-2 text-text">
                  <input
                    type="radio"
                    name="segment"
                    value={option}
                    checked={segment === option}
                    onChange={() => {
                      setSegment(option);
                    }}
                    className="size-4"
                  />
                  {text[option]}
                </label>
              ))}
            </div>
          </fieldset>
          {text1('legalName', text.legalName, {
            help: text.legalNameHelp,
            required: true,
            autoComplete: 'organization',
          })}
          {text1('displayName', text.displayName, { help: text.displayNameHelp, required: true })}
          {text1('gstin', text.gstin, { help: text.gstinHelp, required: true })}
        </>
      )}

      <AddressFieldset
        idPrefix="signup"
        legend={individual ? text.personAddressLegend : text.addressLegend}
        text={text}
        values={values}
        errors={addressErrors}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {pending ? text.creating : text.create}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setKind(null);
          }}
        >
          {text.back}
        </Button>
      </div>
    </form>
  );
}
