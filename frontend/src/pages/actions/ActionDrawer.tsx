import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Check, PencilLine, SearchX } from 'lucide-react'
import { api } from '@/api'
import { isApiError, type ApiError } from '@/api/errors'
import type { ActionDetail, ActionStatus, ActionTransitionRequest, ActionUpdateInput, EvidenceItem, Priority } from '@/api/types'
import { DetailDrawer } from '@/components/DetailDrawer'
import { MetricValue } from '@/components/MetricValue'
import { ActionStatusBadge, PriorityBadge, VerificationBadge } from '@/components/StatusBadges'
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
import { actionStatusLabel, formatDate, formatDateTime, formatPeriod, humanize, priorityLabel, toOptions } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { cn } from '@/lib/utils'
import { linkWithPeriod, usePeriodParam } from '../urlState'
import { ACTION_PATH, NEW_ACTION_PARAMS, transitionLabel, useInvalidateActionData } from './actionShared'

const isNotFound = (e: unknown) => isApiError(e) && e.code === 'not_found'

export function ActionDrawer() {
  const { actionId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const query = useQuery({
    queryKey: queryKeys.action(actionId),
    queryFn: () => api.getAction(actionId),
    retry: (count, err) => !isNotFound(err) && count < 2,
  })

  const close = () => {
    const sp = new URLSearchParams(location.search)
    for (const k of NEW_ACTION_PARAMS) sp.delete(k)
    const qs = sp.toString()
    navigate(`/actions${qs ? `?${qs}` : ''}`)
  }
  const a = query.data

  return (
    <DetailDrawer
      open
      onClose={close}
      eyebrow={
        <>
          <span className="font-mono">{actionId}</span>
          {a && <ActionStatusBadge status={a.status} overdue={a.isOverdue} />}
          {a && <PriorityBadge priority={a.priority} />}
        </>
      }
      title={a ? a.title : query.isError && isNotFound(query.error) ? 'Action not found' : 'Action'}
    >
      {query.isPending ? (
        <Loading variant="inline" label="Loading action…" />
      ) : query.isError ? (
        isNotFound(query.error) ? (
          <EmptyState
            icon={<SearchX />}
            title={`No action with id “${actionId}”`}
            description="It may have been removed, or the link is incorrect."
            action={
              <Button variant="outline" size="sm" onClick={close}>
                Back to actions
              </Button>
            }
          />
        ) : (
          <ErrorState title="Could not load this action" error={query.error} onRetry={() => query.refetch()} />
        )
      ) : (
        <ActionBody key={query.data.id} action={query.data} />
      )}
    </DetailDrawer>
  )
}

// ---------- helpers ----------

function Block({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

function FieldMsg({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-xs text-status-danger">
      {message}
    </p>
  )
}

const fieldErr = (error: unknown, field: string) =>
  isApiError(error) ? error.fieldErrors.find((f) => f.field === field)?.message : undefined

/** Error box for a failed mutation, including 409 allowed transitions. Never looks like success. */
function MutationError({ error, title, shownFields = [] }: { error: unknown; title: string; shownFields?: string[] }) {
  if (!error) return null
  const api: ApiError | null = isApiError(error) ? error : null
  const rest = api?.fieldErrors.filter((f) => !shownFields.includes(f.field)) ?? []
  if (api && api.fieldErrors.length > 0 && rest.length === 0) return null
  return (
    <div className="space-y-1">
      <ErrorState compact title={api?.code === 'invalid_transition' ? 'That status change is not allowed' : title} error={error} />
      {api?.code === 'invalid_transition' && (
        <p className="text-xs text-muted-foreground">
          Allowed from here:{' '}
          {api.allowedTransitions.length
            ? api.allowedTransitions.map((t) => actionStatusLabel[t as ActionStatus] ?? t).join(', ')
            : 'none (final state)'}
          .
        </p>
      )}
    </div>
  )
}

// ---------- body ----------

function ActionBody({ action: a }: { action: ActionDetail }) {
  const period = usePeriodParam()
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
        <dt className="text-muted-foreground">Company</dt>
        <dd>
          <Link className="underline-offset-4 hover:underline" to={linkWithPeriod(`/companies/${encodeURIComponent(a.companyId)}`, period)}>
            {a.companyName}
          </Link>
        </dd>
        <dt className="text-muted-foreground">Exception</dt>
        <dd>
          <Link className="font-mono underline underline-offset-4" to={linkWithPeriod(`/exceptions/${encodeURIComponent(a.exceptionId)}`, period)}>
            {a.exceptionId}
          </Link>
        </dd>
        <dt className="text-muted-foreground">Investigation</dt>
        <dd>
          {a.investigationId ? (
            <Link className="font-mono underline underline-offset-4" to={linkWithPeriod(`/investigations/${encodeURIComponent(a.investigationId)}`, period)}>
              {a.investigationId}
            </Link>
          ) : (
            <span className="text-muted-foreground">None linked</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd>{formatDateTime(a.createdAt)}</dd>
        <dt className="text-muted-foreground">Last updated</dt>
        <dd>{formatDateTime(a.updatedAt)}</dd>
      </dl>

      <Details action={a} />
      <Workflow action={a} />
      <Evidence action={a} />
      <Notes action={a} />
      <Impacts action={a} />

      <Block title="History">
        {a.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history recorded.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {[...a.history].reverse().map((h) => (
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

// ---------- details (view / edit) ----------

function Details({ action: a }: { action: ActionDetail }) {
  const invalidate = useInvalidateActionData()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    title: a.title,
    description: a.description,
    priority: a.priority,
    owner: a.owner ?? '',
    dueDate: a.dueDate ?? '',
  })
  // Final states (no further transitions) can no longer be edited.
  const locked = a.allowedTransitions.length === 0

  const save = useMutation({
    mutationFn: (patch: ActionUpdateInput) => api.updateAction(a.id, patch),
    onSuccess: async () => {
      setEditing(false)
      await invalidate()
    },
  })

  const startEdit = () => {
    setForm({ title: a.title, description: a.description, priority: a.priority, owner: a.owner ?? '', dueDate: a.dueDate ?? '' })
    save.reset()
    setEditing(true)
  }

  const submit = () =>
    save.mutate({
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
      owner: form.owner.trim() || null,
      dueDate: form.dueDate || null,
    })

  const e = (f: string) => fieldErr(save.error, f)

  if (!editing) {
    return (
      <Block
        title="Details"
        actions={
          locked ? (
            <span className="text-xs text-muted-foreground">
              {actionStatusLabel[a.status]} actions can no longer be edited.
            </span>
          ) : (
            <Button size="sm" variant="outline" onClick={startEdit}>
              <PencilLine aria-hidden />
              Edit details
            </Button>
          )
        }
      >
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
          <dt className="text-muted-foreground">Description</dt>
          <dd className="whitespace-pre-line">{a.description || <span className="text-muted-foreground">—</span>}</dd>
          <dt className="text-muted-foreground">Priority</dt>
          <dd>
            <PriorityBadge priority={a.priority} />
          </dd>
          <dt className="text-muted-foreground">Owner</dt>
          <dd>{a.owner ?? <span className="text-muted-foreground">Unassigned</span>}</dd>
          <dt className="text-muted-foreground">Due date</dt>
          <dd className={cn(a.isOverdue && 'font-medium text-status-danger')}>
            {formatDate(a.dueDate)}
            {a.isOverdue && ' (overdue)'}
          </dd>
        </dl>
        {(!a.owner || !a.dueDate) && a.status === 'proposed' && (
          <p className="text-xs text-muted-foreground">An owner and a due date are required before approval.</p>
        )}
      </Block>
    )
  }

  return (
    <Block title="Edit details">
      <form
        className="space-y-3 rounded-md border border-border p-3"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault()
          submit()
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="act-title">Title</Label>
          <Input id="act-title" value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} aria-invalid={Boolean(e('title'))} aria-describedby={e('title') ? 'act-title-err' : undefined} />
          <FieldMsg id="act-title-err" message={e('title')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="act-desc">Description</Label>
          <Textarea id="act-desc" rows={3} value={form.description} onChange={(ev) => setForm({ ...form, description: ev.target.value })} />
          <FieldMsg id="act-desc-err" message={e('description')} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="act-priority">Priority</Label>
            <NativeSelect id="act-priority" value={form.priority} onChange={(ev) => setForm({ ...form, priority: ev.target.value as Priority })} aria-invalid={Boolean(e('priority'))} aria-describedby={e('priority') ? 'act-priority-err' : undefined}>
              {toOptions(priorityLabel).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <FieldMsg id="act-priority-err" message={e('priority')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="act-owner">Owner</Label>
            <Input id="act-owner" value={form.owner} onChange={(ev) => setForm({ ...form, owner: ev.target.value })} aria-invalid={Boolean(e('owner'))} aria-describedby={e('owner') ? 'act-owner-err' : undefined} />
            <FieldMsg id="act-owner-err" message={e('owner')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="act-due">Due date</Label>
            <Input id="act-due" type="date" value={form.dueDate} onChange={(ev) => setForm({ ...form, dueDate: ev.target.value })} aria-invalid={Boolean(e('dueDate'))} aria-describedby={e('dueDate') ? 'act-due-err' : undefined} />
            <FieldMsg id="act-due-err" message={e('dueDate')} />
          </div>
        </div>
        <MutationError error={save.error} title="Could not save the changes" shownFields={['title', 'description', 'priority', 'owner', 'dueDate']} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Block>
  )
}

// ---------- workflow ----------

function Stepper({ status }: { status: ActionStatus }) {
  const idx = ACTION_PATH.indexOf(status)
  return (
    <div className="space-y-2">
      <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Action lifecycle">
        {ACTION_PATH.map((s, i) => {
          const current = s === status
          const done = idx >= 0 && i < idx
          return (
            <li key={s} className="flex items-center gap-1">
              <span
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
                  current && 'border-foreground bg-foreground text-background font-medium',
                  done && 'border-status-success/40 text-status-success',
                  !current && !done && 'border-border text-muted-foreground',
                )}
              >
                {done && <Check className="h-3 w-3" aria-hidden />}
                {actionStatusLabel[s]}
                {done && <span className="sr-only"> (done)</span>}
              </span>
              {i < ACTION_PATH.length - 1 && <span className="text-muted-foreground" aria-hidden>→</span>}
            </li>
          )
        })}
      </ol>
      {(status === 'reopened' || status === 'cancelled') && (
        <p className="text-xs">
          Current state: <Badge variant={status === 'cancelled' ? 'outline' : 'warning'}>{actionStatusLabel[status]}</Badge>{' '}
          <span className="text-muted-foreground">(outside the main path)</span>
        </p>
      )}
    </div>
  )
}

type FormTarget = 'completed' | 'cancelled' | 'reopened' | null

function Workflow({ action: a }: { action: ActionDetail }) {
  const invalidate = useInvalidateActionData()
  const period = usePeriodParam()
  const [form, setForm] = useState<FormTarget>(null)
  const [text, setText] = useState('')

  const transition = useMutation({
    mutationFn: (req: ActionTransitionRequest) => api.transitionAction(a.id, req),
    onSuccess: async () => {
      setForm(null)
      setText('')
      await invalidate()
    },
  })

  const run = (to: ActionStatus) => {
    transition.reset()
    if (to === 'completed' || to === 'cancelled' || to === 'reopened') {
      setForm(to)
      setText('')
      return
    }
    setForm(null)
    transition.mutate({ to })
  }

  const submitForm = () => {
    if (!form) return
    transition.mutate(form === 'completed' ? { to: form, completionNotes: text } : { to: form, reason: text })
  }

  const textField = form === 'completed' ? 'completionNotes' : 'reason'
  const textErr = fieldErr(transition.error, textField)
  const evidenceErr = fieldErr(transition.error, 'evidence')
  const impactsErr = fieldErr(transition.error, 'impacts')
  const impactLink = linkWithPeriod('/impact', period, { action: a.id, new: '1' })

  return (
    <Block title="Status">
      <Stepper status={a.status} />

      {a.allowedTransitions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{actionStatusLabel[a.status]} is a final state; no further changes.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {a.allowedTransitions.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === 'cancelled' ? 'ghost' : form === to ? 'default' : 'outline'}
              aria-expanded={to === 'completed' || to === 'cancelled' || to === 'reopened' ? form === to : undefined}
              disabled={transition.isPending}
              onClick={() => run(to)}
            >
              {transitionLabel[to]}
            </Button>
          ))}
        </div>
      )}

      {a.allowedTransitions.includes('approved') && (!a.owner || !a.dueDate) && (
        <p className="text-xs text-muted-foreground">Approval needs an owner and a due date — use “Edit details”.</p>
      )}
      {a.allowedTransitions.includes('outcome_verification') && a.impacts.length === 0 && (
        <Alert variant="info" title="An impact record is needed first">
          Moving to outcome verification requires at least one impact record for this action.{' '}
          <Link to={impactLink} className="font-medium underline underline-offset-4">
            Add an impact record
          </Link>
          .
        </Alert>
      )}

      {form && (
        <form
          className="space-y-2 rounded-md border border-border p-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            submitForm()
          }}
        >
          {form === 'completed' && (
            <p className="text-xs text-muted-foreground">
              Completion requires notes and at least one evidence item ({a.evidence.length} recorded). Add evidence in the
              “Completion evidence” section below.
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="act-transition-text">{form === 'completed' ? 'Completion notes (required)' : `Reason to ${form === 'cancelled' ? 'cancel' : 'reopen'} (required)`}</Label>
            <Textarea
              id="act-transition-text"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={Boolean(textErr)}
              aria-describedby={textErr ? 'act-transition-text-err' : undefined}
            />
            <FieldMsg id="act-transition-text-err" message={textErr} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant={form === 'cancelled' ? 'destructive' : 'default'} disabled={transition.isPending}>
              {transition.isPending ? 'Saving…' : transitionLabel[form]}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>
              Back
            </Button>
          </div>
        </form>
      )}

      {evidenceErr && <Alert variant="danger" title="Evidence required">{evidenceErr}</Alert>}
      {impactsErr && (
        <Alert variant="danger" title="Impact record required">
          {impactsErr}{' '}
          <Link to={impactLink} className="font-medium underline underline-offset-4">
            Go to Impact
          </Link>
        </Alert>
      )}
      <MutationError error={transition.error} title="Could not change the status" shownFields={[textField, 'evidence', 'impacts']} />
    </Block>
  )
}

// ---------- evidence ----------

function Evidence({ action: a }: { action: ActionDetail }) {
  const invalidate = useInvalidateActionData()
  const [kind, setKind] = useState<EvidenceItem['kind']>('note')
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const add = useMutation({
    mutationFn: () => api.addActionEvidence(a.id, { kind, description, reference: reference.trim() || undefined }),
    onSuccess: async () => {
      setDescription('')
      setReference('')
      await invalidate()
    },
  })
  const e = (f: string) => fieldErr(add.error, f)

  return (
    <Block title={`Completion evidence (${a.evidence.length})`}>
      {a.evidence.length === 0 ? (
        <p className="text-sm text-muted-foreground">No evidence recorded. At least one item is needed to complete the action.</p>
      ) : (
        <ul className="space-y-2">
          {a.evidence.map((ev) => (
            <li key={ev.id} className="rounded-md border border-border p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{humanize(ev.kind)}</Badge>
                <span>{ev.description}</span>
              </div>
              {ev.reference && (
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {ev.kind === 'link' && /^https?:\/\//.test(ev.reference) ? (
                    <a href={ev.reference} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                      {ev.reference}
                    </a>
                  ) : (
                    ev.reference
                  )}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(ev.at)}</p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-[8rem_1fr]"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault()
          add.mutate()
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="ev-kind">Type</Label>
          <NativeSelect id="ev-kind" value={kind} onChange={(ev) => setKind(ev.target.value as EvidenceItem['kind'])}>
            <option value="note">Note</option>
            <option value="document_ref">Document reference</option>
            <option value="link">Link</option>
          </NativeSelect>
          <FieldMsg id="ev-kind-err" message={e('kind')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ev-desc">Description (required)</Label>
          <Input id="ev-desc" value={description} onChange={(ev) => setDescription(ev.target.value)} aria-invalid={Boolean(e('description'))} aria-describedby={e('description') ? 'ev-desc-err' : undefined} />
          <FieldMsg id="ev-desc-err" message={e('description')} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ev-ref">Reference{kind === 'note' ? ' (optional)' : ' (required for documents and links)'}</Label>
          <Input id="ev-ref" value={reference} onChange={(ev) => setReference(ev.target.value)} aria-invalid={Boolean(e('reference'))} aria-describedby={e('reference') ? 'ev-ref-err' : undefined} />
          <FieldMsg id="ev-ref-err" message={e('reference')} />
        </div>
        <div className="sm:col-span-2">
          <MutationError error={add.error} title="Could not add evidence" shownFields={['kind', 'description', 'reference']} />
          <Button type="submit" size="sm" variant="outline" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add evidence'}
          </Button>
        </div>
      </form>
    </Block>
  )
}

// ---------- notes ----------

function Notes({ action: a }: { action: ActionDetail }) {
  const invalidate = useInvalidateActionData()
  const [text, setText] = useState('')
  const add = useMutation({
    mutationFn: () => api.addActionNote(a.id, text),
    onSuccess: async () => {
      setText('')
      await invalidate()
    },
  })
  const err = fieldErr(add.error, 'text')
  return (
    <Block title="Progress notes">
      {a.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {a.notes.map((n) => (
            <li key={n.id} className="rounded-md border border-border p-2.5 text-sm">
              <p className="whitespace-pre-line">{n.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {n.author} · {formatDateTime(n.at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
      >
        <Label htmlFor="act-note">Add progress note</Label>
        <Textarea id="act-note" rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={Boolean(err)} aria-describedby={err ? 'act-note-err' : undefined} />
        <FieldMsg id="act-note-err" message={err} />
        <MutationError error={add.error} title="Could not add the note" shownFields={['text']} />
        <Button type="submit" size="sm" variant="outline" disabled={add.isPending || !text.trim()}>
          {add.isPending ? 'Adding…' : 'Add note'}
        </Button>
      </form>
    </Block>
  )
}

// ---------- impacts ----------

function Impacts({ action: a }: { action: ActionDetail }) {
  const period = usePeriodParam()
  return (
    <Block
      title={`Impact records (${a.impacts.length})`}
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to={linkWithPeriod('/impact', period, { action: a.id, new: '1' })}>Add impact record</Link>
        </Button>
      }
    >
      {a.impacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No impact records. Outcomes are measured and verified on the Impact page.</p>
      ) : (
        <ul className="space-y-2">
          {a.impacts.map((i) => (
            <li key={i.id} className="space-y-1 rounded-md border border-border p-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={linkWithPeriod('/impact', period, { action: a.id, record: i.id })} className="font-medium underline-offset-4 hover:underline">
                  {i.metricLabel} · {i.id}
                </Link>
                <VerificationBadge status={i.verificationStatus} />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Baseline ({formatPeriod(i.baselinePeriod)})</dt>
                  <dd><MetricValue value={i.baselineValue} unit={i.unit} /></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Target ({formatPeriod(i.targetPeriod)})</dt>
                  <dd><MetricValue value={i.targetValue} unit={i.unit} /></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Estimate — not realised</dt>
                  <dd><MetricValue value={i.estimatedValue} unit={i.unit} /></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Observed{i.observationPeriod ? ` (${formatPeriod(i.observationPeriod)})` : ''}</dt>
                  <dd><MetricValue value={i.observedValue} unit={i.unit} /></dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}
