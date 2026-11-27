import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn.js';

/**
 * Button (COMPONENT_SPECIFICATION; lc.css `.btn`). Heights are minimums, not fixed (A-01d); below
 * 768 px every size is at least 44 px (A-01e, DR-12), so `sm` is never smaller than a finger.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md border border-transparent px-4 text-sm font-medium text-center no-underline cursor-pointer max-md:min-h-11 max-md:whitespace-normal md:whitespace-nowrap disabled:cursor-not-allowed disabled:bg-neutral-bg disabled:text-border-strong disabled:border-border aria-disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary:
          'bg-brand-primary text-brand-primary-contrast hover:bg-brand-primary-hover hover:text-brand-primary-contrast active:bg-brand-primary-active',
        secondary: 'bg-surface-raised text-text border-border-strong hover:bg-surface',
        ghost: 'bg-transparent text-text hover:bg-neutral-bg',
        destructive: 'bg-danger text-text-inverse hover:bg-danger-hover hover:text-text-inverse',
        link: 'min-h-0 border-0 bg-transparent px-0 text-brand-primary underline underline-offset-3 max-md:min-h-11',
      },
      size: {
        sm: 'min-h-8 px-3 text-sm',
        md: 'min-h-10',
        lg: 'min-h-12 px-5 text-base',
        xl: 'min-h-14 px-6 text-lg font-semibold',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child (for example a link) with the button's look (`Slot`). */
  asChild?: boolean;
  /** Shows a busy state, disables the button and tells assistive technology (`aria-busy`). */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    block,
    asChild = false,
    loading = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      ref={ref}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={asChild ? undefined : disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </Component>
  );
});
