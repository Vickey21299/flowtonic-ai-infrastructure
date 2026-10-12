import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ClipboardList, Search, SearchX } from 'lucide-react'
import { api } from '@/api'
import { isApiError } from '@/api/errors'
import type { ExceptionDetail, ExceptionStatus, ExceptionTransitionRequest, ResolutionReason } from '@/api/types'
import { DetailDrawer } from '@/components/DetailDrawer'
import { MetricValue } from '@/components/MetricValue'
import { ActionStatusBadge, ExceptionStatusBadge, ReviewStatusBadge, SeverityBadge } from '@/components/StatusBadges'
import { TraceView } from '@/components/TraceView'
import { VarianceValue } from '@/components/VarianceValue'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  exceptionStatusLabel,
  formatDate,
  formatDateTime,
  formatPeriod,
  resolutionReasonLabel,
  toOptions,
} from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { linkWithPeriod, usePeriodParam } from '../urlState'
import { metricUnit, varianceUnit } from './exceptionMeta'

const notFoundError = (e: unknown) => isApiError(e) && e.code === 'not_found'

export function ExceptionDrawer() {
  const { exceptionId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const query = useQuery({
    queryKey: queryKeys.exception(exceptionId),
    queryFn: () => api.getException(exceptionId),
    retry: (count, err) => !notFoundError(err) && count < 2,
  })

  // Back to the list with the same filters.
  const close = () => navigate(`/exceptions${location.search}`)

  const d = query.data
  return (
    <DetailDrawer
      open
      onClose={close}
      eyebrow={
        <>
          <span className="font-mono">{exceptionId}</span>
          {d && <SeverityBadge severity={d.severity} />}
          {d && <ExceptionStatusBadge status={d.status} conditionActive={d.conditionActive} />}
        </>
      }
      title={d ? `${d.metricLabel} — ${d.companyName}` : query.isError && notFoundError(query.error) ? 'Exception not found' : 'Exception'}
      description={d ? `Reporting period ${formatPeriod(d.period)} · rule ${d.ruleLabel}` : undefined}
      footer={d ? <DrawerFooter detail={d} /> : undefined}
    >
      {query.isPending ? (
        <Loading variant="inline" label="Loading exception…" />
      ) : query.isError ? (
        notFoundError(query.error) ? (
          <EmptyState
            icon={<SearchX />}
            title={`No exception with id “${exceptionId}”`}
            description="It may have been removed, or the link is incorrect."
            action={
              <Button variant="outline" size="sm" onClick={close}>
                Back to exceptions
              </Button>
            }
          />
        ) : (
          <ErrorState title="Could not load this exception" error={query.error} onRetry={() => query.refetch()} />
        )
      ) : (
        <ExceptionBody detail={query.data} />
      )}
    </DetailDrawer>
  )
}

// ---------- Body ----------

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ExceptionBody({ detail: d }: { detail: ExceptionDetail }) {
  const period = usePeriodParam()
  const trace = useQuery({ queryKey: queryKeys.exceptionTrace(d.id), queryFn: () => api.getExceptionTrace(d.id) })
  const unit = metricUnit(d.metricKey)
  const obsPeriods = new Set(d.relatedObservations.map((o) => o.period))

  return (
    <div className="space-y-6">
      {!d.conditionActive && d.status !== 'resolved' && (
        <Alert variant="warning" title="Condition cleared — review">
          The latest data no longer breaches this rule. The exception stays {exceptionStatusLabel[d.status].toLowerCase()}{' '}
          until someone resolves it.
        </Alert>
      )}

      <Block title="Metric">
        <Fields
          rows={[
            ['Company', <Link key="c" className="underline-offset-4 hover:underline" to={linkWithPeriod(`/companies/${encodeURIComponent(d.companyId)}`, period)}>{d.companyName}</Link>],
            ['Metric', d.metricLabel],
            ['Reporting period', formatPeriod(d.period)],
            ['Severity', <SeverityBadge key="s" severity={d.severity} />],
            ['Status', <ExceptionStatusBadge key="st" status={d.status} conditionActive={d.conditionActive} />],
            ['Owner', d.owner ?? <span className="text-muted-foreground">Unassigned</span>],
            ['Created', formatDateTime(d.createdAt)],
          ]}
        />
      </Block>

      <Block title="Actual vs comparison">
        <div className="grid grid-cols-3 gap-3">
          <ValueTile label="Actual">
            <MetricValue value={d.actualValue} unit={unit} />
          </ValueTile>
          <ValueTile label="Plan">
            <MetricValue value={d.planValue} unit={unit} />
          </ValueTile>
          <ValueTile label="Variance">
            <VarianceValue value={d.variancePct} unit={varianceUnit(d.kpiKey)} />
          </ValueTile>
        </div>
      </Block>

      <Block title="Calculation">
        <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm">
          <p className="text-muted-foreground">{d.calculation.formula}</p>
          <p>{d.calculation.substituted}</p>
          <p className="font-semibold">= {d.calculation.result || '—'}</p>
        </div>
      </Block>

      <Block title="Rule and threshold">
        <Fields
          rows={[
            ['Rule', d.ruleLabel],
            ['Rule key', <span key="k" className="font-mono text-xs">{d.ruleKey}</span>],
            ['Threshold', <VarianceValue key="t" value={d.threshold} unit={varianceUnit(d.kpiKey)} />],
            ['Rule configuration', `Version ${d.ruleConfigurationVersion}`],
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Thresholds are demo assumptions and can be changed in{' '}
          <Link to="/settings" className="underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      </Block>

      <Block title="Source data and freshness">
        <Fields
          rows={[
            ['Source', d.source.sourceName],
            ['Source updated', formatDateTime(d.source.sourceUpdatedAt)],
            ['File', <span key="f" className="font-mono text-xs">{d.source.fileName}</span>],
            ['Row', String(d.source.sourceRow)],
            ['Import job', <span key="j" className="font-mono text-xs">{d.source.importJobId}</span>],
            ['Imported at', formatDateTime(d.source.importedAt)],
          ]}
        />
      </Block>

      <Block title="Related observations">
        {d.relatedObservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stored observations for this metric.</p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {d.relatedObservations.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {formatPeriod(o.period)} · {o.metricKey === d.metricKey ? d.metricLabel : o.metricKey}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span>
                      Actual <MetricValue value={o.actualValue} unit={metricUnit(o.metricKey)} />
                    </span>
                    <span>
                      Plan <MetricValue value={o.planValue} unit={metricUnit(o.metricKey)} />
                    </span>
                    {o.isCurrent ? <Badge variant="neutral">Current</Badge> : <Badge variant="outline">Superseded</Badge>}
                  </span>
                </li>
              ))}
            </ul>
            {obsPeriods.size <= 1 && (
              <p className="text-xs text-muted-foreground">
                Only one reporting period is stored, so no historical comparison is available.
              </p>
            )}
          </>
        )}
      </Block>

      <Block title="Investigations and actions">
        {d.investigations.length === 0 && d.actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No investigations or actions yet. Use “Investigate” below to start one.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {d.investigations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <Link to={linkWithPeriod(`/investigations/${encodeURIComponent(i.id)}`, period)} className="font-medium underline-offset-4 hover:underline">
                  {i.id}
                </Link>
                <Badge variant={i.mode === 'mock' ? 'inverse' : 'warning'}>{i.mode === 'mock' ? 'Mock — not AI' : 'AI-generated'}</Badge>
                <ReviewStatusBadge status={i.reviewStatus} />
                <span className="text-xs text-muted-foreground">{formatDateTime(i.createdAt)}</span>
              </li>
            ))}
            {d.actions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <Link to={linkWithPeriod(`/actions/${encodeURIComponent(a.id)}`, period)} className="font-medium underline-offset-4 hover:underline">
                  {a.title}
                </Link>
                <ActionStatusBadge status={a.status} overdue={a.isOverdue} />
                <span className="text-xs text-muted-foreground">due {formatDate(a.dueDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Why was this triggered?">
        {trace.isPending ? (
          <Loading variant="inline" label="Loading trace…" />
        ) : trace.isError ? (
          <ErrorState compact title="Could not load the trace" error={trace.error} onRetry={() => trace.refetch()} />
        ) : (
          <TraceView steps={trace.data} label={`Calculation trace for ${d.id}`} />
        )}
      </Block>

      <WorkflowPanel detail={d} />

      <Block title="History">
        {d.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history recorded.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {[...d.history].reverse().map((h) => (
              <li key={h.id} className="border-l-2 border-border pl-3">
                <p className="font-medium">{h.event}</p>
                {h.detail && <p className="text-muted-foreground">{h.detail}</p>}
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(h.at)} · {h.actor}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Block>
    </div>
  )
}

function ValueTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{children}</p>
    </div>
  )
}

// ---------- Workflow ----------

function useInvalidateExceptionData() {
  const qc = useQueryClient()
  return () =>
    Promise.all(
      [['exception'], ['exceptions'], ['overview'], ['companies'], ['company']].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    )
}

function WorkflowPanel({ detail: d }: { detail: ExceptionDetail }) {
  const invalidate = useInvalidateExceptionData()
  const [form, setForm] = useState<null | 'assign' | 'resolve'>(null)
  const [owner, setOwner] = useState(d.owner ?? '')
  const [reason, setReason] = useState<ResolutionReason | ''>('')
  const [note, setNote] = useState('')
  const [clientError, setClientError] = useState<{ field: string; message: string } | null>(null)

  const mutation = useMutation({
    mutationFn: (req: ExceptionTransitionRequest) => api.transitionException(d.id, req),
    onSuccess: async () => {
      setForm(null)
      setNote('')
      setReason('')
      await invalidate()
    },
  })

  // Offered transitions come from the backend's state machine.
  const offered = d.allowedTransitions
  const apiErr = isApiError(mutation.error) ? mutation.error : null
  const fieldError = (field: string) =>
    (clientError?.field === field ? clientError.message : undefined) ??
    apiErr?.fieldErrors.find((f) => f.field === field)?.message

  const run = (req: ExceptionTransitionRequest) => {
    setClientError(null)
    mutation.mutate(req)
  }

  const openForm = (f: 'assign' | 'resolve') => {
    mutation.reset()
    setClientError(null)
    setForm(f)
  }

  const submitAssign = () => {
    if (!owner.trim()) return setClientError({ field: 'owner', message: 'Enter an owner for the review.' })
    run({ to: 'in_review', owner: owner.trim() })
  }
  const submitResolve = () => {
    if (!reason) return setClientError({ field: 'reason', message: 'Choose a resolution reason.' })
    run({ to: 'resolved', reason, note: note.trim() || undefined })
  }

  const pending = mutation.isPending
  const ownerErr = fieldError('owner')
  const reasonErr = fieldError('reason')
  const generalError =
    mutation.error && (!apiErr || apiErr.fieldErrors.length === 0) ? mutation.error : null

  return (
    <Block title="Workflow">
      <p className="text-sm text-muted-foreground">
        Current status: <span className="font-medium text-foreground">{exceptionStatusLabel[d.status]}</span>
        {d.status === 'resolved' && d.resolutionReason && (
          <>
            {' '}
            · reason: {resolutionReasonLabel[d.resolutionReason]}
            {d.resolutionNote && <> · “{d.resolutionNote}”</>}
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        {offered.includes('acknowledged') && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run({ to: 'acknowledged' })}>
            Acknowledge
          </Button>
        )}
        {offered.includes('in_review') && (
          <Button variant={form === 'assign' ? 'default' : 'outline'} size="sm" disabled={pending} aria-expanded={form === 'assign'} onClick={() => openForm('assign')}>
            Assign for review
          </Button>
        )}
        {offered.includes('resolved') && (
          <Button variant={form === 'resolve' ? 'default' : 'outline'} size="sm" disabled={pending} aria-expanded={form === 'resolve'} onClick={() => openForm('resolve')}>
            Resolve
          </Button>
        )}
        {offered.includes('open') && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run({ to: 'open' })}>
            Reopen
          </Button>
        )}
      </div>

      {form === 'assign' && (
        <form
          className="space-y-2 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            submitAssign()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="exc-owner">Owner (required)</Label>
            <Input
              id="exc-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              aria-invalid={Boolean(ownerErr)}
              aria-describedby={ownerErr ? 'exc-owner-err' : undefined}
              placeholder="e.g. Jordan Lee"
            />
            {ownerErr && (
              <p id="exc-owner-err" className="text-xs text-status-danger">
                {ownerErr}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Put in review'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {form === 'resolve' && (
        <form
          className="space-y-2 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            submitResolve()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="exc-reason">Resolution reason (required)</Label>
            <NativeSelect
              id="exc-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as ResolutionReason | '')}
              aria-invalid={Boolean(reasonErr)}
              aria-describedby={reasonErr ? 'exc-reason-err' : undefined}
            >
              <option value="">Choose a reason…</option>
              {toOptions(resolutionReasonLabel).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            {reasonErr && (
              <p id="exc-reason-err" className="text-xs text-status-danger">
                {reasonErr}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="exc-note">Note (optional)</Label>
            <Textarea id="exc-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Resolve exception'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {generalError && (
        <ErrorState
          compact
          title={apiErr?.code === 'invalid_transition' ? 'That status change is not allowed' : 'Could not update the exception'}
          error={generalError}
        />
      )}
      {apiErr?.code === 'invalid_transition' && apiErr.allowedTransitions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Allowed from {exceptionStatusLabel[d.status].toLowerCase()}:{' '}
          {apiErr.allowedTransitions.map((t) => exceptionStatusLabel[t as ExceptionStatus] ?? t).join(', ')}.
        </p>
      )}
    </Block>
  )
}

// ---------- Footer: investigate / create action ----------

function DrawerFooter({ detail: d }: { detail: ExceptionDetail }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const period = usePeriodParam()
  const workspace = useQuery({ queryKey: queryKeys.workspace, queryFn: () => api.getWorkspace() })

  const generate = useMutation({
    mutationFn: (mode: 'live' | 'mock') => api.generateInvestigation(d.id, mode),
    onSuccess: async (inv) => {
      await Promise.all(
        [['investigations'], ['investigation'], ['exception', d.id], ['company']].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      )
      navigate(linkWithPeriod(`/investigations/${encodeURIComponent(inv.id)}`, period))
    },
  })

  const latest = [...d.investigations].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const providerDown = isApiError(generate.error) && generate.error.code === 'provider_unavailable'
  const mode = workspace.data?.aiMode ?? 'mock'

  return (
    <div className="w-full space-y-2">
      {generate.isError && (
        <Alert
          variant="danger"
          title={providerDown ? 'AI provider unavailable' : 'Could not start the investigation'}
          action={
            providerDown ? (
              <Button size="sm" variant="outline" onClick={() => generate.mutate('mock')} disabled={generate.isPending}>
                Use mock investigation
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => generate.mutate(mode)} disabled={generate.isPending}>
                Retry
              </Button>
            )
          }
        >
          {generate.error instanceof Error ? generate.error.message : 'Unexpected error.'}
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() =>
            navigate(linkWithPeriod('/actions', period, { new: '1', exceptionId: d.id }))
          }
        >
          Create action
        </Button>
        {latest ? (
          <>
            <Button variant="outline" disabled={!workspace.data || generate.isPending} onClick={() => generate.mutate(mode)}>
              {generate.isPending ? 'Generating…' : 'Run new investigation'}
            </Button>
            <Button asChild>
              <Link to={linkWithPeriod(`/investigations/${encodeURIComponent(latest.id)}`, period)}>Open investigation</Link>
            </Button>
          </>
        ) : (
          <Button disabled={!workspace.data || generate.isPending} onClick={() => generate.mutate(mode)}>
            <Search aria-hidden />
            {generate.isPending ? 'Generating…' : 'Investigate'}
          </Button>
        )}
      </div>
    </div>
  )
}
