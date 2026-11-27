'use client';

import { Check, X } from 'lucide-react';
import { Checkbox as CheckboxPrimitive, Dialog, Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/*
 * Accessible primitives from Radix (DESIGN_SYSTEM: shadcn/ui-style, Radix underneath): focus is
 * trapped in a dialog and returns to the trigger, tabs follow the WAI-ARIA tab pattern with arrow
 * keys, Escape closes. Styling follows lc.css (`.tabs`, `.overlay`, `.scrim`).
 */

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex flex-wrap gap-1 border-b border-border', className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center gap-2 border-b-2 border-transparent bg-transparent px-3.5 text-sm font-medium text-text-muted',
        'data-[state=active]:border-brand-primary data-[state=active]:text-brand-on-tint',
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The element that opens it (rendered with `asChild`). */
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Accessible name of the close button, from the app's messages. */
  closeLabel: string;
  /** `center` is a dialog; `bottom` (phones) and `side` (tablets) are sheets (H2 filter sheet). */
  placement?: 'center' | 'bottom' | 'side';
  footer?: ReactNode;
  children: ReactNode;
}

const placements = {
  center:
    'left-1/2 top-1/2 w-[min(560px,calc(100vw-32px))] max-h-[calc(100vh-32px)] -translate-x-1/2 -translate-y-1/2 rounded-lg',
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg',
  side: 'inset-y-0 right-0 w-[min(400px,100vw)] rounded-l-lg',
} as const;

/** A dialog or a sheet with a title, an optional description, a close button and a footer. */
export function Modal({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  closeLabel,
  placement = 'center',
  footer,
  children,
}: DialogProps) {
  return (
    <Dialog.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {trigger !== undefined && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col border border-border bg-surface-raised shadow-overlay',
            placements[placement],
          )}
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-lg font-semibold text-text">{title}</Dialog.Title>
              {description !== undefined && (
                <Dialog.Description className="text-sm text-text-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label={closeLabel}
              className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-text hover:bg-neutral-bg"
            >
              <X aria-hidden="true" className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer !== undefined && (
            <div className="flex gap-2 border-t border-border px-5 py-3">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface CheckboxProps extends Omit<
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  'children'
> {
  label: ReactNode;
}

/** A checkbox with its label as a 44 px row (lc.css `.check`). */
export function Checkbox({ label, className, id, ...props }: CheckboxProps) {
  return (
    <label
      className={cn('flex min-h-11 cursor-pointer items-center gap-3 text-base', className)}
      htmlFor={id}
    >
      <CheckboxPrimitive.Root
        id={id}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm border-2 border-border-strong bg-surface-raised data-[state=checked]:border-brand-primary data-[state=checked]:bg-brand-primary data-[state=checked]:text-text-inverse"
        {...props}
      >
        <CheckboxPrimitive.Indicator>
          <Check aria-hidden="true" className="size-4" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span>{label}</span>
    </label>
  );
}
