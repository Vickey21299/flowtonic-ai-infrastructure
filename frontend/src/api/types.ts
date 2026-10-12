/**
 * API contract between the frontend and the (future) backend.
 *
 * Every screen reads data only through the `Api` interface at the bottom of this file.
 * Today `src/api/index.ts` implements it with demo data from `src/demo/`.
 * When the backend exists, only `src/api/index.ts` changes: screens and components stay the same.
 *
 * Conventions
 * - `number | null`: null means MISSING. It is never the same as 0 and must be shown as "—".
 * - Money values are in the workspace currency and unit (USD millions in the demo).
 * - Percentages are plain numbers: -14.7368 means -14.7368 %.
 * - KPI values are calculated by the backend (Spec §7). The frontend only formats them.
 * - Dates are ISO 8601 strings.
 */

export type ISODate = string
export type ISODateTime = string

// ---------- Shared enums ----------

export type CompanyStatus = 'on_track' | 'warning' | 'exception' | 'insufficient_data'
export type Severity = 'high' | 'medium' | 'warning'
export type CalcStatus = 'ok' | 'not_calculable' | 'sign_ambiguous'
export type MetricKey = 'revenue' | 'ebitda' | 'ebitda_margin'
export type KpiKey =
  | 'revenue_variance'
  | 'revenue_variance_pct'
  | 'ebitda_variance'
  | 'ebitda_variance_pct'
  | 'ebitda_margin_actual_pct'
  | 'ebitda_margin_plan_pct'
  | 'ebitda_margin_variance_pp'
export type ValueUnit = 'currency' | 'pct' | 'pp'

export type ExceptionStatus = 'open' | 'acknowledged' | 'in_review' | 'resolved'
export type ResolutionReason =
  | 'action_verified'
  | 'data_corrected'
  | 'condition_cleared'
  | 'not_material'
  | 'other'

export type InvestigationMode = 'live' | 'mock'
export type InvestigationStatus = 'running' | 'completed' | 'failed'
export type ReviewStatus = 'unreviewed' | 'reviewed'
export type EvidenceStrength = 'none' | 'weak' | 'moderate' | 'strong'
export type CauseDetermination = 'undetermined' | 'partially_supported' | 'supported'

export type ActionStatus =
  | 'proposed'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'outcome_verification'
  | 'verified'
  | 'reopened'
  | 'cancelled'
export type Priority = 'high' | 'medium' | 'low'

export type ImpactVerificationStatus = 'not_yet_measurable' | 'unverified' | 'verified' | 'rejected'

// ---------- Common building blocks ----------

export interface ReportingPeriod {
  key: string // e.g. "2026-09"
  label: string // e.g. "Sep 2026"
  type: 'month' | 'quarter'
}

export interface KpiValue {
  value: number | null
  status: CalcStatus
  reason?: string // why not calculable, e.g. "Plan revenue is zero"
}

export interface ActualPlan {
  actual: number | null
  plan: number | null
}

export interface AuditEntry {
  id: string
  at: ISODateTime
  actor: string
  event: string // e.g. "Status changed: open → acknowledged"
  detail?: string
}

export interface Note {
  id: string
  at: ISODateTime
  author: string
  text: string
}

export interface EvidenceItem {
  id: string
  at: ISODateTime
  kind: 'note' | 'document_ref' | 'link'
  description: string
  reference?: string
}

// ---------- Workspace / header ----------

export interface WorkspaceInfo {
  name: string // e.g. "Demo Fund I"
  environment: 'demo' | 'production'
  currency: string // "USD"
  unit: 'units' | 'thousands' | 'millions'
  periods: ReportingPeriod[]
  currentPeriod: string // ReportingPeriod.key
  lastImportAt: ISODateTime
  sourceName: string
  sourceUpdatedAt: ISODateTime
  aiMode: InvestigationMode
  demoUser: { name: string; role: string }
}

// ---------- Overview & companies ----------

export interface PortfolioFilters {
  period?: string
  sector?: string
  status?: CompanyStatus
  /** true = only companies requiring attention (status warning or exception). */
  attention?: boolean
  search?: string
}

export interface CompanySummary {
  id: string
  name: string
  sector: string
  currency: string
  period: string // ReportingPeriod.key
  financials: { revenue: ActualPlan; ebitda: ActualPlan }
  kpis: Record<KpiKey, KpiValue>
  status: CompanyStatus
  openExceptions: number
  openActions: number
  lastDataUpdate: ISODateTime
}

export interface OverviewCards {
  companies: number
  requiringAttention: number
  openHighExceptions: number
  overdueActions: number
  awaitingVerification: number
}

export interface ActualVsPlanPoint {
  companyId: string
  companyName: string
  actual: number | null
  plan: number | null
}

export interface OverviewResponse {
  period: ReportingPeriod
  cards: OverviewCards
  rows: CompanySummary[]
  sectors: string[] // for the sector filter
  charts: {
    revenueByCompany: ActualVsPlanPoint[]
    ebitdaByCompany: ActualVsPlanPoint[]
    statusDistribution: { status: CompanyStatus; count: number }[]
    exceptionsBySeverity: { severity: Severity; count: number }[]
  }
  freshness: { latestPeriod: string; lastImportAt: ISODateTime }
}

export interface CompanyPeriodPoint {
  period: string
  periodLabel: string
  revenue: ActualPlan
  ebitda: ActualPlan
  marginActualPct: number | null
  marginPlanPct: number | null
}

export interface MetricDefinition {
  key: MetricKey | string
  label: string
  unit: ValueUnit
  description: string
  hasData: boolean // only metrics with definition AND data are shown (Spec §5)
}

export interface ObservationRecord {
  id: string
  companyId: string
  metricKey: MetricKey
  period: string
  actualValue: number | null
  planValue: number | null
  originalValues: Record<string, string> // raw strings from the CSV
  sourceName: string
  sourceUpdatedAt: ISODateTime
  importJobId: string
  fileName: string
  sourceRow: number
  importedAt: ISODateTime
  importedBy: string
  validationStatus: 'valid' | 'invalid'
  isCurrent: boolean
}

export interface CompanyDetail {
  company: CompanySummary
  history: CompanyPeriodPoint[] // only periods that have stored observations
  metrics: MetricDefinition[]
  exceptions: ExceptionSummary[]
  investigations: InvestigationSummary[]
  actions: ActionSummary[]
  dataHistory: ObservationRecord[]
}

// ---------- Rules ----------

export interface Rule {
  id: string
  key: string // e.g. "EBITDA_VAR_HIGH"
  label: string
  kpiKey: KpiKey
  comparator: 'lte'
  threshold: number
  severity: Severity
  enabled: boolean
}

export interface RuleConfiguration {
  version: number
  activatedAt: ISODateTime
  rules: Rule[]
}

// ---------- Exceptions ----------

export interface ExceptionFilters {
  severity?: Severity
  companyId?: string
  metricKey?: MetricKey
  period?: string
  status?: ExceptionStatus | 'not_resolved'
  owner?: string
}

export interface ExceptionSummary {
  id: string
  companyId: string
  companyName: string
  period: string
  metricKey: MetricKey
  kpiKey: KpiKey
  metricLabel: string // e.g. "EBITDA"
  actualValue: number | null
  planValue: number | null
  variancePct: number | null
  severity: Severity
  ruleKey: string
  ruleLabel: string // e.g. "EBITDA variance ≤ −10%"
  threshold: number
  status: ExceptionStatus
  conditionActive: boolean // false = "condition cleared — review"
  owner: string | null
  createdAt: ISODateTime
}

export interface ExceptionDetail extends ExceptionSummary {
  calculation: {
    formula: string // "(EBITDA actual − EBITDA plan) / EBITDA plan × 100"
    substituted: string // "(1.62 − 1.90) / 1.90 × 100"
    result: string // "−14.74%"
  }
  source: {
    sourceName: string
    sourceUpdatedAt: ISODateTime
    importJobId: string
    fileName: string
    sourceRow: number
    importedAt: ISODateTime
  }
  ruleConfigurationVersion: number
  allowedTransitions: ExceptionStatus[] // computed by the backend from the state machine
  resolutionReason: ResolutionReason | null
  resolutionNote: string | null
  relatedObservations: ObservationRecord[]
  investigations: InvestigationSummary[]
  actions: ActionSummary[]
  history: AuditEntry[]
}

export interface TraceStep {
  kind: 'rule' | 'evaluation' | 'kpi' | 'observation' | 'import'
  title: string
  fields: { label: string; value: string }[]
}

export interface ExceptionTransitionRequest {
  to: ExceptionStatus
  owner?: string
  reason?: ResolutionReason
  note?: string
}

// ---------- Investigations ----------

export interface EvidenceRef {
  id: string // e.g. "kpi:apex-ebitda_variance_pct"
  label: string // e.g. "EBITDA variance % (Sep 2026)"
  value: string // e.g. "−14.74%"
}

export interface InvestigationOutput {
  executiveSummary: string
  confirmedObservations: { statement: string; evidenceIds: string[] }[]
  potentialExplanations: {
    id: string
    statement: string
    supportingEvidenceIds: string[]
    missingEvidence: string[]
    evidenceStrength: EvidenceStrength
  }[]
  missingEvidence: { type: string; whyNeeded: string; explanations: string[] }[]
  managementQuestions: { question: string; explanations: string[] }[]
  nextSteps: { step: string; type: 'data_request' | 'analysis' | 'meeting' }[]
  suggestedActions: { title: string; rationale: string; explanations: string[] }[]
  overallAssessment: {
    causeDetermination: CauseDetermination
    evidenceStrength: EvidenceStrength
    rationale: string
  }
  dataLimitations: string[]
}

export interface InvestigationFilters {
  companyId?: string
  exceptionId?: string
  reviewStatus?: ReviewStatus
}

export interface InvestigationSummary {
  id: string
  exceptionId: string
  companyId: string
  companyName: string
  metricLabel: string
  mode: InvestigationMode
  status: InvestigationStatus
  reviewStatus: ReviewStatus
  createdAt: ISODateTime
}

export interface InvestigationDetail extends InvestigationSummary {
  evidence: EvidenceRef[] // what the output may cite
  output: InvestigationOutput | null // raw model / mock output, never edited
  editedOutput: InvestigationOutput | null // analyst edit, shown labelled "edited by analyst"
  analystNotes: Note[]
  error: { category: string; message: string } | null
  modelMetadata: { provider: string; model: string; promptVersion: string } | null
  reviewedBy: string | null
  reviewedAt: ISODateTime | null
}

// ---------- Actions ----------

export interface ActionFilters {
  /** 'awaiting_verification' = completed or outcome_verification (same rule as the overview card). */
  status?: ActionStatus | 'awaiting_verification'
  priority?: Priority
  owner?: string
  companyId?: string
  overdue?: boolean
}

export interface ActionSummary {
  id: string
  companyId: string
  companyName: string
  exceptionId: string
  investigationId: string | null
  title: string
  priority: Priority
  owner: string | null
  dueDate: ISODate | null
  status: ActionStatus
  isOverdue: boolean
  verificationStatus: ImpactVerificationStatus | 'none'
  createdAt: ISODateTime
}

export interface ActionDetail extends ActionSummary {
  description: string
  completionNotes: string | null
  cancelReason: string | null
  evidence: EvidenceItem[]
  notes: Note[]
  impacts: ImpactRecord[]
  allowedTransitions: ActionStatus[] // computed by the backend from the state machine
  history: AuditEntry[]
  updatedAt: ISODateTime
}

export interface ActionCreateInput {
  exceptionId: string
  investigationId?: string | null
  title: string
  description: string
  priority: Priority
  owner?: string | null
  dueDate?: ISODate | null
}

export type ActionUpdateInput = Partial<
  Pick<ActionDetail, 'title' | 'description' | 'priority' | 'owner' | 'dueDate'>
>

export interface ActionTransitionRequest {
  to: ActionStatus
  completionNotes?: string
  reason?: string // required for cancelled / reopened
}

// ---------- Impact ----------

export interface ImpactFilters {
  companyId?: string
  actionId?: string
  verificationStatus?: ImpactVerificationStatus
}

export interface ImpactRecord {
  id: string
  companyId: string
  companyName: string
  actionId: string
  actionTitle: string
  metricKey: MetricKey
  metricLabel: string
  unit: ValueUnit
  baselineValue: number | null
  baselinePeriod: string
  targetValue: number | null
  targetPeriod: string
  estimatedValue: number | null // projection — NEVER realised
  observedValue: number | null
  observationPeriod: string | null
  measurementSource: string | null
  verificationStatus: ImpactVerificationStatus
  reviewer: string | null
  verificationRationale: string | null
  evidenceReference: string | null
  notes: string
  history: AuditEntry[]
}

export interface ImpactCreateInput {
  actionId: string
  metricKey: MetricKey
  baselineValue: number | null
  baselinePeriod: string
  targetValue: number | null
  targetPeriod: string
  estimatedValue?: number | null
  notes?: string
}

export type ImpactUpdateInput = Partial<
  Pick<
    ImpactRecord,
    | 'targetValue'
    | 'targetPeriod'
    | 'estimatedValue'
    | 'observedValue'
    | 'observationPeriod'
    | 'measurementSource'
    | 'notes'
    | 'evidenceReference'
  >
>

export interface ImpactVerificationRequest {
  decision: 'verified' | 'rejected'
  reviewer: string
  rationale: string
  evidenceReference?: string
}

// ---------- Import ----------

export type SchemaField =
  | 'company_id'
  | 'company_name'
  | 'sector'
  | 'reporting_period'
  | 'revenue_actual'
  | 'revenue_plan'
  | 'ebitda_actual'
  | 'ebitda_plan'
  | 'source_name'
  | 'source_updated_at'

export interface SchemaFieldInfo {
  field: SchemaField
  label: string
  required: boolean
  description: string
}

export type ImportJobStatus = 'uploaded' | 'validated' | 'committed' | 'cancelled' | 'failed'

export interface ImportIssue {
  field: string
  severity: 'error' | 'warning'
  message: string
}

export interface ImportRow {
  rowNumber: number // as in the file, header = row 1
  values: Record<string, string>
  classification: 'new' | 'unchanged' | 'changed' | 'invalid'
  issues: ImportIssue[]
}

export interface ImportSummary {
  rowsRead: number
  imported: number
  unchanged: number
  superseded: number
  invalid: number
  companiesCreated: number
  kpisRecalculated: number
  exceptionsCreated: number
  exceptionsUpdated: number
  /** Part of exceptionsUpdated: breaches that no longer hold, flagged "condition cleared — review". */
  exceptionsConditionCleared?: number
}

export interface ImportJob {
  id: string
  fileName: string
  status: ImportJobStatus
  createdAt: ISODateTime
  detectedColumns: string[]
  schema: SchemaFieldInfo[]
  mapping: Partial<Record<SchemaField, string | null>> // schema field → CSV column
  rows: ImportRow[] // empty until mapping is applied
  fileErrors: string[] // file-level problems that block confirmation
  summary: ImportSummary | null
}

// ---------- Methodology & settings ----------

export interface MethodologyResponse {
  methodologyVersion: string
  period: ReportingPeriod
  lastImportAt: ISODateTime
  kpiDefinitions: { key: KpiKey; label: string; formula: string; unit: ValueUnit; notes?: string }[]
  ruleConfiguration: RuleConfiguration
  edgeCases: { case: string; handling: string }[]
  dataSources: { name: string; updatedAt: ISODateTime; lastImportAt: ISODateTime; fileName: string }[]
  missingData: { companyName: string; field: string; period: string }[]
  validationErrors: { fileName: string; row: number; field: string; message: string }[]
  knownLimitations: string[]
  aiStatus: { mode: InvestigationMode; liveConfigured: boolean; note: string }
  dataNature: { item: string; nature: 'observed' | 'calculated' | 'estimated' | 'hypothetical' }[]
}

export interface SettingsResponse {
  environment: 'demo' | 'production'
  ruleConfiguration: RuleConfiguration
  aiMode: InvestigationMode
  liveAiAvailable: boolean
}

export interface SettingsUpdateInput {
  rules?: Pick<Rule, 'id' | 'threshold' | 'enabled'>[]
  aiMode?: InvestigationMode
}

// ---------- The API ----------

/**
 * Every function returns a Promise and may throw `ApiError` (src/api/errors.ts).
 * Mutations return the updated record so the caller can refresh its cache.
 */
export interface Api {
  getWorkspace(): Promise<WorkspaceInfo>

  getOverview(filters: PortfolioFilters): Promise<OverviewResponse>
  listCompanies(filters: PortfolioFilters): Promise<CompanySummary[]>
  getCompany(id: string): Promise<CompanyDetail>

  listExceptions(filters: ExceptionFilters): Promise<ExceptionSummary[]>
  getException(id: string): Promise<ExceptionDetail>
  getExceptionTrace(id: string): Promise<TraceStep[]>
  transitionException(id: string, req: ExceptionTransitionRequest): Promise<ExceptionDetail>

  listInvestigations(filters: InvestigationFilters): Promise<InvestigationSummary[]>
  getInvestigation(id: string): Promise<InvestigationDetail>
  /** Generate or regenerate. Regenerating creates a NEW run; earlier runs are kept. */
  generateInvestigation(exceptionId: string, mode: InvestigationMode): Promise<InvestigationDetail>
  addInvestigationNote(id: string, text: string): Promise<InvestigationDetail>
  saveInvestigationEdit(id: string, edited: InvestigationOutput): Promise<InvestigationDetail>
  markInvestigationReviewed(id: string): Promise<InvestigationDetail>

  listActions(filters: ActionFilters): Promise<ActionSummary[]>
  getAction(id: string): Promise<ActionDetail>
  createAction(input: ActionCreateInput): Promise<ActionDetail>
  updateAction(id: string, patch: ActionUpdateInput): Promise<ActionDetail>
  transitionAction(id: string, req: ActionTransitionRequest): Promise<ActionDetail>
  addActionNote(id: string, text: string): Promise<ActionDetail>
  addActionEvidence(
    id: string,
    item: Pick<EvidenceItem, 'kind' | 'description' | 'reference'>,
  ): Promise<ActionDetail>

  listImpacts(filters: ImpactFilters): Promise<ImpactRecord[]>
  createImpact(input: ImpactCreateInput): Promise<ImpactRecord>
  updateImpact(id: string, patch: ImpactUpdateInput): Promise<ImpactRecord>
  verifyImpact(id: string, req: ImpactVerificationRequest): Promise<ImpactRecord>

  getSampleCsv(): Promise<{ fileName: string; text: string }>
  /** Current state of an import job (so a refreshed wizard can resume). 404 when the job is gone. */
  getImportJob(id: string): Promise<ImportJob>
  uploadImport(file: { name: string; text: string }): Promise<ImportJob>
  setImportMapping(id: string, mapping: ImportJob['mapping']): Promise<ImportJob>
  confirmImport(id: string, opts: { acknowledgeInvalidRows: boolean }): Promise<ImportJob>
  cancelImport(id: string): Promise<ImportJob>

  getMethodology(): Promise<MethodologyResponse>
  getSettings(): Promise<SettingsResponse>
  updateSettings(input: SettingsUpdateInput): Promise<SettingsResponse>
  resetDemo(): Promise<void>
}
