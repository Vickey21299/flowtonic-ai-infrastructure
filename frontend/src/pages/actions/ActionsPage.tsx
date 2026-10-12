import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api } from '@/api'
import type { ActionFilters, ActionStatus, ActionSummary, Priority } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { FilterBar, type FilterDef } from '@/components/FilterBar'
import { PageHeader } from '@/components/PageHeader'
import { ActionStatusBadge, PriorityBadge, VerificationBadge } from '@/components/StatusBadges'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Button } from '@/components/ui/button'
import { actionStatusLabel, formatDate, formatDateTime, priorityLabel, toOptions } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { cn } from '@/lib/utils'
import { AWAITING_VERIFICATION_STATUS, linkWithPeriod, oneOf, usePeriodParam, useUrlFilters } from '../urlState'
import { CreateActionDialog } from './CreateActionDialog'
import { NEW_ACTION_PARAMS } from './actionShared'

const STATUSES = [...(Object.keys(actionStatusLabel) as ActionStatus[]), AWAITING_VERIFICATION_STATUS] as const
const PRIORITIES = Object.keys(priorityLabel) as Priority[]
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
const FILTER_KEYS = ['status', 'priority', 'owner', 'company', 'overdue'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

function QuickChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-9 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-foreground bg-foreground text-background' : 'border-border bg-surface hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

export function ActionsPage() {
  const navigate = useNavigate()
  const period = usePeriodParam()
  const [params, setParams] = useSearchParams()
  const selected = useMatch('/actions/:actionId')?.params.actionId ?? null
  const { values, update, clear } = useUrlFilters(FILTER_KEYS)

  const filters: ActionFilters = {
    status: oneOf(values.status, STATUSES),
    priority: oneOf(values.priority, PRIORITIES),
    owner: values.owner,
    companyId: values.company,
    overdue: values.overdue === '1' ? true : undefined,
  }

  const companies = useQuery({ queryKey: queryKeys.companies({}), queryFn: () => api.listCompanies({}) })
  const all = useQuery({ queryKey: queryKeys.actions({}), queryFn: () => api.listActions({}) })
  const list = useQuery({
    queryKey: queryKeys.actions(filters),
    queryFn: () => api.listActions(filters),
    placeholderData: keepPreviousData,
  })

  const owners = useMemo(() => {
    const set = new Set((all.data ?? []).map((a) => a.owner).filter((o): o is string => Boolean(o)))
    if (filters.owner) set.add(filters.owner)
    return [...set].sort()
  }, [all.data, filters.owner])

  // ---- create form (URL driven: ?new=1&exceptionId=…&investigationId=…&title=…) ----
  const createOpen = params.get('new') === '1'
  const prefill = {
    exceptionId: params.get('exceptionId') || undefined,
    investigationId: params.get('investigationId') || undefined,
    title: params.get('title') || undefined,
  }
  const withoutNewParams = () => {
    const next = new URLSearchParams(params)
    for (const k of NEW_ACTION_PARAMS) next.delete(k)
    return next
  }
  const openCreate = () => {
    const next = withoutNewParams()
    next.set('new', '1')
    setParams(next)
  }
  const closeCreate = () => setParams(withoutNewParams())

  const keepSearch = () => {
    const qs = withoutNewParams().toString()
    return qs ? `?${qs}` : ''
  }

  const columns: Column<ActionSummary>[] = [
    { id: 'id', header: 'ID', cell: (a) => <span className="font-mono text-xs">{a.id}</span>, sortValue: (a) => a.id, hideBelow: 'xl' },
    { id: 'title', header: 'Action', cell: (a) => <span className="font-medium">{a.title}</span>, sortValue: (a) => a.title, className: 'min-w-[12rem]' },
    {
      id: 'company',
      header: 'Company',
      cell: (a) => (
        <Link
          to={linkWithPeriod(`/companies/${encodeURIComponent(a.companyId)}`, period)}
          onClick={(e) => e.stopPropagation()}
          className="underline-offset-4 hover:underline"
        >
          {a.companyName}
        </Link>
      ),
      sortValue: (a) => a.companyName,
      hideBelow: 'md',
    },
    {
      id: 'exception',
      header: 'Exception',
      cell: (a) => (
        <Link
          to={linkWithPeriod(`/exceptions/${encodeURIComponent(a.exceptionId)}`, period)}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs underline underline-offset-4"
        >
          {a.exceptionId}
        </Link>
      ),
      sortValue: (a) => a.exceptionId,
      hideBelow: 'lg',
    },
    { id: 'status', header: 'Status', cell: (a) => <ActionStatusBadge status={a.status} overdue={a.isOverdue} />, sortValue: (a) => a.status },
    { id: 'priority', header: 'Priority', cell: (a) => <PriorityBadge priority={a.priority} />, sortValue: (a) => PRIORITY_RANK[a.priority], hideBelow: 'sm' },
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
      cell: (a) => (
        <span className={cn('whitespace-nowrap', a.isOverdue && 'font-medium text-status-danger')}>
          {formatDate(a.dueDate)}
          {a.isOverdue && <span className="sr-only"> (overdue)</span>}
        </span>
      ),
      sortValue: (a) => a.dueDate,
      hideBelow: 'sm',
    },
    { id: 'verification', header: 'Outcome', cell: (a) => <VerificationBadge status={a.verificationStatus} />, sortValue: (a) => a.verificationStatus, hideBelow: 'lg' },
    {
      id: 'created',
      header: 'Created',
      cell: (a) => <span className="whitespace-nowrap">{formatDateTime(a.createdAt)}</span>,
      sortValue: (a) => a.createdAt,
      hideBelow: 'xl',
    },
  ]

  const filterDefs: FilterDef[] = [
    {
      id: 'status',
      label: 'Status',
      value: filters.status,
      options: [
        { value: AWAITING_VERIFICATION_STATUS, label: 'Awaiting outcome verification (completed + outcome verification)' },
        ...toOptions(actionStatusLabel),
      ],
      allLabel: 'All statuses',
    },
    { id: 'priority', label: 'Priority', value: filters.priority, options: toOptions(priorityLabel), allLabel: 'All priorities' },
    { id: 'owner', label: 'Owner', value: filters.owner, options: owners.map((o) => ({ value: o, label: o })), allLabel: 'Any owner' },
    {
      id: 'company',
      label: 'Company',
      value: filters.companyId,
      options: (companies.data ?? []).map((c) => ({ value: c.id, label: c.name })),
      allLabel: 'All companies',
    },
  ]
  const anyFilter = Boolean(filters.status || filters.priority || filters.owner || filters.companyId || filters.overdue)

  let body
  if (list.isPending) body = <Loading variant="table" label="Loading actions…" />
  else if (list.isError && !list.data)
    body = <ErrorState title="Could not load actions" error={list.error} onRetry={() => list.refetch()} />
  else
    body = (
      <div className="space-y-2">
        {list.isError && (
          <ErrorState compact title="Could not refresh — showing the previous result" error={list.error} onRetry={() => list.refetch()} />
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <p>
            {list.data.length} {list.data.length === 1 ? 'action' : 'actions'}
          </p>
          {list.isFetching && <span role="status">Updating…</span>}
        </div>
        <DataTable
          data={list.data}
          columns={columns}
          getRowId={(a) => a.id}
          selectedRowId={selected}
          caption="Actions"
          initialSort={{ id: 'due', direction: 'asc' }}
          onRowClick={(a) => navigate(`/actions/${encodeURIComponent(a.id)}${keepSearch()}`)}
          emptyState={
            anyFilter ? (
              <EmptyState
                compact
                title="No actions match these filters"
                action={
                  <Button variant="outline" size="sm" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                compact
                title="No actions yet"
                description="Create an action from an exception or an investigation, or use “New action”."
              />
            )
          }
        />
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Actions"
        description="Remediation actions with owners, due dates and evidence. Outcomes are verified separately on the Impact page."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden />
            New action
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick filters">
        <QuickChip active={Boolean(filters.overdue)} onClick={() => update({ overdue: filters.overdue ? undefined : '1' })}>
          Overdue
        </QuickChip>
        <QuickChip
          active={filters.priority === 'high'}
          onClick={() => update({ priority: filters.priority === 'high' ? undefined : 'high' })}
        >
          High priority
        </QuickChip>
      </div>
      <FilterBar
        filters={filterDefs}
        onFilterChange={(id, value) => update({ [id]: value } as Partial<Record<FilterKey, string | undefined>>)}
        onClear={clear}
      />
      {body}
      <CreateActionDialog
        open={createOpen}
        prefill={prefill}
        onClose={closeCreate}
        onCreated={(a) => navigate(`/actions/${encodeURIComponent(a.id)}${keepSearch()}`)}
      />
      <Outlet />
    </div>
  )
}
