import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

export const Label = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-xs font-medium text-foreground peer-disabled:opacity-60', className)}
    {...props}
  >
    {children}
    {required && (
      <>
        <span className="ml-0.5 text-status-danger" aria-hidden>
          *
        </span>
        <span className="sr-only"> (required)</span>
      </>
    )}
  </LabelPrimitive.Root>
))
Label.displayName = 'Label'
