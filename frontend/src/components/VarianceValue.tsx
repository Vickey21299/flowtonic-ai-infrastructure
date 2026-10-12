import type { CalcStatus, KpiValue } from '@/api/types'
import { EM_DASH, calcStatusLabel, formatPct, formatPp, isMissing } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Tooltip } from './ui/tooltip'

interface VarianceValueProps {
  /** Variance as a plain number (−14.74 means −14.74 %). Ignored when `kpi` is given. */
  value?: number | null
  /** Backend KPI value; its status and reason drive the "—" + tooltip. */
  kpi?: KpiValue | null
  /** `pct` → "−14.74%", `pp` → "−1.96 pp". */
  unit: 'pct' | 'pp'
  /** Reason shown in a tooltip (e.g. why the value is not calculable). Defaults to `kpi.reason`. */
  reason?: string
  /** How to colour positive variances: neutral ink (default) or green. Negatives are always red. */
  positive?: 'neutral' | 'good'
  dp?: number
  className?: string
}

/** Signed variance. Negative → red with a true minus sign; missing → "—" with an optional reason tooltip. */
export function VarianceValue({
  value,
  kpi,
  unit,
  reason,
  positive = 'neutral',
  dp = 2,
  className,
}: VarianceValueProps) {
  const v = kpi ? kpi.value : value
  const status: CalcStatus = kpi ? kpi.status : isMissing(v) ? 'not_calculable' : 'ok'
  const why = reason ?? kpi?.reason
  const missing = isMissing(v) || status === 'not_calculable'

  const text = missing ? EM_DASH : unit === 'pct' ? formatPct(v, { signed: true, dp }) : formatPp(v, { signed: true, dp })

  // Colour by the displayed (rounded) value so "0.00%" is never red.
  const rounded = missing ? 0 : Number((v as number).toFixed(dp))
  const tone = missing
    ? 'text-muted-foreground'
    : rounded < 0
      ? 'text-status-danger'
      : rounded > 0 && positive === 'good'
        ? 'text-status-success'
        : 'text-foreground'

  const flagged = status === 'sign_ambiguous'
  const content = (
    <span className={cn('whitespace-nowrap tabular', tone, className)}>
      {text}
      {flagged && <span aria-hidden>*</span>}
    </span>
  )

  if (!why && !flagged) return content

  const tip = why ?? calcStatusLabel[status]
  return (
    <Tooltip content={tip}>
      <span
        tabIndex={0}
        className="cursor-help rounded-sm underline decoration-dotted decoration-muted-foreground/60 underline-offset-4"
      >
        {content}
        <span className="sr-only">
          {' '}
          ({missing ? 'not calculable' : calcStatusLabel[status].toLowerCase()}: {tip})
        </span>
      </span>
    </Tooltip>
  )
}
