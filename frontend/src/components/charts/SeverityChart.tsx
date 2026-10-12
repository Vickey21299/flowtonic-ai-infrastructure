import type { Severity } from '@/api/types'
import { severityLabel } from '@/lib/format'
import { chartColors } from './chartTheme'
import { CountBarChart } from './CountBarChart'

const ORDER: Severity[] = ['high', 'medium', 'warning']
const COLOR: Record<Severity, string> = {
  high: chartColors.danger,
  medium: chartColors.warning,
  warning: chartColors.warningLight,
}

interface SeverityChartProps {
  data: { severity: Severity; count: number }[]
  label?: string
  height?: number
  /** Click a bar, e.g. to open Exceptions filtered by severity. */
  onSelect?: (severity: Severity) => void
}

/** Exception count per severity, fixed order high → medium → warning (missing severities as 0). */
export function SeverityChart({ data, label = 'Exception count by severity', height, onSelect }: SeverityChartProps) {
  const rows = ORDER.map((severity) => ({
    key: severity,
    label: severityLabel[severity],
    count: data.find((d) => d.severity === severity)?.count ?? 0,
    color: COLOR[severity],
  }))
  return <CountBarChart data={rows} label={label} categoryHeader="Severity" height={height} onSelect={onSelect} />
}
