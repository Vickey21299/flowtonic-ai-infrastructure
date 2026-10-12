import { cn } from '@/lib/utils'
import { Skeleton } from '../ui/skeleton'

interface LoadingProps {
  /** Announced to screen readers (default "Loading…"). */
  label?: string
  /** `page`: header + cards + table; `table`: rows; `cards`: KPI card row; `inline`: one line. */
  variant?: 'page' | 'table' | 'cards' | 'inline'
  /** Number of table rows for `table` / `page` (default 6). */
  rows?: number
  className?: string
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <Skeleton className="h-9 rounded-none" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 border-t border-border px-3 py-3">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/6" />
          <Skeleton className="h-4 w-1/6" />
          <Skeleton className="ml-auto h-4 w-1/12" />
        </div>
      ))}
    </div>
  )
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="mt-3 h-7 w-12" />
        </div>
      ))}
    </div>
  )
}

/** Skeleton placeholder with a polite live-region announcement. */
export function Loading({ label = 'Loading…', variant = 'page', rows = 6, className }: LoadingProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn('space-y-4', className)}>
      <span className="sr-only">{label}</span>
      {variant === 'inline' && <Skeleton className="h-4 w-40" />}
      {variant === 'cards' && <CardsSkeleton />}
      {variant === 'table' && <TableSkeleton rows={rows} />}
      {variant === 'page' && (
        <>
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <CardsSkeleton />
          <TableSkeleton rows={rows} />
        </>
      )}
    </div>
  )
}
