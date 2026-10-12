/** Small helpers shared by the demo data layer. No demo facts live here. */
import type { AuditEntry, ISODateTime } from '@/api/types'
import { ApiError } from '@/api/errors'
import { WORKSPACE_META } from './seed'

/** Deep copy so callers never receive live store objects. */
export const clone = <T>(value: T): T => structuredClone(value)

export const nowIso = (): ISODateTime => new Date().toISOString()

/** Today's date (local calendar) as YYYY-MM-DD, used for overdue checks. */
export const todayIso = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const currentActor = (): string => WORKSPACE_META.demoUser.name

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export function periodLabel(key: string): string {
  if (!PERIOD_RE.test(key)) return key
  const [y, m] = key.split('-')
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]
  return `${month} ${y}`
}

export function notFound(kind: string, id: string): never {
  throw new ApiError('not_found', `${kind} "${id}" was not found.`)
}

export function validationError(fieldErrors: { field: string; message: string }[]): never {
  const first = fieldErrors[0]
  throw new ApiError(
    'validation_error',
    fieldErrors.length === 1 && first ? first.message : `${fieldErrors.length} fields need attention.`,
    { fieldErrors },
  )
}

// ---------- Display strings (only for text the demo backend itself writes) ----------

const MINUS = '−'

/** Round half away from zero to `dp` decimals. */
export function round(value: number, dp: number): number {
  const f = 10 ** dp
  return (Math.sign(value) * Math.round(Math.abs(value) * f)) / f
}

/** Fixed decimals with a typographic minus, e.g. −14.74. */
export function fixed(value: number, dp: number): string {
  const r = round(value, dp)
  const s = Math.abs(r).toFixed(dp)
  return r < 0 ? `${MINUS}${s}` : s
}

/** Signed fixed decimals, e.g. +2.50 / −14.74. */
export function signed(value: number, dp: number): string {
  const r = round(value, dp)
  return r > 0 ? `+${fixed(r, dp)}` : fixed(r, dp)
}

export const pctText = (v: number | null, dp = 2): string => (v === null ? '—' : `${signed(v, dp)}%`)
export const ppText = (v: number | null, dp = 2): string => (v === null ? '—' : `${signed(v, dp)} pp`)
export const plainPct = (v: number | null, dp = 2): string => (v === null ? '—' : `${fixed(v, dp)}%`)
export const moneyText = (v: number | null): string => (v === null ? '—' : `${fixed(v, 2)}`)
export const withMinus = (s: string): string => s.replace(/^-/, MINUS)

// ---------- Audit ----------

let auditSeq = 0
export function audit(event: string, opts: { actor?: string; at?: ISODateTime; detail?: string } = {}): AuditEntry {
  auditSeq += 1
  const entry: AuditEntry = {
    id: `AUD-${String(auditSeq).padStart(5, '0')}`,
    at: opts.at ?? nowIso(),
    actor: opts.actor ?? currentActor(),
    event,
  }
  if (opts.detail !== undefined) entry.detail = opts.detail
  return entry
}
export const resetAuditSeq = () => {
  auditSeq = 0
}

/** Next sequential id on a state's counters, e.g. "ACT-0001". */
export function seqId(s: { seq: Record<string, number> }, prefix: string): string {
  const n = (s.seq[prefix] ?? 0) + 1
  s.seq[prefix] = n
  return `${prefix}-${String(n).padStart(4, '0')}`
}
