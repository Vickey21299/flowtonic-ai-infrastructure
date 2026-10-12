/**
 * Impact tracking (Spec §11). Targets, estimates and observed values are kept apart;
 * an estimate is never a realised result, and nothing is "verified" without an
 * observation, its source, a reviewer, a rationale and an evidence reference.
 */
import type {
  ImpactCreateInput,
  ImpactFilters,
  ImpactRecord,
  ImpactUpdateInput,
  ImpactVerificationRequest,
  MetricKey,
  ValueUnit,
} from '@/api/types'
import { ApiError } from '@/api/errors'
import { db, nextId, type ImpactRow } from './store'
import { METRIC_LABELS } from './seed'
import { findAction } from './actions.demo'
import { audit, clone, notFound, nowIso, PERIOD_RE, validationError } from './util'
import { toImpact } from './views'

type FieldError = { field: string; message: string }

const METRIC_UNIT: Record<MetricKey, ValueUnit> = { revenue: 'currency', ebitda: 'currency', ebitda_margin: 'pct' }

function findImpact(id: string): ImpactRow {
  const i = db().impacts.find((x) => x.id === id)
  if (!i) notFound('Impact record', id)
  return i
}

export function listImpactsDemo(f: ImpactFilters): ImpactRecord[] {
  const s = db()
  return clone(
    s.impacts
      .filter((i) => !f.companyId || i.companyId === f.companyId)
      .filter((i) => !f.actionId || i.actionId === f.actionId)
      .filter((i) => !f.verificationStatus || i.verificationStatus === f.verificationStatus)
      .map((i) => toImpact(s, i))
      .sort((a, b) => b.id.localeCompare(a.id)),
  )
}

const isNumOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))

function checkNumber(field: string, v: unknown, errors: FieldError[]) {
  if (v !== undefined && !isNumOrNull(v)) errors.push({ field, message: 'Enter a number or leave it empty.' })
}
function checkPeriod(field: string, v: unknown, required: boolean, errors: FieldError[]) {
  if (v === undefined || v === null || v === '') {
    if (required) errors.push({ field, message: 'A period (YYYY-MM) is required.' })
    return
  }
  if (typeof v !== 'string' || !PERIOD_RE.test(v)) errors.push({ field, message: 'Use the YYYY-MM format, e.g. 2026-12.' })
}

export function createImpactDemo(input: ImpactCreateInput): ImpactRecord {
  const s = db()
  const errors: FieldError[] = []
  const action = s.actions.find((a) => a.id === input.actionId)
  if (!action) errors.push({ field: 'actionId', message: 'Select the related action.' })
  else if (action.status === 'cancelled') errors.push({ field: 'actionId', message: 'A cancelled action cannot get impact records.' })
  if (!(input.metricKey in METRIC_UNIT)) errors.push({ field: 'metricKey', message: 'Select a metric.' })
  checkNumber('baselineValue', input.baselineValue, errors)
  checkNumber('targetValue', input.targetValue, errors)
  checkNumber('estimatedValue', input.estimatedValue, errors)
  checkPeriod('baselinePeriod', input.baselinePeriod, true, errors)
  checkPeriod('targetPeriod', input.targetPeriod, true, errors)
  if (errors.length || !action) validationError(errors)

  const at = nowIso()
  const row: ImpactRow = {
    id: nextId('IMP'),
    companyId: action.companyId,
    actionId: action.id,
    metricKey: input.metricKey,
    metricLabel: METRIC_LABELS[input.metricKey],
    unit: METRIC_UNIT[input.metricKey],
    baselineValue: input.baselineValue,
    baselinePeriod: input.baselinePeriod,
    targetValue: input.targetValue,
    targetPeriod: input.targetPeriod,
    estimatedValue: input.estimatedValue ?? null,
    observedValue: null,
    observationPeriod: null,
    measurementSource: null,
    verificationStatus: 'not_yet_measurable',
    reviewer: null,
    verificationRationale: null,
    evidenceReference: null,
    notes: input.notes?.trim() ?? '',
    history: [audit('Impact record created — not yet measurable', { at })],
  }
  s.impacts.push(row)
  action.history.push(audit(`Impact record ${row.id} added (${row.metricLabel})`, { at }))
  action.updatedAt = at
  return toImpact(s, row)
}

/** Fields that describe the measurement; changing one invalidates an earlier verification. */
const MEASUREMENT_FIELDS: (keyof ImpactUpdateInput)[] = [
  'observedValue',
  'observationPeriod',
  'measurementSource',
  'evidenceReference',
]

export function updateImpactDemo(id: string, patch: ImpactUpdateInput): ImpactRecord {
  const row = findImpact(id)
  const errors: FieldError[] = []
  checkNumber('targetValue', patch.targetValue, errors)
  checkNumber('estimatedValue', patch.estimatedValue, errors)
  checkNumber('observedValue', patch.observedValue, errors)
  if (patch.targetPeriod !== undefined) checkPeriod('targetPeriod', patch.targetPeriod, true, errors)
  checkPeriod('observationPeriod', patch.observationPeriod, false, errors)
  if (errors.length) validationError(errors)

  const at = nowIso()
  let measurementChanged = false
  for (const key of Object.keys(patch) as (keyof ImpactUpdateInput)[]) {
    let next = patch[key]
    if (next === undefined) continue
    if (typeof next === 'string') next = next.trim()
    if (next === '' && key !== 'notes') next = null
    const prev = row[key]
    if (next === prev) continue
    ;(row as unknown as Record<string, unknown>)[key] = next
    if (MEASUREMENT_FIELDS.includes(key)) measurementChanged = true
    row.history.push(audit(key === 'notes' ? 'Notes edited' : `${key} changed: ${show(prev)} → ${show(next)}`, { at }))
  }

  const prevStatus = row.verificationStatus
  let nextStatus = prevStatus
  if (row.observedValue === null) nextStatus = 'not_yet_measurable'
  else if (prevStatus === 'not_yet_measurable') nextStatus = 'unverified'
  else if (measurementChanged && (prevStatus === 'verified' || prevStatus === 'rejected')) nextStatus = 'unverified'
  if (nextStatus !== prevStatus) {
    row.verificationStatus = nextStatus
    if (prevStatus === 'verified' || prevStatus === 'rejected') {
      row.reviewer = null
      row.verificationRationale = null
    }
    row.history.push(
      audit(`Verification status: ${prevStatus} → ${nextStatus}`, {
        at,
        detail: nextStatus === 'not_yet_measurable' ? 'No observed value recorded.' : 'The measurement changed and must be reviewed again.',
      }),
    )
  }
  return toImpact(db(), row)
}

export function verifyImpactDemo(id: string, req: ImpactVerificationRequest): ImpactRecord {
  const row = findImpact(id)
  if (req.decision !== 'verified' && req.decision !== 'rejected') {
    throw new ApiError('validation_error', 'Decision must be verified or rejected.', {
      fieldErrors: [{ field: 'decision', message: 'Decision must be verified or rejected.' }],
    })
  }
  const reviewer = req.reviewer?.trim()
  const rationale = req.rationale?.trim()
  const evidenceReference = req.evidenceReference?.trim() || row.evidenceReference
  const errors: FieldError[] = []
  if (req.decision === 'verified') {
    if (row.observedValue === null) errors.push({ field: 'observedValue', message: 'Record the observed value first.' })
    if (!row.observationPeriod) errors.push({ field: 'observationPeriod', message: 'Record the observation period first.' })
    if (!row.measurementSource) errors.push({ field: 'measurementSource', message: 'Record the measurement source first.' })
    if (!evidenceReference) errors.push({ field: 'evidenceReference', message: 'An evidence reference is required to verify.' })
  }
  if (!reviewer) errors.push({ field: 'reviewer', message: 'A reviewer is required.' })
  if (!rationale) errors.push({ field: 'rationale', message: 'A rationale is required.' })
  // Record stays unchanged on failure.
  if (errors.length) validationError(errors)

  const at = nowIso()
  const prev = row.verificationStatus
  row.verificationStatus = req.decision
  row.reviewer = reviewer ?? null
  row.verificationRationale = rationale ?? null
  row.evidenceReference = evidenceReference ?? null
  row.history.push(
    audit(`Verification status: ${prev} → ${req.decision}`, {
      at,
      actor: reviewer,
      detail: `Rationale: ${rationale}${evidenceReference ? `. Evidence: ${evidenceReference}` : ''}`,
    }),
  )
  const action = findAction(row.actionId)
  action.history.push(audit(`Impact record ${row.id} ${req.decision}`, { at }))
  action.updatedAt = at
  return toImpact(db(), row)
}
