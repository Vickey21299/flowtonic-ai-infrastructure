import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium leading-4 [&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-muted text-foreground',
        outline: 'border-border bg-surface text-muted-foreground',
        accent: 'border-accent/25 bg-accent/10 text-accent',
        inverse: 'border-foreground bg-foreground text-background',
        success: 'border-status-success/25 bg-status-success-bg text-status-success',
        warning: 'border-status-warning/25 bg-status-warning-bg text-status-warning',
        danger: 'border-status-danger/25 bg-status-danger-bg text-status-danger',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
