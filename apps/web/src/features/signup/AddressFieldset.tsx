'use client';

import { Field, fieldProps, Input, Select } from '@labconnect/ui';
import { useState } from 'react';
import { INDIAN_STATES } from './indian-states';
import type { AddressField } from './signup-form';

export interface AddressText {
  line1: string;
  line2: string;
  city: string;
  district: string;
  state: string;
  choose: string;
  pincode: string;
}

/**
 * The postal address of boards J1 steps 4 and 5 (`PostalAddress`): two lines, city, district,
 * state and PIN code, with autofill. The state picker is controlled so a server answer with
 * errors keeps the choice (the forms submit without React's automatic reset).
 */
export function AddressFieldset({
  idPrefix,
  legend,
  text,
  values,
  errors,
}: {
  idPrefix: string;
  legend: string;
  text: AddressText;
  values: Partial<Record<AddressField, string>>;
  errors: Partial<Record<AddressField, string>>;
}) {
  const [stateCode, setStateCode] = useState(values.stateCode ?? '');

  const input = (
    field: AddressField,
    label: string,
    options: { required?: boolean; autoComplete: string; inputMode?: 'numeric' },
  ) => {
    const id = `${idPrefix}-${field}`;
    const message = errors[field];
    const state = {
      ...(message === undefined ? {} : { error: message }),
      required: options.required === true,
    };
    return (
      <Field id={id} label={label} {...state}>
        <Input
          {...fieldProps(id, state)}
          name={field}
          defaultValue={values[field] ?? ''}
          autoComplete={options.autoComplete}
          {...(options.inputMode === undefined ? {} : { inputMode: options.inputMode })}
        />
      </Field>
    );
  };
  const stateId = `${idPrefix}-stateCode`;
  const stateError = errors.stateCode;

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 font-medium text-text">{legend}</legend>
      {input('line1', text.line1, { required: true, autoComplete: 'address-line1' })}
      {input('line2', text.line2, { autoComplete: 'address-line2' })}
      <div className="grid gap-4 sm:grid-cols-2">
        {input('city', text.city, { required: true, autoComplete: 'address-level2' })}
        {input('district', text.district, { autoComplete: 'address-level3' })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={stateId}
          label={text.state}
          required
          {...(stateError === undefined ? {} : { error: stateError })}
        >
          <Select
            {...fieldProps(stateId, {
              required: true,
              ...(stateError === undefined ? {} : { error: stateError }),
            })}
            name="stateCode"
            value={stateCode}
            onChange={(event) => {
              setStateCode(event.target.value);
            }}
            autoComplete="address-level1"
          >
            <option value="">{text.choose}</option>
            {INDIAN_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.name}
              </option>
            ))}
          </Select>
        </Field>
        {input('pincode', text.pincode, {
          required: true,
          autoComplete: 'postal-code',
          inputMode: 'numeric',
        })}
      </div>
    </fieldset>
  );
}
