import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { RotateCcw } from 'lucide-react'
import { api } from '@/api'
import { isApiError } from '@/api/errors'
import type { InvestigationMode, SettingsResponse } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { Section } from '@/components/Section'
import { SeverityBadge } from '@/components/StatusBadges'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateTime } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { cn } from '@/lib/utils'
import { parseNumberInput } from '../impact/impactShared'
import { ruleConditionText, thresholdUnit } from '../ruleFormat'

/** Everything whose status/exceptions/labels derive from rules or AI mode. */
const SETTINGS_INVALIDATE = [
  ['overview'],
  ['companies'],
  ['company'],
  ['exceptions'],
  ['exception'],
  ['methodology'],
  ['settings'],
  ['workspace'],
  ['investigations'],
  ['investigation'],
]

function useInvalidateSettingsData() {
  const qc = useQueryClient()
  return () => Promise.all(SETTINGS_INVALIDATE.map((queryKey) => qc.invalidateQueries({ queryKey })))
}

// ---------- thresholds ----------

function ThresholdsForm({ settings }: { settings: SettingsResponse }) {
  const invalidate = useInvalidateSettingsData()
  const cfg = settings.ruleConfiguration
  const initial = () => cfg.rules.map((r) => ({ id: r.id, threshold: String(r.threshold), enabled: r.enabled }))
  const [rows, setRows] = useState(initial)
  const [clientErr, setClientErr] = useState<Record<number, string>>({})
  const [saved, setSaved] = useState<number | null>(null)
  // Re-sync the form when the active configuration changes (after a save or a demo reset).
  const cfgStamp = `${cfg.version}|${cfg.activatedAt}`
  const [seenStamp, setSeenStamp] = useState(cfgStamp)
  if (seenStamp !== cfgStamp) {
    setSeenStamp(cfgStamp)
    setRows(initial())
    setClientErr({})
    setSaved(null)
  }

  const save = useMutation({
    mutationFn: (rules: { id: string; threshold: number; enabled: boolean }[]) => api.updateSettings({ rules }),
    onSuccess: async (res) => {
      await invalidate()
      setSaved(res.ruleConfiguration.version)
    },
  })
  const apiErr = isApiError(save.error) ? save.error : null
  // Server field errors are indexed by position in the submitted list, which follows cfg.rules order.
  const fieldErr = (i: number, f: 'threshold' | 'enabled' | 'id') =>
    (f === 'threshold' ? clientErr[i] : undefined) ?? apiErr?.fieldErrors.find((e) => e.field === `rules.${i}.${f}`)?.message
  const otherErrors = apiErr?.fieldErrors.filter((e) => !/^rules\.\d+\.(threshold|enabled)$/.test(e.field)) ?? []

  const dirty = rows.some((r, i) => r.threshold.trim() !== String(cfg.rules[i]?.threshold) || r.enabled !== cfg.rules[i]?.enabled)

  const submit = () => {
    setSaved(null)
    const errs: Record<number, string> = {}
    const parsed = rows.map((r, i) => {
      const n = parseNumberInput(r.threshold)
      if (n === null || n === undefined) errs[i] = 'Enter a number, e.g. −10.'
      return { id: r.id, threshold: n ?? NaN, enabled: r.enabled }
    })
    setClientErr(errs)
    if (Object.keys(errs).length) return
    save.mutate(parsed)
  }

  return (
    <Section
      title="Exception thresholds"
      description={`Rule configuration version ${cfg.version}, active since ${formatDateTime(cfg.activatedAt)}. Saving a change creates a new version and re-evaluates every exception.`}
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <ul className="divide-y divide-border rounded-md border border-border">
          {cfg.rules.map((r, i) => {
            const row = rows[i]!
            const err = fieldErr(i, 'threshold')
            const enErr = fieldErr(i, 'enabled')
            const unit = thresholdUnit(r.kpiKey)
            return (
              <li key={r.id} className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-start">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.label}</span>
                    <SeverityBadge severity={r.severity} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{r.kpiKey}</span> — currently {ruleConditionText(r)}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`thr-${r.id}`}>Threshold ({unit}, ≤)</Label>
                  <Input
                    id={`thr-${r.id}`}
                    inputMode="decimal"
                    value={row.threshold}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, threshold: e.target.value } : x)))}
                    aria-invalid={Boolean(err)}
                    aria-describedby={err ? `thr-${r.id}-err` : undefined}
                  />
                  {err && (
                    <p id={`thr-${r.id}-err`} className="text-xs text-status-danger">
                      {err}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 sm:pt-7">
                  <Checkbox
                    id={`en-${r.id}`}
                    checked={row.enabled}
                    onCheckedChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, enabled: v === true } : x)))}
                    aria-describedby={enErr ? `en-${r.id}-err` : undefined}
                  />
                  <Label htmlFor={`en-${r.id}`}>Enabled</Label>
                  {enErr && (
                    <p id={`en-${r.id}-err`} className="text-xs text-status-danger">
                      {enErr}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          Thresholds are demo assumptions. An exception is raised when the KPI is at or below the threshold; only the most
          severe matching rule per KPI is active. Exceptions whose condition no longer holds are kept and marked “condition
          cleared — review”.
        </p>

        {save.isError && (otherErrors.length > 0 || !apiErr || apiErr.fieldErrors.length === 0) && (
          <ErrorState compact title="Thresholds were not saved" error={save.error} />
        )}
        {saved !== null && !dirty && (
          <Alert variant="success" title={`Saved — rule configuration version ${saved} is active`}>
            Statuses and exceptions were re-evaluated.{' '}
            <Link to="/exceptions" className="underline underline-offset-4">
              Review exceptions
            </Link>{' '}
            or the{' '}
            <Link to="/" className="underline underline-offset-4">
              Overview
            </Link>
            .
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || !dirty}>
            {save.isPending ? 'Saving…' : 'Save thresholds'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setRows(initial())
              setClientErr({})
              save.reset()
            }}
          >
            Discard changes
          </Button>
        </div>
      </form>
    </Section>
  )
}

// ---------- AI mode ----------

function AiModeSection({ settings }: { settings: SettingsResponse }) {
  const invalidate = useInvalidateSettingsData()
  const save = useMutation({
    mutationFn: (aiMode: InvestigationMode) => api.updateSettings({ aiMode }),
    onSuccess: () => invalidate(),
  })
  const options: { mode: InvestigationMode; label: string; help: string; disabledReason?: string }[] = [
    { mode: 'mock', label: 'Mock investigations', help: 'Deterministic template, clearly labelled MOCK. Not generated by an AI model.' },
    {
      mode: 'live',
      label: 'Live AI',
      help: 'Investigations generated by a configured AI provider, labelled AI-generated.',
      disabledReason: settings.liveAiAvailable ? undefined : 'Not available in this demo: no AI provider is configured on the backend.',
    },
  ]

  return (
    <Section title="Investigation mode" description="Which engine produces new investigation runs. Existing runs keep their label.">
      <fieldset className="space-y-2" disabled={save.isPending}>
        <legend className="sr-only">Investigation mode</legend>
        {options.map((o) => {
          const disabled = Boolean(o.disabledReason)
          const checked = settings.aiMode === o.mode
          return (
            <label
              key={o.mode}
              className={cn(
                'flex items-start gap-3 rounded-md border p-3',
                checked ? 'border-foreground' : 'border-border',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/40',
              )}
            >
              <input
                type="radio"
                name="ai-mode"
                value={o.mode}
                checked={checked}
                disabled={disabled}
                onChange={() => save.mutate(o.mode)}
                className="mt-1"
                aria-describedby={`ai-${o.mode}-help`}
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{o.label}</span>
                <span id={`ai-${o.mode}-help`} className="block text-xs text-muted-foreground">
                  {o.help}
                  {o.disabledReason && <span className="block font-medium text-foreground/80">{o.disabledReason}</span>}
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>
      {save.isError && <ErrorState compact className="mt-3" title="Could not change the mode" error={save.error} />}
    </Section>
  )
}

// ---------- reset ----------

function ResetSection() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  const reset = useMutation({
    mutationFn: () => api.resetDemo(),
    onSuccess: async () => {
      await qc.invalidateQueries()
      setOpen(false)
      setDone(true)
    },
  })

  return (
    <Section title="Demo data" description="Restore the original seed: 3 companies, the Apex EBITDA exception, no investigations, actions or impacts.">
      <div className="space-y-3">
        {done && (
          <Alert variant="success" title="Demo data reset" action={<Button size="sm" variant="ghost" onClick={() => setDone(false)}>Dismiss</Button>}>
            Everything is back to the original seed.
          </Alert>
        )}
        <Button variant="destructive" onClick={() => { reset.reset(); setOpen(true) }}>
          <RotateCcw aria-hidden />
          Reset demo data
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(o) => !reset.isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset all demo data?</DialogTitle>
            <DialogDescription>
              This discards every import, threshold change, investigation, action, impact record and note made in this session.
              It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {reset.isError && <ErrorState compact title="Reset failed" error={reset.error} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={reset.isPending}>
              Keep my data
            </Button>
            <Button variant="destructive" onClick={() => reset.mutate()} disabled={reset.isPending}>
              {reset.isPending ? 'Resetting…' : 'Reset demo data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

export function SettingsPage() {
  const q = useQuery({ queryKey: queryKeys.settings, queryFn: () => api.getSettings() })
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Exception thresholds, investigation mode and demo reset."
        meta={q.data ? <span>Environment: {q.data.environment === 'demo' ? 'Demo (fictional data)' : 'Production'}</span> : null}
      />
      {q.isPending ? (
        <Loading variant="table" label="Loading settings…" />
      ) : q.isError ? (
        <ErrorState title="Could not load settings" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <ThresholdsForm settings={q.data} />
          <AiModeSection settings={q.data} />
          <ResetSection />
        </>
      )}
    </div>
  )
}
