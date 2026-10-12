/**
 * Pure display formatters. Display rounding only — never feed the output back into a calculation.
 *
 * Rules
 * - `null` / `undefined` / non-finite → "—" (em dash). Missing is never shown as 0.
 * - 0 → "0.00" (a real zero is shown as a number).
 * - Negative numbers use a true minus sign (U+2212), not a hyphen.
 */
import type {
  ActionStatus,
  CalcStatus,
  CauseDetermination,
  CompanyStatus,
  EvidenceStrength,
  ExceptionStatus,
  ImpactVerificationStatus,
  InvestigationMode,
  InvestigationStatus,
  KpiValue,
  Priority,
  ResolutionReason,
  ReviewStatus,
  Severity,
  ValueUnit,
} from '@/api/types'

export const EM_DASH = '—'
export const MINUS = '−'

type Num = number | null | undefined

export type MoneyUnit = 'units' | 'thousands' | 'millions'

export interface NumberOptions {
  /** Decimal places, default 2. */
  dp?: number
  /** Prefix positives with "+". */
  signed?: boolean
}

export interface MoneyOptions extends NumberOptions {
  currency?: string
  unit?: MoneyUnit
}

const UNIT_SUFFIX: Record<MoneyUnit, string> = { units: '', thousands: 'k', millions: 'm' }

const nfCache = new Map<number, Intl.NumberFormat>()
function nf(dp: number): Intl.NumberFormat {
  let f = nfCache.get(dp)
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
    nfCache.set(dp, f)
  }
  return f
}

export function isMissing(v: Num): v is null | undefined {
  return v === null || v === undefined || !Number.isFinite(v)
}

/** Number with sign handling; returns the absolute part and a sign prefix separately. */
function parts(v: number, { dp = 2, signed = false }: NumberOptions): { sign: string; abs: string } {
  const abs = nf(dp).format(Math.abs(v))
  // A value that rounds to zero is shown as an unsigned zero.
  const roundsToZero = Number(abs.replace(/,/g, '')) === 0
  if (roundsToZero) return { sign: '', abs }
  if (v < 0) return { sign: MINUS, abs }
  return { sign: signed ? '+' : '', abs }
}

/** 1234.5 → "1,234.50"; −3 → "−3.00". */
export function formatNumber(v: Num, opts: NumberOptions = {}): string {
  if (isMissing(v)) return EM_DASH
  const { sign, abs } = parts(v, opts)
  return `${sign}${abs}`
}

/** Integer count: 1234 → "1,234". */
export function formatCount(v: Num): string {
  return formatNumber(v, { dp: 0 })
}

/** 1.62 → "USD 1.62m"; −0.28 → "USD −0.28m". */
export function formatMoney(v: Num, { currency = 'USD', unit = 'millions', ...opts }: MoneyOptions = {}): string {
  if (isMissing(v)) return EM_DASH
  const { sign, abs } = parts(v, opts)
  return `${currency} ${sign}${abs}${UNIT_SUFFIX[unit]}`
}

/** −14.7368 → "−14.74%"; with `signed`, 3.2 → "+3.20%". */
export function formatPct(v: Num, opts: NumberOptions = {}): string {
  if (isMissing(v)) return EM_DASH
  const { sign, abs } = parts(v, opts)
  return `${sign}${abs}%`
}

/** Percentage points: −1.96 → "−1.96 pp". */
export function formatPp(v: Num, opts: NumberOptions = {}): string {
  if (isMissing(v)) return EM_DASH
  const { sign, abs } = parts(v, opts)
  return `${sign}${abs} pp`
}

/** Dispatch on the API value unit. */
export function formatValue(v: Num, unit: ValueUnit, opts: MoneyOptions = {}): string {
  switch (unit) {
    case 'currency':
      return formatMoney(v, opts)
    case 'pct':
      return formatPct(v, opts)
    case 'pp':
      return formatPp(v, opts)
  }
}

function lowerFirst(s: string): string {
  return s.length > 1 && s[1] !== s[1]?.toUpperCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

/**
 * Format a backend KPI value.
 * - not_calculable → "— (plan revenue is zero)" (the reason, when given)
 * - sign_ambiguous → value followed by the reason, e.g. "−12.00% (plan is negative)"
 */
export function formatKpi(kpi: KpiValue | null | undefined, unit: ValueUnit, opts: MoneyOptions = {}): string {
  if (!kpi) return EM_DASH
  if (kpi.status === 'not_calculable' || isMissing(kpi.value)) {
    return kpi.reason ? `${EM_DASH} (${lowerFirst(kpi.reason)})` : EM_DASH
  }
  const text = formatValue(kpi.value, unit, opts)
  if (kpi.status === 'sign_ambiguous') {
    return `${text} (${kpi.reason ? lowerFirst(kpi.reason) : 'sign ambiguous'})`
  }
  return text
}

// ---------- Dates ----------

// Month names are fixed (not Intl) so output is stable across browsers ("Sep", never "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function toDate(v: string | Date): Date | null {
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "2026-09-30" or ISO date-time → "30 Sep 2026". Date-only strings are not shifted by time zone. */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return EM_DASH
  if (typeof v === 'string') {
    const m = DATE_ONLY.exec(v)
    if (m) {
      const month = MONTHS[Number(m[2]) - 1]
      return month ? `${Number(m[3])} ${month} ${m[1]}` : EM_DASH
    }
  }
  const d = toDate(v)
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : EM_DASH
}

/** ISO date-time → "30 Sep 2026, 14:05" (local time, 24h). */
export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return EM_DASH
  const d = toDate(v)
  if (!d) return EM_DASH
  return `${formatDate(d)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** "2026-09" → "Sep 2026"; "2026-Q3" → "Q3 2026"; anything else is returned unchanged. */
export function formatPeriod(key: string | null | undefined): string {
  if (!key) return EM_DASH
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (m) {
    const month = MONTHS[Number(m[2]) - 1]
    return month ? `${month} ${m[1]}` : key
  }
  const q = /^(\d{4})-?Q([1-4])$/i.exec(key)
  if (q) return `Q${q[2]} ${q[1]}`
  return key
}

// ---------- Human labels for API enums ----------

export const companyStatusLabel: Record<CompanyStatus, string> = {
  on_track: 'On track',
  warning: 'Warning',
  exception: 'Exception',
  insufficient_data: 'Insufficient data',
}

export const severityLabel: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  warning: 'Warning',
}

export const exceptionStatusLabel: Record<ExceptionStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  in_review: 'In review',
  resolved: 'Resolved',
}

export const resolutionReasonLabel: Record<ResolutionReason, string> = {
  action_verified: 'Action verified',
  data_corrected: 'Data corrected',
  condition_cleared: 'Condition cleared',
  not_material: 'Not material',
  other: 'Other',
}

export const actionStatusLabel: Record<ActionStatus, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  in_progress: 'In progress',
  completed: 'Completed',
  outcome_verification: 'Outcome verification',
  verified: 'Verified',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
}

export const priorityLabel: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' }

export const verificationLabel: Record<ImpactVerificationStatus | 'none', string> = {
  not_yet_measurable: 'Not yet measurable',
  unverified: 'Unverified',
  verified: 'Verified',
  rejected: 'Rejected',
  none: 'No impact record',
}

export const reviewStatusLabel: Record<ReviewStatus, string> = {
  unreviewed: 'Unreviewed',
  reviewed: 'Reviewed',
}

export const investigationStatusLabel: Record<InvestigationStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
}

export const investigationModeLabel: Record<InvestigationMode, string> = {
  live: 'Live AI',
  mock: 'Mock',
}

export const evidenceStrengthLabel: Record<EvidenceStrength, string> = {
  none: 'None',
  weak: 'Weak',
  moderate: 'Moderate',
  strong: 'Strong',
}

export const causeDeterminationLabel: Record<CauseDetermination, string> = {
  undetermined: 'Undetermined',
  partially_supported: 'Partially supported',
  supported: 'Supported',
}

export const calcStatusLabel: Record<CalcStatus, string> = {
  ok: 'Calculated',
  not_calculable: 'Not calculable',
  sign_ambiguous: 'Sign ambiguous',
}

/** Turn a label map into `{ value, label }[]` options for selects / filters. */
export function toOptions<K extends string>(labels: Record<K, string>): { value: K; label: string }[] {
  return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }))
}

/** "in_review" → "In review" — fallback for enum values without a label map. */
export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
