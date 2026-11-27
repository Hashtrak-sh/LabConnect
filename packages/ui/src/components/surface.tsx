import { CircleAlert, CircleCheck, Info, Lock, type LucideIcon, SearchX } from 'lucide-react';
import { type ButtonHTMLAttributes, forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import type { Tone } from '../status.js';

/** A card (lc.css `.card`): raised surface, border, card shadow. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-md border border-border bg-surface-raised shadow-card', className)}
      {...props}
    />
  );
}

const alertTones: Readonly<Record<Exclude<Tone, 'brand'>, { box: string; icon: LucideIcon }>> = {
  info: { box: 'text-info-strong bg-info-bg border-info-border', icon: Info },
  warning: { box: 'text-warning-strong bg-warning-bg border-warning-border', icon: CircleAlert },
  success: { box: 'text-success-strong bg-success-bg border-success-border', icon: CircleCheck },
  danger: { box: 'text-danger-strong bg-danger-bg border-danger-border', icon: CircleAlert },
  neutral: { box: 'text-neutral-strong bg-neutral-bg border-neutral-border', icon: Info },
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: Exclude<Tone, 'brand'>;
  title?: ReactNode;
}

/**
 * A banner (lc.css `.alert`). Danger and warning are announced (`role="alert"`), the others are a
 * polite status, so a page that shows one on load does not shout.
 */
export function Alert({ tone = 'info', title, className, children, ...props }: AlertProps) {
  const { box, icon: Icon } = alertTones[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-md border px-4 py-3 text-sm', box, className)}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        {title !== undefined && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** A toggle chip (a filter): pressed state for assistive technology. */
  pressed?: boolean;
}

/** A chip (lc.css `.chip`): a filter toggle or an applied-filter pill; 44 px on phones. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { pressed, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={cn(
        'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border-strong bg-surface-raised px-3.5 text-sm font-medium text-text max-md:min-h-11',
        'aria-pressed:border-brand-primary aria-pressed:bg-brand-tint aria-pressed:text-brand-on-tint',
        className,
      )}
      {...props}
    />
  );
});

const stateIcons = { empty: SearchX, error: CircleAlert, denied: Lock } as const;

export interface StatePanelProps {
  kind: keyof typeof stateIcons;
  title: ReactNode;
  children?: ReactNode;
  /** A next step, for example a "Try again" button or a link. */
  action?: ReactNode;
  className?: string;
}

/**
 * Empty, error and permission-denied states (COMPONENT_SPECIFICATION; DP2-05: every screen shows
 * them, from one shared pattern). An error is announced; empty and denied are not.
 */
export function StatePanel({ kind, title, children, action, className }: StatePanelProps) {
  const Icon = stateIcons[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-6 py-10 text-center',
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-10', kind === 'error' ? 'text-danger' : 'text-text-muted')}
      />
      <p className="text-lg font-semibold text-text">{title}</p>
      {children !== undefined && <div className="max-w-prose text-text-muted">{children}</div>}
      {action}
    </div>
  );
}

/** A loading placeholder; hidden from assistive technology (the region says it is busy). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-neutral-bg', className)} />
  );
}

/** Money and numbers in tabular figures (DESIGN_SYSTEM 2). */
export function Num({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('tabular-nums', className)} {...props} />;
}
