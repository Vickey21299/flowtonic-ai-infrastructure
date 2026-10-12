/** Exceptions list, detail, trace and workflow, derived from the store. */
import type {
  ExceptionDetail,
  ExceptionFilters,
  ExceptionSummary,
  ExceptionTransitionRequest,
  ObservationRecord,
  ResolutionReason,
  TraceStep,
} from '@/api/types'
import { ApiError } from '@/api/errors'
import { db, type ExceptionRecord } from './store'
import { METRIC_COLUMNS, METRIC_LABELS } from './seed'
import { kpiValueText, periodFacts, ruleConditionLabel, type PeriodFacts } from './engine'
import { kpiDefinition } from './kpi'
import { audit, clone, notFound, periodLabel, plainPct, ppText, pctText, signed, validationError, withMinus } from './util'
import {
  EXCEPTION_TRANSITIONS,
  exceptionSort,
  toActionSummary,
  toExceptionSummary,
  toInvestigationSummary,
} from './views'

export function findException(id: string): ExceptionRecord {
  const e = db().exceptions.find((x) => x.id === id)
  if (!e) notFound('Exception', id)
  return e
}

export function listExceptionsDemo(f: ExceptionFilters): ExceptionSummary[] {
  const s = db()
  const owner = f.owner?.trim().toLowerCase()
  return clone(
    s.exceptions
      .filter((e) => !f.severity || e.severity === f.severity)
      .filter((e) => !f.companyId || e.companyId === f.companyId)
      .filter((e) => !f.metricKey || e.metricKey === f.metricKey)
      .filter((e) => !f.period || e.period === f.period)
      .filter((e) => !f.status || (f.status === 'not_resolved' ? e.status !== 'resolved' : e.status === f.status))
      .filter((e) => !owner || (e.owner ?? '').toLowerCase() === owner)
      .map((e) => toExceptionSummary(s, e))
      .sort(exceptionSort),
  )
}

// ---------- Calculation text ----------

/** The original CSV string for a value (e.g. "1.90"), falling back to the stored number. */
function raw(obs: ObservationRecord | undefined, field: string, value: number | null): string {
  const original = obs?.originalValues[field]
  if (original !== undefined && original.trim() !== '') return withMinus(original.trim())
  return value === null ? '—' : withMinus(String(value))
}

function calculationFor(e: ExceptionRecord, f: PeriodFacts): ExceptionDetail['calculation'] {
  const def = kpiDefinition(e.kpiKey)
  const kv = f.kpis[e.kpiKey]
  const rev = METRIC_COLUMNS.revenue
  const ebi = METRIC_COLUMNS.ebitda
  const ra = raw(f.revenueObs, rev.actual, f.revenue.actual)
  const rp = raw(f.revenueObs, rev.plan, f.revenue.plan)
  const ea = raw(f.ebitdaObs, ebi.actual, f.ebitda.actual)
  const ep = raw(f.ebitdaObs, ebi.plan, f.ebitda.plan)

  let substituted: string
  let result: string
  switch (e.kpiKey) {
    case 'revenue_variance':
      substituted = `${ra} − ${rp}`
      result = kv.value === null ? '' : signed(kv.value, 2)
      break
    case 'ebitda_variance':
      substituted = `${ea} − ${ep}`
      result = kv.value === null ? '' : signed(kv.value, 2)
      break
    case 'revenue_variance_pct':
      substituted = `(${ra} − ${rp}) / ${rp} × 100`
      result = pctText(kv.value)
      break
    case 'ebitda_variance_pct':
      substituted = `(${ea} − ${ep}) / ${ep} × 100`
      result = pctText(kv.value)
      break
    case 'ebitda_margin_actual_pct':
      substituted = `${ea} / ${ra} × 100`
      result = plainPct(kv.value)
      break
    case 'ebitda_margin_plan_pct':
      substituted = `${ep} / ${rp} × 100`
      result = plainPct(kv.value)
      break
    case 'ebitda_margin_variance_pp':
      substituted = `(${ea} / ${ra} × 100) − (${ep} / ${rp} × 100)`
      result = ppText(kv.value)
      break
  }
  if (kv.status === 'not_calculable') result = `Not calculable — ${kv.reason ?? 'missing input'}`
  else if (kv.status === 'sign_ambiguous') result = `${result} (sign ambiguous — ${kv.reason ?? ''})`
  return { formula: def.formula, substituted, result }
}

const metricObservations = (e: ExceptionRecord, f: PeriodFacts): (ObservationRecord | undefined)[] =>
  e.metricKey === 'revenue' ? [f.revenueObs] : e.metricKey === 'ebitda' ? [f.ebitdaObs] : [f.revenueObs, f.ebitdaObs]

export function getExceptionDemo(id: string): ExceptionDetail {
  const s = db()
  const e = findException(id)
  const f = periodFacts(s, e.companyId, e.period)
  const sourceObs = (e.metricKey === 'revenue' ? f.revenueObs : f.ebitdaObs) ?? f.revenueObs
  const metrics = e.metricKey === 'ebitda_margin' ? ['revenue', 'ebitda'] : [e.metricKey]

  return clone({
    ...toExceptionSummary(s, e),
    calculation: calculationFor(e, f),
    source: {
      sourceName: sourceObs?.sourceName ?? '—',
      sourceUpdatedAt: sourceObs?.sourceUpdatedAt ?? '',
      importJobId: sourceObs?.importJobId ?? '—',
      fileName: sourceObs?.fileName ?? '—',
      sourceRow: sourceObs?.sourceRow ?? 0,
      importedAt: sourceObs?.importedAt ?? '',
    },
    ruleConfigurationVersion: e.ruleConfigurationVersion,
    allowedTransitions: [...EXCEPTION_TRANSITIONS[e.status]],
    resolutionReason: e.resolutionReason,
    resolutionNote: e.resolutionNote,
    relatedObservations: s.observations
      .filter((o) => o.companyId === e.companyId && metrics.includes(o.metricKey))
      .sort((a, b) => b.period.localeCompare(a.period) || b.importedAt.localeCompare(a.importedAt)),
    investigations: s.investigations
      .filter((i) => i.exceptionId === id)
      .map(toInvestigationSummary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    actions: s.actions
      .filter((a) => a.exceptionId === id)
      .map((a) => toActionSummary(s, a))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    history: e.history,
  })
}

/** rule → evaluation → KPI → observation(s) → import job (file, row). */
export function getExceptionTraceDemo(id: string): TraceStep[] {
  const s = db()
  const e = findException(id)
  const f = periodFacts(s, e.companyId, e.period)
  const rule = s.ruleConfiguration.rules.find((r) => r.id === e.ruleId)
  const calc = calculationFor(e, f)
  const kv = f.kpis[e.kpiKey]
  const steps: TraceStep[] = []

  steps.push({
    kind: 'rule',
    title: `Rule ${e.ruleKey}`,
    fields: [
      { label: 'Rule', value: rule?.label ?? e.ruleKey },
      { label: 'Condition', value: `${e.kpiKey} ≤ ${withMinus(String(e.threshold))}` },
      { label: 'Reads as', value: ruleConditionLabel(e.kpiKey, e.threshold) },
      { label: 'Severity', value: e.severity },
      { label: 'Rule configuration', value: `v${e.ruleConfigurationVersion}` },
      { label: 'Currently enabled', value: rule?.enabled ? 'Yes' : 'No' },
      { label: 'Current threshold', value: rule ? withMinus(String(rule.threshold)) : '—' },
    ],
  })
  steps.push({
    kind: 'evaluation',
    title: 'Evaluation',
    fields: [
      { label: 'Evaluated at', value: e.evaluatedAt },
      { label: 'Value', value: kpiValueText(e.kpiKey, e.evaluatedValue) },
      {
        label: 'Test',
        value: `${kpiValueText(e.kpiKey, e.evaluatedValue)} ≤ ${withMinus(String(e.threshold))} → ${e.conditionActive ? 'triggered' : 'not triggered (condition cleared)'}`,
      },
      { label: 'Condition active', value: e.conditionActive ? 'Yes' : 'No' },
      { label: 'Exception status', value: e.status },
    ],
  })
  steps.push({
    kind: 'kpi',
    title: `KPI ${kpiDefinition(e.kpiKey).label} — ${periodLabel(e.period)}`,
    fields: [
      { label: 'Formula', value: calc.formula },
      { label: 'Substituted', value: calc.substituted },
      { label: 'Result (display)', value: calc.result },
      { label: 'Result (stored precision)', value: kpiValueText(e.kpiKey, kv.value) },
      { label: 'Calculation status', value: kv.status + (kv.reason ? ` — ${kv.reason}` : '') },
    ],
  })
  const obsList = metricObservations(e, f).filter((o): o is ObservationRecord => Boolean(o))
  for (const o of obsList) {
    steps.push({
      kind: 'observation',
      title: `Observation ${o.id} — ${METRIC_LABELS[o.metricKey]} ${periodLabel(o.period)}`,
      fields: [
        { label: 'Actual', value: o.actualValue === null ? '—' : withMinus(String(o.actualValue)) },
        { label: 'Plan', value: o.planValue === null ? '—' : withMinus(String(o.planValue)) },
        { label: 'Original values', value: Object.entries(o.originalValues).map(([k, v]) => `${k}="${v}"`).join(', ') },
        { label: 'Validation', value: o.validationStatus },
        { label: 'Current', value: o.isCurrent ? 'Yes' : 'No (superseded)' },
      ],
    })
  }
  const jobs = [...new Map(obsList.map((o) => [`${o.importJobId}|${o.sourceRow}`, o])).values()]
  for (const o of jobs) {
    steps.push({
      kind: 'import',
      title: `Import ${o.importJobId}`,
      fields: [
        { label: 'File', value: o.fileName },
        { label: 'Row', value: String(o.sourceRow) },
        { label: 'Imported at', value: o.importedAt },
        { label: 'Imported by', value: o.importedBy },
        { label: 'Source', value: o.sourceName },
        { label: 'Source updated at', value: o.sourceUpdatedAt },
      ],
    })
  }
  return clone(steps)
}

const RESOLUTION_REASONS: ResolutionReason[] = [
  'action_verified',
  'data_corrected',
  'condition_cleared',
  'not_material',
  'other',
]

export function transitionExceptionDemo(id: string, req: ExceptionTransitionRequest): ExceptionDetail {
  const e = findException(id)
  const from = e.status
  const allowed = EXCEPTION_TRANSITIONS[from]
  if (!allowed.includes(req.to)) {
    throw new ApiError('invalid_transition', `An exception cannot move from ${from} to ${req.to}.`, {
      allowedTransitions: allowed,
    })
  }
  const owner = req.owner?.trim() || null
  const note = req.note?.trim() || null
  const errors: { field: string; message: string }[] = []
  if (req.to === 'in_review' && !owner && !e.owner) {
    errors.push({ field: 'owner', message: 'Assign an owner to put the exception in review.' })
  }
  if (req.to === 'resolved') {
    if (!req.reason) errors.push({ field: 'reason', message: 'A resolution reason is required.' })
    else if (!RESOLUTION_REASONS.includes(req.reason)) errors.push({ field: 'reason', message: `Unknown resolution reason "${req.reason}".` })
  }
  if (errors.length) validationError(errors)

  if (owner && owner !== e.owner) {
    e.history.push(audit(`Owner assigned: ${e.owner ?? '—'} → ${owner}`))
    e.owner = owner
  }
  e.status = req.to
  if (req.to === 'resolved') {
    e.resolvedAt = new Date().toISOString()
    e.resolutionReason = req.reason ?? null
    e.resolutionNote = note
  } else if (from === 'resolved') {
    e.resolvedAt = null
    e.resolutionReason = null
    e.resolutionNote = null
  }
  const detail = [req.to === 'resolved' ? `Reason: ${req.reason}` : null, note ? `Note: ${note}` : null]
    .filter(Boolean)
    .join('. ')
  e.history.push(audit(`Status changed: ${from} → ${req.to}`, detail ? { detail } : {}))
  return getExceptionDemo(id)
}
