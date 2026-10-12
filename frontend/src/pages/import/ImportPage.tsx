import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import { api } from '@/api'
import { isApiError } from '@/api/errors'
import type { ImportJob } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { queryKeys } from '@/lib/queryKeys'
import { cn } from '@/lib/utils'
import { ConfirmStep, MapStep, PreviewStep, SummaryStep, UploadStep } from './ImportSteps'

const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map columns' },
  { id: 'preview', label: 'Preview & errors' },
  { id: 'confirm', label: 'Confirm' },
  { id: 'summary', label: 'Summary' },
] as const
type StepId = (typeof STEPS)[number]['id']

/** Which step to show, given the job's real status (the URL `step` only chooses among valid ones). */
function effectiveStep(job: ImportJob | undefined, requested: string | null): StepId {
  if (!job || job.status === 'cancelled' || job.status === 'failed') return 'upload'
  if (job.status === 'committed') return 'summary'
  if (job.status === 'uploaded') return 'map'
  // validated
  return requested === 'map' || requested === 'confirm' ? requested : 'preview'
}

function Stepper({ current }: { current: StepId }) {
  const idx = STEPS.findIndex((s) => s.id === current)
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Import steps">
      {STEPS.map((s, i) => {
        const done = i < idx
        const active = i === idx
        return (
          <li
            key={s.id}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
              active && 'border-foreground bg-foreground text-background',
              done && 'border-status-success/40 text-status-success',
              !active && !done && 'border-border text-muted-foreground',
            )}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs tabular" aria-hidden>
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {s.label}
            {done && <span className="sr-only"> (done)</span>}
          </li>
        )
      })}
    </ol>
  )
}

const DATA_KEYS = [['overview'], ['companies'], ['company'], ['exceptions'], ['exception'], ['methodology'], ['workspace'], ['actions'], ['impacts']]

export function ImportPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const jobId = params.get('job')
  const [notice, setNotice] = useState<string | null>(null)

  const jobQuery = useQuery({
    queryKey: queryKeys.importJob(jobId ?? ''),
    queryFn: () => api.getImportJob(jobId as string),
    enabled: Boolean(jobId),
    retry: false,
  })
  const job = jobId ? jobQuery.data : undefined
  const jobGone = Boolean(jobId) && jobQuery.isError && isApiError(jobQuery.error) && jobQuery.error.code === 'not_found'
  const step = effectiveStep(job, params.get('step'))

  /** Keep the other params (e.g. period) and set job/step. */
  const go = (next: { job?: ImportJob | null; step?: StepId }) => {
    const sp = new URLSearchParams(params)
    if (next.job === null) {
      sp.delete('job')
      sp.delete('step')
    } else if (next.job) {
      qc.setQueryData(queryKeys.importJob(next.job.id), next.job)
      sp.set('job', next.job.id)
    }
    if (next.step && next.job !== null) sp.set('step', next.step)
    setParams(sp)
  }

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelImport(id),
    onSuccess: (j) => {
      qc.setQueryData(queryKeys.importJob(j.id), j)
      setNotice('Import cancelled — no data was changed.')
      go({ job: null })
    },
  })

  const onCommitted = async (j: ImportJob) => {
    await Promise.all(DATA_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })))
    go({ job: j, step: 'summary' })
  }

  const canCancel = job && (job.status === 'uploaded' || job.status === 'validated')

  let body
  if (jobId && jobQuery.isPending) body = <Loading variant="inline" label="Loading import…" />
  else if (jobId && jobQuery.isError && !jobGone)
    body = <ErrorState title="Could not load the import" error={jobQuery.error} onRetry={() => jobQuery.refetch()} />
  else if (step === 'upload')
    body = (
      <UploadStep
        onUploaded={(j) => {
          setNotice(null)
          go({ job: j, step: 'map' })
        }}
      />
    )
  else if (job && step === 'map') body = <MapStep job={job} onValidated={(j) => go({ job: j, step: 'preview' })} />
  else if (job && step === 'preview')
    body = <PreviewStep job={job} onBack={() => go({ step: 'map' })} onNext={() => go({ step: 'confirm' })} />
  else if (job && step === 'confirm')
    body = <ConfirmStep job={job} onBack={() => go({ step: 'preview' })} onCommitted={onCommitted} />
  else if (job && step === 'summary') body = <SummaryStep job={job} onNew={() => go({ job: null })} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link to="/methodology" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Data & Methodology
          </Link>
        }
        title="Data Import"
        description="Import monthly actual and plan figures from a CSV file. Nothing changes until you confirm."
        actions={
          canCancel ? (
            <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)}>
              {cancel.isPending ? 'Cancelling…' : 'Cancel import'}
            </Button>
          ) : undefined
        }
      />

      <Stepper current={step} />

      {notice && (
        <Alert variant="success" title={notice} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>} />
      )}
      {jobGone && (
        <Alert variant="warning" title="That import session is no longer available">
          Import sessions expire after 24 hours, and cancelled or unknown sessions cannot be resumed. Start a new import below.
        </Alert>
      )}
      {job?.status === 'cancelled' && !notice && (
        <Alert variant="info" title="This import was cancelled — no data was changed." />
      )}
      {cancel.isError && <ErrorState compact title="Could not cancel the import" error={cancel.error} />}

      {job && step !== 'upload' && (
        <p className="text-sm text-muted-foreground">
          File: <span className="font-mono text-foreground">{job.fileName}</span> · import {job.id}
        </p>
      )}

      {body}
    </div>
  )
}
