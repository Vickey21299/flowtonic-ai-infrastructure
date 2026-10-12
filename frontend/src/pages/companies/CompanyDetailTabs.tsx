/**
 * Tab panels of the Company Detail page (Spec §5). All values come from `CompanyDetail`; this file only formats.
 */
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type {
  ActionSummary,
  CompanyDetail,
  ExceptionSummary,
  InvestigationSummary,
  KpiValue,
  MetricDefinition,
  ObservationRecord,
  ValueUnit,
} from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { MetricValue } from '@/components/MetricValue'
import { Section } from '@/components/Section'
import {
  ActionStatusBadge,
  ExceptionStatusBadge,
  PriorityBadge,
  ReviewStatusBadge,
  SeverityBadge,
  VerificationBadge,
} from '@/components/StatusBadges'
import { VarianceValue } from '@/components/VarianceValue'
import { ActualVsPlanChart } from '@/components/charts/ActualVsPlanChart'
import { EmptyState } from '@/components/states/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import {
  EM_DASH,
  formatDate,
  formatDateTime,
  formatKpi,
  formatPeriod,
  humanize,
  investigationModeLabel,
  investigationStatusLabel,
  type MoneyUnit,
} from '@/lib/format'
import { linkWithPeriod } from '../urlState'

interface TabProps {
  detail: CompanyDetail
  /** URL `?period=`, carried on links. */
  period: string | undefined
  moneyUnit?: MoneyUnit
}

function metricLabel(detail: CompanyDetail, key: string): string {
  return detail.metrics.find((m) => m.key === key)?.label ?? humanize(key)
}

function metricUnit(detail: CompanyDetail, key: string): ValueUnit {
  return detail.metrics.find((m) => m.key === key)?.unit ?? 'currency'
}

// ---------- Performance ----------

function KpiLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  )
}

/** KPI value that may be not calculable (reason in a tooltip). */
function KpiText({ kpi, unit, currency, moneyUnit }: { kpi: KpiValue; unit: ValueUnit; currency: string; moneyUnit?: MoneyUnit }) {
  const missing = kpi.status === 'not_calculable' || kpi.value === null
  const text = formatKpi(kpi, unit, { currency, unit: moneyUnit, signed: true })
  return <span className={missing ? 'text-muted-foreground tabular' : 'tabular'}>{text}</span>
}

function MetricBlock({ metric, detail, moneyUnit }: { metric: MetricDefinition; detail: CompanyDetail; moneyUnit?: MoneyUnit }) {
  const c = detail.company
  const money = (v: number | null) => (
    <MetricValue value={v} unit="currency" currency={c.currency} moneyUnit={moneyUnit} className="text-base" />
  )

  let lines: ReactNode
  if (metric.key === 'revenue' || metric.key === 'ebitda') {
    const ap = c.financials[metric.key]
    const absKpi = metric.key === 'revenue' ? c.kpis.revenue_variance : c.kpis.ebitda_variance
    const pctKpi = metric.key === 'revenue' ? c.kpis.revenue_variance_pct : c.kpis.ebitda_variance_pct
    lines = (
      <>
        <KpiLine label="Actual">{money(ap.actual)}</KpiLine>
        <KpiLine label="Plan">{money(ap.plan)}</KpiLine>
        <KpiLine label="Variance">
          <KpiText kpi={absKpi} unit="currency" currency={c.currency} moneyUnit={moneyUnit} />
        </KpiLine>
        <KpiLine label="Variance %">
          <VarianceValue kpi={pctKpi} unit="pct" className="text-base" />
        </KpiLine>
      </>
    )
  } else if (metric.key === 'ebitda_margin') {
    const marginValue = (k: KpiValue) => (k.status === 'not_calculable' ? null : k.value)
    lines = (
      <>
        <KpiLine label="Actual margin">
          <MetricValue value={marginValue(c.kpis.ebitda_margin_actual_pct)} unit="pct" className="text-base" />
        </KpiLine>
        <KpiLine label="Planned margin">
          <MetricValue value={marginValue(c.kpis.ebitda_margin_plan_pct)} unit="pct" className="text-base" />
        </KpiLine>
        <KpiLine label="Margin variance">
          <VarianceValue kpi={c.kpis.ebitda_margin_variance_pp} unit="pp" className="text-base" />
        </KpiLine>
      </>
    )
  } else {
    lines = <p className="text-sm text-muted-foreground">No KPI view is defined for this metric yet.</p>
  }

  return (
    <Section title={metric.label} description={metric.description} as="h3">
      <dl className="divide-y divide-border">{lines}</dl>
    </Section>
  )
}

export function PerformanceTab({ detail, moneyUnit }: TabProps) {
  const c = detail.company
  const shown = detail.metrics.filter((m) => m.hasData)
  const hidden = detail.metrics.filter((m) => !m.hasData)
  const history = detail.history
  const hasTrend = history.length > 1

  const toPoints = (key: 'revenue' | 'ebitda') =>
    history.map((h) => ({ companyId: h.period, companyName: h.periodLabel, actual: h[key].actual, plan: h[key].plan }))

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Performance against plan — {formatPeriod(c.period)}</h2>
        {shown.length === 0 ? (
          <EmptyState
            compact
            title="No metric data for this company"
            description="Metrics appear once observations with a definition have been imported."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((m) => (
              <MetricBlock key={m.key} metric={m} detail={detail} moneyUnit={moneyUnit} />
            ))}
          </div>
        )}
        {hidden.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Not shown (no data imported): {hidden.map((m) => m.label).join(', ')}.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Trend across reporting periods</h2>
        {!hasTrend ? (
          <EmptyState
            compact
            title="Historical trend appears once more than one reporting period has been imported"
            description={
              history.length === 1
                ? `Only ${history[0]?.periodLabel} is stored for this company. No earlier periods are shown or estimated.`
                : 'No reporting periods are stored for this company.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {shown.some((m) => m.key === 'revenue') && (
              <Section title="Revenue: actual vs plan" description="Stored periods only" as="h3">
                <ActualVsPlanChart
                  data={toPoints('revenue')}
                  label={`${c.name} revenue actual vs plan by period`}
                  currency={c.currency}
                  moneyUnit={moneyUnit}
                  categoryHeader="Period"
                />
              </Section>
            )}
            {shown.some((m) => m.key === 'ebitda') && (
              <Section title="EBITDA: actual vs plan" description="Stored periods only" as="h3">
                <ActualVsPlanChart
                  data={toPoints('ebitda')}
                  label={`${c.name} EBITDA actual vs plan by period`}
                  currency={c.currency}
                  moneyUnit={moneyUnit}
                  categoryHeader="Period"
                />
              </Section>
            )}
            {shown.some((m) => m.key === 'ebitda_margin') && (
              <Section title="EBITDA margin: actual vs plan" description="Stored periods only" as="h3" flush>
                <Table>
                  <caption className="sr-only">{c.name} EBITDA margin actual vs plan by period</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Actual margin</TableHead>
                      <TableHead className="text-right">Planned margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((h) => (
                      <TableRow key={h.period}>
                        <TableCell>{h.periodLabel}</TableCell>
                        <TableCell className="text-right">
                          <MetricValue value={h.marginActualPct} unit="pct" />
                        </TableCell>
                        <TableCell className="text-right">
                          <MetricValue value={h.marginPlanPct} unit="pct" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Exceptions ----------

export function ExceptionsTab({ detail, period, moneyUnit }: TabProps) {
  const navigate = useNavigate()
  const currency = detail.company.currency
  const columns: Column<ExceptionSummary>[] = [
    { id: 'severity', header: 'Severity', cell: (e) => <SeverityBadge severity={e.severity} />, sortValue: (e) => ['high', 'medium', 'warning'].indexOf(e.severity) },
    { id: 'metric', header: 'Metric', cell: (e) => <span className="font-medium">{e.metricLabel}</span>, sortValue: (e) => e.metricLabel },
    { id: 'period', header: 'Period', cell: (e) => formatPeriod(e.period), sortValue: (e) => e.period, hideBelow: 'xl' },
    {
      id: 'actual',
      header: 'Actual',
      cell: (e) => <MetricValue value={e.actualValue} unit={metricUnit(detail, e.metricKey)} currency={currency} moneyUnit={moneyUnit} />,
      sortValue: (e) => e.actualValue,
      align: 'right',
      hideBelow: 'md',
    },
    {
      id: 'plan',
      header: 'Plan',
      cell: (e) => <MetricValue value={e.planValue} unit={metricUnit(detail, e.metricKey)} currency={currency} moneyUnit={moneyUnit} />,
      sortValue: (e) => e.planValue,
      align: 'right',
      hideBelow: 'md',
    },
    {
      id: 'variance',
      header: 'Variance',
      cell: (e) => <VarianceValue value={e.variancePct} unit={e.kpiKey.endsWith('_pp') ? 'pp' : 'pct'} />,
      sortValue: (e) => e.variancePct,
      align: 'right',
    },
    { id: 'rule', header: 'Rule', cell: (e) => e.ruleLabel, sortValue: (e) => e.ruleLabel, hideBelow: 'lg' },
    {
      id: 'status',
      header: 'Status',
      cell: (e) => <ExceptionStatusBadge status={e.status} conditionActive={e.conditionActive} />,
      sortValue: (e) => e.status,
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: (e) => e.owner ?? <span className="text-muted-foreground">Unassigned</span>,
      sortValue: (e) => e.owner,
      hideBelow: 'lg',
    },
    {
      id: 'created',
      header: 'Created',
      cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.createdAt)}</span>,
      sortValue: (e) => e.createdAt,
      hideBelow: 'xl',
    },
  ]

  return (
    <DataTable
      data={detail.exceptions}
      columns={columns}
      getRowId={(e) => e.id}
      caption={`Exceptions for ${detail.company.name}`}
      onRowClick={(e) => navigate(linkWithPeriod(`/exceptions/${encodeURIComponent(e.id)}`, period))}
      emptyState={
        <EmptyState
          compact
          title="No exceptions for this company"
          description="No rule threshold has been breached by the imported data."
        />
      }
    />
  )
}

// ---------- Investigations ----------

export function InvestigationsTab({ detail, period }: TabProps) {
  const navigate = useNavigate()
  const openException = detail.exceptions.find((e) => e.status !== 'resolved')

  const columns: Column<InvestigationSummary>[] = [
    { id: 'id', header: 'Investigation', cell: (i) => <span className="font-medium">{i.id}</span>, sortValue: (i) => i.id },
    { id: 'metric', header: 'Exception', cell: (i) => `${i.metricLabel} · ${i.exceptionId}`, sortValue: (i) => i.exceptionId, hideBelow: 'md' },
    {
      id: 'mode',
      header: 'Source',
      cell: (i) =>
        i.mode === 'mock' ? (
          <Tooltip content="MOCK INVESTIGATION — not generated by an AI model">
            <span tabIndex={0}>
              <Badge variant="inverse">Mock — not AI</Badge>
            </span>
          </Tooltip>
        ) : (
          <Badge variant="warning">AI-generated</Badge>
        ),
      sortValue: (i) => investigationModeLabel[i.mode],
    },
    { id: 'status', header: 'Run status', cell: (i) => investigationStatusLabel[i.status], sortValue: (i) => i.status, hideBelow: 'sm' },
    { id: 'review', header: 'Review', cell: (i) => <ReviewStatusBadge status={i.reviewStatus} />, sortValue: (i) => i.reviewStatus },
    {
      id: 'created',
      header: 'Created',
      cell: (i) => <span className="whitespace-nowrap">{formatDateTime(i.createdAt)}</span>,
      sortValue: (i) => i.createdAt,
      hideBelow: 'lg',
    },
  ]

  return (
    <DataTable
      data={detail.investigations}
      columns={columns}
      getRowId={(i) => i.id}
      caption={`Investigations for ${detail.company.name}`}
      initialSort={{ id: 'created', direction: 'desc' }}
      onRowClick={(i) => navigate(linkWithPeriod(`/investigations/${encodeURIComponent(i.id)}`, period))}
      emptyState={
        <EmptyState
          compact
          title="No investigations yet"
          description="Investigations are started from an exception."
          action={
            openException ? (
              <Button asChild variant="outline" size="sm">
                <Link to={linkWithPeriod(`/exceptions/${encodeURIComponent(openException.id)}`, period)}>
                  Open {openException.metricLabel} exception ({openException.id})
                </Link>
              </Button>
            ) : undefined
          }
        />
      }
    />
  )
}

// ---------- Actions ----------

export function ActionsTab({ detail, period }: TabProps) {
  const navigate = useNavigate()
  const columns: Column<ActionSummary>[] = [
    { id: 'title', header: 'Action', cell: (a) => <span className="font-medium">{a.title}</span>, sortValue: (a) => a.title, className: 'min-w-[12rem]' },
    { id: 'status', header: 'Status', cell: (a) => <ActionStatusBadge status={a.status} overdue={a.isOverdue} />, sortValue: (a) => a.status },
    {
      id: 'priority',
      header: 'Priority',
      cell: (a) => <PriorityBadge priority={a.priority} />,
      sortValue: (a) => ['high', 'medium', 'low'].indexOf(a.priority),
      hideBelow: 'sm',
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: (a) => a.owner ?? <span className="text-muted-foreground">Unassigned</span>,
      sortValue: (a) => a.owner,
      hideBelow: 'md',
    },
    {
      id: 'due',
      header: 'Due',
      cell: (a) => <span className={a.isOverdue ? 'whitespace-nowrap text-status-danger' : 'whitespace-nowrap'}>{formatDate(a.dueDate)}</span>,
      sortValue: (a) => a.dueDate,
      hideBelow: 'md',
    },
    {
      id: 'verification',
      header: 'Outcome',
      cell: (a) => <VerificationBadge status={a.verificationStatus} />,
      sortValue: (a) => a.verificationStatus,
      hideBelow: 'lg',
    },
  ]
  return (
    <DataTable
      data={detail.actions}
      columns={columns}
      getRowId={(a) => a.id}
      caption={`Actions for ${detail.company.name}`}
      onRowClick={(a) => navigate(linkWithPeriod(`/actions/${encodeURIComponent(a.id)}`, period))}
      emptyState={
        <EmptyState
          compact
          title="No actions for this company"
          description="Actions are created from an exception or an investigation."
        />
      }
    />
  )
}

// ---------- Data history ----------

function OriginalValues({ values }: { values: Record<string, string> }) {
  const entries = Object.entries(values)
  if (entries.length === 0) return <span className="text-muted-foreground">{EM_DASH}</span>
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono">{v === '' ? <span className="text-muted-foreground">(empty)</span> : v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function DataHistoryTab({ detail, moneyUnit }: TabProps) {
  const currency = detail.company.currency
  const columns: Column<ObservationRecord>[] = [
    { id: 'metric', header: 'Metric', cell: (o) => <span className="font-medium">{metricLabel(detail, o.metricKey)}</span>, sortValue: (o) => o.metricKey },
    { id: 'period', header: 'Period', cell: (o) => formatPeriod(o.period), sortValue: (o) => o.period },
    {
      id: 'actual',
      header: 'Actual',
      cell: (o) => <MetricValue value={o.actualValue} unit={metricUnit(detail, o.metricKey)} currency={currency} moneyUnit={moneyUnit} />,
      sortValue: (o) => o.actualValue,
      align: 'right',
    },
    {
      id: 'plan',
      header: 'Plan',
      cell: (o) => <MetricValue value={o.planValue} unit={metricUnit(detail, o.metricKey)} currency={currency} moneyUnit={moneyUnit} />,
      sortValue: (o) => o.planValue,
      align: 'right',
      hideBelow: 'sm',
    },
    { id: 'original', header: 'Original values', cell: (o) => <OriginalValues values={o.originalValues} />, hideBelow: 'xl' },
    {
      id: 'source',
      header: 'Source',
      cell: (o) => (
        <div className="text-xs">
          <p>{o.sourceName}</p>
          <p className="text-muted-foreground">updated {formatDateTime(o.sourceUpdatedAt)}</p>
        </div>
      ),
      sortValue: (o) => o.sourceName,
      hideBelow: 'lg',
    },
    {
      id: 'file',
      header: 'File / row',
      cell: (o) => (
        <div className="text-xs">
          <p className="font-mono">{o.fileName}</p>
          <p className="text-muted-foreground">
            row {o.sourceRow} · {o.importJobId}
          </p>
        </div>
      ),
      sortValue: (o) => `${o.fileName}#${String(o.sourceRow).padStart(6, '0')}`,
      hideBelow: 'md',
    },
    {
      id: 'imported',
      header: 'Imported',
      cell: (o) => (
        <div className="whitespace-nowrap text-xs">
          <p>{formatDateTime(o.importedAt)}</p>
          <p className="text-muted-foreground">by {o.importedBy}</p>
        </div>
      ),
      sortValue: (o) => o.importedAt,
      hideBelow: 'lg',
    },
    {
      id: 'validation',
      header: 'Validation',
      cell: (o) => <Badge variant={o.validationStatus === 'valid' ? 'success' : 'danger'}>{humanize(o.validationStatus)}</Badge>,
      sortValue: (o) => o.validationStatus,
      hideBelow: 'sm',
    },
    {
      id: 'current',
      header: 'Version',
      cell: (o) => (o.isCurrent ? <Badge variant="neutral">Current</Badge> : <Badge variant="outline">Superseded</Badge>),
      sortValue: (o) => (o.isCurrent ? 0 : 1),
    },
  ]
  return (
    <DataTable
      data={detail.dataHistory}
      columns={columns}
      getRowId={(o) => o.id}
      caption={`Data history for ${detail.company.name}`}
      emptyState={
        <EmptyState
          compact
          title="No observations stored"
          description="Imported values for this company will appear here with their source file and row."
        />
      }
    />
  )
}
