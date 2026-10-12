import { useQueryClient } from '@tanstack/react-query'
import type { MetricKey, ValueUnit } from '@/api/types'

const IMPACT_INVALIDATE = [['impacts'], ['action'], ['actions'], ['overview'], ['company']]

export function useInvalidateImpactData() {
  const qc = useQueryClient()
  return () => Promise.all(IMPACT_INVALIDATE.map((queryKey) => qc.invalidateQueries({ queryKey })))
}

export const IMPACT_METRICS: { value: MetricKey; label: string; unit: ValueUnit }[] = [
  { value: 'revenue', label: 'Revenue', unit: 'currency' },
  { value: 'ebitda', label: 'EBITDA', unit: 'currency' },
  { value: 'ebitda_margin', label: 'EBITDA margin', unit: 'pct' },
]

/** Input suffix for a value unit (demo money is USD millions). */
export function unitHint(unit: ValueUnit, currency = 'USD'): string {
  return unit === 'currency' ? `${currency} m` : unit === 'pct' ? '%' : 'pp'
}

/** Text input → number | null. `undefined` means "not a number" (show a field error). */
export function parseNumberInput(text: string): number | null | undefined {
  const t = text.trim().replace(/−/g, '-').replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export const numberText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
