/**
 * Read-model helpers and the rules engine for the demo backend.
 * Everything here derives from the store state; no demo facts live here.
 *
 * Engine guarantees (Spec §7, §8):
 * - Same data + same rules → same KPIs and exception decisions.
 * - Dedupe key: company + period + KPI + rule.
 * - When several rules on one KPI match, only the most severe one is active.
 * - not_calculable / sign_ambiguous KPIs never create an exception.
 * - Re-evaluation never deletes an exception; it updates `conditionActive` and appends history.
 */
import type {
  ActualPlan,
  CompanyStatus,
  KpiKey,
  KpiValue,
  MetricKey,
  ObservationRecord,
  Rule,
  Severity,
} from '@/api/types'
import type { DemoState, ExceptionRecord } from './store'
import { DEMO_PERIOD, METRIC_LABELS } from './seed'
import { KPI_KEYS, KPI_METRIC, calculateKpis, kpiUnit } from './kpi'
import { audit, fixed, seqId, withMinus } from './util'

// ---------- Observations & KPIs ----------

export function currentObservation(
  s: DemoState,
  companyId: string,
  period: string,
  metricKey: MetricKey,
): ObservationRecord | undefined {
  return s.observations.find(
    (o) => o.isCurrent && o.companyId === companyId && o.period === period && o.metricKey === metricKey,
  )
}

export interface PeriodFacts {
  revenue: ActualPlan
  ebitda: ActualPlan
  revenueObs: ObservationRecord | undefined
  ebitdaObs: ObservationRecord | undefined
  kpis: Record<KpiKey, KpiValue>
  hasData: boolean
}

const ap = (o: ObservationRecord | undefined): ActualPlan => ({
  actual: o ? o.actualValue : null,
  plan: o ? o.planValue : null,
})

export function periodFacts(s: DemoState, companyId: string, period: string): PeriodFacts {
  const revenueObs = currentObservation(s, companyId, period, 'revenue')
  const ebitdaObs = currentObservation(s, companyId, period, 'ebitda')
  const revenue = ap(revenueObs)
  const ebitda = ap(ebitdaObs)
  return {
    revenue,
    ebitda,
    revenueObs,
    ebitdaObs,
    kpis: calculateKpis(revenue, ebitda),
    hasData: Boolean(revenueObs || ebitdaObs),
  }
}

/** Periods with stored current observations, ascending. */
export function companyPeriods(s: DemoState, companyId: string): string[] {
  return [...new Set(s.observations.filter((o) => o.isCurrent && o.companyId === companyId).map((o) => o.period))].sort()
}

/** All periods with data, latest first. */
export function allPeriods(s: DemoState): string[] {
  const periods = [...new Set(s.observations.filter((o) => o.isCurrent).map((o) => o.period))].sort().reverse()
  return periods.length ? periods : [DEMO_PERIOD.key]
}

export const latestPeriod = (s: DemoState): string => allPeriods(s)[0] ?? DEMO_PERIOD.key

// ---------- Exceptions & status ----------

/** Unresolved and the condition still holds. */
export const isOpenException = (e: ExceptionRecord): boolean => e.status !== 'resolved' && e.conditionActive

export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, warning: 1 }

export function companyStatus(s: DemoState, companyId: string, period: string): CompanyStatus {
  const open = s.exceptions.filter((e) => e.companyId === companyId && e.period === period && isOpenException(e))
  if (open.some((e) => e.severity === 'high' || e.severity === 'medium')) return 'exception'
  if (open.some((e) => e.severity === 'warning')) return 'warning'
  const f = periodFacts(s, companyId, period)
  if (!f.hasData || KPI_KEYS.some((k) => f.kpis[k].status !== 'ok')) return 'insufficient_data'
  return 'on_track'
}

/** Human condition text, e.g. "EBITDA variance ≤ −10%". */
export function ruleConditionLabel(kpiKey: KpiKey, threshold: number): string {
  const metric = KPI_METRIC[kpiKey]
  const t = withMinus(String(threshold))
  switch (kpiKey) {
    case 'revenue_variance_pct':
    case 'ebitda_variance_pct':
      return `${METRIC_LABELS[metric]} variance ≤ ${t}%`
    case 'revenue_variance':
    case 'ebitda_variance':
      return `${METRIC_LABELS[metric]} variance ≤ ${t} (USD m)`
    case 'ebitda_margin_actual_pct':
      return `Actual EBITDA margin ≤ ${t}%`
    case 'ebitda_margin_plan_pct':
      return `Planned EBITDA margin ≤ ${t}%`
    case 'ebitda_margin_variance_pp':
      return `EBITDA margin variance ≤ ${t} pp`
  }
}

/** "−14.7368%" style text for a KPI value at full stored precision (4 dp). */
export function kpiValueText(kpiKey: KpiKey, value: number | null): string {
  if (value === null) return '—'
  const unit = kpiUnit(kpiKey)
  return unit === 'pct' ? `${fixed(value, 4)}%` : unit === 'pp' ? `${fixed(value, 4)} pp` : fixed(value, 4)
}

function matches(rule: Rule, kv: KpiValue): boolean {
  return rule.enabled && kv.status === 'ok' && kv.value !== null && rule.comparator === 'lte' && kv.value <= rule.threshold
}

export interface EvaluationResult {
  created: number
  updated: number
  kpisCalculated: number
  createdIds: string[]
}

export function evaluateExceptions(
  s: DemoState,
  ctx: { at: string; actor: string; trigger: string; onlyCompanyPeriods?: Set<string> },
): EvaluationResult {
  const result: EvaluationResult = { created: 0, updated: 0, kpisCalculated: 0, createdIds: [] }
  const config = s.ruleConfiguration
  const kpisWithRules = [...new Set(config.rules.map((r) => r.kpiKey))]
  const opts = { actor: ctx.actor, at: ctx.at }

  for (const company of s.companies) {
    for (const period of companyPeriods(s, company.id)) {
      if (ctx.onlyCompanyPeriods && !ctx.onlyCompanyPeriods.has(`${company.id}|${period}`)) continue
      const facts = periodFacts(s, company.id, period)
      result.kpisCalculated += KPI_KEYS.length

      for (const kpiKey of kpisWithRules) {
        const kv = facts.kpis[kpiKey]
        const rules = config.rules.filter((r) => r.kpiKey === kpiKey)
        const winner = rules
          .filter((r) => matches(r, kv))
          .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.threshold - b.threshold)[0]
        const valueText = kpiValueText(kpiKey, kv.value)

        for (const rule of rules) {
          const existing = s.exceptions.find(
            (e) => e.companyId === company.id && e.period === period && e.kpiKey === kpiKey && e.ruleKey === rule.key,
          )
          const condition = ruleConditionLabel(kpiKey, rule.threshold)

          if (winner && rule.id === winner.id) {
            if (!existing) {
              const id = seqId(s, 'EXC')
              s.exceptions.push({
                id,
                companyId: company.id,
                period,
                metricKey: KPI_METRIC[kpiKey],
                kpiKey,
                ruleId: rule.id,
                ruleKey: rule.key,
                severity: rule.severity,
                threshold: rule.threshold,
                status: 'open',
                conditionActive: true,
                owner: null,
                createdAt: ctx.at,
                resolvedAt: null,
                resolutionReason: null,
                resolutionNote: null,
                ruleConfigurationVersion: config.version,
                evaluatedAt: ctx.at,
                evaluatedValue: kv.value,
                history: [
                  audit(`Exception created by rule ${rule.key}: ${condition}`, {
                    ...opts,
                    detail: `${kpiKey} = ${valueText} under rule configuration v${config.version}. Triggered by ${ctx.trigger}.`,
                  }),
                ],
              })
              result.created += 1
              result.createdIds.push(id)
              continue
            }
            let changed = false
            if (!existing.conditionActive) {
              existing.conditionActive = true
              existing.history.push(
                audit(`Condition re-triggered: ${condition}`, {
                  ...opts,
                  detail: `${kpiKey} = ${valueText} under rule configuration v${config.version}. Triggered by ${ctx.trigger}.`,
                }),
              )
              changed = true
              if (existing.status === 'resolved') {
                existing.status = 'open'
                existing.resolvedAt = null
                existing.history.push(audit('Status changed: resolved → open', { ...opts, detail: 'Reopened because the condition is active again.' }))
              }
            } else if (existing.threshold !== rule.threshold || existing.evaluatedValue !== kv.value) {
              existing.history.push(
                audit(`Re-evaluated: ${condition}`, {
                  ...opts,
                  detail: `${kpiKey} = ${valueText} under rule configuration v${config.version}. Triggered by ${ctx.trigger}.`,
                }),
              )
              changed = true
            }
            existing.threshold = rule.threshold
            existing.severity = rule.severity
            existing.evaluatedValue = kv.value
            existing.evaluatedAt = ctx.at
            existing.ruleConfigurationVersion = config.version
            if (changed) result.updated += 1
            continue
          }

          if (existing && existing.conditionActive) {
            let why: string
            if (!rule.enabled) why = `rule ${rule.key} is disabled`
            else if (kv.status !== 'ok') why = `${kpiKey} is ${kv.status.replace('_', ' ')}${kv.reason ? ` (${kv.reason})` : ''}`
            else if (winner && matches(rule, kv)) why = `superseded by the more severe rule ${winner.key}`
            else why = `${kpiKey} = ${valueText} no longer meets ${condition}`
            existing.conditionActive = false
            existing.evaluatedValue = kv.value
            existing.evaluatedAt = ctx.at
            existing.history.push(
              audit('Condition cleared — review required', {
                ...opts,
                detail: `Under rule configuration v${config.version}: ${why}. Triggered by ${ctx.trigger}.`,
              }),
            )
            result.updated += 1
          }
        }
      }
    }
  }
  return result
}
