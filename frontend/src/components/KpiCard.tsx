import type { ReactNode } from 'react'
import { Link, type To } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Skeleton } from './ui/skeleton'

type Tone = 'default' | 'danger' | 'warning' | 'success'

interface KpiCardProps {
  label: string
  /** Numbers are formatted as counts; null/undefined shows "—". Pass a string/node for pre-formatted values. */
  value: ReactNode
  hint?: ReactNode
  /** Makes the whole card a link (e.g. to a filtered list, Spec §4). */
  to?: To
  /** Accessible name for the link; defaults to "<label>: <value>. <linkHint>". */
  linkLabel?: string
  /** Status tone: thin coloured bar on the left. Use only when the number signals a problem / success. */
  tone?: Tone
  icon?: ReactNode
  loading?: boolean
  className?: string
}

const toneBar: Record<Tone, string> = {
  default: 'before:bg-transparent',
  danger: 'before:bg-status-danger',
  warning: 'before:bg-status-warning',
  success: 'before:bg-status-success',
}

export function KpiCard({ label, value, hint, to, linkLabel, tone = 'default', icon, loading, className }: KpiCardProps) {
  const display = typeof value === 'number' || value === null || value === undefined ? formatCount(value as number | null) : value

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4" aria-hidden>{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{display}</p>
      )}
      {(hint || to) && (
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0">{hint}</span>
          {to && (
            <ChevronRight
              className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
              aria-hidden
            />
          )}
        </div>
      )}
    </>
  )

  const base = cn(
    'group relative block overflow-hidden rounded-lg border border-border bg-surface p-4 shadow-sm',
    'before:absolute before:inset-y-0 before:left-0 before:w-0.5',
    toneBar[tone],
    className,
  )

  if (to) {
    const textValue = typeof display === 'string' || typeof display === 'number' ? String(display) : undefined
    const name =
      linkLabel ?? (textValue !== undefined ? `${label}: ${textValue}${typeof hint === 'string' ? `. ${hint}` : ''}` : undefined)
    return (
      <Link
        to={to}
        aria-label={name}
        className={cn(base, 'transition-colors hover:border-foreground/30 hover:bg-muted/30')}
      >
        {body}
      </Link>
    )
  }

  return <div className={base}>{body}</div>
}
