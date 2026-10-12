/**
 * Deterministic KPI calculation (Spec §7) — the demo stand-in for the backend engine.
 *
 * Precision: inputs are converted to scaled integers (common power-of-ten scale) so
 * differences are exact and each ratio is a single correctly-rounded division.
 * Results are kept at 10 decimal places; rounding for display happens in the UI.
 * Missing inputs stay missing (null) and zero denominators are never divided by.
 */
import type { ActualPlan, KpiKey, KpiValue, ValueUnit } from '@/api/types'
import { round } from './util'

export const KPI_KEYS: KpiKey[] = [
  'revenue_variance',
  'revenue_variance_pct',
  'ebitda_variance',
  'ebitda_variance_pct',
  'ebitda_margin_actual_pct',
  'ebitda_margin_plan_pct',
  'ebitda_margin_variance_pp',
]

export const KPI_DEFINITIONS: { key: KpiKey; label: string; formula: string; unit: ValueUnit; notes?: string }[] = [
  { key: 'revenue_variance', label: 'Revenue variance', formula: 'Revenue actual − Revenue plan', unit: 'currency', notes: 'Not calculable when either value is missing.' },
  { key: 'revenue_variance_pct', label: 'Revenue variance %', formula: '(Revenue actual − Revenue plan) / Revenue plan × 100', unit: 'pct', notes: 'Not calculable when plan is zero or missing.' },
  { key: 'ebitda_variance', label: 'EBITDA variance', formula: 'EBITDA actual − EBITDA plan', unit: 'currency', notes: 'Not calculable when either value is missing.' },
  { key: 'ebitda_variance_pct', label: 'EBITDA variance %', formula: '(EBITDA actual − EBITDA plan) / EBITDA plan × 100', unit: 'pct', notes: 'Not calculable when plan is zero or missing. Flagged as sign-ambiguous when plan is negative.' },
  { key: 'ebitda_margin_actual_pct', label: 'Actual EBITDA margin', formula: 'EBITDA actual / Revenue actual × 100', unit: 'pct', notes: 'Not calculable when revenue actual is zero or missing.' },
  { key: 'ebitda_margin_plan_pct', label: 'Planned EBITDA margin', formula: 'EBITDA plan / Revenue plan × 100', unit: 'pct', notes: 'Not calculable when revenue plan is zero or missing.' },
  { key: 'ebitda_margin_variance_pp', label: 'EBITDA margin variance', formula: 'Actual EBITDA margin − Planned EBITDA margin', unit: 'pp', notes: 'Expressed in percentage points. Not calculable unless both margins are.' },
]

export const kpiDefinition = (key: KpiKey) => KPI_DEFINITIONS.find((d) => d.key === key)!

const PRECISION_DP = 10

function decimals(x: number): number | null {
  const s = String(x)
  if (/e/i.test(s)) return null
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

/** Common power-of-ten scale for the inputs, or null when exact scaling isn't safe. */
function commonScale(...xs: number[]): number | null {
  let d = 0
  for (const x of xs) {
    const k = decimals(x)
    if (k === null || k > 9) return null
    d = Math.max(d, k)
  }
  return 10 ** d
}

const fin = (v: number) => round(v, PRECISION_DP)

/** a − b */
function diff(a: number, b: number): number {
  const s = commonScale(a, b)
  if (s === null) return fin(a - b)
  return fin((Math.round(a * s) - Math.round(b * s)) / s)
}

/** (a − b) / b × 100 */
function variancePct(a: number, b: number): number {
  const s = commonScale(a, b)
  if (s === null) return fin(((a - b) / b) * 100)
  const A = Math.round(a * s)
  const B = Math.round(b * s)
  return fin(((A - B) * 100) / B)
}

/** n / d × 100 */
function ratioPct(n: number, d: number): number {
  const s = commonScale(n, d)
  if (s === null) return fin((n / d) * 100)
  return fin((Math.round(n * s) * 100) / Math.round(d * s))
}

/** ea/ra×100 − ep/rp×100, as one fraction when the integers stay safe. */
function marginDiff(ea: number, ra: number, ep: number, rp: number): number {
  const s = commonScale(ea, ra, ep, rp)
  if (s !== null) {
    const [Ea, Ra, Ep, Rp] = [ea, ra, ep, rp].map((x) => Math.round(x * s)) as [number, number, number, number]
    const num = 100 * (Ea * Rp - Ep * Ra)
    const den = Ra * Rp
    if (Number.isSafeInteger(num) && Number.isSafeInteger(den)) return fin(num / den)
  }
  return fin((ea / ra) * 100 - (ep / rp) * 100)
}

const nc = (reason: string): KpiValue => ({ value: null, status: 'not_calculable', reason })

function missingReason(label: string, v: ActualPlan): string | null {
  if (v.actual === null && v.plan === null) return `${label} actual and plan are missing`
  if (v.actual === null) return `${label} actual is missing`
  if (v.plan === null) return `${label} plan is missing`
  return null
}

function varianceKpis(label: string, v: ActualPlan): { abs: KpiValue; pct: KpiValue } {
  const missing = missingReason(label, v)
  if (missing || v.actual === null || v.plan === null) {
    const r = missing ?? `${label} values are missing`
    return { abs: nc(r), pct: nc(r) }
  }
  const abs: KpiValue = { value: diff(v.actual, v.plan), status: 'ok' }
  if (v.plan === 0) return { abs, pct: nc(`${label} plan is zero`) }
  const value = variancePct(v.actual, v.plan)
  if (v.plan < 0) {
    return {
      abs,
      pct: {
        value,
        status: 'sign_ambiguous',
        reason: `${label} plan is negative, so the sign of the percentage variance is ambiguous`,
      },
    }
  }
  return { abs, pct: { value, status: 'ok' } }
}

function margin(kind: 'actual' | 'plan', revenue: number | null, ebitda: number | null): KpiValue {
  if (revenue === null) return nc(`Revenue ${kind} is missing`)
  if (ebitda === null) return nc(`EBITDA ${kind} is missing`)
  if (revenue === 0) return nc(`Revenue ${kind} is zero`)
  return { value: ratioPct(ebitda, revenue), status: 'ok' }
}

export function calculateKpis(revenue: ActualPlan, ebitda: ActualPlan): Record<KpiKey, KpiValue> {
  const rev = varianceKpis('Revenue', revenue)
  const ebi = varianceKpis('EBITDA', ebitda)
  const mA = margin('actual', revenue.actual, ebitda.actual)
  const mP = margin('plan', revenue.plan, ebitda.plan)
  const mV: KpiValue =
    mA.status === 'ok' && mP.status === 'ok'
      ? { value: marginDiff(ebitda.actual!, revenue.actual!, ebitda.plan!, revenue.plan!), status: 'ok' }
      : nc(`Requires both margins: ${[mA.reason, mP.reason].filter(Boolean).join('; ')}`)
  return {
    revenue_variance: rev.abs,
    revenue_variance_pct: rev.pct,
    ebitda_variance: ebi.abs,
    ebitda_variance_pct: ebi.pct,
    ebitda_margin_actual_pct: mA,
    ebitda_margin_plan_pct: mP,
    ebitda_margin_variance_pp: mV,
  }
}

/** Which metric a KPI belongs to. */
export const KPI_METRIC: Record<KpiKey, 'revenue' | 'ebitda' | 'ebitda_margin'> = {
  revenue_variance: 'revenue',
  revenue_variance_pct: 'revenue',
  ebitda_variance: 'ebitda',
  ebitda_variance_pct: 'ebitda',
  ebitda_margin_actual_pct: 'ebitda_margin',
  ebitda_margin_plan_pct: 'ebitda_margin',
  ebitda_margin_variance_pp: 'ebitda_margin',
}

export const kpiUnit = (key: KpiKey): ValueUnit => kpiDefinition(key).unit
