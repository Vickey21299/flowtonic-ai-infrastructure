import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
  /** Purely visual (default) or announced as a separator. */
  decorative?: boolean
}

export function Separator({ orientation = 'horizontal', decorative = true, className, ...props }: SeparatorProps) {
  return (
    <div
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
      {...props}
    />
  )
}
