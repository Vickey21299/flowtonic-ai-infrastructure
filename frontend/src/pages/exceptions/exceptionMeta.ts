import type { KpiKey, MetricKey, ValueUnit } from '@/api/types'

export const NOT_RESOLVED = 'not_resolved'

export const METRIC_LABELS: Record<MetricKey, string> = {
  revenue: 'Revenue',
  ebitda: 'EBITDA',
  ebitda_margin: 'EBITDA margin',
}

export function metricUnit(key: MetricKey): ValueUnit {
  return key === 'ebitda_margin' ? 'pct' : 'currency'
}

/** Margin variances are in percentage points; the others in %. */
export function varianceUnit(kpi: KpiKey): 'pct' | 'pp' {
  return kpi.endsWith('_pp') ? 'pp' : 'pct'
}
