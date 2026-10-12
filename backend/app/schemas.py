"""Response models. They mirror frontend/src/api/types.ts and serialise as camelCase."""

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

CompanyStatus = Literal["on_track", "warning", "exception", "insufficient_data"]
Severity = Literal["high", "medium", "warning"]
CalcStatus = Literal["ok", "not_calculable", "sign_ambiguous"]
MetricKey = Literal["revenue", "ebitda", "ebitda_margin"]
KpiKey = Literal[
    "revenue_variance",
    "revenue_variance_pct",
    "ebitda_variance",
    "ebitda_variance_pct",
    "ebitda_margin_actual_pct",
    "ebitda_margin_plan_pct",
    "ebitda_margin_variance_pp",
]
ExceptionStatus = Literal["open", "acknowledged", "in_review", "resolved"]
ActionStatus = Literal[
    "proposed", "approved", "in_progress", "completed", "outcome_verification", "verified", "reopened", "cancelled"
]
Priority = Literal["high", "medium", "low"]
ImpactVerificationStatus = Literal["not_yet_measurable", "unverified", "verified", "rejected"]
ReviewStatus = Literal["unreviewed", "reviewed"]


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------- Common ----------


class ReportingPeriod(Model):
    key: str
    label: str
    type: Literal["month", "quarter"] = "month"


class KpiValue(Model):
    value: float | None
    status: CalcStatus
    reason: str | None = None


class ActualPlan(Model):
    actual: float | None
    plan: float | None


class AuditEntry(Model):
    id: str
    at: str
    actor: str
    event: str
    detail: str | None = None


class Note(Model):
    id: str
    at: str
    author: str
    text: str


class EvidenceItem(Model):
    id: str
    at: str
    kind: Literal["note", "document_ref", "link"]
    description: str
    reference: str | None = None


class Health(Model):
    status: Literal["ok"]
    database: Literal["ok"]
    database_role: str
    latest_period: str | None


# ---------- Workspace ----------


class DemoUser(Model):
    name: str
    role: str


class WorkspaceInfo(Model):
    name: str
    environment: Literal["demo", "production"]
    currency: str
    unit: str
    periods: list[ReportingPeriod]
    current_period: str
    last_import_at: str
    source_name: str
    source_updated_at: str
    ai_mode: Literal["live", "mock"]
    demo_user: DemoUser


# ---------- Companies & overview ----------


class Financials(Model):
    revenue: ActualPlan
    ebitda: ActualPlan


class CompanySummary(Model):
    id: str
    name: str
    sector: str
    currency: str
    period: str
    financials: Financials
    kpis: dict[str, KpiValue]
    status: CompanyStatus
    open_exceptions: int
    open_actions: int
    last_data_update: str


class OverviewCards(Model):
    companies: int
    requiring_attention: int
    open_high_exceptions: int
    overdue_actions: int
    awaiting_verification: int


class ActualVsPlanPoint(Model):
    company_id: str
    company_name: str
    actual: float | None
    plan: float | None


class StatusCount(Model):
    status: CompanyStatus
    count: int


class SeverityCount(Model):
    severity: Severity
    count: int


class OverviewCharts(Model):
    revenue_by_company: list[ActualVsPlanPoint]
    ebitda_by_company: list[ActualVsPlanPoint]
    status_distribution: list[StatusCount]
    exceptions_by_severity: list[SeverityCount]


class Freshness(Model):
    latest_period: str
    last_import_at: str


class OverviewResponse(Model):
    period: ReportingPeriod
    cards: OverviewCards
    rows: list[CompanySummary]
    sectors: list[str]
    charts: OverviewCharts
    freshness: Freshness


class CompanyPeriodPoint(Model):
    period: str
    period_label: str
    revenue: ActualPlan
    ebitda: ActualPlan
    margin_actual_pct: float | None
    margin_plan_pct: float | None


class MetricDefinition(Model):
    key: str
    label: str
    unit: Literal["currency", "pct", "pp"]
    description: str
    has_data: bool


class ObservationRecord(Model):
    id: str
    company_id: str
    metric_key: MetricKey
    period: str
    actual_value: float | None
    plan_value: float | None
    original_values: dict[str, str]
    source_name: str
    source_updated_at: str
    import_job_id: str
    file_name: str
    source_row: int
    imported_at: str
    imported_by: str
    validation_status: str
    is_current: bool


# ---------- Exceptions ----------


class ExceptionSummary(Model):
    id: str
    company_id: str
    company_name: str
    period: str
    metric_key: MetricKey
    kpi_key: KpiKey
    metric_label: str
    actual_value: float | None
    plan_value: float | None
    variance_pct: float | None
    severity: Severity
    rule_key: str
    rule_label: str
    threshold: float
    status: ExceptionStatus
    condition_active: bool
    owner: str | None
    created_at: str


class Calculation(Model):
    formula: str
    substituted: str
    result: str


class SourceInfo(Model):
    source_name: str
    source_updated_at: str
    import_job_id: str
    file_name: str
    source_row: int
    imported_at: str


class InvestigationSummary(Model):
    id: str
    exception_id: str
    company_id: str
    company_name: str
    metric_label: str
    mode: Literal["live", "mock"]
    status: Literal["running", "completed", "failed"]
    review_status: ReviewStatus
    created_at: str


class ActionSummary(Model):
    id: str
    company_id: str
    company_name: str
    exception_id: str
    investigation_id: str | None
    title: str
    priority: Priority
    owner: str | None
    due_date: str | None
    status: ActionStatus
    is_overdue: bool
    verification_status: ImpactVerificationStatus | Literal["none"]
    created_at: str


class ExceptionDetail(ExceptionSummary):
    calculation: Calculation
    source: SourceInfo
    rule_configuration_version: int
    allowed_transitions: list[ExceptionStatus]
    resolution_reason: str | None
    resolution_note: str | None
    related_observations: list[ObservationRecord]
    investigations: list[InvestigationSummary]
    actions: list[ActionSummary]
    history: list[AuditEntry]


class TraceField(Model):
    label: str
    value: str


class TraceStep(Model):
    kind: Literal["rule", "evaluation", "kpi", "observation", "import"]
    title: str
    fields: list[TraceField]


# ---------- Investigations ----------


class ConfirmedObservation(Model):
    statement: str
    evidence_ids: list[str]


class PotentialExplanation(Model):
    id: str
    statement: str
    supporting_evidence_ids: list[str]
    missing_evidence: list[str]
    evidence_strength: Literal["none", "weak", "moderate", "strong"]


class MissingEvidence(Model):
    type: str
    why_needed: str
    explanations: list[str]


class SuggestedAction(Model):
    title: str
    rationale: str
    explanations: list[str]


class OverallAssessment(Model):
    cause_determination: Literal["undetermined", "partially_supported", "supported"]
    evidence_strength: Literal["none", "weak", "moderate", "strong"]
    rationale: str


class InvestigationOutput(Model):
    executive_summary: str
    confirmed_observations: list[ConfirmedObservation]
    potential_explanations: list[PotentialExplanation]
    missing_evidence: list[MissingEvidence]
    management_questions: list[dict]
    next_steps: list[dict]
    suggested_actions: list[SuggestedAction]
    overall_assessment: OverallAssessment
    data_limitations: list[str]


class ModelMetadata(Model):
    provider: str
    model: str
    prompt_version: str


class InvestigationDetail(InvestigationSummary):
    evidence: list[dict]
    output: InvestigationOutput | None
    edited_output: InvestigationOutput | None
    analyst_notes: list[Note]
    error: dict | None
    model_metadata: ModelMetadata | None
    reviewed_by: str | None
    reviewed_at: str | None


# ---------- Actions & impact ----------


class ImpactRecord(Model):
    id: str
    company_id: str
    company_name: str
    action_id: str
    action_title: str
    metric_key: MetricKey
    metric_label: str
    unit: Literal["currency", "pct", "pp"]
    baseline_value: float | None
    baseline_period: str
    target_value: float | None
    target_period: str
    estimated_value: float | None
    observed_value: float | None
    observation_period: str | None
    measurement_source: str | None
    verification_status: ImpactVerificationStatus
    reviewer: str | None
    verification_rationale: str | None
    evidence_reference: str | None
    notes: str
    history: list[AuditEntry]


class ActionDetail(ActionSummary):
    description: str
    completion_notes: str | None
    cancel_reason: str | None
    evidence: list[EvidenceItem]
    notes: list[Note]
    impacts: list[ImpactRecord]
    allowed_transitions: list[ActionStatus]
    history: list[AuditEntry]
    updated_at: str


class CompanyDetail(Model):
    company: CompanySummary
    history: list[CompanyPeriodPoint]
    metrics: list[MetricDefinition]
    exceptions: list[ExceptionSummary]
    investigations: list[InvestigationSummary]
    actions: list[ActionSummary]
    data_history: list[ObservationRecord]
