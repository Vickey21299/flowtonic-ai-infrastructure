import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { api } from '@/api'
import type { CompanyStatus, PortfolioFilters } from '@/api/types'
import { DataTable } from '@/components/DataTable'
import { FilterBar, type FilterDef } from '@/components/FilterBar'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { companyStatusLabel, formatDateTime, formatPeriod, toOptions } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { portfolioColumns } from '../portfolioColumns'
import { ATTENTION_PARAM, PERIOD_PARAM, SEARCH_PARAM, linkWithPeriod, oneOf, useUrlFilters } from '../urlState'

const COMPANY_STATUSES = Object.keys(companyStatusLabel) as CompanyStatus[]
const FILTER_KEYS = [PERIOD_PARAM, 'sector', 'status', SEARCH_PARAM, ATTENTION_PARAM] as const
type FilterKey = (typeof FILTER_KEYS)[number]

export function CompaniesPage() {
  const navigate = useNavigate()
  const { values, update, clear } = useUrlFilters(FILTER_KEYS)

  const filters: PortfolioFilters = {
    period: values.period,
    sector: values.sector,
    status: oneOf(values.status, COMPANY_STATUSES),
    search: values.q?.trim() || undefined,
    attention: values.attention === '1' ? true : undefined,
  }
  const period = filters.period

  const workspace = useQuery({ queryKey: queryKeys.workspace, queryFn: () => api.getWorkspace() })
  // Sector options come from the overview read model (same period) — the list endpoint has no sector list.
  const sectorsQuery = useQuery({
    queryKey: queryKeys.overview({ period }),
    queryFn: () => api.getOverview({ period }),
    select: (d) => d.sectors,
  })
  const companies = useQuery({
    queryKey: queryKeys.companies(filters),
    queryFn: () => api.listCompanies(filters),
    placeholderData: keepPreviousData,
  })

  const columns = useMemo(() => portfolioColumns({ moneyUnit: workspace.data?.unit }), [workspace.data?.unit])

  const periodLabel = formatPeriod(period ?? workspace.data?.currentPeriod)
  const tableFilterActive = Boolean(filters.sector || filters.status || filters.search || filters.attention)

  const header = (
    <PageHeader
      title="Portfolio Companies"
      description="Every portfolio company with its performance against plan. Select a company to open its detail page."
      meta={
        workspace.data ? (
          <>
            <span>
              Period: <span className="font-medium text-foreground">{periodLabel}</span>
            </span>
            <span aria-hidden>·</span>
            <span>Last import: {formatDateTime(workspace.data.lastImportAt)}</span>
          </>
        ) : null
      }
    />
  )

  if (companies.isPending) {
    return <Loading label="Loading portfolio companies…" />
  }

  if (companies.isError && !companies.data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState title="Could not load companies" error={companies.error} onRetry={() => companies.refetch()} />
      </div>
    )
  }

  const rows = companies.data

  const filterDefs: FilterDef[] = [
    {
      id: 'sector',
      label: 'Sector',
      value: filters.sector,
      options: (sectorsQuery.data ?? (filters.sector ? [filters.sector] : [])).map((s) => ({ value: s, label: s })),
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
      options: (workspace.data?.periods ?? [])
        .filter((p) => p.key !== workspace.data?.currentPeriod)
        .map((p) => ({ value: p.key, label: p.label })),
      allLabel: workspace.data ? `Latest (${formatPeriod(workspace.data.currentPeriod)})` : 'Latest',
    },
  ]

  const clearTableFilters = () => update({ sector: undefined, status: undefined, q: undefined, attention: undefined })

  const emptyState = tableFilterActive ? (
    <EmptyState
      compact
      title="No companies match these filters"
      description="Try a different sector, status or search term."
      action={
        <Button variant="outline" size="sm" onClick={clearTableFilters}>
          Clear filters
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

      {companies.isError && (
        <ErrorState
          compact
          title="Could not refresh the list — showing the previous result"
          error={companies.error}
          onRetry={() => companies.refetch()}
        />
      )}

      <FilterBar
        filters={filterDefs}
        onFilterChange={(id, value) => update({ [id]: value } as Partial<Record<FilterKey, string | undefined>>)}
        search={{
          value: values.q ?? '',
          onChange: (v) => update({ q: v }, { replace: true }),
          placeholder: 'Company name…',
          label: 'Search companies',
        }}
        onClear={clear}
      >
        {filters.attention && (
          <div className="flex items-center gap-1.5 self-end pb-1.5">
            <Badge variant="warning">Showing companies requiring attention (warning or exception)</Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => update({ attention: undefined })}
              aria-label="Remove the requiring-attention filter"
            >
              <X aria-hidden />
            </Button>
          </div>
        )}
      </FilterBar>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            {rows.length} {rows.length === 1 ? 'company' : 'companies'} · {periodLabel}
          </p>
          {companies.isFetching && <span role="status">Updating…</span>}
        </div>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          caption={`Portfolio companies, ${periodLabel}`}
          onRowClick={(r) => navigate(linkWithPeriod(`/companies/${encodeURIComponent(r.id)}`, period))}
          initialSort={{ id: 'name', direction: 'asc' }}
          pageSize={10}
          emptyState={emptyState}
        />
      </div>
    </div>
  )
}
