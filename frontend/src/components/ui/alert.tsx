import type { HTMLAttributes, ReactNode } from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger'

const styles: Record<AlertVariant, string> = {
  info: 'border-border bg-muted/60 [&>svg]:text-accent',
  success: 'border-status-success/30 bg-status-success-bg [&>svg]:text-status-success',
  warning: 'border-status-warning/30 bg-status-warning-bg [&>svg]:text-status-warning',
  danger: 'border-status-danger/30 bg-status-danger-bg [&>svg]:text-status-danger',
}

const icons: Record<AlertVariant, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertOctagon,
}

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: AlertVariant
  title?: ReactNode
  /** Right-aligned actions, e.g. a Retry button. */
  action?: ReactNode
  /** Hide the leading icon. */
  noIcon?: boolean
}

/** Inline message box. `danger` is announced (role="alert"); the others use role="status". */
export function Alert({ variant = 'info', title, action, noIcon, className, children, ...props }: AlertProps) {
  const Icon = icons[variant]
  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-3 py-2.5 text-sm text-foreground',
        styles[variant],
        className,
      )}
      {...props}
    >
      {!noIcon && <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}
