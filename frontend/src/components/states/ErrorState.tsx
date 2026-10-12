import { AlertOctagon, RotateCw } from 'lucide-react'
import { isApiError } from '@/api/errors'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'

interface ErrorStateProps {
  /** Anything thrown by the API layer; ApiError messages, field errors and request id are shown. */
  error: unknown
  /** Shows a Retry button (e.g. react-query `refetch`). */
  onRetry?: () => void
  title?: string
  /** Compact inline variant. */
  compact?: boolean
  className?: string
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'An unexpected error occurred.'
}

export function ErrorState({ error, onRetry, title = 'Something went wrong', compact, className }: ErrorStateProps) {
  const api = isApiError(error) ? error : null
  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-status-danger/30 bg-status-danger-bg text-sm',
        compact ? 'px-3 py-2.5' : 'px-5 py-6',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-status-danger" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-foreground/80">{messageOf(error)}</p>
          {api && api.fieldErrors.length > 0 && (
            <ul className="list-inside list-disc text-foreground/80">
              {api.fieldErrors.map((f, i) => (
                <li key={`${f.field}-${i}`}>
                  <span className="font-medium">{f.field}</span>: {f.message}
                </li>
              ))}
            </ul>
          )}
          {api && (
            <p className="text-xs text-muted-foreground">
              Code {api.code} · request {api.requestId}
            </p>
          )}
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
            <RotateCw aria-hidden />
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}
