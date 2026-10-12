import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronDown, PencilLine, Plus, RotateCw, SearchX } from 'lucide-react'
import { api } from '@/api'
import { isApiError } from '@/api/errors'
import type { InvestigationDetail, InvestigationMode, InvestigationOutput } from '@/api/types'
import { AiLabel } from '@/components/AiLabel'
import { DetailDrawer } from '@/components/DetailDrawer'
import { ReviewStatusBadge } from '@/components/StatusBadges'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, investigationModeLabel, investigationStatusLabel } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { linkWithPeriod, usePeriodParam } from '../urlState'
import { InvestigationEditForm, InvestigationOutputView } from './InvestigationOutputView'

const INVALIDATE = [['investigation'], ['investigations'], ['exception'], ['company']]

function useInvalidateInvestigationData() {
  const qc = useQueryClient()
  return () => Promise.all(INVALIDATE.map((queryKey) => qc.invalidateQueries({ queryKey })))
}

const isNotFound = (e: unknown) => isApiError(e) && e.code === 'not_found'

export function InvestigationDrawer() {
  const { investigationId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const query = useQuery({
    queryKey: queryKeys.investigation(investigationId),
    queryFn: () => api.getInvestigation(investigationId),
    retry: (count, err) => !isNotFound(err) && count < 2,
  })
  const close = () => navigate(`/investigations${location.search}`)
  const inv = query.data

  return (
    <DetailDrawer
      open
      onClose={close}
      eyebrow={
        <>
          <span className="font-mono">{investigationId}</span>
          {inv && <ReviewStatusBadge status={inv.reviewStatus} />}
        </>
      }
      title={
        inv
          ? `${inv.metricLabel} investigation — ${inv.companyName}`
          : query.isError && isNotFound(query.error)
            ? 'Investigation not found'
            : 'Investigation'
      }
      description={inv ? `Exception ${inv.exceptionId} · run created ${formatDateTime(inv.createdAt)}` : undefined}
      footer={inv ? <Controls inv={inv} /> : undefined}
    >
      {query.isPending ? (
        <Loading variant="inline" label="Loading investigation…" />
      ) : query.isError ? (
        isNotFound(query.error) ? (
          <EmptyState
            icon={<SearchX />}
            title={`No investigation with id “${investigationId}”`}
            description="It may have been removed, or the link is incorrect."
            action={
              <Button variant="outline" size="sm" onClick={close}>
                Back to investigations
              </Button>
            }
          />
        ) : (
          <ErrorState title="Could not load this investigation" error={query.error} onRetry={() => query.refetch()} />
        )
      ) : (
        <InvestigationBody key={query.data.id} inv={query.data} />
      )}
    </DetailDrawer>
  )
}

// ---------- Generate / regenerate ----------

function useGenerate(exceptionId: string) {
  const navigate = useNavigate()
  const location = useLocation()
  const invalidate = useInvalidateInvestigationData()
  return useMutation({
    mutationFn: (mode: InvestigationMode) => api.generateInvestigation(exceptionId, mode),
    onSuccess: async (next) => {
      await invalidate()
      navigate(`/investigations/${encodeURIComponent(next.id)}${location.search}`)
    },
  })
}

function GenerateError({ gen, mode }: { gen: ReturnType<typeof useGenerate>; mode: InvestigationMode }) {
  if (!gen.isError) return null
  const providerDown = isApiError(gen.error) && gen.error.code === 'provider_unavailable'
  return (
    <Alert
      variant="danger"
      title={providerDown ? 'AI provider unavailable' : 'Could not generate the investigation'}
      action={
        <div className="flex flex-wrap gap-2">
          {!providerDown && (
            <Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => gen.mutate(mode)}>
              Retry
            </Button>
          )}
          {mode !== 'mock' && (
            <Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => gen.mutate('mock')}>
              Use mock investigation
            </Button>
          )}
        </div>
      }
    >
      {gen.error instanceof Error ? gen.error.message : 'Unexpected error.'}
    </Alert>
  )
}

// ---------- Body ----------

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

function InvestigationBody({ inv }: { inv: InvestigationDetail }) {
  const period = usePeriodParam()
  const invalidate = useInvalidateInvestigationData()
  const gen = useGenerate(inv.exceptionId)
  const [showOriginal, setShowOriginal] = useState(false)
  const [draft, setDraft] = useState<InvestigationOutput | null>(null)
  const [note, setNote] = useState('')

  const displayed = inv.editedOutput ?? inv.output
  const viewing = showOriginal && inv.editedOutput ? inv.output : displayed

  const actionLink = (title: string) =>
    linkWithPeriod('/actions', period, {
      new: '1',
      exceptionId: inv.exceptionId,
      investigationId: inv.id,
      title,
    })

  const save = useMutation({
    mutationFn: (edited: InvestigationOutput) => api.saveInvestigationEdit(inv.id, edited),
    onSuccess: async () => {
      setDraft(null)
      setShowOriginal(false)
      await invalidate()
    },
  })
  const addNote = useMutation({
    mutationFn: (text: string) => api.addInvestigationNote(inv.id, text),
    onSuccess: async () => {
      setNote('')
      await invalidate()
    },
  })

  const saveErr = isApiError(save.error) ? save.error : null
  const fieldError = (f: string) => saveErr?.fieldErrors.find((e) => e.field === f)?.message
  const noteErr = isApiError(addNote.error) ? addNote.error.fieldErrors.find((e) => e.field === 'text')?.message : undefined

  return (
    <div className="space-y-6">
      {/* Persistent provenance label: a mock is never presented as live AI output. */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-surface px-1 py-1">
        <AiLabel kind={inv.mode === 'mock' ? 'mock' : 'ai'} size="lg" />
        {inv.editedOutput && !showOriginal && <AiLabel kind="edited" />}
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
        <dt className="text-muted-foreground">Exception</dt>
        <dd>
          <Link
            to={linkWithPeriod(`/exceptions/${encodeURIComponent(inv.exceptionId)}`, period)}
            className="font-mono underline underline-offset-4"
          >
            {inv.exceptionId}
          </Link>{' '}
          · {inv.metricLabel} · {inv.companyName}
        </dd>
        <dt className="text-muted-foreground">Mode</dt>
        <dd>{investigationModeLabel[inv.mode]}</dd>
        <dt className="text-muted-foreground">Run status</dt>
        <dd>{investigationStatusLabel[inv.status]}</dd>
        {inv.modelMetadata && (
          <>
            <dt className="text-muted-foreground">Model</dt>
            <dd>
              {inv.modelMetadata.provider} · {inv.modelMetadata.model} · prompt {inv.modelMetadata.promptVersion}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Created</dt>
        <dd>{formatDateTime(inv.createdAt)}</dd>
        <dt className="text-muted-foreground">Review</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <ReviewStatusBadge status={inv.reviewStatus} />
          {inv.reviewedBy && (
            <span className="text-xs text-muted-foreground">
              by {inv.reviewedBy} · {formatDateTime(inv.reviewedAt)}
            </span>
          )}
        </dd>
      </dl>

      <GenerateError gen={gen} mode={inv.mode} />

      {inv.status === 'failed' && (
        <Alert
          variant="danger"
          title={`Investigation failed${inv.error ? ` (${inv.error.category})` : ''}`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => gen.mutate(inv.mode)}>
                <RotateCw aria-hidden />
                Retry
              </Button>
              {inv.mode !== 'mock' && (
                <Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => gen.mutate('mock')}>
                  Use mock investigation
                </Button>
              )}
            </div>
          }
        >
          {inv.error?.message ?? 'The run did not complete.'}
        </Alert>
      )}

      {inv.status === 'running' && <Loading variant="inline" label="Investigation running…" />}

      {draft ? (
        <Block title="Edit investigation">
          <p className="text-xs text-muted-foreground">
            The original output is kept unchanged; your edit is shown labelled “Edited by analyst”.
            {inv.reviewStatus === 'reviewed' && ' Saving sets the review status back to unreviewed.'}
          </p>
          {saveErr && saveErr.fieldErrors.length > 0 && !fieldError('executiveSummary') && (
            <ErrorState compact title="Could not save the edit" error={save.error} />
          )}
          {save.isError && !saveErr && <ErrorState compact title="Could not save the edit" error={save.error} />}
          <InvestigationEditForm value={draft} onChange={setDraft} fieldError={fieldError} />
          <div className="flex gap-2">
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(draft)}>
              {save.isPending ? 'Saving…' : 'Save edit'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null)
                save.reset()
              }}
            >
              Cancel
            </Button>
          </div>
        </Block>
      ) : viewing ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {inv.editedOutput && (
              <Button size="sm" variant="ghost" aria-pressed={showOriginal} onClick={() => setShowOriginal((s) => !s)}>
                {showOriginal ? 'Show analyst edit' : 'View original output'}
              </Button>
            )}
            {displayed && inv.status === 'completed' && (
              <Button size="sm" variant="outline" onClick={() => setDraft(structuredClone(displayed))}>
                <PencilLine aria-hidden />
                Edit investigation
              </Button>
            )}
          </div>
          {showOriginal && inv.editedOutput && (
            <p className="text-xs text-muted-foreground">Showing the original, unedited output.</p>
          )}
          <InvestigationOutputView output={viewing} evidence={inv.evidence} actionLink={actionLink} />
        </div>
      ) : (
        inv.status === 'completed' && <EmptyState compact title="This run produced no output" />
      )}

      <details className="group rounded-md border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
          Evidence supplied ({inv.evidence.length})
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        {inv.evidence.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">No evidence was supplied to this run.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border text-sm">
            {inv.evidence.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5">
                <span>
                  {e.label} <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
                </span>
                <span className="font-medium tabular">{e.value}</span>
              </li>
            ))}
          </ul>
        )}
      </details>

      <Block title="Analyst notes">
        {inv.analystNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {inv.analystNotes.map((n) => (
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
            addNote.mutate(note)
          }}
        >
          <Label htmlFor="inv-note">Add analyst note</Label>
          <Textarea
            id="inv-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={Boolean(noteErr)}
            aria-describedby={noteErr ? 'inv-note-err' : undefined}
          />
          {noteErr && (
            <p id="inv-note-err" className="text-xs text-status-danger">
              {noteErr}
            </p>
          )}
          {addNote.isError && !noteErr && <ErrorState compact title="Could not add the note" error={addNote.error} />}
          <Button type="submit" size="sm" variant="outline" disabled={addNote.isPending || !note.trim()}>
            {addNote.isPending ? 'Adding…' : 'Add note'}
          </Button>
        </form>
      </Block>
    </div>
  )
}

// ---------- Footer controls ----------

function Controls({ inv }: { inv: InvestigationDetail }) {
  const period = usePeriodParam()
  const invalidate = useInvalidateInvestigationData()
  const gen = useGenerate(inv.exceptionId)
  const review = useMutation({
    mutationFn: () => api.markInvestigationReviewed(inv.id),
    onSuccess: () => invalidate(),
  })

  const shown = inv.editedOutput ?? inv.output
  const firstTitle = shown?.suggestedActions[0]?.title
  const actionHref = linkWithPeriod('/actions', period, {
    new: '1',
    exceptionId: inv.exceptionId,
    investigationId: inv.id,
    title: firstTitle,
  })

  return (
    <div className="w-full space-y-2">
      <GenerateError gen={gen} mode={inv.mode} />
      {review.isError && <ErrorState compact title="Could not mark as reviewed" error={review.error} />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" disabled={gen.isPending} onClick={() => gen.mutate(inv.mode)}>
          <RotateCw aria-hidden />
          {gen.isPending ? 'Generating…' : 'Regenerate analysis'}
        </Button>
        {inv.reviewStatus === 'reviewed' ? (
          <Button variant="outline" disabled title="Already reviewed. Saving an edit sets it back to unreviewed.">
            <CheckCircle2 aria-hidden />
            Reviewed
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={review.isPending || inv.status !== 'completed'}
            title={inv.status !== 'completed' ? 'Only a completed run can be reviewed.' : undefined}
            onClick={() => review.mutate()}
          >
            <CheckCircle2 aria-hidden />
            {review.isPending ? 'Saving…' : 'Mark reviewed'}
          </Button>
        )}
        <Button asChild>
          <Link to={actionHref}>
            <Plus aria-hidden />
            Create proposed action
          </Link>
        </Button>
      </div>
    </div>
  )
}
