/**
 * Investigations. Only the clearly labelled MOCK mode works in the demo: the output is
 * built deterministically from the exception's evidence and the seed template.
 * It confirms only what the data shows and never asserts a cause (Spec §9, §13).
 */
import type {
  EvidenceRef,
  InvestigationDetail,
  InvestigationFilters,
  InvestigationMode,
  InvestigationOutput,
  InvestigationSummary,
} from '@/api/types'
import { ApiError } from '@/api/errors'
import { db, nextId } from './store'
import { METRIC_COLUMNS, METRIC_LABELS, MOCK_INVESTIGATION_TEMPLATE as T } from './seed'
import { companyPeriods, periodFacts, ruleConditionLabel } from './engine'
import { findException } from './exceptions.demo'
import { audit, clone, currentActor, fixed, notFound, nowIso, periodLabel, plainPct, ppText, pctText, validationError } from './util'
import { companyName, toInvestigationSummary } from './views'

export const LIVE_AI_CONFIGURED = false

function findInvestigation(id: string): InvestigationDetail {
  const inv = db().investigations.find((i) => i.id === id)
  if (!inv) notFound('Investigation', id)
  return inv
}

export function listInvestigationsDemo(f: InvestigationFilters): InvestigationSummary[] {
  return clone(
    db()
      .investigations.filter((i) => !f.companyId || i.companyId === f.companyId)
      .filter((i) => !f.exceptionId || i.exceptionId === f.exceptionId)
      .filter((i) => !f.reviewStatus || i.reviewStatus === f.reviewStatus)
      .map(toInvestigationSummary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
  )
}

export function getInvestigationDemo(id: string): InvestigationDetail {
  return clone(findInvestigation(id))
}

const rawOr = (orig: Record<string, string> | undefined, field: string, v: number | null) =>
  orig?.[field]?.trim() || (v === null ? '—' : String(v))

/** "3.57% below plan" / "2.50% above plan" / "in line with plan". */
function vsPlan(value: number, unit: '%' | ' pp'): string {
  const abs = fixed(Math.abs(value), 2)
  if (Number(abs) === 0) return 'in line with plan'
  return `${abs}${unit} ${value < 0 ? 'below' : 'above'} plan`
}

function buildMockRun(exceptionId: string): { evidence: EvidenceRef[]; output: InvestigationOutput } {
  const s = db()
  const e = findException(exceptionId)
  const f = periodFacts(s, e.companyId, e.period)
  const name = companyName(s, e.companyId)
  const pl = periodLabel(e.period)
  const k = f.kpis
  const id = (kpi: string) => `kpi:${e.companyId}:${kpi}`

  const evidence: EvidenceRef[] = []
  const observations: InvestigationOutput['confirmedObservations'] = []

  // Revenue
  if (f.revenueObs) {
    const c = METRIC_COLUMNS.revenue
    evidence.push({
      id: `obs:${f.revenueObs.id}`,
      label: `Revenue actual vs plan (${pl}, USD m)`,
      value: `${rawOr(f.revenueObs.originalValues, c.actual, f.revenue.actual)} vs ${rawOr(f.revenueObs.originalValues, c.plan, f.revenue.plan)}`,
    })
  }
  evidence.push({ id: id('revenue_variance_pct'), label: `Revenue variance % (${pl})`, value: k.revenue_variance_pct.status === 'ok' ? pctText(k.revenue_variance_pct.value) : `Not calculable — ${k.revenue_variance_pct.reason ?? ''}` })
  if (k.revenue_variance_pct.status === 'ok' && k.revenue_variance_pct.value !== null && f.revenueObs) {
    observations.push({
      statement: `Revenue was ${vsPlan(k.revenue_variance_pct.value, '%')} in ${pl} (${f.revenue.actual} vs ${f.revenue.plan} USD m).`,
      evidenceIds: [`obs:${f.revenueObs.id}`, id('revenue_variance_pct')],
    })
  }

  // EBITDA
  if (f.ebitdaObs) {
    const c = METRIC_COLUMNS.ebitda
    evidence.push({
      id: `obs:${f.ebitdaObs.id}`,
      label: `EBITDA actual vs plan (${pl}, USD m)`,
      value: `${rawOr(f.ebitdaObs.originalValues, c.actual, f.ebitda.actual)} vs ${rawOr(f.ebitdaObs.originalValues, c.plan, f.ebitda.plan)}`,
    })
  }
  evidence.push({ id: id('ebitda_variance_pct'), label: `EBITDA variance % (${pl})`, value: k.ebitda_variance_pct.status === 'ok' ? pctText(k.ebitda_variance_pct.value) : `Not calculable — ${k.ebitda_variance_pct.reason ?? ''}` })
  if (k.ebitda_variance_pct.status === 'ok' && k.ebitda_variance_pct.value !== null && f.ebitdaObs) {
    const c = METRIC_COLUMNS.ebitda
    observations.push({
      statement: `EBITDA was ${vsPlan(k.ebitda_variance_pct.value, '%')} in ${pl} (${rawOr(f.ebitdaObs.originalValues, c.actual, f.ebitda.actual)} vs ${rawOr(f.ebitdaObs.originalValues, c.plan, f.ebitda.plan)} USD m).`,
      evidenceIds: [`obs:${f.ebitdaObs.id}`, id('ebitda_variance_pct')],
    })
  }

  // Margin
  const mOk = k.ebitda_margin_variance_pp.status === 'ok' && k.ebitda_margin_variance_pp.value !== null
  evidence.push({
    id: id('ebitda_margin_variance_pp'),
    label: `EBITDA margin actual vs plan (${pl})`,
    value: mOk
      ? `${plainPct(k.ebitda_margin_actual_pct.value)} vs ${plainPct(k.ebitda_margin_plan_pct.value)} (${ppText(k.ebitda_margin_variance_pp.value)})`
      : `Not calculable — ${k.ebitda_margin_variance_pp.reason ?? ''}`,
  })
  if (mOk) {
    observations.push({
      statement: `EBITDA margin was ${plainPct(k.ebitda_margin_actual_pct.value)} against a planned ${plainPct(k.ebitda_margin_plan_pct.value)} (${ppText(k.ebitda_margin_variance_pp.value)}).`,
      evidenceIds: [id('ebitda_margin_variance_pp')],
    })
  }

  // Rule + source + history
  const condition = ruleConditionLabel(e.kpiKey, e.threshold)
  evidence.push({ id: `rule:${e.ruleKey}`, label: 'Triggered rule', value: `${condition} (${e.severity}, configuration v${e.ruleConfigurationVersion})` })
  observations.push({
    statement: `The rule "${condition}" (${e.severity} severity) was triggered under rule configuration v${e.ruleConfigurationVersion}.`,
    evidenceIds: [`rule:${e.ruleKey}`, id(e.kpiKey)],
  })
  const srcObs = f.ebitdaObs ?? f.revenueObs
  if (srcObs) {
    evidence.push({
      id: `src:${srcObs.importJobId}`,
      label: 'Source and freshness',
      value: `${srcObs.sourceName}, source updated ${srcObs.sourceUpdatedAt.slice(0, 10)}; imported ${srcObs.importedAt.slice(0, 10)} from ${srcObs.fileName}, row ${srcObs.sourceRow}`,
    })
  }
  const periods = companyPeriods(s, e.companyId)
  evidence.push({
    id: `hist:${e.companyId}`,
    label: 'Stored reporting periods',
    value: `${periods.length} (${periods.map(periodLabel).join(', ')})`,
  })
  if (periods.length <= 1) {
    observations.push({
      statement: `Only one reporting period (${pl}) is stored for ${name}, so no trend can be assessed.`,
      evidenceIds: [`hist:${e.companyId}`],
    })
  }

  // Hypotheses — never stronger than "weak" because no explanatory data exists.
  const revenueBelow = k.revenue_variance_pct.status === 'ok' && (k.revenue_variance_pct.value ?? 0) < 0
  const marginBelow = mOk && (k.ebitda_margin_variance_pp.value ?? 0) < 0
  const missingType = (mid: string) => T.missingEvidence.find((m) => m.id === mid)?.type ?? mid
  const potentialExplanations: InvestigationOutput['potentialExplanations'] = T.explanations.map((x) => {
    const supportingEvidenceIds =
      x.supportedBy === 'revenue_below_plan' && revenueBelow
        ? [id('revenue_variance_pct')]
        : x.supportedBy === 'margin_below_plan' && marginBelow
          ? [id('ebitda_margin_variance_pp')]
          : []
    return {
      id: x.id,
      statement: x.statement,
      supportingEvidenceIds,
      missingEvidence: x.missing.map(missingType),
      evidenceStrength: supportingEvidenceIds.length ? 'weak' : 'none',
    }
  })

  const metricLabel = METRIC_LABELS[e.metricKey]
  const kv = k[e.kpiKey]
  const varianceText =
    kv.value === null ? 'outside its plan' : vsPlan(kv.value, e.kpiKey === 'ebitda_margin_variance_pp' ? ' pp' : '%')
  const output: InvestigationOutput = {
    executiveSummary:
      `${metricLabel} at ${name} was ${varianceText} in ${pl}, which triggered the rule "${condition}". ` +
      'The supplied data confirms the size of the variance but not its cause. ' +
      `Additional evidence is needed before any explanation can be assessed: ${T.missingEvidence
        .map((m) => m.type.toLowerCase())
        .join(', ')
        .replace(/, ([^,]*)$/, ' and $1')}. ` +
      'MOCK INVESTIGATION — generated from a deterministic template, not by an AI model.',
    confirmedObservations: observations,
    potentialExplanations,
    missingEvidence: T.missingEvidence.map((m) => ({
      type: m.type,
      whyNeeded: m.whyNeeded,
      explanations: T.explanations.filter((x) => x.missing.includes(m.id)).map((x) => x.id),
    })),
    managementQuestions: clone(T.managementQuestions),
    nextSteps: clone(T.nextSteps),
    suggestedActions: clone(T.suggestedActions),
    overallAssessment: {
      causeDetermination: 'undetermined',
      evidenceStrength: potentialExplanations.some((p) => p.evidenceStrength === 'weak') ? 'weak' : 'none',
      rationale:
        'The data shows the size of the variance but contains nothing that distinguishes between the possible explanations. ' +
        'No cause can be determined until the missing evidence is supplied and reviewed.',
    },
    dataLimitations: [...T.dataLimitations],
  }
  return { evidence, output }
}

export function generateInvestigationDemo(exceptionId: string, mode: InvestigationMode): InvestigationDetail {
  const s = db()
  const e = findException(exceptionId)
  if (mode === 'live') {
    throw new ApiError(
      'provider_unavailable',
      'No AI provider is configured for this workspace. Use the mock investigation, or configure a provider on the backend.',
    )
  }
  const { evidence, output } = buildMockRun(exceptionId)
  const previous = s.investigations.filter((i) => i.exceptionId === exceptionId).length
  const inv: InvestigationDetail = {
    id: nextId('INV'),
    exceptionId,
    companyId: e.companyId,
    companyName: companyName(s, e.companyId),
    metricLabel: METRIC_LABELS[e.metricKey],
    mode: 'mock',
    status: 'completed',
    reviewStatus: 'unreviewed',
    createdAt: nowIso(),
    evidence,
    output,
    editedOutput: null,
    analystNotes: [],
    error: null,
    modelMetadata: { ...T.modelMetadata },
    reviewedBy: null,
    reviewedAt: null,
  }
  s.investigations.push(inv)
  e.history.push(
    audit(`Mock investigation ${inv.id} ${previous ? 'regenerated' : 'generated'}`, {
      detail: previous ? `Run ${previous + 1}; earlier runs are kept.` : 'Deterministic template, not an AI model.',
    }),
  )
  return clone(inv)
}

export function addInvestigationNoteDemo(id: string, text: string): InvestigationDetail {
  const inv = findInvestigation(id)
  const t = text.trim()
  if (!t) validationError([{ field: 'text', message: 'The note cannot be empty.' }])
  inv.analystNotes.push({ id: nextId('NOTE'), at: nowIso(), author: currentActor(), text: t })
  return clone(inv)
}

function outputErrors(o: InvestigationOutput | null | undefined): { field: string; message: string }[] {
  if (!o || typeof o !== 'object') return [{ field: 'edited', message: 'The edited investigation is empty.' }]
  const errors: { field: string; message: string }[] = []
  if (typeof o.executiveSummary !== 'string' || !o.executiveSummary.trim()) {
    errors.push({ field: 'executiveSummary', message: 'The executive summary cannot be empty.' })
  }
  const arrays = [
    'confirmedObservations',
    'potentialExplanations',
    'missingEvidence',
    'managementQuestions',
    'nextSteps',
    'suggestedActions',
    'dataLimitations',
  ] as const
  for (const key of arrays) {
    if (!Array.isArray(o[key])) errors.push({ field: key, message: `${key} must be a list.` })
  }
  if (!o.overallAssessment || typeof o.overallAssessment.rationale !== 'string') {
    errors.push({ field: 'overallAssessment', message: 'The overall assessment is missing.' })
  }
  return errors
}

/** Stores the analyst's edit separately; the raw output never changes. Editing requires a fresh review. */
export function saveInvestigationEditDemo(id: string, edited: InvestigationOutput): InvestigationDetail {
  const inv = findInvestigation(id)
  const errors = outputErrors(edited)
  if (errors.length) validationError(errors)
  inv.editedOutput = clone(edited)
  if (inv.reviewStatus === 'reviewed') {
    inv.reviewStatus = 'unreviewed'
    inv.reviewedBy = null
    inv.reviewedAt = null
  }
  return clone(inv)
}

export function markInvestigationReviewedDemo(id: string): InvestigationDetail {
  const inv = findInvestigation(id)
  if (inv.status !== 'completed') {
    throw new ApiError('conflict', 'Only a completed investigation can be marked reviewed.')
  }
  inv.reviewStatus = 'reviewed'
  inv.reviewedBy = currentActor()
  inv.reviewedAt = nowIso()
  const e = db().exceptions.find((x) => x.id === inv.exceptionId)
  e?.history.push(audit(`Investigation ${inv.id} marked reviewed`))
  return clone(inv)
}
