import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionProps {
  title: ReactNode
  description?: ReactNode
  /** Right side of the header (buttons, toggles). */
  actions?: ReactNode
  children: ReactNode
  /** Heading level for the title (default h2). */
  as?: 'h2' | 'h3'
  /** Remove body padding (e.g. for edge-to-edge tables). */
  flush?: boolean
  className?: string
  contentClassName?: string
}

/** Titled card section, labelled by its heading for assistive tech. */
export function Section({
  title,
  description,
  actions,
  children,
  as: Heading = 'h2',
  flush,
  className,
  contentClassName,
}: SectionProps) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn('rounded-lg border border-border bg-surface shadow-sm', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <Heading id={id} className="text-sm font-semibold tracking-tight">
            {title}
          </Heading>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn(!flush && 'p-4', contentClassName)}>{children}</div>
    </section>
  )
}
