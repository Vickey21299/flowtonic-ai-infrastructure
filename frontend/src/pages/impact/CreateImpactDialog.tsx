import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/api'
import { isApiError } from '@/api/errors'
import type { ImpactCreateInput, ImpactRecord, MetricKey } from '@/api/types'
import { SourceLabel } from '@/components/AiLabel'
import { ErrorState } from '@/components/states/ErrorState'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { actionStatusLabel } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { IMPACT_METRICS, parseNumberInput, unitHint, useInvalidateImpactData } from './impactShared'

interface Props {
  open: boolean
  actionId?: string
  onClose: () => void
  onCreated: (r: ImpactRecord) => void
}

const KNOWN_FIELDS = ['actionId', 'metricKey', 'baselineValue', 'baselinePeriod', 'targetValue', 'targetPeriod', 'estimatedValue', 'notes']

function Msg({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-xs text-status-danger">
      {message}
    </p>
  )
}

export function CreateImpactDialog({ open, actionId, onClose, onCreated }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        {open && <CreateForm key={actionId ?? ''} actionId={actionId} onClose={onClose} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateForm({ actionId: initialAction, onClose, onCreated }: Omit<Props, 'open'>) {
  const invalidate = useInvalidateImpactData()
  const actions = useQuery({ queryKey: queryKeys.actions({}), queryFn: () => api.listActions({}) })
  const workspace = useQuery({ queryKey: queryKeys.workspace, queryFn: () => api.getWorkspace() })
  const current = workspace.data?.currentPeriod ?? ''

  const [actionId, setActionId] = useState(initialAction ?? '')
  const [metricKey, setMetricKey] = useState<MetricKey | ''>('')
  const [baseline, setBaseline] = useState('')
  const [baselinePeriod, setBaselinePeriod] = useState<string | null>(null) // null = use workspace current period
  const [target, setTarget] = useState('')
  const [targetPeriod, setTargetPeriod] = useState('')
  const [estimate, setEstimate] = useState('')
  const [notes, setNotes] = useState('')
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})

  const create = useMutation({
    mutationFn: (input: ImpactCreateInput) => api.createImpact(input),
    onSuccess: async (r) => {
      await invalidate()
      onCreated(r)
    },
  })
  const apiErr = isApiError(create.error) ? create.error : null
  const err = (f: string) => clientErrors[f] ?? apiErr?.fieldErrors.find((e) => e.field === f)?.message
  const desc = (f: string) => (err(f) ? `imp-${f}-err` : undefined)
  const unit = IMPACT_METRICS.find((m) => m.value === metricKey)?.unit ?? 'currency'
  const hint = metricKey ? ` (${unitHint(unit)})` : ''
  const bPeriod = baselinePeriod ?? current

  const submit = () => {
    const errors: Record<string, string> = {}
    const b = parseNumberInput(baseline)
    const t = parseNumberInput(target)
    const e = parseNumberInput(estimate)
    if (!actionId) errors.actionId = 'Select the related action.'
    if (!metricKey) errors.metricKey = 'Select a metric.'
    if (b === undefined) errors.baselineValue = 'Enter a number or leave it empty.'
    if (t === undefined) errors.targetValue = 'Enter a number or leave it empty.'
    if (e === undefined) errors.estimatedValue = 'Enter a number or leave it empty.'
    setClientErrors(errors)
    if (Object.keys(errors).length || !metricKey || b === undefined || t === undefined || e === undefined) return
    create.mutate({
      actionId,
      metricKey,
      baselineValue: b,
      baselinePeriod: bPeriod,
      targetValue: t,
      targetPeriod,
      estimatedValue: e,
      notes: notes.trim() || undefined,
    })
  }

  const unmatched = apiErr?.fieldErrors.filter((f) => !KNOWN_FIELDS.includes(f.field)) ?? []
  const options = (actions.data ?? []).filter((a) => a.status !== 'cancelled' || a.id === actionId)

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>New impact record</DialogTitle>
        <DialogDescription>
          A new record starts as <strong>Not yet measurable</strong>. Record the observed result and verify it later.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="imp-actionId">Action (required)</Label>
          <NativeSelect id="imp-actionId" value={actionId} onChange={(e) => setActionId(e.target.value)} aria-invalid={Boolean(err('actionId'))} aria-describedby={desc('actionId')} disabled={actions.isPending}>
            <option value="">{actions.isPending ? 'Loading actions…' : 'Choose an action…'}</option>
            {actionId && !options.some((a) => a.id === actionId) && <option value={actionId}>{actionId}</option>}
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.companyName} · {a.title} ({actionStatusLabel[a.status]})
              </option>
            ))}
          </NativeSelect>
          <Msg id="imp-actionId-err" message={err('actionId')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="imp-metricKey">Metric (required)</Label>
          <NativeSelect id="imp-metricKey" value={metricKey} onChange={(e) => setMetricKey(e.target.value as MetricKey | '')} aria-invalid={Boolean(err('metricKey'))} aria-describedby={desc('metricKey')}>
            <option value="">Choose…</option>
            {IMPACT_METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
          <Msg id="imp-metricKey-err" message={err('metricKey')} />
        </div>
      </div>

      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
          Baseline <SourceLabel nature="observed" />
        </legend>
        <p className="text-xs text-muted-foreground">Take the baseline from a stored observation (Company → Data history).</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="imp-baselineValue">Baseline value{hint}</Label>
            <Input id="imp-baselineValue" inputMode="decimal" value={baseline} onChange={(e) => setBaseline(e.target.value)} aria-invalid={Boolean(err('baselineValue'))} aria-describedby={desc('baselineValue')} />
            <Msg id="imp-baselineValue-err" message={err('baselineValue')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="imp-baselinePeriod">Baseline period</Label>
            <Input id="imp-baselinePeriod" type="month" value={bPeriod} onChange={(e) => setBaselinePeriod(e.target.value)} aria-invalid={Boolean(err('baselinePeriod'))} aria-describedby={desc('baselinePeriod')} />
            <Msg id="imp-baselinePeriod-err" message={err('baselinePeriod')} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-semibold">Target</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="imp-targetValue">Target value{hint}</Label>
            <Input id="imp-targetValue" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={Boolean(err('targetValue'))} aria-describedby={desc('targetValue')} />
            <Msg id="imp-targetValue-err" message={err('targetValue')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="imp-targetPeriod">Target period</Label>
            <Input id="imp-targetPeriod" type="month" value={targetPeriod} onChange={(e) => setTargetPeriod(e.target.value)} aria-invalid={Boolean(err('targetPeriod'))} aria-describedby={desc('targetPeriod')} />
            <Msg id="imp-targetPeriod-err" message={err('targetPeriod')} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded-md border border-dashed border-muted-foreground/50 p-3">
        <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
          Estimated value (optional) <SourceLabel nature="estimated" />
        </legend>
        <p className="text-xs text-muted-foreground">A projection only. It is never shown or counted as a realised result.</p>
        <div className="space-y-1">
          <Label htmlFor="imp-estimatedValue">Estimate{hint}</Label>
          <Input id="imp-estimatedValue" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} aria-invalid={Boolean(err('estimatedValue'))} aria-describedby={desc('estimatedValue')} />
          <Msg id="imp-estimatedValue-err" message={err('estimatedValue')} />
        </div>
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="imp-notes">Notes</Label>
        <Textarea id="imp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Msg id="imp-notes-err" message={err('notes')} />
      </div>

      {create.isError && (!apiErr || apiErr.fieldErrors.length === 0) && <ErrorState compact title="Could not create the record" error={create.error} />}
      {unmatched.length > 0 && (
        <ul className="list-inside list-disc text-xs text-status-danger">
          {unmatched.map((f, i) => (
            <li key={i}>
              {f.field}: {f.message}
            </li>
          ))}
        </ul>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create impact record'}
        </Button>
      </DialogFooter>
    </form>
  )
}
