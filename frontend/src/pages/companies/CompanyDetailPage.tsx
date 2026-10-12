import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, SearchX } from 'lucide-react'
import { api } from '@/api'
import { isApiError } from '@/api/errors'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadges'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTime, formatPeriod } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { PERIOD_PARAM, linkWithPeriod, oneOf, useUrlFilters } from '../urlState'
import { ActionsTab, DataHistoryTab, ExceptionsTab, InvestigationsTab, PerformanceTab } from './CompanyDetailTabs'

const TABS = ['performance', 'exceptions', 'investigations', 'actions', 'data'] as const
type Tab = (typeof TABS)[number]
const DEFAULT_TAB: Tab = 'performance'
const URL_KEYS = ['tab', PERIOD_PARAM] as const

export function CompanyDetailPage() {
  const { companyId = '' } = useParams()
  const { values, update } = useUrlFilters(URL_KEYS)
  const period = values.period
  const tab: Tab = oneOf(values.tab, TABS) ?? DEFAULT_TAB

  const workspace = useQuery({ queryKey: queryKeys.workspace, queryFn: () => api.getWorkspace() })
  const query = useQuery({
    queryKey: queryKeys.company(companyId),
    queryFn: () => api.getCompany(companyId),
    // A missing company will not appear by retrying.
    retry: (count, err) => !(isApiError(err) && err.code === 'not_found') && count < 2,
  })

  const backLink = (
    <Link
      to={linkWithPeriod('/companies', period)}
      className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Portfolio companies
    </Link>
  )

  if (query.isPending) return <Loading label="Loading company…" />

  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.code === 'not_found'
    return (
      <div className="space-y-6">
        <PageHeader title={notFound ? 'Company not found' : 'Company'} eyebrow={backLink} />
        {notFound ? (
          <EmptyState
            icon={<SearchX />}
            title={`No company with id “${companyId}”`}
            description="It may have been removed, or the link is incorrect."
            action={
              <Button asChild variant="outline" size="sm">
                <Link to={linkWithPeriod('/companies', period)}>Back to portfolio companies</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title="Could not load this company" error={query.error} onRetry={() => query.refetch()} />
        )}
      </div>
    )
  }

  const detail = query.data
  const c = detail.company
  const moneyUnit = workspace.data?.unit
  const tabProps = { detail, period, moneyUnit }
  const periodMismatch = period !== undefined && period !== c.period

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={backLink}
        title={c.name}
        description={c.sector}
        actions={<StatusBadge status={c.status} className="text-sm" />}
        meta={
          <>
            <span>
              Reporting period: <span className="font-medium text-foreground">{formatPeriod(c.period)}</span>
            </span>
            <span aria-hidden>·</span>
            <span>Last data update: {formatDateTime(c.lastDataUpdate)}</span>
            <span aria-hidden>·</span>
            <span>
              Active exceptions: <span className="font-medium text-foreground tabular">{c.openExceptions}</span>
            </span>
            <span aria-hidden>·</span>
            <span>
              Open actions: <span className="font-medium text-foreground tabular">{c.openActions}</span>
            </span>
          </>
        }
      />

      {periodMismatch && (
        <p role="note" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {formatPeriod(period)} is selected in the header; this page shows the company’s latest stored period,{' '}
          {formatPeriod(c.period)}.
        </p>
      )}

      <Tabs value={tab} onValueChange={(v) => update({ tab: v === DEFAULT_TAB ? undefined : v }, { replace: true })}>
        <TabsList aria-label="Company sections">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="exceptions">
            Exceptions <Count n={detail.exceptions.length} />
          </TabsTrigger>
          <TabsTrigger value="investigations">
            Investigations <Count n={detail.investigations.length} />
          </TabsTrigger>
          <TabsTrigger value="actions">
            Actions <Count n={detail.actions.length} />
          </TabsTrigger>
          <TabsTrigger value="data">
            Data history <Count n={detail.dataHistory.length} />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="performance">
          <PerformanceTab {...tabProps} />
        </TabsContent>
        <TabsContent value="exceptions">
          <ExceptionsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="investigations">
          <InvestigationsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="actions">
          <ActionsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="data">
          <DataHistoryTab {...tabProps} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Count({ n }: { n: number }) {
  return <span className="rounded bg-muted px-1.5 text-xs tabular text-muted-foreground">{n}</span>
}
