/**
 * URL search-param state shared by every page (filters, search and the header's `?period=`),
 * so KPI cards can link to filtered views and every view is shareable.
 *
 * URL params used across pages (keep in sync with the pages that honour them):
 * - `period`    reporting period key, e.g. `2026-09` (absent = workspace current period). Set by the header.
 * - `q`         free-text search (company name on Overview / Companies).
 * - `sector`    company sector (Overview / Companies).
 * - `status`    entity status. Companies: CompanyStatus. Exceptions: ExceptionStatus | `not_resolved`.
 *               Actions: ActionStatus | `awaiting_verification` (= completed + outcome_verification).
 * - `attention` `1` = companies requiring attention (status warning OR exception). Companies page.
 * - `severity`  exception severity. Exceptions page.
 * - `overdue`   `1` = overdue actions only. Actions page.
 * - `company`   company id (slug). Exceptions page filter (→ ExceptionFilters.companyId).
 * - `metric`    MetricKey. Exceptions page filter.
 * - `owner`     owner name. Exceptions page filter.
 * - `tab`       Company Detail tab: exceptions | investigations | actions | data (absent = performance).
 * - `review`    ReviewStatus. Investigations page filter (`company` also applies there).
 * - `new=1&exceptionId=<id>[&investigationId=<id>][&title=<text>]`  Actions page: open the create-action
 *               form pre-linked to that exception (and investigation), with the title pre-filled.
 * - `priority`, `owner`, `company`, `overdue=1`  Actions page filters.
 * - Impact page: `company`, `action` (filter; also pre-links the create form), `verification`
 *   (ImpactVerificationStatus), `new=1` (open the create form), `record=<IMP-id>` (open that record's drawer).
 * Exceptions list: when `period` is absent the list shows ALL periods (the period filter's "All periods").
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export const PERIOD_PARAM = 'period'
export const SEARCH_PARAM = 'q'
export const ATTENTION_PARAM = 'attention'
export const AWAITING_VERIFICATION_STATUS = 'awaiting_verification'

type Patch<K extends string> = Partial<Record<K, string | undefined | null>>

/**
 * Reads/writes a fixed set of search params. Empty values remove the param.
 * Unrelated params (e.g. `period`, unless listed) are preserved.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams()

  const keysKey = keys.join('|')
  const values = useMemo(() => {
    const out = {} as Record<K, string | undefined>
    for (const k of keysKey.split('|') as K[]) out[k] = params.get(k) || undefined
    return out
  }, [params, keysKey])

  /** Apply a patch. `replace` avoids a history entry per keystroke (use for search inputs). */
  const update = useCallback(
    (patch: Patch<K>, opts: { replace?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch) as [string, string | undefined | null][]) {
            if (v === undefined || v === null || v === '') next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: opts.replace },
      )
    },
    [setParams],
  )

  /** Remove all the listed keys. */
  const clear = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const k of keysKey.split('|')) next.delete(k)
      return next
    })
  }, [setParams, keysKey])

  return { values, update, clear }
}

/** The `?period=` selected in the header (undefined = workspace current period). */
export function usePeriodParam(): string | undefined {
  const [params] = useSearchParams()
  return params.get(PERIOD_PARAM) || undefined
}

/** Narrow a URL string to one of the allowed values (invalid → undefined, so bad links don't break the page). */
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

/**
 * Build a link that keeps the current reporting period, e.g.
 * `linkWithPeriod('/exceptions', period, { severity: 'high' })` → `/exceptions?severity=high&period=2026-08`.
 */
export function linkWithPeriod(
  path: string,
  period: string | undefined,
  params: Record<string, string | undefined> = {},
): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v)
  if (period) sp.set(PERIOD_PARAM, period)
  const qs = sp.toString()
  return qs ? `${path}?${qs}` : path
}
