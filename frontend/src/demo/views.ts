/**
 * Builders that turn store records into API response shapes (joins + derived fields).
 * Shared by the per-screen *.demo.ts files. All values are derived from the store.
 */
import type {
  ActionDetail,
  ActionStatus,
  ActionSummary,
  CompanySummary,
  ExceptionStatus,
  ExceptionSummary,
  ImpactRecord,
  ImpactVerificationStatus,
  InvestigationDetail,
  InvestigationSummary,
} from '@/api/types'
import type { ActionRecord, CompanyRecord, DemoState, ExceptionRecord, ImpactRow } from './store'
import { METRIC_LABELS } from './seed'
import { SEVERITY_RANK, companyStatus, isOpenException, periodFacts, ruleConditionLabel } from './engine'
import { clone, todayIso } from './util'

export function companyName(s: DemoState, id: string): string {
  return s.companies.find((c) => c.id === id)?.name ?? id
}

// ---------- Companies ----------

export const OPEN_ACTION_STATUSES: ActionStatus[] = [
  'proposed',
  'approved',
  'in_progress',
  'completed',
  'outcome_verification',
  'reopened',
]

export function toCompanySummary(s: DemoState, c: CompanyRecord, period: string): CompanySummary {
  const f = periodFacts(s, c.id, period)
  const imported = [f.revenueObs?.importedAt, f.ebitdaObs?.importedAt].filter((x): x is string => Boolean(x)).sort()
  return {
    id: c.id,
    name: c.name,
    sector: c.sector,
    currency: c.currency,
    period,
    financials: { revenue: f.revenue, ebitda: f.ebitda },
    kpis: f.kpis,
    status: companyStatus(s, c.id, period),
    openExceptions: s.exceptions.filter((e) => e.companyId === c.id && e.period === period && isOpenException(e)).length,
    openActions: s.actions.filter((a) => a.companyId === c.id && OPEN_ACTION_STATUSES.includes(a.status)).length,
    lastDataUpdate: imported[imported.length - 1] ?? c.updatedAt,
  }
}

// ---------- Exceptions ----------

export const EXCEPTION_TRANSITIONS: Record<ExceptionStatus, ExceptionStatus[]> = {
  open: ['acknowledged', 'in_review', 'resolved'],
  acknowledged: ['in_review', 'resolved'],
  in_review: ['resolved'],
  resolved: ['open'],
}

export function toExceptionSummary(s: DemoState, e: ExceptionRecord): ExceptionSummary {
  const f = periodFacts(s, e.companyId, e.period)
  let actualValue: number | null
  let planValue: number | null
  let variancePct: number | null
  if (e.metricKey === 'ebitda_margin') {
    actualValue = f.kpis.ebitda_margin_actual_pct.value
    planValue = f.kpis.ebitda_margin_plan_pct.value
    variancePct = f.kpis.ebitda_margin_variance_pp.value
  } else {
    actualValue = f[e.metricKey].actual
    planValue = f[e.metricKey].plan
    variancePct = f.kpis[e.metricKey === 'revenue' ? 'revenue_variance_pct' : 'ebitda_variance_pct'].value
  }
  return {
    id: e.id,
    companyId: e.companyId,
    companyName: companyName(s, e.companyId),
    period: e.period,
    metricKey: e.metricKey,
    kpiKey: e.kpiKey,
    metricLabel: METRIC_LABELS[e.metricKey],
    actualValue,
    planValue,
    variancePct,
    severity: e.severity,
    ruleKey: e.ruleKey,
    ruleLabel: ruleConditionLabel(e.kpiKey, e.threshold),
    threshold: e.threshold,
    status: e.status,
    conditionActive: e.conditionActive,
    owner: e.owner,
    createdAt: e.createdAt,
  }
}

/** Open first, then most severe, then newest. */
export function exceptionSort(a: ExceptionSummary, b: ExceptionSummary): number {
  const openA = a.status !== 'resolved' && a.conditionActive ? 1 : 0
  const openB = b.status !== 'resolved' && b.conditionActive ? 1 : 0
  return (
    openB - openA ||
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id)
  )
}

// ---------- Investigations ----------

export function toInvestigationSummary(inv: InvestigationDetail): InvestigationSummary {
  return {
    id: inv.id,
    exceptionId: inv.exceptionId,
    companyId: inv.companyId,
    companyName: inv.companyName,
    metricLabel: inv.metricLabel,
    mode: inv.mode,
    status: inv.status,
    reviewStatus: inv.reviewStatus,
    createdAt: inv.createdAt,
  }
}

// ---------- Actions ----------

export const ACTION_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  proposed: ['approved', 'cancelled'],
  approved: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['outcome_verification'],
  outcome_verification: ['verified', 'reopened'],
  verified: [],
  reopened: ['in_progress', 'cancelled'],
  cancelled: [],
}

/** Statuses in which an action can still become overdue. */
const OVERDUE_STATUSES: ActionStatus[] = ['proposed', 'approved', 'in_progress', 'reopened']

export function isOverdue(a: ActionRecord): boolean {
  return a.dueDate !== null && a.dueDate < todayIso() && OVERDUE_STATUSES.includes(a.status)
}

/**
 * Derived from the action's impact records. The weakest state wins, so an action is
 * only "verified" when every impact record is verified.
 */
export function actionVerificationStatus(s: DemoState, actionId: string): ImpactVerificationStatus | 'none' {
  const impacts = s.impacts.filter((i) => i.actionId === actionId)
  if (impacts.length === 0) return 'none'
  const order: ImpactVerificationStatus[] = ['rejected', 'unverified', 'not_yet_measurable', 'verified']
  for (const st of order) if (impacts.some((i) => i.verificationStatus === st)) return st
  return 'none'
}

export function toActionSummary(s: DemoState, a: ActionRecord): ActionSummary {
  return {
    id: a.id,
    companyId: a.companyId,
    companyName: companyName(s, a.companyId),
    exceptionId: a.exceptionId,
    investigationId: a.investigationId,
    title: a.title,
    priority: a.priority,
    owner: a.owner,
    dueDate: a.dueDate,
    status: a.status,
    isOverdue: isOverdue(a),
    verificationStatus: actionVerificationStatus(s, a.id),
    createdAt: a.createdAt,
  }
}

export function toActionDetail(s: DemoState, a: ActionRecord): ActionDetail {
  return clone({
    ...toActionSummary(s, a),
    description: a.description,
    completionNotes: a.completionNotes,
    cancelReason: a.cancelReason,
    evidence: a.evidence,
    notes: a.notes,
    impacts: s.impacts.filter((i) => i.actionId === a.id).map((i) => toImpact(s, i)),
    allowedTransitions: [...ACTION_TRANSITIONS[a.status]],
    history: a.history,
    updatedAt: a.updatedAt,
  })
}

// ---------- Impact ----------

export function toImpact(s: DemoState, i: ImpactRow): ImpactRecord {
  return clone({
    ...i,
    companyName: companyName(s, i.companyId),
    actionTitle: s.actions.find((a) => a.id === i.actionId)?.title ?? i.actionId,
  })
}
