/**
 * In-memory demo state: a deep copy of the seed plus everything the user changes.
 * It resets on page reload or `resetStore()`; it is a single-user demo store.
 */
import type {
  ActionDetail,
  AuditEntry,
  ExceptionStatus,
  ImpactRecord,
  ImportJob,
  InvestigationDetail,
  InvestigationMode,
  KpiKey,
  MetricKey,
  MethodologyResponse,
  ObservationRecord,
  ResolutionReason,
  RuleConfiguration,
  Severity,
} from '@/api/types'
import {
  IMPORT_SCHEMA,
  METRIC_COLUMNS,
  SEED_COMPANIES,
  SEED_IMPORT,
  SEED_RULE_CONFIGURATION,
  SEED_SOURCE_ROWS,
  SYSTEM_ACTOR,
} from './seed'
import { evaluateExceptions } from './engine'
import { clone, resetAuditSeq, seqId } from './util'

export interface CompanyRecord {
  id: string
  name: string
  sector: string
  currency: string
  createdAt: string
  updatedAt: string
}

export interface ImportJobRecord extends ImportJob {
  importedBy: string
  committedAt: string | null
  /** Parsed CSV (header excluded); kept so the mapping can be re-applied. */
  rawRows: string[][]
}

export interface ExceptionRecord {
  id: string
  companyId: string
  period: string
  metricKey: MetricKey
  kpiKey: KpiKey
  ruleId: string
  ruleKey: string
  severity: Severity
  threshold: number // threshold that last triggered the exception
  status: ExceptionStatus
  conditionActive: boolean
  owner: string | null
  createdAt: string
  resolvedAt: string | null
  resolutionReason: ResolutionReason | null
  resolutionNote: string | null
  ruleConfigurationVersion: number
  evaluatedAt: string
  evaluatedValue: number | null
  history: AuditEntry[]
}

export type ActionRecord = Omit<
  ActionDetail,
  'companyName' | 'isOverdue' | 'verificationStatus' | 'impacts' | 'allowedTransitions'
>

export type ImpactRow = Omit<ImpactRecord, 'companyName' | 'actionTitle'>

export interface DemoState {
  companies: CompanyRecord[]
  observations: ObservationRecord[]
  importJobs: ImportJobRecord[]
  ruleConfiguration: RuleConfiguration
  exceptions: ExceptionRecord[]
  investigations: InvestigationDetail[]
  actions: ActionRecord[]
  impacts: ImpactRow[]
  aiMode: InvestigationMode
  /** Invalid rows of the last confirmed import (Methodology "validation errors"). */
  lastValidationErrors: MethodologyResponse['validationErrors']
  seq: Record<string, number>
}

let state: DemoState = buildInitialState()

export const db = (): DemoState => state

/** Next sequential id, e.g. nextId('ACT') → "ACT-0001". */
export const nextId = (prefix: string): string => seqId(state, prefix)

export function resetStore(): void {
  state = buildInitialState()
}

function buildInitialState(): DemoState {
  resetAuditSeq()
  const s: DemoState = {
    companies: SEED_COMPANIES.map((c) => ({ ...c, updatedAt: c.createdAt })),
    observations: [],
    importJobs: [],
    ruleConfiguration: clone(SEED_RULE_CONFIGURATION),
    exceptions: [],
    investigations: [],
    actions: [],
    impacts: [],
    aiMode: 'mock',
    lastValidationErrors: [],
    seq: { JOB: 1 }, // JOB-0001 is the seed import
  }

  let obsSeq = 0
  for (const r of SEED_SOURCE_ROWS) {
    for (const metricKey of ['revenue', 'ebitda'] as const) {
      const cols = METRIC_COLUMNS[metricKey]
      obsSeq += 1
      s.observations.push({
        id: `OBS-${String(obsSeq).padStart(4, '0')}`,
        companyId: r.values.company_id,
        metricKey,
        period: r.values.reporting_period,
        actualValue: Number(r.values[cols.actual]),
        planValue: Number(r.values[cols.plan]),
        originalValues: {
          company_id: r.values.company_id,
          reporting_period: r.values.reporting_period,
          [cols.actual]: r.values[cols.actual],
          [cols.plan]: r.values[cols.plan],
        },
        sourceName: r.values.source_name,
        sourceUpdatedAt: r.values.source_updated_at,
        importJobId: SEED_IMPORT.id,
        fileName: SEED_IMPORT.fileName,
        sourceRow: r.sourceRow,
        importedAt: SEED_IMPORT.importedAt,
        importedBy: SEED_IMPORT.importedBy,
        validationStatus: 'valid',
        isCurrent: true,
      })
    }
  }
  s.seq.OBS = obsSeq

  s.importJobs.push({
    id: SEED_IMPORT.id,
    fileName: SEED_IMPORT.fileName,
    status: 'committed',
    createdAt: SEED_IMPORT.importedAt,
    detectedColumns: IMPORT_SCHEMA.map((f) => f.field),
    schema: clone(IMPORT_SCHEMA),
    mapping: Object.fromEntries(IMPORT_SCHEMA.map((f) => [f.field, f.field])),
    rows: SEED_SOURCE_ROWS.map((r) => ({
      rowNumber: r.sourceRow,
      values: { ...r.values },
      classification: 'new',
      issues: [],
    })),
    fileErrors: [],
    summary: null, // filled below from what actually happened
    importedBy: SEED_IMPORT.importedBy,
    committedAt: SEED_IMPORT.importedAt,
    rawRows: [],
  })

  const result = evaluateExceptions(s, {
    at: SEED_IMPORT.importedAt,
    actor: SYSTEM_ACTOR,
    trigger: `import ${SEED_IMPORT.id} (${SEED_IMPORT.fileName})`,
  })
  const job = s.importJobs[0]!
  job.summary = {
    rowsRead: SEED_SOURCE_ROWS.length,
    imported: SEED_SOURCE_ROWS.length,
    unchanged: 0,
    superseded: 0,
    invalid: 0,
    companiesCreated: SEED_COMPANIES.length,
    kpisRecalculated: result.kpisCalculated,
    exceptionsCreated: result.created,
    exceptionsUpdated: result.updated,
  }
  return s
}
