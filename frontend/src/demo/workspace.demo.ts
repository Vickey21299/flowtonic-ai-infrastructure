/** Header / workspace info, derived from the store. */
import type { ReportingPeriod, WorkspaceInfo } from '@/api/types'
import { db } from './store'
import { WORKSPACE_META } from './seed'
import { allPeriods, latestPeriod } from './engine'
import { periodLabel } from './util'

export const toPeriod = (key: string): ReportingPeriod => ({ key, label: periodLabel(key), type: 'month' })

/** Timestamp of the most recent committed import. */
export function lastImportAt(): string {
  const s = db()
  const times = s.importJobs.map((j) => j.committedAt).filter((t): t is string => t !== null).sort()
  return times[times.length - 1] ?? ''
}

export function workspaceDemo(): WorkspaceInfo {
  const s = db()
  const current = s.observations.filter((o) => o.isCurrent)
  const freshest = [...current].sort((a, b) => b.sourceUpdatedAt.localeCompare(a.sourceUpdatedAt))[0]
  return {
    name: WORKSPACE_META.name,
    environment: WORKSPACE_META.environment,
    currency: WORKSPACE_META.currency,
    unit: WORKSPACE_META.unit,
    periods: allPeriods(s).map(toPeriod),
    currentPeriod: latestPeriod(s),
    lastImportAt: lastImportAt(),
    sourceName: freshest?.sourceName ?? '—',
    sourceUpdatedAt: freshest?.sourceUpdatedAt ?? '',
    aiMode: s.aiMode,
    demoUser: { ...WORKSPACE_META.demoUser },
  }
}
