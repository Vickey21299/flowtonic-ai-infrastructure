import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { api } from '@/api'
import type { InvestigationFilters, InvestigationSummary, ReviewStatus } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { FilterBar, type FilterDef } from '@/components/FilterBar'
import { PageHeader } from '@/components/PageHeader'
import { ReviewStatusBadge } from '@/components/StatusBadges'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Button } from '@/components/ui/button'
import { formatDateTime, investigationStatusLabel, reviewStatusLabel, toOptions } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { linkWithPeriod, oneOf, usePeriodParam, useUrlFilters } from '../urlState'
import { ModeBadge } from './ModeBadge'

const REVIEW = Object.keys(reviewStatusLabel) as ReviewStatus[]
const FILTER_KEYS = ['company', 'review'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

export function InvestigationsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const period = usePeriodParam()
  const selected = useMatch('/investigations/:investigationId')?.params.investigationId ?? null
  const { values, update, clear } = useUrlFilters(FILTER_KEYS)

  const filters: InvestigationFilters = {
    companyId: values.company,
    reviewStatus: oneOf(values.review, REVIEW),
  }

  const companies = useQuery({ queryKey: queryKeys.companies({}), queryFn: () => api.listCompanies({}) })
  const list = useQuery({
    queryKey: queryKeys.investigations(filters),
    queryFn: () => api.listInvestigations(filters),
    placeholderData: keepPreviousData,
  })

  const columns: Column<InvestigationSummary>[] = [
    { id: 'id', header: 'ID', cell: (i) => <span className="font-mono text-xs">{i.id}</span>, sortValue: (i) => i.id },
    { id: 'company', header: 'Company', cell: (i) => <span className="font-medium">{i.companyName}</span>, sortValue: (i) => i.companyName },
    {
      id: 'exception',
      header: 'Exception',
      cell: (i) => (
        <Link
          to={linkWithPeriod(`/exceptions/${encodeURIComponent(i.exceptionId)}`, period)}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs underline underline-offset-4"
        >
          {i.exceptionId}
        </Link>
      ),
      sortValue: (i) => i.exceptionId,
      hideBelow: 'md',
    },
    { id: 'metric', header: 'Metric', cell: (i) => i.metricLabel, sortValue: (i) => i.metricLabel, hideBelow: 'lg' },
    { id: 'mode', header: 'Mode', cell: (i) => <ModeBadge mode={i.mode} />, sortValue: (i) => i.mode },
    { id: 'status', header: 'Run status', cell: (i) => investigationStatusLabel[i.status], sortValue: (i) => i.status, hideBelow: 'lg' },
    { id: 'review', header: 'Review', cell: (i) => <ReviewStatusBadge status={i.reviewStatus} />, sortValue: (i) => i.reviewStatus, hideBelow: 'sm' },
    {
      id: 'created',
      header: 'Created',
      cell: (i) => <span className="whitespace-nowrap">{formatDateTime(i.createdAt)}</span>,
      sortValue: (i) => i.createdAt,
      hideBelow: 'md',
    },
  ]

  const filterDefs: FilterDef[] = [
    {
      id: 'company',
      label: 'Company',
      value: filters.companyId,
      options: (companies.data ?? []).map((c) => ({ value: c.id, label: c.name })),
      allLabel: 'All companies',
    },
    { id: 'review', label: 'Review status', value: filters.reviewStatus, options: toOptions(reviewStatusLabel), allLabel: 'Any' },
  ]
  const anyFilter = Boolean(filters.companyId || filters.reviewStatus)

  let body
  if (list.isPending) body = <Loading variant="table" label="Loading investigations…" />
  else if (list.isError && !list.data)
    body = <ErrorState title="Could not load investigations" error={list.error} onRetry={() => list.refetch()} />
  else
    body = (
      <div className="space-y-2">
        {list.isError && (
          <ErrorState compact title="Could not refresh — showing the previous result" error={list.error} onRetry={() => list.refetch()} />
        )}
        <DataTable
          data={list.data}
          columns={columns}
          getRowId={(i) => i.id}
          selectedRowId={selected}
          caption="Investigations"
          initialSort={{ id: 'created', direction: 'desc' }}
          onRowClick={(i) => navigate(`/investigations/${encodeURIComponent(i.id)}${location.search}`)}
          emptyState={
            anyFilter ? (
              <EmptyState
                compact
                title="No investigations match these filters"
                action={
                  <Button variant="outline" size="sm" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                compact
                title="No investigations yet"
                description="Investigations start from an exception: open one and choose “Investigate”."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link to={linkWithPeriod('/exceptions', period, { status: 'not_resolved' })}>View open exceptions</Link>
                  </Button>
                }
              />
            )
          }
        />
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investigations"
        description="Structured analyses of exceptions. Each run is kept; regenerating creates a new run. Hypotheses are never confirmed causes."
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
