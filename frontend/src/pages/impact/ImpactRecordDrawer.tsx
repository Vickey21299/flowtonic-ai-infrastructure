import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, PencilLine, SearchX, X } from 'lucide-react'
import { api } from '@/api'
import { isApiError } from '@/api/errors'
import type { ImpactRecord, ImpactUpdateInput, ImpactVerificationRequest } from '@/api/types'
import { SourceLabel } from '@/components/AiLabel'
import { DetailDrawer } from '@/components/DetailDrawer'
import { MetricValue } from '@/components/MetricValue'
import { VerificationBadge } from '@/components/StatusBadges'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Alert, type AlertVariant } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, formatPeriod } from '@/lib/format'
import { cn } from '@/lib/utils'
import { linkWithPeriod, usePeriodParam } from '../urlState'
import { numberText, parseNumberInput, unitHint, useInvalidateImpactData } from './impactShared'

interface Props {
  recordId: string
  record: ImpactRecord | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  onClose: () => void
}

/** Impact record detail, opened by `?record=<id>` on /impact (no dedicated route). */
export function ImpactRecordDrawer({ recordId, record, loading, error, onRetry, onClose }: Props) {
  return (
    <DetailDrawer
      open
      onClose={onClose}
      eyebrow={
        <>
          <span className="font-mono">{recordId}</span>
          {record && <VerificationBadge status={record.verificationStatus} />}
        </>
      }
      title={record ? `${record.metricLabel} impact — ${record.companyName}` : loading ? 'Impact record' : 'Impact record not found'}
      description={record ? `Action: ${record.actionTitle}` : undefined}
    >
      {loading ? (
        <Loading variant="inline" label="Loading impact record…" />
      ) : error ? (
        <ErrorState title="Could not load impact records" error={error} onRetry={onRetry} />
      ) : !record ? (
        <EmptyState
          icon={<SearchX />}
          title={`No impact record with id “${recordId}”`}
          description="It may have been removed, or the link is incorrect."
          action={
            <Button variant="outline" size="sm" onClick={onClose}>
              Back to impact records
            </Button>
          }
        />
      ) : (
        <RecordBody key={record.id} r={record} />
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

function Msg({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-xs text-status-danger">
      {message}
    </p>
  )
}

function ValueBlock({
  title,
  label,
  value,
  period,
  r,
  dashed,
  note,
}: {
  title: string
  label?: ReactNode
  value: number | null
  period: string | null
  r: ImpactRecord
  dashed?: boolean
  note?: string
}) {
  return (
    <div className={cn('space-y-1 rounded-md border p-3', dashed ? 'border-dashed border-muted-foreground/50' : 'border-border')}>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {label}
      </div>
      <p className="text-lg font-semibold">
        <MetricValue value={value} unit={r.unit} />
      </p>
      <p className="text-xs text-muted-foreground">{period ? formatPeriod(period) : 'No period'}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

const statusExplain: Record<ImpactRecord['verificationStatus'], { variant: AlertVariant; title: string; text: string }> = {
  not_yet_measurable: { variant: 'info', title: 'Not yet measurable', text: 'No post-action observation recorded yet.' },
  unverified: {
    variant: 'warning',
    title: 'Unverified',
    text: 'Observed value recorded but not verified. Do not treat as realised.',
  },
  verified: { variant: 'success', title: 'Verified', text: 'The observed measurement has been reviewed and accepted.' },
  rejected: { variant: 'danger', title: 'Rejected', text: 'The reviewer did not accept the observed measurement.' },
}

// ---------- body ----------

function RecordBody({ r }: { r: ImpactRecord }) {
  const period = usePeriodParam()
  const ex = statusExplain[r.verificationStatus]
  const decided = r.verificationStatus === 'verified' || r.verificationStatus === 'rejected'

  return (
    <div className="space-y-6">
      <Alert variant={ex.variant} title={`Verification: ${ex.title}`}>
        <p>{ex.text}</p>
        {decided && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            <dt className="text-muted-foreground">Reviewer</dt>
            <dd>{r.reviewer ?? '—'}</dd>
            <dt className="text-muted-foreground">Rationale</dt>
            <dd>{r.verificationRationale ?? '—'}</dd>
            <dt className="text-muted-foreground">Evidence</dt>
            <dd className="break-all">{r.evidenceReference ?? '—'}</dd>
          </dl>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Verification confirms the measurement, not that the action caused the change.
        </p>
      </Alert>

      {r.verificationStatus === 'rejected' && (
        <p className="text-sm">
          The outcome was rejected. Consider reopening the action:{' '}
          <Link to={linkWithPeriod(`/actions/${encodeURIComponent(r.actionId)}`, period)} className="font-medium underline underline-offset-4">
            open {r.actionId}
          </Link>
          .
        </p>
      )}

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
        <dt className="text-muted-foreground">Company</dt>
        <dd>
          <Link to={linkWithPeriod(`/companies/${encodeURIComponent(r.companyId)}`, period)} className="underline-offset-4 hover:underline">
            {r.companyName}
          </Link>
        </dd>
        <dt className="text-muted-foreground">Action</dt>
        <dd>
          <Link to={linkWithPeriod(`/actions/${encodeURIComponent(r.actionId)}`, period)} className="underline-offset-4 hover:underline">
            {r.actionTitle} <span className="font-mono text-xs">({r.actionId})</span>
          </Link>
        </dd>
        <dt className="text-muted-foreground">Metric</dt>
        <dd>{r.metricLabel}</dd>
        <dt className="text-muted-foreground">Measurement source</dt>
        <dd>{r.measurementSource ?? <span className="text-muted-foreground">—</span>}</dd>
        <dt className="text-muted-foreground">Notes</dt>
        <dd className="whitespace-pre-line">{r.notes || <span className="text-muted-foreground">—</span>}</dd>
      </dl>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ValueBlock title="Baseline" label={<SourceLabel nature="observed" />} value={r.baselineValue} period={r.baselinePeriod} r={r} />
        <ValueBlock title="Target" value={r.targetValue} period={r.targetPeriod} r={r} note="A goal, not a result." />
        <ValueBlock
          title="Estimate — not realised"
          label={<SourceLabel nature="estimated" />}
          value={r.estimatedValue}
          period={null}
          r={r}
          dashed
          note="Projection only."
        />
        <ValueBlock
          title="Observed result"
          label={r.observedValue !== null ? <SourceLabel nature="observed" /> : undefined}
          value={r.observedValue}
          period={r.observationPeriod}
          r={r}
          note={r.verificationStatus === 'verified' ? 'Verified measurement.' : r.observedValue !== null ? 'Not verified.' : 'Not recorded yet.'}
        />
      </div>

      <UpdateMeasurement r={r} />
      <Verify r={r} />

      <Block title="History">
        {r.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes recorded.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {[...r.history].reverse().map((h) => (
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

// ---------- update measurement ----------

function UpdateMeasurement({ r }: { r: ImpactRecord }) {
  const invalidate = useInvalidateImpactData()
  const [open, setOpen] = useState(false)
  const initial = () => ({
    observed: numberText(r.observedValue),
    observationPeriod: r.observationPeriod ?? '',
    measurementSource: r.measurementSource ?? '',
    evidenceReference: r.evidenceReference ?? '',
    notes: r.notes,
    target: numberText(r.targetValue),
    targetPeriod: r.targetPeriod,
  })
  const [f, setF] = useState(initial)
  const [clientErr, setClientErr] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: (patch: ImpactUpdateInput) => api.updateImpact(r.id, patch),
    onSuccess: async () => {
      setOpen(false)
      await invalidate()
    },
  })
  const apiErr = isApiError(save.error) ? save.error : null
  const err = (k: string) => clientErr[k] ?? apiErr?.fieldErrors.find((e) => e.field === k)?.message
  const desc = (k: string) => (err(k) ? `upd-${k}-err` : undefined)
  const hint = ` (${unitHint(r.unit)})`

  const submit = () => {
    const observed = parseNumberInput(f.observed)
    const target = parseNumberInput(f.target)
    const errors: Record<string, string> = {}
    if (observed === undefined) errors.observedValue = 'Enter a number or leave it empty.'
    if (target === undefined) errors.targetValue = 'Enter a number or leave it empty.'
    setClientErr(errors)
    if (observed === undefined || target === undefined) return
    save.mutate({
      observedValue: observed,
      observationPeriod: f.observationPeriod || null,
      measurementSource: f.measurementSource.trim() || null,
      evidenceReference: f.evidenceReference.trim() || null,
      notes: f.notes,
      targetValue: target,
      targetPeriod: f.targetPeriod,
    })
  }

  if (!open) {
    return (
      <Block
        title="Measurement"
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setF(initial())
              setClientErr({})
              save.reset()
              setOpen(true)
            }}
          >
            <PencilLine aria-hidden />
            Update measurement
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">Record the observed result, its period and source, or adjust the target.</p>
      </Block>
    )
  }

  const known = ['observedValue', 'observationPeriod', 'measurementSource', 'evidenceReference', 'notes', 'targetValue', 'targetPeriod']
  const unmatched = apiErr?.fieldErrors.filter((e) => !known.includes(e.field)) ?? []

  return (
    <Block title="Update measurement">
      <form
        className="space-y-3 rounded-md border border-border p-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {(r.verificationStatus === 'verified' || r.verificationStatus === 'rejected') && (
          <Alert variant="warning">Saving changes sets this record back to unverified.</Alert>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="upd-observedValue">Observed value{hint}</Label>
            <Input id="upd-observedValue" inputMode="decimal" value={f.observed} onChange={(e) => setF({ ...f, observed: e.target.value })} aria-invalid={Boolean(err('observedValue'))} aria-describedby={desc('observedValue')} />
            <Msg id="upd-observedValue-err" message={err('observedValue')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upd-observationPeriod">Observation period</Label>
            <Input id="upd-observationPeriod" type="month" value={f.observationPeriod} onChange={(e) => setF({ ...f, observationPeriod: e.target.value })} aria-invalid={Boolean(err('observationPeriod'))} aria-describedby={desc('observationPeriod')} />
            <Msg id="upd-observationPeriod-err" message={err('observationPeriod')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upd-measurementSource">Measurement source</Label>
            <Input id="upd-measurementSource" value={f.measurementSource} onChange={(e) => setF({ ...f, measurementSource: e.target.value })} placeholder="e.g. Q4 management accounts" aria-invalid={Boolean(err('measurementSource'))} aria-describedby={desc('measurementSource')} />
            <Msg id="upd-measurementSource-err" message={err('measurementSource')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upd-evidenceReference">Evidence reference</Label>
            <Input id="upd-evidenceReference" value={f.evidenceReference} onChange={(e) => setF({ ...f, evidenceReference: e.target.value })} aria-invalid={Boolean(err('evidenceReference'))} aria-describedby={desc('evidenceReference')} />
            <Msg id="upd-evidenceReference-err" message={err('evidenceReference')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upd-targetValue">Target value{hint}</Label>
            <Input id="upd-targetValue" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} aria-invalid={Boolean(err('targetValue'))} aria-describedby={desc('targetValue')} />
            <Msg id="upd-targetValue-err" message={err('targetValue')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upd-targetPeriod">Target period</Label>
            <Input id="upd-targetPeriod" type="month" value={f.targetPeriod} onChange={(e) => setF({ ...f, targetPeriod: e.target.value })} aria-invalid={Boolean(err('targetPeriod'))} aria-describedby={desc('targetPeriod')} />
            <Msg id="upd-targetPeriod-err" message={err('targetPeriod')} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="upd-notes">Notes</Label>
          <Textarea id="upd-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <Msg id="upd-notes-err" message={err('notes')} />
        </div>
        {save.isError && (!apiErr || apiErr.fieldErrors.length === 0) && <ErrorState compact title="Could not save" error={save.error} />}
        {unmatched.map((u, i) => (
          <p key={i} className="text-xs text-status-danger">
            {u.field}: {u.message}
          </p>
        ))}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save measurement'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Block>
  )
}

// ---------- verify ----------

function Verify({ r }: { r: ImpactRecord }) {
  const invalidate = useInvalidateImpactData()
  const [open, setOpen] = useState(false)
  const [decision, setDecision] = useState<ImpactVerificationRequest['decision']>('verified')
  const [reviewer, setReviewer] = useState('')
  const [rationale, setRationale] = useState('')
  const [evidence, setEvidence] = useState(r.evidenceReference ?? '')

  const verify = useMutation({
    mutationFn: (req: ImpactVerificationRequest) => api.verifyImpact(r.id, req),
    onSuccess: async () => {
      setOpen(false)
      await invalidate()
    },
  })
  const apiErr = isApiError(verify.error) ? verify.error : null
  const err = (k: string) => apiErr?.fieldErrors.find((e) => e.field === k)?.message
  // Record-level problems (fields edited via "Update measurement", not in this form).
  const recordErrors = apiErr?.fieldErrors.filter((e) => ['observedValue', 'observationPeriod', 'measurementSource'].includes(e.field)) ?? []

  // Checklist from the current record + this form; the API still decides.
  const checklist: [string, boolean][] = [
    ['Observed value recorded', r.observedValue !== null],
    ['Observation period recorded', Boolean(r.observationPeriod)],
    ['Measurement source recorded', Boolean(r.measurementSource)],
    ['Reviewer named', Boolean(reviewer.trim())],
    ['Rationale given', Boolean(rationale.trim())],
    ['Evidence reference', Boolean(evidence.trim() || r.evidenceReference)],
  ]

  if (!open) {
    return (
      <Block
        title="Verification"
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              verify.reset()
              setOpen(true)
            }}
          >
            Review outcome
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          A reviewer verifies or rejects the observed measurement. Verifying requires an observed value, observation period,
          measurement source, reviewer, rationale and evidence reference.
        </p>
      </Block>
    )
  }

  return (
    <Block title="Review outcome">
      <form
        className="space-y-3 rounded-md border border-border p-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          verify.mutate({ decision, reviewer, rationale, evidenceReference: evidence.trim() || undefined })
        }}
      >
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Needed to verify</p>
          <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {checklist.map(([label, ok]) => (
              <li key={label} className={cn('flex items-center gap-1.5', ok ? 'text-status-success' : 'text-muted-foreground')}>
                {ok ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                <span className={ok ? 'text-foreground' : undefined}>{label}</span>
                <span className="sr-only">{ok ? ' — done' : ' — missing'}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ver-decision">Decision</Label>
            <NativeSelect id="ver-decision" value={decision} onChange={(e) => setDecision(e.target.value as ImpactVerificationRequest['decision'])} aria-invalid={Boolean(err('decision'))}>
              <option value="verified">Verified — measurement accepted</option>
              <option value="rejected">Rejected — measurement not accepted</option>
            </NativeSelect>
            <Msg id="ver-decision-err" message={err('decision')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ver-reviewer">Reviewer (required)</Label>
            <Input id="ver-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-invalid={Boolean(err('reviewer'))} aria-describedby={err('reviewer') ? 'ver-reviewer-err' : undefined} />
            <Msg id="ver-reviewer-err" message={err('reviewer')} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ver-rationale">Rationale (required)</Label>
          <Textarea id="ver-rationale" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} aria-invalid={Boolean(err('rationale'))} aria-describedby={err('rationale') ? 'ver-rationale-err' : undefined} />
          <Msg id="ver-rationale-err" message={err('rationale')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ver-evidence">Evidence reference</Label>
          <Input id="ver-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-invalid={Boolean(err('evidenceReference'))} aria-describedby={err('evidenceReference') ? 'ver-evidence-err' : undefined} />
          <Msg id="ver-evidence-err" message={err('evidenceReference')} />
        </div>

        {verify.isError && (
          <Alert variant="danger" title="Not verified — the record is unchanged">
            {recordErrors.length > 0 ? (
              <ul className="list-inside list-disc">
                {recordErrors.map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            ) : (
              <p>{verify.error instanceof Error ? verify.error.message : 'Unexpected error.'}</p>
            )}
            {recordErrors.length > 0 && <p className="mt-1 text-xs">Use “Update measurement” to record the missing values.</p>}
          </Alert>
        )}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={verify.isPending}>
            {verify.isPending ? 'Submitting…' : decision === 'verified' ? 'Verify measurement' : 'Reject measurement'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Block>
  )
}
