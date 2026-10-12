import type { KpiKey, Rule } from '@/api/types'
import { formatPct, formatPp } from '@/lib/format'

/** Unit of a rule threshold: margin variances are percentage points, the others percent. */
export function thresholdUnit(kpi: KpiKey): '%' | 'pp' {
  return kpi.endsWith('_pp') ? 'pp' : '%'
}

/** Display a threshold value, e.g. −10 → "−10%" (display rounding only). */
export function formatThreshold(kpi: KpiKey, value: number): string {
  const dp = Number.isInteger(value) ? 0 : 2
  return thresholdUnit(kpi) === 'pp' ? formatPp(value, { dp }) : formatPct(value, { dp })
}

/** "≤ −10%" for the rule's comparator. */
export function ruleConditionText(rule: Pick<Rule, 'kpiKey' | 'comparator' | 'threshold'>): string {
  const op = rule.comparator === 'lte' ? '≤' : rule.comparator
  return `${op} ${formatThreshold(rule.kpiKey, rule.threshold)}`
}
