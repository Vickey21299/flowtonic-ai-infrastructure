/**
 * Read-only and edit views of an investigation output (Spec §9, all ten parts).
 * Confirmed observations are facts backed by evidence; potential explanations are hypotheses
 * and are rendered visually distinct (dashed border + "Hypothesis — unverified").
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { EvidenceRef, EvidenceStrength, InvestigationOutput } from '@/api/types'
import { SourceLabel } from '@/components/AiLabel'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { causeDeterminationLabel, evidenceStrengthLabel, humanize } from '@/lib/format'
import { cn } from '@/lib/utils'

const strengthVariant: Record<EvidenceStrength, BadgeVariant> = {
  none: 'outline',
  weak: 'warning',
  moderate: 'accent',
  strong: 'success',
}

export function StrengthBadge({ strength }: { strength: EvidenceStrength }) {
  return <Badge variant={strengthVariant[strength]}>Evidence: {evidenceStrengthLabel[strength]}</Badge>
}

function Part({ n, title, children, className }: { n: number; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)} aria-labelledby={`inv-part-${n}`}>
      <h3 id={`inv-part-${n}`} className="text-sm font-semibold">
        <span className="mr-1.5 text-muted-foreground tabular">{n}.</span>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Empty({ children = 'None listed.' }: { children?: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function EvidenceChips({ ids, evidence }: { ids: string[]; evidence: EvidenceRef[] }) {
  if (ids.length === 0) return <span className="text-xs text-muted-foreground">No supporting evidence cited.</span>
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Cited evidence">
      {ids.map((id) => {
        const e = evidence.find((x) => x.id === id)
        return (
          <li key={id}>
            <span
              className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs"
              title={id}
            >
              {e ? (
                <>
                  <span className="text-muted-foreground">{e.label}:</span>
                  <span className="font-medium tabular">{e.value}</span>
                </>
              ) : (
                <span className="font-mono text-status-danger">Unknown evidence {id}</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Refs({ ids, prefix = 'Relates to' }: { ids: string[]; prefix?: string }) {
  if (ids.length === 0) return null
  return (
    <span className="text-xs text-muted-foreground">
      {prefix}: {ids.join(', ')}
    </span>
  )
}

interface OutputViewProps {
  output: InvestigationOutput
  evidence: EvidenceRef[]
  /** Link for "Create proposed action" per suggested action; omit to hide the buttons. */
  actionLink?: (title: string) => string
}

export function InvestigationOutputView({ output: o, evidence, actionLink }: OutputViewProps) {
  const a = o.overallAssessment
  return (
    <div className="space-y-6">
      <Part n={1} title="Executive summary">
        <p className="whitespace-pre-line text-sm">{o.executiveSummary}</p>
      </Part>

      <Part n={2} title="Confirmed observations">
        <p className="text-xs text-muted-foreground">Facts taken from the imported data and calculated KPIs.</p>
        {o.confirmedObservations.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-2">
            {o.confirmedObservations.map((c, i) => (
              <li key={i} className="space-y-1.5 rounded-md border border-border bg-surface p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <SourceLabel nature="observed" />
                  <p className="min-w-0 flex-1 text-sm">{c.statement}</p>
                </div>
                <EvidenceChips ids={c.evidenceIds} evidence={evidence} />
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part n={3} title="Potential explanations">
        <p className="text-xs text-muted-foreground">
          Hypotheses only — none is a confirmed cause. Each lists the evidence that supports it (part 4) and what is missing.
        </p>
        {o.potentialExplanations.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-2">
            {o.potentialExplanations.map((p) => (
              <li key={p.id} className="space-y-2 rounded-md border border-dashed border-status-warning/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                  <SourceLabel nature="hypothetical" />
                  <StrengthBadge strength={p.evidenceStrength} />
                </div>
                <p className="text-sm">{p.statement}</p>
                <div className="space-y-1">
                  <p className="text-xs font-medium">4. Supporting evidence</p>
                  <EvidenceChips ids={p.supportingEvidenceIds} evidence={evidence} />
                </div>
                {p.missingEvidence.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Missing evidence</p>
                    <ul className="list-inside list-disc text-xs text-muted-foreground">
                      {p.missingEvidence.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part n={4} title="Supporting evidence">
        <p className="text-sm text-muted-foreground">Shown with each potential explanation above.</p>
      </Part>

      <Part n={5} title="Missing evidence">
        {o.missingEvidence.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-2">
            {o.missingEvidence.map((m, i) => (
              <li key={i} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">{m.type}</p>
                <p className="text-muted-foreground">{m.whyNeeded}</p>
                <Refs ids={m.explanations} />
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part n={6} title="Management questions">
        {o.managementQuestions.length === 0 ? (
          <Empty />
        ) : (
          <ol className="list-inside list-decimal space-y-1.5 text-sm">
            {o.managementQuestions.map((q, i) => (
              <li key={i}>
                {q.question} <Refs ids={q.explanations} />
              </li>
            ))}
          </ol>
        )}
      </Part>

      <Part n={7} title="Recommended next steps">
        {o.nextSteps.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1.5 text-sm">
            {o.nextSteps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2">
                <Badge variant="outline">{humanize(s.type)}</Badge>
                <span className="min-w-0 flex-1">{s.step}</span>
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part n={8} title="Suggested actions for human review">
        <p className="text-xs text-muted-foreground">Suggestions only. Nothing is created until a person submits the action form.</p>
        {o.suggestedActions.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-2">
            {o.suggestedActions.map((s, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-muted-foreground">{s.rationale}</p>
                  <Refs ids={s.explanations} />
                </div>
                {actionLink && (
                  <Button asChild variant="outline" size="sm" className="shrink-0">
                    <Link to={actionLink(s.title)}>
                      <Plus aria-hidden />
                      Create proposed action
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Part>

      <Part n={9} title="Overall assessment">
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={a.causeDetermination === 'supported' ? 'success' : 'warning'} className="text-sm">
              Cause: {causeDeterminationLabel[a.causeDetermination].toLowerCase()}
            </Badge>
            <StrengthBadge strength={a.evidenceStrength} />
          </div>
          <p className="text-sm">{a.rationale}</p>
        </div>
      </Part>

      <Part n={10} title="Data limitations">
        {o.dataLimitations.length === 0 ? (
          <Empty />
        ) : (
          <ul className="list-inside list-disc space-y-1 text-sm">
            {o.dataLimitations.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </Part>
    </div>
  )
}

// ---------- Edit ----------

interface EditProps {
  value: InvestigationOutput
  onChange: (next: InvestigationOutput) => void
  fieldError: (field: string) => string | undefined
}

function EditField({
  id,
  label,
  value,
  onChange,
  error,
  rows = 2,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  rows?: number
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      {error && (
        <p id={`${id}-err`} className="text-xs text-status-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** Edit the narrative parts. Evidence citations, strengths and the assessment are not editable here. */
export function InvestigationEditForm({ value: v, onChange, fieldError }: EditProps) {
  const set = <K extends keyof InvestigationOutput>(k: K, val: InvestigationOutput[K]) => onChange({ ...v, [k]: val })
  return (
    <div className="space-y-5">
      <EditField
        id="edit-summary"
        label="1. Executive summary"
        value={v.executiveSummary}
        rows={4}
        onChange={(t) => set('executiveSummary', t)}
        error={fieldError('executiveSummary')}
      />
      {v.potentialExplanations.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">3. Potential explanations (hypotheses)</legend>
          {v.potentialExplanations.map((p, i) => (
            <EditField
              key={p.id}
              id={`edit-expl-${i}`}
              label={`Explanation ${p.id}`}
              value={p.statement}
              onChange={(t) =>
                set(
                  'potentialExplanations',
                  v.potentialExplanations.map((x, j) => (j === i ? { ...x, statement: t } : x)),
                )
              }
            />
          ))}
        </fieldset>
      )}
      {v.managementQuestions.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">6. Management questions</legend>
          {v.managementQuestions.map((q, i) => (
            <EditField
              key={i}
              id={`edit-q-${i}`}
              label={`Question ${i + 1}`}
              value={q.question}
              onChange={(t) =>
                set(
                  'managementQuestions',
                  v.managementQuestions.map((x, j) => (j === i ? { ...x, question: t } : x)),
                )
              }
            />
          ))}
        </fieldset>
      )}
      {v.nextSteps.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">7. Recommended next steps</legend>
          {v.nextSteps.map((s, i) => (
            <EditField
              key={i}
              id={`edit-step-${i}`}
              label={`Step ${i + 1} (${humanize(s.type)})`}
              value={s.step}
              onChange={(t) => set('nextSteps', v.nextSteps.map((x, j) => (j === i ? { ...x, step: t } : x)))}
            />
          ))}
        </fieldset>
      )}
      {v.dataLimitations.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">10. Data limitations</legend>
          {v.dataLimitations.map((d, i) => (
            <EditField
              key={i}
              id={`edit-lim-${i}`}
              label={`Limitation ${i + 1}`}
              value={d}
              onChange={(t) => set('dataLimitations', v.dataLimitations.map((x, j) => (j === i ? t : x)))}
            />
          ))}
        </fieldset>
      )}
    </div>
  )
}
