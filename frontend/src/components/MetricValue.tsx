import type { ValueUnit } from '@/api/types'
import { formatValue, isMissing, type MoneyUnit } from '@/lib/format'
import { cn } from '@/lib/utils'

interface MetricValueProps {
  value: number | null | undefined
  unit: ValueUnit
  /** For `currency`: currency code (default "USD") and scale (default "millions"). */
  currency?: string
  moneyUnit?: MoneyUnit
  /** Show "+" for positives. */
  signed?: boolean
  dp?: number
  className?: string
}

/** Formatted money / pct / pp value with unit; "—" (muted) when missing — never 0. */
export function MetricValue({ value, unit, currency, moneyUnit, signed, dp, className }: MetricValueProps) {
  const missing = isMissing(value)
  return (
    <span className={cn('whitespace-nowrap tabular', missing && 'text-muted-foreground', className)}>
      {formatValue(value, unit, { currency, unit: moneyUnit, signed, dp })}
      {missing && <span className="sr-only"> (missing)</span>}
    </span>
  )
}
