import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from '../lib/cn.js';

/** What a field passes to its control so the label, help and error are tied to it (DR-25). */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  /** Error text; when set the control is marked invalid and the text is announced. */
  error?: ReactNode;
  required?: boolean;
  /** The marker after a required label, from the app's messages (for example "required"). */
  requiredLabel?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * A labelled form field (lc.css `.field`): a visible label, help text and an error, all tied to
 * the control with `for`, `aria-describedby` and `aria-invalid`.
 */
export function Field({
  label,
  help,
  error,
  required = false,
  requiredLabel,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const helpId = help === undefined ? undefined : `${id}-help`;
  const errorId =
    error === undefined || error === null || error === false ? undefined : `${id}-error`;
  const describedBy = [helpId, errorId].filter((value) => value !== undefined).join(' ');
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
      {children({
        id,
        ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
        ...(errorId === undefined ? {} : { 'aria-invalid': true as const }),
        ...(required ? { 'aria-required': true as const } : {}),
      })}
      {helpId !== undefined && (
        <p id={helpId} className="text-sm text-text-muted">
          {help}
        </p>
      )}
      {errorId !== undefined && (
        <p id={errorId} role="alert" className="text-sm text-danger">
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
