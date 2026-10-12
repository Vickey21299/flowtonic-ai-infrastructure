/**
 * The 15 Spec §4 portfolio-table columns, shared by Overview and the Companies list.
 * Values come straight from the backend (`CompanySummary`); this file only formats them.
 */
import type { CompanySummary, KpiValue } from '@/api/types'
import type { Column } from '@/components/DataTable'
import { MetricValue } from '@/components/MetricValue'
import { StatusBadge } from '@/components/StatusBadges'
import { VarianceValue } from '@/components/VarianceValue'
import { Tooltip } from '@/components/ui/tooltip'
import { companyStatusLabel, formatDateTime, formatPeriod, type MoneyUnit } from '@/lib/format'

const STATUS_RANK: Record<CompanySummary['status'], number> = {
  exception: 0,
  warning: 1,
  insufficient_data: 2,
  on_track: 3,
}

/** Numeric KPI value for sorting; not-calculable sorts last (as missing). */
function kpiSort(kpi: KpiValue | undefined): number | null {
  if (!kpi || kpi.status === 'not_calculable') return null
  return kpi.value
}

/** Margin (a percentage level, not a variance): "—" with the reason in a tooltip when not calculable. */
function marginCell(kpi: KpiValue | undefined) {
  const value = kpi && kpi.status !== 'not_calculable' ? kpi.value : null
  const node = <MetricValue value={value} unit="pct" />
  if (!kpi?.reason) return node
  return (
    <Tooltip content={kpi.reason}>
      <span
        tabIndex={0}
        className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-4"
      >
        {node}
        <span className="sr-only"> ({kpi.reason})</span>
      </span>
    </Tooltip>
  )
}

export function portfolioColumns(opts: { moneyUnit?: MoneyUnit } = {}): Column<CompanySummary>[] {
  const money = (row: CompanySummary, v: number | null) => (
    <MetricValue value={v} unit="currency" currency={row.currency} moneyUnit={opts.moneyUnit} />
  )

  return [
    {
      id: 'name',
      header: 'Company',
      cell: (r) => <span className="font-medium text-foreground">{r.name}</span>,
      sortValue: (r) => r.name,
      className: 'min-w-[10rem]',
    },
    { id: 'sector', header: 'Sector', cell: (r) => r.sector, sortValue: (r) => r.sector, hideBelow: 'md' },
    {
      id: 'period',
      header: 'Period',
      cell: (r) => <span className="whitespace-nowrap">{formatPeriod(r.period)}</span>,
      sortValue: (r) => r.period,
      hideBelow: 'xl',
    },
    {
      id: 'revenueActual',
      header: 'Revenue actual',
      cell: (r) => money(r, r.financials.revenue.actual),
      sortValue: (r) => r.financials.revenue.actual,
      align: 'right',
      hideBelow: 'lg',
    },
    {
      id: 'revenuePlan',
      header: 'Revenue plan',
      cell: (r) => money(r, r.financials.revenue.plan),
      sortValue: (r) => r.financials.revenue.plan,
      align: 'right',
      hideBelow: 'xl',
    },
    {
      id: 'revenueVarPct',
      header: 'Revenue var %',
      cell: (r) => <VarianceValue kpi={r.kpis.revenue_variance_pct} unit="pct" />,
      sortValue: (r) => kpiSort(r.kpis.revenue_variance_pct),
      align: 'right',
      hideBelow: 'sm',
    },
    {
      id: 'ebitdaActual',
      header: 'EBITDA actual',
      cell: (r) => money(r, r.financials.ebitda.actual),
      sortValue: (r) => r.financials.ebitda.actual,
      align: 'right',
      hideBelow: 'lg',
    },
    {
      id: 'ebitdaPlan',
      header: 'EBITDA plan',
      cell: (r) => money(r, r.financials.ebitda.plan),
      sortValue: (r) => r.financials.ebitda.plan,
      align: 'right',
      hideBelow: 'xl',
    },
    {
      id: 'ebitdaVarPct',
      header: 'EBITDA var %',
      cell: (r) => <VarianceValue kpi={r.kpis.ebitda_variance_pct} unit="pct" />,
      sortValue: (r) => kpiSort(r.kpis.ebitda_variance_pct),
      align: 'right',
    },
    {
      id: 'marginActual',
      header: 'Actual margin',
      cell: (r) => marginCell(r.kpis.ebitda_margin_actual_pct),
      sortValue: (r) => kpiSort(r.kpis.ebitda_margin_actual_pct),
      align: 'right',
      hideBelow: 'xl',
    },
    {
      id: 'marginPlan',
      header: 'Planned margin',
      cell: (r) => marginCell(r.kpis.ebitda_margin_plan_pct),
      sortValue: (r) => kpiSort(r.kpis.ebitda_margin_plan_pct),
      align: 'right',
      hideBelow: 'xl',
    },
    {
      id: 'marginVarPp',
      header: 'Margin var (pp)',
      cell: (r) => <VarianceValue kpi={r.kpis.ebitda_margin_variance_pp} unit="pp" />,
      sortValue: (r) => kpiSort(r.kpis.ebitda_margin_variance_pp),
      align: 'right',
      hideBelow: 'lg',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.status} />,
      // Most severe first when ascending.
      sortValue: (r) => STATUS_RANK[r.status] ?? companyStatusLabel[r.status],
    },
    {
      id: 'openExceptions',
      header: 'Open exceptions',
      cell: (r) => <span className="tabular">{r.openExceptions}</span>,
      sortValue: (r) => r.openExceptions,
      align: 'right',
      hideBelow: 'md',
    },
    {
      id: 'lastDataUpdate',
      header: 'Last data update',
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.lastDataUpdate)}</span>,
      sortValue: (r) => r.lastDataUpdate,
      hideBelow: 'xl',
    },
  ]
}
