import type { LucideIcon } from 'lucide-react'
import { Calculator, FileInput, Gauge, Scale, Table2 } from 'lucide-react'
import type { TraceStep } from '@/api/types'
import { cn } from '@/lib/utils'

const kindMeta: Record<TraceStep['kind'], { label: string; icon: LucideIcon }> = {
  rule: { label: 'Rule', icon: Scale },
  evaluation: { label: 'Evaluation', icon: Gauge },
  kpi: { label: 'KPI calculation', icon: Calculator },
  observation: { label: 'Observation', icon: Table2 },
  import: { label: 'Import', icon: FileInput },
}

interface TraceViewProps {
  steps: TraceStep[]
  /** Accessible name for the list. */
  label?: string
  className?: string
}

/** Vertical audit chain: rule → evaluation → KPI → observation → import, joined by connectors. */
export function TraceView({ steps, label = 'Calculation trace', className }: TraceViewProps) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">No trace available.</p>
  }
  return (
    <ol aria-label={label} className={cn('relative', className)}>
      {steps.map((step, i) => {
        const meta = kindMeta[step.kind]
        const Icon = meta.icon
        const last = i === steps.length - 1
        return (
          <li key={`${step.kind}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border" aria-hidden />}
            <span
              className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground"
              aria-hidden
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2">
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                <span className="sr-only">Step {i + 1}: </span>
                {meta.label}
              </p>
              <p className="text-sm font-medium">{step.title}</p>
              {step.fields.length > 0 && (
                <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[minmax(7rem,auto)_1fr]">
                  {step.fields.map((f, j) => (
                    <div key={`${f.label}-${j}`} className="contents">
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd className="break-words font-medium tabular">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
