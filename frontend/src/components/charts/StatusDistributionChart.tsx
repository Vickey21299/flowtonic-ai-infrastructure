import type { CompanyStatus } from '@/api/types'
import { companyStatusLabel } from '@/lib/format'
import { chartColors } from './chartTheme'
import { CountBarChart } from './CountBarChart'

const ORDER: CompanyStatus[] = ['exception', 'warning', 'on_track', 'insufficient_data']
const COLOR: Record<CompanyStatus, string> = {
  exception: chartColors.danger,
  warning: chartColors.warning,
  on_track: chartColors.success,
  insufficient_data: chartColors.neutral,
}

interface StatusDistributionChartProps {
  data: { status: CompanyStatus; count: number }[]
  label?: string
  height?: number
  /** Click a bar, e.g. to filter the table by that status. */
  onSelect?: (status: CompanyStatus) => void
}

/** Companies per status. All four statuses are always shown (missing ones as 0) in a fixed order. */
export function StatusDistributionChart({
  data,
  label = 'Distribution of companies by status',
  height,
  onSelect,
}: StatusDistributionChartProps) {
  const rows = ORDER.map((status) => ({
    key: status,
    label: companyStatusLabel[status],
    count: data.find((d) => d.status === status)?.count ?? 0,
    color: COLOR[status],
  }))
  return <CountBarChart data={rows} label={label} categoryHeader="Status" height={height} onSelect={onSelect} />
}
