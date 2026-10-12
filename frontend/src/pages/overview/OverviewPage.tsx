import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Building2, ClipboardCheck, Clock, ShieldAlert } from 'lucide-react'
import { api } from '@/api'
import type { CompanyStatus, PortfolioFilters } from '@/api/types'
import { DataTable } from '@/components/DataTable'
import { FilterBar, type FilterDef } from '@/components/FilterBar'
import { KpiCard } from '@/components/KpiCard'
import { PageHeader } from '@/components/PageHeader'
import { Section } from '@/components/Section'
import { ActualVsPlanChart } from '@/components/charts/ActualVsPlanChart'
import { SeverityChart } from '@/components/charts/SeverityChart'
import { StatusDistributionChart } from '@/components/charts/StatusDistributionChart'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Button } from '@/components/ui/button'
import { companyStatusLabel, formatDateTime, formatPeriod, toOptions } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { portfolioColumns } from '../portfolioColumns'
import {
  ATTENTION_PARAM,
  AWAITING_VERIFICATION_STATUS,
  PERIOD_PARAM,
  SEARCH_PARAM,
  linkWithPeriod,
  oneOf,
  useUrlFilters,
} from '../urlState'

const COMPANY_STATUSES = Object.keys(companyStatusLabel) as CompanyStatus[]
const FILTER_KEYS = [PERIOD_PARAM, 'sector', 'status', SEARCH_PARAM] as const

export function OverviewPage() {
  const navigate = useNavigate()
  const { values, update, clear } = useUrlFilters(FILTER_KEYS)

  const filters: PortfolioFilters = {
    period: values.period,
    sector: values.sector,
    status: oneOf(values.status, COMPANY_STATUSES),
    search: values.q?.trim() || undefined,
  }
  const period = filters.period

  const workspace = useQuery({ queryKey: queryKeys.workspace, queryFn: () => api.getWorkspace() })
  const overview = useQuery({
    queryKey: queryKeys.overview(filters),
    queryFn: () => api.getOverview(filters),
    // Keep the page on screen while a new filter/search result loads.
    placeholderData: keepPreviousData,
  })

  const columns = useMemo(() => portfolioColumns({ moneyUnit: workspace.data?.unit }), [workspace.data?.unit])

  const filterActive = Boolean(filters.sector || filters.status || filters.search || period)
  const tableFilterActive = Boolean(filters.sector || filters.status || filters.search)

  const header = (
    <PageHeader
      title="Portfolio Overview"
      description="Performance against plan for every portfolio company in the selected reporting period."
      meta={
        overview.data ? (
          <>
            <span>
              Period: <span className="font-medium text-foreground">{overview.data.period.label}</span>
              {overview.data.period.key !== overview.data.freshness.latestPeriod && ' (historical)'}
            </span>
            <span aria-hidden>·</span>
            <span>Latest available period: {formatPeriod(overview.data.freshness.latestPeriod)}</span>
            <span aria-hidden>·</span>
            <span>Last import: {formatDateTime(overview.data.freshness.lastImportAt)}</span>
            <span aria-hidden>·</span>
            <span>Figures reflect the last import, not real-time data.</span>
          </>
        ) : null
      }
    />
  )

  if (overview.isPending) {
    return (
      <div className="space-y-6">
        <Loading label="Loading portfolio overview…" />
      </div>
    )
  }

  if (overview.isError && !overview.data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState title="Could not load the portfolio overview" error={overview.error} onRetry={() => overview.refetch()} />
      </div>
    )
  }

  const data = overview.data
  const { cards, charts, rows } = data
  const periodLabel = data.period.label
  const cardHint = `All companies, ${periodLabel}`

  const filterDefs: FilterDef[] = [
    {
      id: 'sector',
      label: 'Sector',
      value: filters.sector,
      options: data.sectors.map((s) => ({ value: s, label: s })),
      allLabel: 'All sectors',
    },
    {
      id: 'status',
      label: 'Status',
      value: filters.status,
      options: toOptions(companyStatusLabel),
      allLabel: 'All statuses',
    },
    {
      id: PERIOD_PARAM,
      label: 'Reporting period',
      value: period,
      options: (workspace.data?.periods ?? [data.period])
        .filter((p) => p.key !== workspace.data?.currentPeriod)
        .map((p) => ({ value: p.key, label: p.label })),
      allLabel: workspace.data
        ? `Latest (${formatPeriod(workspace.data.currentPeriod)})`
        : `Latest`,
    },
  ]

  const onFilterChange = (id: string, value: string | undefined) => {
    update({ [id]: value } as Partial<Record<(typeof FILTER_KEYS)[number], string | undefined>>)
  }

  const toggleStatus = (status: CompanyStatus) => update({ status: filters.status === status ? undefined : status })

  const emptyTable = tableFilterActive ? (
    <EmptyState
      compact
      title="No companies match these filters"
      description="Try a different sector, status or search term."
      action={
        <Button variant="outline" size="sm" onClick={() => update({ sector: undefined, status: undefined, q: undefined })}>
          Clear table filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      compact
      title={`No portfolio data for ${periodLabel}`}
      description="No observations have been imported for this period."
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/import">Import data</Link>
        </Button>
      }
    />
  )

  return (
    <div className="space-y-6">
      {header}

      {overview.isError && (
        <ErrorState
          compact
          title="Could not refresh the overview — showing the previous result"
          error={overview.error}
          onRetry={() => overview.refetch()}
        />
      )}

      <section aria-labelledby="overview-kpis" className="space-y-2">
        <h2 id="overview-kpis" className="sr-only">
          Portfolio KPIs
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="Portfolio companies"
            value={cards.companies}
            hint={cardHint}
            icon={<Building2 />}
            to={linkWithPeriod('/companies', period)}
          />
          <KpiCard
            label="Companies requiring attention"
            value={cards.requiringAttention}
            hint="Status warning or exception"
            icon={<AlertTriangle />}
            tone={cards.requiringAttention > 0 ? 'warning' : 'default'}
            to={linkWithPeriod('/companies', period, { [ATTENTION_PARAM]: '1' })}
          />
          <KpiCard
            label="Open high-priority exceptions"
            value={cards.openHighExceptions}
            hint={`Not resolved, ${periodLabel}`}
            icon={<ShieldAlert />}
            tone={cards.openHighExceptions > 0 ? 'danger' : 'default'}
            to={linkWithPeriod('/exceptions', period, { severity: 'high', status: 'not_resolved' })}
          />
          <KpiCard
            label="Overdue actions"
            value={cards.overdueActions}
            hint="Past due date, not finished"
            icon={<Clock />}
            tone={cards.overdueActions > 0 ? 'danger' : 'default'}
            to={linkWithPeriod('/actions', period, { overdue: '1' })}
          />
          <KpiCard
            label="Awaiting outcome verification"
            value={cards.awaitingVerification}
            hint="Completed actions, outcome not yet verified"
            icon={<ClipboardCheck />}
            tone={cards.awaitingVerification > 0 ? 'warning' : 'default'}
            to={linkWithPeriod('/actions', period, { status: AWAITING_VERIFICATION_STATUS })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Cards cover the whole portfolio for {periodLabel}. The table and charts below apply the sector, status and
          search filters.
        </p>
      </section>

      <FilterBar
        filters={filterDefs}
        onFilterChange={onFilterChange}
        search={{
          value: values.q ?? '',
          onChange: (v) => update({ q: v }, { replace: true }),
          placeholder: 'Company name…',
          label: 'Search companies',
        }}
        onClear={filterActive ? clear : undefined}
      />

      <Section
        title="Portfolio performance"
        description={`${rows.length} ${rows.length === 1 ? 'company' : 'companies'} · ${periodLabel} · click a row to open the company`}
        actions={
          overview.isFetching ? (
            <span role="status" className="text-xs text-muted-foreground">
              Updating…
            </span>
          ) : null
        }
        flush
        contentClassName="p-3"
      >
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          caption={`Portfolio performance, ${periodLabel}`}
          onRowClick={(r) => navigate(linkWithPeriod(`/companies/${encodeURIComponent(r.id)}`, period))}
          initialSort={{ id: 'status', direction: 'asc' }}
          pageSize={10}
          emptyState={emptyTable}
        />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Revenue: actual vs plan" description={`By company, ${periodLabel}. Hover a bar for the company name`}>
          {charts.revenueByCompany.length > 0 ? (
            <ActualVsPlanChart
              data={charts.revenueByCompany}
              label={`Revenue actual vs plan by company, ${periodLabel}`}
              currency={workspace.data?.currency}
              moneyUnit={workspace.data?.unit}
              onSelectCompany={(id) => navigate(linkWithPeriod(`/companies/${encodeURIComponent(id)}`, period))}
            />
          ) : (
            <EmptyState compact title="No companies to chart" />
          )}
        </Section>
        <Section title="EBITDA: actual vs plan" description={`By company, ${periodLabel}. Hover a bar for the company name`}>
          {charts.ebitdaByCompany.length > 0 ? (
            <ActualVsPlanChart
              data={charts.ebitdaByCompany}
              label={`EBITDA actual vs plan by company, ${periodLabel}`}
              currency={workspace.data?.currency}
              moneyUnit={workspace.data?.unit}
              onSelectCompany={(id) => navigate(linkWithPeriod(`/companies/${encodeURIComponent(id)}`, period))}
            />
          ) : (
            <EmptyState compact title="No companies to chart" />
          )}
        </Section>
        <Section title="Companies by status" description="Click a bar to filter the table by that status">
          <StatusDistributionChart
            data={charts.statusDistribution}
            label={`Distribution of companies by status, ${periodLabel}`}
            onSelect={toggleStatus}
          />
        </Section>
        <Section title="Open exceptions by severity" description="Click a bar to open the matching exceptions">
          <SeverityChart
            data={charts.exceptionsBySeverity}
            label={`Open exception count by severity, ${periodLabel}`}
            onSelect={(severity) =>
              navigate(linkWithPeriod('/exceptions', period, { severity, status: 'not_resolved' }))
            }
          />
        </Section>
      </div>
    </div>
  )
}
