import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { fieldClass } from './field-class'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(fieldClass, 'min-h-[4.5rem] py-2 leading-relaxed', className)}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
