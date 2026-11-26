import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn.js';

/** What a field's control needs so the label, help and error are tied to it (DR-25). */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

export interface FieldState {
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}

function present(value: ReactNode): boolean {
  return value !== undefined && value !== null && value !== false;
}

/**
 * The attributes for a field's control: spread them on the input, select or textarea inside the
 * `Field` with the same `id` and state. A plain function, so it works in server and client
 * components alike.
 */
export function fieldProps(id: string, state: FieldState = {}): FieldControlProps {
  const describedBy = [
    present(state.help) ? `${id}-help` : undefined,
    present(state.error) ? `${id}-error` : undefined,
  ]
    .filter((value) => value !== undefined)
    .join(' ');
  return {
    id,
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
    ...(present(state.error) ? { 'aria-invalid': true as const } : {}),
    ...(state.required === true ? { 'aria-required': true as const } : {}),
  };
}

export interface FieldProps extends FieldState {
  /** The control's id; the control gets its attributes from `fieldProps(id, …)`. */
  id: string;
  label: ReactNode;
  /** The marker after a required label, from the app's messages (for example "required"). */
  requiredLabel?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A labelled form field (lc.css `.field`): a visible label, help text and an error, tied to the
 * control by `for`, `aria-describedby` and `aria-invalid` (see `fieldProps`). Works in server
 * components: it takes its id from the caller instead of generating one.
 *
 * ```tsx
 * <Field id="email" label="Email" error={error} required>
 *   <Input {...fieldProps('email', { error, required: true })} />
 * </Field>
 * ```
 */
export function Field({
  id,
  label,
  help,
  error,
  required = false,
  requiredLabel,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {required && (
          <span className="text-danger">
            {' '}
            *{requiredLabel !== undefined && <span className="sr-only">{requiredLabel}</span>}
          </span>
        )}
      </label>
      {children}
      {present(help) && (
        <p id={`${id}-help`} className="text-sm text-text-muted">
          {help}
        </p>
      )}
      {present(error) && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const control =
  'w-full rounded-md border border-border-strong bg-surface-raised px-3 text-base text-text placeholder:text-border-strong aria-invalid:border-2 aria-invalid:border-danger disabled:bg-neutral-bg disabled:text-border-strong disabled:border-border-disabled read-only:border-dashed read-only:bg-surface';

/** Text input; 16 px text so phones do not zoom (A-01f), 44 px high. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(control, 'min-h-11', className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-22 py-2.5', className)} {...props} />;
});

/** A native select: the most accessible choice on phones for a short list. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(control, 'min-h-11', className)} {...props} />;
  },
);
