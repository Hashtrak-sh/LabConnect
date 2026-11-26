import {
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  type LucideIcon,
  ShieldCheck,
  Store,
} from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import type { StatusIcon, StatusStyle, Tone } from '../status.js';

export const toneClasses: Readonly<Record<Tone, string>> = {
  info: 'text-info bg-info-bg border-info-border',
  warning: 'text-warning bg-warning-bg border-warning-border',
  success: 'text-success bg-success-bg border-success-border',
  danger: 'text-danger bg-danger-bg border-danger-border',
  neutral: 'text-neutral bg-neutral-bg border-neutral-border',
  brand: 'text-brand-on-tint bg-brand-tint border-brand-tint-border',
};

const ICONS: Readonly<Record<StatusIcon, LucideIcon>> = {
  clock: Clock,
  alert: CircleAlert,
  check: CircleCheck,
  x: CircleX,
  circle: BadgeCheck,
  shield: ShieldCheck,
  store: Store,
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: StatusIcon;
}

/** A pill (lc.css `.badge`): 12 px semibold, min-height 24 px, may wrap on phones. */
export function Badge({ tone = 'neutral', icon, className, children, ...props }: BadgeProps) {
  const Icon = icon === undefined ? undefined : ICONS[icon];
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-2.5 text-xs font-semibold max-md:whitespace-normal md:whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {Icon !== undefined && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
      {children}
    </span>
  );
}

export interface StatusBadgeProps {
  /** From one of the mappings in `status.ts`. */
  status: StatusStyle;
  /** The label from the app's messages. Status is never colour alone (DESIGN_SYSTEM 1.3). */
  label: ReactNode;
  className?: string;
}

/** A status: label, icon and tone together. */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <Badge tone={status.tone} icon={status.icon} className={className}>
      {label}
    </Badge>
  );
}
