/**
 * Portfolio Overview. Every count is derived from store records (Spec §4).
 * Cards cover the whole portfolio for the selected period, so they always equal what
 * the Exceptions / Actions lists show; rows and charts also apply sector/status/search.
 */
import type { CompanyStatus, OverviewResponse, PortfolioFilters, Severity } from '@/api/types'
import { db } from './store'
import { isOpenException, latestPeriod } from './engine'
import { companyRows } from './companies.demo'
import { lastImportAt, toPeriod } from './workspace.demo'
import { clone } from './util'
import { isOverdue } from './views'

const STATUSES: CompanyStatus[] = ['on_track', 'warning', 'exception', 'insufficient_data']
const SEVERITIES: Severity[] = ['high', 'medium', 'warning']

export function overviewDemo(filters: PortfolioFilters): OverviewResponse {
  const s = db()
  const period = filters.period ?? latestPeriod(s)
  const allRows = companyRows({ period })
  const rows = companyRows({ ...filters, period })
  const rowIds = new Set(rows.map((r) => r.id))
  const periodOpenExceptions = s.exceptions.filter((e) => e.period === period && isOpenException(e))

  return clone({
    period: toPeriod(period),
    cards: {
      companies: allRows.length,
      requiringAttention: allRows.filter((r) => r.status === 'exception' || r.status === 'warning').length,
      openHighExceptions: periodOpenExceptions.filter((e) => e.severity === 'high').length,
      overdueActions: s.actions.filter(isOverdue).length,
      awaitingVerification: s.actions.filter((a) => a.status === 'completed' || a.status === 'outcome_verification').length,
    },
    rows,
    sectors: [...new Set(s.companies.map((c) => c.sector))].sort(),
    charts: {
      revenueByCompany: rows.map((r) => ({
        companyId: r.id,
        companyName: r.name,
        actual: r.financials.revenue.actual,
        plan: r.financials.revenue.plan,
      })),
      ebitdaByCompany: rows.map((r) => ({
        companyId: r.id,
        companyName: r.name,
        actual: r.financials.ebitda.actual,
        plan: r.financials.ebitda.plan,
      })),
      statusDistribution: STATUSES.map((status) => ({ status, count: rows.filter((r) => r.status === status).length })),
      exceptionsBySeverity: SEVERITIES.map((severity) => ({
        severity,
        count: periodOpenExceptions.filter((e) => e.severity === severity && rowIds.has(e.companyId)).length,
      })),
    },
    freshness: { latestPeriod: latestPeriod(s), lastImportAt: lastImportAt() },
  })
}
