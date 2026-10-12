/** Portfolio Companies list and Company Detail, derived from the store. */
import type {
  CompanyDetail,
  CompanyPeriodPoint,
  CompanySummary,
  MetricDefinition,
  PortfolioFilters,
} from '@/api/types'
import { db } from './store'
import { companyPeriods, latestPeriod, periodFacts } from './engine'
import { clone, notFound, periodLabel } from './util'
import {
  exceptionSort,
  toActionSummary,
  toCompanySummary,
  toExceptionSummary,
  toInvestigationSummary,
} from './views'

/** All companies for a period, with the portfolio filters applied, sorted by name. */
export function companyRows(filters: PortfolioFilters): CompanySummary[] {
  const s = db()
  const period = filters.period ?? latestPeriod(s)
  const search = filters.search?.trim().toLowerCase() ?? ''
  return s.companies
    .map((c) => toCompanySummary(s, c, period))
    .filter((r) => !filters.sector || r.sector === filters.sector)
    .filter((r) => !filters.status || r.status === filters.status)
    .filter((r) => !filters.attention || r.status === 'warning' || r.status === 'exception')
    .filter((r) => !search || r.name.toLowerCase().includes(search))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function listCompaniesDemo(filters: PortfolioFilters): CompanySummary[] {
  return clone(companyRows(filters))
}

export function getCompanyDemo(id: string): CompanyDetail {
  const s = db()
  const company = s.companies.find((c) => c.id === id)
  if (!company) notFound('Company', id)

  const periods = companyPeriods(s, id)
  const period = periods[periods.length - 1] ?? latestPeriod(s)

  const history: CompanyPeriodPoint[] = periods.map((p) => {
    const f = periodFacts(s, id, p)
    return {
      period: p,
      periodLabel: periodLabel(p),
      revenue: f.revenue,
      ebitda: f.ebitda,
      marginActualPct: f.kpis.ebitda_margin_actual_pct.value,
      marginPlanPct: f.kpis.ebitda_margin_plan_pct.value,
    }
  })

  const obs = s.observations.filter((o) => o.companyId === id && o.isCurrent)
  const has = (m: 'revenue' | 'ebitda') => obs.some((o) => o.metricKey === m && (o.actualValue !== null || o.planValue !== null))
  const marginHasData = history.some((h) => h.marginActualPct !== null || h.marginPlanPct !== null)
  const metrics: MetricDefinition[] = [
    { key: 'revenue', label: 'Revenue', unit: 'currency', description: 'Reported revenue, actual vs plan (USD millions).', hasData: has('revenue') },
    { key: 'ebitda', label: 'EBITDA', unit: 'currency', description: 'Reported EBITDA, actual vs plan (USD millions).', hasData: has('ebitda') },
    { key: 'ebitda_margin', label: 'EBITDA margin', unit: 'pct', description: 'EBITDA / Revenue × 100, actual vs plan.', hasData: marginHasData },
  ]

  return clone({
    company: toCompanySummary(s, company, period),
    history,
    metrics,
    exceptions: s.exceptions
      .filter((e) => e.companyId === id)
      .map((e) => toExceptionSummary(s, e))
      .sort(exceptionSort),
    investigations: s.investigations
      .filter((i) => i.companyId === id)
      .map(toInvestigationSummary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    actions: s.actions
      .filter((a) => a.companyId === id)
      .map((a) => toActionSummary(s, a))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    dataHistory: s.observations
      .filter((o) => o.companyId === id)
      .sort(
        (a, b) =>
          b.period.localeCompare(a.period) ||
          b.importedAt.localeCompare(a.importedAt) ||
          a.metricKey.localeCompare(b.metricKey),
      ),
  })
}
