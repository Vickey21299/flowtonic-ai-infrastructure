/**
 * CSV import (Spec §6): upload → map → validate/classify → confirm or cancel.
 * Rows are never silently dropped: every data row of the file appears in `rows`,
 * and invalid rows are reported with row number, field and reason.
 */
import type {
  ImportIssue,
  ImportJob,
  ImportRow,
  ImportSummary,
  ObservationRecord,
  SchemaField,
} from '@/api/types'
import { ApiError } from '@/api/errors'
import { db, nextId, type ImportJobRecord } from './store'
import {
  IMPORT_SCHEMA,
  METRIC_COLUMNS,
  SAMPLE_CSV_FILE_NAME,
  SAMPLE_INVALID_ROW,
  SEED_SOURCE_ROWS,
  SYSTEM_ACTOR,
} from './seed'
import { currentObservation, evaluateExceptions } from './engine'
import { clone, currentActor, notFound, nowIso, PERIOD_RE, validationError } from './util'

// ---------- CSV ----------

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function sampleCsvDemo(): { fileName: string; text: string } {
  const fields = IMPORT_SCHEMA.map((f) => f.field)
  const lines = [fields.join(',')]
  for (const r of [...SEED_SOURCE_ROWS.map((x) => x.values), SAMPLE_INVALID_ROW]) {
    lines.push(fields.map((f) => csvCell(r[f])).join(','))
  }
  return { fileName: SAMPLE_CSV_FILE_NAME, text: lines.join('\n') + '\n' }
}

interface ParsedRecord {
  line: number // 1-based line where the record starts
  cells: string[]
}

/** RFC 4180-style parser: quoted fields, escaped quotes, CRLF, newlines inside quotes. */
export function parseCsv(text: string): { records: ParsedRecord[]; error: string | null } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: ParsedRecord[] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let recordLine = 1
  let i = 0
  const endRecord = () => {
    cells.push(cell)
    const blank = cells.length === 1 && cells[0]!.trim() === ''
    if (!blank) records.push({ line: recordLine, cells })
    cells = []
    cell = ''
  }
  while (i < src.length) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
      } else {
        if (ch === '\n') line += 1
        cell += ch
      }
      i += 1
      continue
    }
    if (ch === '"' && cell === '') inQuotes = true
    else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1
      endRecord()
      line += 1
      recordLine = line
    } else cell += ch
    i += 1
  }
  if (inQuotes) return { records, error: `Unclosed quote starting on line ${recordLine}.` }
  if (cell !== '' || cells.length) endRecord()
  return { records, error: null }
}

// ---------- Jobs ----------

function findJob(id: string): ImportJobRecord {
  const j = db().importJobs.find((x) => x.id === id)
  if (!j) notFound('Import job', id)
  return j
}

/** Public view of a job (internal fields removed). */
function view(j: ImportJobRecord): ImportJob {
  const { importedBy: _a, committedAt: _b, rawRows: _c, ...pub } = j
  void _a
  void _b
  void _c
  return clone(pub)
}

export function uploadImportDemo(file: { name: string; text: string }): ImportJob {
  const s = db()
  const fileErrors: string[] = []
  const name = file.name?.trim() || 'upload.csv'
  if (!/\.csv$/i.test(name)) fileErrors.push(`"${name}" is not a .csv file.`)
  const { records, error } = parseCsv(file.text ?? '')
  if (error) fileErrors.push(error)
  const header = (records[0]?.cells ?? []).map((h) => h.trim())
  if (header.length === 0) fileErrors.push('The file is empty.')
  else if (records.length < 2) fileErrors.push('The file has a header row but no data rows.')
  const dupes = header.filter((h, idx) => h && header.indexOf(h) !== idx)
  if (dupes.length) fileErrors.push(`Duplicate column names: ${[...new Set(dupes)].join(', ')}.`)

  const mapping: ImportJob['mapping'] = {}
  for (const f of IMPORT_SCHEMA) mapping[f.field] = header.includes(f.field) ? f.field : null

  const job: ImportJobRecord = {
    id: nextId('JOB'),
    fileName: name,
    status: 'uploaded',
    createdAt: nowIso(),
    detectedColumns: header,
    schema: clone(IMPORT_SCHEMA),
    mapping,
    rows: [],
    fileErrors,
    summary: null,
    importedBy: currentActor(),
    committedAt: null,
    rawRows: records.slice(1).map((r) => [String(r.line), ...r.cells]),
  }
  s.importJobs.push(job)
  return view(job)
}

// ---------- Validation ----------

const NUMERIC_FIELDS: SchemaField[] = ['revenue_actual', 'revenue_plan', 'ebitda_actual', 'ebitda_plan']
const NUMBER_RE = /^[-+]?(\d+(\.\d*)?|\.\d+)$/
const UNIT_RE = /[$€£¥%,]|\b(usd|eur|gbp)\b|\d\s*(m|mm|mn|k|bn|b)$/i

function parseNumber(v: string): { value: number | null; error: string | null } {
  if (v === '') return { value: null, error: null }
  if (UNIT_RE.test(v)) {
    return { value: null, error: `"${v}" contains a currency, unit or thousands symbol. Enter plain numbers in USD millions, e.g. 1.62.` }
  }
  if (!NUMBER_RE.test(v)) return { value: null, error: `"${v}" is not a number.` }
  return { value: Number(v), error: null }
}

interface ValidatedRow extends ImportRow {
  parsed: Partial<Record<SchemaField, number | null>>
}

function validateRows(job: ImportJobRecord): ValidatedRow[] {
  const s = db()
  const colIndex = (field: SchemaField) => {
    const col = job.mapping[field]
    return col ? job.detectedColumns.indexOf(col) : -1
  }
  const rows: ValidatedRow[] = job.rawRows.map(([lineStr, ...cells]) => {
    const issues: ImportIssue[] = []
    const values: Record<string, string> = {}
    for (const f of IMPORT_SCHEMA) {
      const idx = colIndex(f.field)
      if (idx >= 0) values[f.field] = (cells[idx] ?? '').trim()
    }
    const err = (field: string, message: string) => issues.push({ field, severity: 'error', message })
    const warn = (field: string, message: string) => issues.push({ field, severity: 'warning', message })

    if (cells.length !== job.detectedColumns.length) {
      err('row', `The row has ${cells.length} values but the header has ${job.detectedColumns.length} columns.`)
    }
    for (const f of IMPORT_SCHEMA) {
      if (!f.required || f.field === 'revenue_plan' || f.field === 'ebitda_plan') continue
      if (!values[f.field]) err(f.field, job.mapping[f.field] ? 'Missing required value.' : 'Column is not mapped.')
    }
    const period = values.reporting_period ?? ''
    if (period && !PERIOD_RE.test(period)) err('reporting_period', `"${period}" is not a valid period. Use YYYY-MM, e.g. 2026-09.`)

    const parsed: ValidatedRow['parsed'] = {}
    for (const f of NUMERIC_FIELDS) {
      const v = values[f] ?? ''
      const p = parseNumber(v)
      if (p.error) err(f, p.error)
      parsed[f] = p.value
    }
    for (const m of ['revenue', 'ebitda'] as const) {
      const c = METRIC_COLUMNS[m]
      const label = m === 'revenue' ? 'Revenue' : 'EBITDA'
      const planRaw = values[c.plan] ?? ''
      if (!planRaw) warn(c.plan, `${label} plan is missing; ${label} variance % will be shown as not calculable.`)
      else if (parsed[c.plan] === 0) warn(c.plan, `${label} plan is zero; ${label} variance % will be shown as not calculable.`)
      else if (m === 'ebitda' && (parsed[c.plan] ?? 0) < 0) {
        warn(c.plan, 'EBITDA plan is negative; the sign of EBITDA variance % is ambiguous and no alert will be raised from it.')
      }
    }
    for (const f of ['revenue_actual', 'revenue_plan'] as const) {
      if ((parsed[f] ?? 0) < 0) err(f, 'Revenue cannot be negative.')
    }
    if (parsed.revenue_actual === 0) warn('revenue_actual', 'Revenue actual is zero; actual EBITDA margin will be not calculable.')

    const srcAt = values.source_updated_at
    if (srcAt && Number.isNaN(Date.parse(srcAt))) err('source_updated_at', `"${srcAt}" is not a valid date. Use ISO 8601, e.g. 2026-10-03.`)

    const companyId = values.company_id ?? ''
    const existing = s.companies.find((c) => c.id === companyId)
    if (existing && values.company_name && values.company_name !== existing.name) {
      warn('company_name', `Differs from the stored name "${existing.name}"; the stored name is kept.`)
    }
    if (!existing && companyId && !values.sector) warn('sector', 'No sector given; the new company will be listed as "Unassigned".')

    return {
      rowNumber: Number(lineStr),
      values,
      classification: 'new',
      issues,
      parsed,
    }
  })

  // Duplicate company-period records within the file: none of them is imported.
  const groups = new Map<string, ValidatedRow[]>()
  for (const r of rows) {
    const id = r.values.company_id
    const p = r.values.reporting_period
    if (!id || !p) continue
    const key = `${id}|${p}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    for (const r of group) {
      const others = group.filter((o) => o !== r).map((o) => o.rowNumber)
      r.issues.push({
        field: 'company_id',
        severity: 'error',
        message: `Duplicate company and period (also in row ${others.join(', ')}). Duplicates are not imported; keep one row per company and period.`,
      })
    }
  }

  for (const r of rows) {
    if (r.issues.some((i) => i.severity === 'error')) {
      r.classification = 'invalid'
      continue
    }
    const id = r.values.company_id!
    const period = r.values.reporting_period!
    const obs = (['revenue', 'ebitda'] as const).map((m) => currentObservation(s, id, period, m))
    if (obs.every((o) => !o)) r.classification = 'new'
    else r.classification = changedMetrics(r, obs[0], obs[1]).length ? 'changed' : 'unchanged'
  }
  return rows
}

function changedMetrics(
  r: ValidatedRow,
  revenueObs: ObservationRecord | undefined,
  ebitdaObs: ObservationRecord | undefined,
): ('revenue' | 'ebitda')[] {
  const out: ('revenue' | 'ebitda')[] = []
  for (const [m, o] of [
    ['revenue', revenueObs],
    ['ebitda', ebitdaObs],
  ] as const) {
    const c = METRIC_COLUMNS[m]
    const a = r.parsed[c.actual] ?? null
    const p = r.parsed[c.plan] ?? null
    if (!o || o.actualValue !== a || o.planValue !== p) out.push(m)
  }
  return out
}

export function setImportMappingDemo(id: string, mapping: ImportJob['mapping']): ImportJob {
  const job = findJob(id)
  if (job.status !== 'uploaded' && job.status !== 'validated') {
    throw new ApiError('conflict', `Import ${id} is ${job.status}; the mapping can no longer change.`)
  }
  const fileErrors = job.fileErrors.filter((e) => !e.startsWith('Mapping: '))
  const clean: ImportJob['mapping'] = {}
  for (const f of IMPORT_SCHEMA) {
    const col = mapping[f.field] ?? null
    if (col !== null && !job.detectedColumns.includes(col)) {
      fileErrors.push(`Mapping: column "${col}" for ${f.label} is not in the file.`)
      clean[f.field] = null
    } else clean[f.field] = col
    if (f.required && !col) fileErrors.push(`Mapping: required field ${f.label} (${f.field}) is not mapped to a column.`)
  }
  const used = Object.values(clean).filter((c): c is string => Boolean(c))
  const twice = used.filter((c, i) => used.indexOf(c) !== i)
  if (twice.length) fileErrors.push(`Mapping: column(s) ${[...new Set(twice)].join(', ')} are mapped to more than one field.`)

  job.mapping = clean
  job.fileErrors = fileErrors
  job.rows = validateRows(job).map(({ parsed: _p, ...row }) => {
    void _p
    return row
  })
  job.status = 'validated'
  return view(job)
}

export function confirmImportDemo(id: string, opts: { acknowledgeInvalidRows: boolean }): ImportJob {
  const s = db()
  const job = findJob(id)
  if (job.status === 'uploaded') {
    validationError([{ field: 'mapping', message: 'Apply a column mapping and review the validation results first.' }])
  }
  if (job.status !== 'validated') throw new ApiError('conflict', `Import ${id} is already ${job.status}.`)
  if (job.fileErrors.length) {
    validationError(job.fileErrors.map((message) => ({ field: 'file', message })))
  }
  const rows = validateRows(job) // re-validate against the current store
  const invalid = rows.filter((r) => r.classification === 'invalid')
  if (invalid.length && !opts.acknowledgeInvalidRows) {
    validationError([
      {
        field: 'acknowledgeInvalidRows',
        message: `${invalid.length} invalid row(s) will not be imported. Confirm that you have reviewed them.`,
      },
    ])
  }

  const at = nowIso()
  const actor = currentActor()
  let companiesCreated = 0
  const touched = new Set<string>()
  for (const r of rows) {
    if (r.classification !== 'new' && r.classification !== 'changed') continue
    const companyId = r.values.company_id!
    const period = r.values.reporting_period!
    let company = s.companies.find((c) => c.id === companyId)
    if (!company) {
      company = {
        id: companyId,
        name: r.values.company_name!,
        sector: r.values.sector || 'Unassigned',
        currency: 'USD',
        createdAt: at,
        updatedAt: at,
      }
      s.companies.push(company)
      companiesCreated += 1
    }
    company.updatedAt = at
    const revenueObs = currentObservation(s, companyId, period, 'revenue')
    const ebitdaObs = currentObservation(s, companyId, period, 'ebitda')
    for (const m of changedMetrics(r, revenueObs, ebitdaObs)) {
      const prev = m === 'revenue' ? revenueObs : ebitdaObs
      if (prev) prev.isCurrent = false
      const c = METRIC_COLUMNS[m]
      s.observations.push({
        id: nextId('OBS'),
        companyId,
        metricKey: m,
        period,
        actualValue: r.parsed[c.actual] ?? null,
        planValue: r.parsed[c.plan] ?? null,
        originalValues: {
          company_id: companyId,
          reporting_period: period,
          [c.actual]: r.values[c.actual] ?? '',
          [c.plan]: r.values[c.plan] ?? '',
        },
        sourceName: r.values.source_name || job.fileName,
        sourceUpdatedAt: r.values.source_updated_at ? new Date(r.values.source_updated_at).toISOString() : at,
        importJobId: job.id,
        fileName: job.fileName,
        sourceRow: r.rowNumber,
        importedAt: at,
        importedBy: actor,
        validationStatus: 'valid',
        isCurrent: true,
      })
    }
    touched.add(`${companyId}|${period}`)
  }

  const evaluation = touched.size
    ? evaluateExceptions(s, { at, actor: SYSTEM_ACTOR, trigger: `import ${job.id} (${job.fileName})`, onlyCompanyPeriods: touched })
    : { created: 0, updated: 0, kpisCalculated: 0 }

  const count = (c: ImportRow['classification']) => rows.filter((r) => r.classification === c).length
  const summary: ImportSummary = {
    rowsRead: rows.length,
    imported: count('new') + count('changed'),
    unchanged: count('unchanged'),
    superseded: count('changed'),
    invalid: invalid.length,
    companiesCreated,
    kpisRecalculated: evaluation.kpisCalculated,
    exceptionsCreated: evaluation.created,
    exceptionsUpdated: evaluation.updated,
  }
  job.rows = rows.map(({ parsed: _p, ...row }) => {
    void _p
    return row
  })
  job.summary = summary
  job.status = 'committed'
  job.committedAt = at
  s.lastValidationErrors = invalid.flatMap((r) =>
    r.issues
      .filter((i) => i.severity === 'error')
      .map((i) => ({ fileName: job.fileName, row: r.rowNumber, field: i.field, message: i.message })),
  )
  return view(job)
}

export function cancelImportDemo(id: string): ImportJob {
  const job = findJob(id)
  if (job.status === 'committed') throw new ApiError('conflict', `Import ${id} is already committed and cannot be cancelled.`)
  job.status = 'cancelled'
  return view(job)
}

export function getImportJobDemo(id: string): ImportJob {
  return view(findJob(id))
}
