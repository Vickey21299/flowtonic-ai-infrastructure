import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: string
  description?: ReactNode
  /** e.g. a "Clear filters" or "Import data" button. */
  action?: ReactNode
  icon?: ReactNode
  /** Compact version for use inside tables / sections. */
  compact?: boolean
  className?: string
}

export function EmptyState({ title, description, action, icon, compact, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 py-6' : 'gap-2 rounded-lg border border-dashed border-border bg-surface px-6 py-12',
        className,
      )}
    >
      <span className="text-muted-foreground [&_svg]:h-6 [&_svg]:w-6" aria-hidden>
        {icon ?? <Inbox />}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <div className="max-w-md text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
