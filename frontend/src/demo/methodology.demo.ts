/** Data & Methodology (Spec §12), derived from the store and the KPI definitions. */
import type { MethodologyResponse } from '@/api/types'
import { db } from './store'
import { WORKSPACE_META } from './seed'
import { allPeriods, currentObservation, latestPeriod, ruleConditionLabel } from './engine'
import { KPI_DEFINITIONS } from './kpi'
import { LIVE_AI_CONFIGURED } from './investigations.demo'
import { lastImportAt, toPeriod } from './workspace.demo'
import { clone } from './util'

export function methodologyDemo(): MethodologyResponse {
  const s = db()
  const current = s.observations.filter((o) => o.isCurrent)

  const sources = new Map<string, MethodologyResponse['dataSources'][number]>()
  for (const o of current) {
    const key = `${o.sourceName}|${o.fileName}`
    const prev = sources.get(key)
    sources.set(key, {
      name: o.sourceName,
      fileName: o.fileName,
      updatedAt: prev && prev.updatedAt > o.sourceUpdatedAt ? prev.updatedAt : o.sourceUpdatedAt,
      lastImportAt: prev && prev.lastImportAt > o.importedAt ? prev.lastImportAt : o.importedAt,
    })
  }

  const missingData: MethodologyResponse['missingData'] = []
  for (const c of s.companies) {
    for (const period of allPeriods(s)) {
      for (const m of ['revenue', 'ebitda'] as const) {
        const label = m === 'revenue' ? 'Revenue' : 'EBITDA'
        const o = currentObservation(s, c.id, period, m)
        if (!o) missingData.push({ companyName: c.name, field: `${label} actual and plan`, period })
        else {
          if (o.actualValue === null) missingData.push({ companyName: c.name, field: `${label} actual`, period })
          if (o.planValue === null) missingData.push({ companyName: c.name, field: `${label} plan`, period })
        }
      }
    }
  }

  const rules = s.ruleConfiguration.rules
  return clone({
    methodologyVersion: WORKSPACE_META.methodologyVersion,
    period: toPeriod(latestPeriod(s)),
    lastImportAt: lastImportAt(),
    kpiDefinitions: KPI_DEFINITIONS,
    ruleConfiguration: s.ruleConfiguration,
    edgeCases: [
      { case: 'Plan value is zero', handling: 'Variance % is "not calculable" with the reason shown. No exception is raised.' },
      { case: 'Actual or plan value is missing', handling: 'Stored as missing (shown as "—"), never as zero. Dependent KPIs are "not calculable"; no exception is raised.' },
      { case: 'Plan value is negative', handling: 'Variance % is calculated but flagged "sign ambiguous"; no exception is raised from it.' },
      { case: 'Revenue is zero', handling: 'EBITDA margin is "not calculable".' },
      {
        case: 'A KPI breaches several rules',
        handling: `Only the most severe exception is active (e.g. ${rules.map((r) => ruleConditionLabel(r.kpiKey, r.threshold)).join('; ')}).`,
      },
      { case: 'Rule thresholds change', handling: 'The configuration version increases and all exceptions are re-evaluated. Cleared exceptions are kept with their history and marked "condition cleared — review".' },
      { case: 'Same company and period imported again', handling: 'Identical values are reported as unchanged. Different values supersede the previous observation, which is kept in the data history.' },
      { case: 'Duplicate company-period rows in one file', handling: 'All copies are reported as invalid and none is imported.' },
      { case: 'Invalid rows in a file', handling: 'Reported with row number, field and reason. They are never silently dropped and are not imported.' },
      { case: 'Rounding', handling: 'KPIs are stored to 10 decimal places; the interface rounds for display only.' },
    ],
    dataSources: [...sources.values()],
    missingData,
    validationErrors: s.lastValidationErrors,
    knownLimitations: [
      'Demo environment: all company data is fictional and state resets on page reload.',
      'Only revenue and EBITDA (actual and plan) are imported; other operating metrics have no data yet and are not shown.',
      `Data is monthly and periodic, not real-time. Latest period: ${toPeriod(latestPeriod(s)).label}.`,
      'Thresholds are demo assumptions, not universal private-equity standards.',
      'Investigations use a deterministic mock template; no AI provider is configured.',
      'Single-currency workspace (USD millions); no FX conversion.',
    ],
    aiStatus: {
      mode: s.aiMode,
      liveConfigured: LIVE_AI_CONFIGURED,
      note: 'No AI provider is configured. Investigations are clearly labelled MOCK and are generated from a deterministic template, not by an AI model.',
    },
    dataNature: [
      { item: 'Revenue and EBITDA actuals', nature: 'observed' },
      { item: 'Revenue and EBITDA plan values (as reported by the source)', nature: 'observed' },
      { item: 'Variances, variance % and EBITDA margins', nature: 'calculated' },
      { item: 'Company status and exceptions', nature: 'calculated' },
      { item: 'Investigation explanations', nature: 'hypothetical' },
      { item: 'Impact targets', nature: 'hypothetical' },
      { item: 'Impact estimates (projections, never realised)', nature: 'estimated' },
      { item: 'Impact observed values', nature: 'observed' },
    ],
  })
}
