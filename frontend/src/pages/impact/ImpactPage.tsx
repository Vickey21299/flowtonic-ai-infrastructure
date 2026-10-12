import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api } from '@/api'
import type { ImpactFilters, ImpactRecord, ImpactVerificationStatus } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { FilterBar, type FilterDef } from '@/components/FilterBar'
import { MetricValue } from '@/components/MetricValue'
import { PageHeader } from '@/components/PageHeader'
import { VerificationBadge } from '@/components/StatusBadges'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Button } from '@/components/ui/button'
import { formatPeriod, verificationLabel } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { cn } from '@/lib/utils'
import { linkWithPeriod, oneOf, usePeriodParam, useUrlFilters } from '../urlState'
import { CreateImpactDialog } from './CreateImpactDialog'
import { ImpactRecordDrawer } from './ImpactRecordDrawer'

const VERIFICATION: ImpactVerificationStatus[] = ['not_yet_measurable', 'unverified', 'verified', 'rejected']
const FILTER_KEYS = ['company', 'action', 'verification'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

function ValueWithPeriod({ r, value, period, muted }: { r: ImpactRecord; value: number | null; period: string | null; muted?: boolean }) {
  return (
    <div className={cn('whitespace-nowrap', muted && 'text-muted-foreground')}>
      <MetricValue value={value} unit={r.unit} />
      {period && <span className="block text-xs text-muted-foreground">{formatPeriod(period)}</span>}
    </div>
  )
}

export function ImpactPage() {
  const period = usePeriodParam()
  const [params, setParams] = useSearchParams()
  const { values, update, clear } = useUrlFilters(FILTER_KEYS)

  const filters: ImpactFilters = {
    companyId: values.company,
    actionId: values.action,
    verificationStatus: oneOf(values.verification, VERIFICATION),
  }

  const companies = useQuery({ queryKey: queryKeys.companies({}), queryFn: () => api.listCompanies({}) })
  const actions = useQuery({ queryKey: queryKeys.actions({}), queryFn: () => api.listActions({}) })
  const all = useQuery({ queryKey: queryKeys.impacts({}), queryFn: () => api.listImpacts({}) })
  const list = useQuery({
    queryKey: queryKeys.impacts(filters),
    queryFn: () => api.listImpacts(filters),
    placeholderData: keepPreviousData,
  })

  // ---- URL-driven dialog / drawer ----
  const createOpen = params.get('new') === '1'
  const recordId = params.get('record')
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next)
  }

  // Per-status counts of the listed records. Values are never summed (Spec §11).
  const counts = useMemo(() => {
    const c: Record<ImpactVerificationStatus, number> = { not_yet_measurable: 0, unverified: 0, verified: 0, rejected: 0 }
    for (const r of list.data ?? []) c[r.verificationStatus] += 1
    return c
  }, [list.data])

  const columns: Column<ImpactRecord>[] = [
    { id: 'id', header: 'ID', cell: (r) => <span className="font-mono text-xs">{r.id}</span>, sortValue: (r) => r.id, hideBelow: 'xl' },
    { id: 'company', header: 'Company', cell: (r) => <span className="font-medium">{r.companyName}</span>, sortValue: (r) => r.companyName },
    {
      id: 'action',
      header: 'Action',
      cell: (r) => (
        <Link
          to={linkWithPeriod(`/actions/${encodeURIComponent(r.actionId)}`, period)}
          onClick={(e) => e.stopPropagation()}
          className="underline-offset-4 hover:underline"
        >
          {r.actionTitle}
        </Link>
      ),
      sortValue: (r) => r.actionTitle,
      hideBelow: 'md',
      className: 'min-w-[10rem]',
    },
    { id: 'metric', header: 'Metric', cell: (r) => r.metricLabel, sortValue: (r) => r.metricLabel, hideBelow: 'sm' },
    {
      id: 'baseline',
      header: 'Baseline',
      cell: (r) => <ValueWithPeriod r={r} value={r.baselineValue} period={r.baselinePeriod} />,
      sortValue: (r) => r.baselineValue,
      align: 'right',
      hideBelow: 'lg',
    },
    {
      id: 'target',
      header: 'Target',
      cell: (r) => <ValueWithPeriod r={r} value={r.targetValue} period={r.targetPeriod} />,
      sortValue: (r) => r.targetValue,
      align: 'right',
      hideBelow: 'lg',
    },
    {
      id: 'estimate',
      header: (
        <span>
          Estimate <span className="font-normal normal-case">(not realised)</span>
        </span>
      ),
      cell: (r) => <ValueWithPeriod r={r} value={r.estimatedValue} period={null} muted />,
      sortValue: (r) => r.estimatedValue,
      align: 'right',
      hideBelow: 'xl',
    },
    {
      id: 'observed',
      header: 'Observed',
      cell: (r) => <ValueWithPeriod r={r} value={r.observedValue} period={r.observationPeriod} />,
      sortValue: (r) => r.observedValue,
      align: 'right',
    },
    {
      id: 'source',
      header: 'Measurement source',
      cell: (r) => r.measurementSource ?? <span className="text-muted-foreground">—</span>,
      sortValue: (r) => r.measurementSource,
      hideBelow: 'xl',
    },
    {
      id: 'verification',
      header: 'Verification',
      cell: (r) => <VerificationBadge status={r.verificationStatus} />,
      sortValue: (r) => VERIFICATION.indexOf(r.verificationStatus),
    },
    {
      id: 'reviewer',
      header: 'Reviewer',
      cell: (r) => r.reviewer ?? <span className="text-muted-foreground">—</span>,
      sortValue: (r) => r.reviewer,
      hideBelow: 'lg',
    },
  ]

  const actionOptions = (actions.data ?? []).map((a) => ({ value: a.id, label: `${a.id} · ${a.title}` }))
  if (filters.actionId && !actionOptions.some((o) => o.value === filters.actionId)) {
    actionOptions.unshift({ value: filters.actionId, label: filters.actionId })
  }

  const filterDefs: FilterDef[] = [
    {
      id: 'company',
      label: 'Company',
      value: filters.companyId,
      options: (companies.data ?? []).map((c) => ({ value: c.id, label: c.name })),
      allLabel: 'All companies',
    },
    { id: 'action', label: 'Action', value: filters.actionId, options: actionOptions, allLabel: 'All actions' },
    {
      id: 'verification',
      label: 'Verification',
      value: filters.verificationStatus,
      options: VERIFICATION.map((v) => ({ value: v, label: verificationLabel[v] })),
      allLabel: 'Any',
    },
  ]
  const anyFilter = Boolean(filters.companyId || filters.actionId || filters.verificationStatus)

  let body
  if (list.isPending) body = <Loading variant="table" label="Loading impact records…" />
  else if (list.isError && !list.data)
    body = <ErrorState title="Could not load impact records" error={list.error} onRetry={() => list.refetch()} />
  else
    body = (
      <div className="space-y-4">
        {list.isError && (
          <ErrorState compact title="Could not refresh — showing the previous result" error={list.error} onRetry={() => list.refetch()} />
        )}
        <section aria-labelledby="impact-summary" className="space-y-2">
          <h2 id="impact-summary" className="text-sm font-semibold">
            Records by verification status{anyFilter ? ' (filtered)' : ''}
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VERIFICATION.map((v) => (
              <li key={v}>
                <button
                  type="button"
                  onClick={() => update({ verification: filters.verificationStatus === v ? undefined : v })}
                  aria-pressed={filters.verificationStatus === v}
                  className={cn(
                    'w-full rounded-lg border bg-surface p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    filters.verificationStatus === v ? 'border-foreground' : 'border-border',
                  )}
                >
                  <VerificationBadge status={v} />
                  <p className="mt-1 text-xl font-semibold tabular">{counts[v]}</p>
                  <p className="text-xs text-muted-foreground">{counts[v] === 1 ? 'record' : 'records'}</p>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Counts of records only. Baselines, targets, estimates and observed values are kept separate and are never added
            up; only verified records reflect a reviewed measurement — and verification does not prove the action caused the
            change.
          </p>
        </section>

        <DataTable
          data={list.data}
          columns={columns}
          getRowId={(r) => r.id}
          selectedRowId={recordId}
          caption="Impact records"
          onRowClick={(r) => setParam({ record: r.id, new: null })}
          emptyState={
            anyFilter ? (
              <EmptyState
                compact
                title="No impact records match these filters"
                action={
                  <Button variant="outline" size="sm" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                compact
                title="No impact records yet"
                description="Impact records are added to completed actions to track baseline, target and observed outcome."
              />
            )
          }
        />
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Impact Tracking"
        description="Baseline, target, estimate and observed outcome for each action, with independent verification."
        actions={
          <Button onClick={() => setParam({ new: '1', record: null })}>
            <Plus aria-hidden />
            New impact record
          </Button>
        }
      />
      <FilterBar
        filters={filterDefs}
        onFilterChange={(id, value) => update({ [id]: value } as Partial<Record<FilterKey, string | undefined>>)}
        onClear={clear}
      />
      {body}

      <CreateImpactDialog
        open={createOpen}
        actionId={filters.actionId}
        onClose={() => setParam({ new: null })}
        onCreated={(r) => setParam({ new: null, record: r.id })}
      />
      {recordId && (
        <ImpactRecordDrawer
          recordId={recordId}
          record={all.data?.find((r) => r.id === recordId)}
          loading={all.isPending}
          error={all.isError ? all.error : null}
          onRetry={() => all.refetch()}
          onClose={() => setParam({ record: null })}
        />
      )}
    </div>
  )
}
