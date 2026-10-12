import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { api } from '@/api'
import type { ExceptionFilters, ExceptionStatus, ExceptionSummary, MetricKey, Severity } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { FilterBar, type FilterDef } from '@/components/FilterBar'
import { MetricValue } from '@/components/MetricValue'
import { PageHeader } from '@/components/PageHeader'
import { ExceptionStatusBadge, SeverityBadge } from '@/components/StatusBadges'
import { VarianceValue } from '@/components/VarianceValue'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Button } from '@/components/ui/button'
import {
  exceptionStatusLabel,
  formatDateTime,
  formatPeriod,
  severityLabel,
  toOptions,
  type MoneyUnit,
} from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { PERIOD_PARAM, oneOf, useUrlFilters } from '../urlState'
import { METRIC_LABELS, NOT_RESOLVED, metricUnit, varianceUnit } from './exceptionMeta'

const SEVERITIES = Object.keys(severityLabel) as Severity[]
const METRICS = Object.keys(METRIC_LABELS) as MetricKey[]
const STATUSES = [...(Object.keys(exceptionStatusLabel) as ExceptionStatus[]), NOT_RESOLVED] as const
const FILTER_KEYS = ['severity', 'company', 'metric', PERIOD_PARAM, 'status', 'owner'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

function columns(moneyUnit: MoneyUnit | undefined): Column<ExceptionSummary>[] {
  return [
    { id: 'id', header: 'ID', cell: (e) => <span className="font-mono text-xs">{e.id}</span>, sortValue: (e) => e.id },
    {
      id: 'company',
      header: 'Company',
      cell: (e) => <span className="font-medium">{e.companyName}</span>,
      sortValue: (e) => e.companyName,
      className: 'min-w-[9rem]',
    },
    { id: 'period', header: 'Period', cell: (e) => formatPeriod(e.period), sortValue: (e) => e.period, hideBelow: 'xl' },
    { id: 'metric', header: 'Metric', cell: (e) => e.metricLabel, sortValue: (e) => e.metricLabel, hideBelow: 'sm' },
    {
      id: 'actual',
      header: 'Actual',
      cell: (e) => <MetricValue value={e.actualValue} unit={metricUnit(e.metricKey)} moneyUnit={moneyUnit} />,
      sortValue: (e) => e.actualValue,
      align: 'right',
      hideBelow: 'lg',
    },
    {
      id: 'plan',
      header: 'Plan / benchmark',
      cell: (e) => <MetricValue value={e.planValue} unit={metricUnit(e.metricKey)} moneyUnit={moneyUnit} />,
      sortValue: (e) => e.planValue,
      align: 'right',
      hideBelow: 'lg',
    },
    {
      id: 'variance',
      header: 'Variance',
      cell: (e) => <VarianceValue value={e.variancePct} unit={varianceUnit(e.kpiKey)} />,
      sortValue: (e) => e.variancePct,
      align: 'right',
    },
    {
      id: 'severity',
      header: 'Severity',
      cell: (e) => <SeverityBadge severity={e.severity} />,
      sortValue: (e) => SEVERITIES.indexOf(e.severity),
    },
    { id: 'rule', header: 'Detection rule', cell: (e) => e.ruleLabel, sortValue: (e) => e.ruleLabel, hideBelow: 'xl' },
    {
      id: 'status',
      header: 'Status',
      cell: (e) => <ExceptionStatusBadge status={e.status} conditionActive={e.conditionActive} />,
      sortValue: (e) => e.status,
      hideBelow: 'md',
    },
    {
      id: 'created',
      header: 'Created',
      cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.createdAt)}</span>,
      sortValue: (e) => e.createdAt,
      hideBelow: 'xl',
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: (e) => e.owner ?? <span className="text-muted-foreground">Unassigned</span>,
      sortValue: (e) => e.owner,
      hideBelow: 'lg',
    },
  ]
}

export function ExceptionsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const selected = useMatch('/exceptions/:exceptionId')?.params.exceptionId ?? null
  const { values, update, clear } = useUrlFilters(FILTER_KEYS)

  const filters: ExceptionFilters = {
    severity: oneOf(values.severity, SEVERITIES),
    companyId: values.company,
    metricKey: oneOf(values.metric, METRICS),
    period: values.period,
    status: oneOf(values.status, STATUSES),
    owner: values.owner,
  }

  const workspace = useQuery({ queryKey: queryKeys.workspace, queryFn: () => api.getWorkspace() })
  const companies = useQuery({ queryKey: queryKeys.companies({}), queryFn: () => api.listCompanies({}) })
  // Unfiltered list, only to offer the owners that exist as filter options.
  const allExceptions = useQuery({ queryKey: queryKeys.exceptions({}), queryFn: () => api.listExceptions({}) })
  const list = useQuery({
    queryKey: queryKeys.exceptions(filters),
    queryFn: () => api.listExceptions(filters),
    placeholderData: keepPreviousData,
  })

  const cols = useMemo(() => columns(workspace.data?.unit), [workspace.data?.unit])

  const owners = useMemo(() => {
    const set = new Set((allExceptions.data ?? []).map((e) => e.owner).filter((o): o is string => Boolean(o)))
    if (filters.owner) set.add(filters.owner)
    return [...set].sort()
  }, [allExceptions.data, filters.owner])

  const filterDefs: FilterDef[] = [
    { id: 'severity', label: 'Severity', value: filters.severity, options: toOptions(severityLabel), allLabel: 'All severities' },
    {
      id: 'company',
      label: 'Company',
      value: filters.companyId,
      options: (companies.data ?? []).map((c) => ({ value: c.id, label: c.name })),
      allLabel: 'All companies',
    },
    {
      id: 'metric',
      label: 'Metric',
      value: filters.metricKey,
      options: METRICS.map((m) => ({ value: m, label: METRIC_LABELS[m] })),
      allLabel: 'All metrics',
    },
    {
      id: PERIOD_PARAM,
      label: 'Period',
      value: filters.period,
      options: (workspace.data?.periods ?? []).map((p) => ({ value: p.key, label: p.label })),
      allLabel: 'All periods',
    },
    {
      id: 'status',
      label: 'Status',
      value: filters.status,
      options: [{ value: NOT_RESOLVED, label: 'Not resolved (open, acknowledged, in review)' }, ...toOptions(exceptionStatusLabel)],
      allLabel: 'All statuses',
    },
    { id: 'owner', label: 'Owner', value: filters.owner, options: owners.map((o) => ({ value: o, label: o })), allLabel: 'Any owner' },
  ]

  const anyFilter = Object.values(filters).some(Boolean)

  let body
  if (list.isPending) {
    body = <Loading variant="table" label="Loading exceptions…" />
  } else if (list.isError && !list.data) {
    body = <ErrorState title="Could not load exceptions" error={list.error} onRetry={() => list.refetch()} />
  } else {
    const rows = list.data
    body = (
      <div className="space-y-2">
        {list.isError && (
          <ErrorState
            compact
            title="Could not refresh the list — showing the previous result"
            error={list.error}
            onRetry={() => list.refetch()}
          />
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            {rows.length} {rows.length === 1 ? 'exception' : 'exceptions'}
          </p>
          {list.isFetching && <span role="status">Updating…</span>}
        </div>
        <DataTable
          data={rows}
          columns={cols}
          getRowId={(e) => e.id}
          selectedRowId={selected}
          caption="Exceptions"
          // Keep every filter in the URL so the list stays filtered behind the drawer.
          onRowClick={(e) => navigate(`/exceptions/${encodeURIComponent(e.id)}${location.search}`)}
          emptyState={
            anyFilter ? (
              <EmptyState
                compact
                title="No exceptions match these filters"
                description="Try widening the severity, status or period."
                action={
                  <Button variant="outline" size="sm" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                compact
                title="No exceptions"
                description="No detection rule has been breached by the imported data."
              />
            )
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exceptions"
        description="KPI variances that breached a detection rule. Opening an exception never changes its status."
      />
      <FilterBar
        filters={filterDefs}
        onFilterChange={(id, value) => update({ [id]: value } as Partial<Record<FilterKey, string | undefined>>)}
        onClear={clear}
      />
      {body}
      <Outlet />
    </div>
  )
}
