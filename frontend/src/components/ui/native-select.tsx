import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fieldClass } from './field-class'

interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Class for the wrapper (width etc.). */
  wrapperClassName?: string
}

/** Styled native <select>: best for compact filters and mobile. Pass <option>s as children. */
export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => (
    <div className={cn('relative', wrapperClassName)}>
      <select ref={ref} className={cn(fieldClass, 'h-9 appearance-none py-1.5 pr-8', className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  ),
)
NativeSelect.displayName = 'NativeSelect'
