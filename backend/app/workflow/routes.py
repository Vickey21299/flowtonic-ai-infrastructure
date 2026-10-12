"""Workflow write endpoints. Contracts: frontend/src/api/types.ts (Api interface)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from psycopg import Connection
from pydantic import Field

from .. import schemas as s
from ..db import get_write_conn
from ..errors import ApiError
from . import service

router = APIRouter(prefix="/api")
WriteConn = Annotated[Connection, Depends(get_write_conn)]
Text = Annotated[str, Field(max_length=5000)]


def _actor(request: Request) -> str:
    return request.app.state.settings.workspace_user_name


# ---------- Exceptions ----------


class ExceptionTransition(s.Model):
    to: s.ExceptionStatus
    owner: Text | None = None
    reason: str | None = None
    note: Text | None = None


@router.post("/exceptions/{exception_id}/transition", response_model=s.ExceptionDetail)
def transition_exception(exception_id: str, body: ExceptionTransition, conn: WriteConn, request: Request):
    return service.transition_exception(conn, exception_id, body.to, body.owner, body.reason, body.note,
                                        _actor(request))


# ---------- Actions ----------


class ActionCreate(s.Model):
    exception_id: str
    investigation_id: str | None = None
    title: Text
    description: Text = ""
    priority: str
    owner: Text | None = None
    due_date: str | None = None


class ActionUpdate(s.Model):
    title: Text | None = None
    description: Text | None = None
    priority: str | None = None
    owner: Text | None = None
    due_date: str | None = None


class ActionTransition(s.Model):
    to: s.ActionStatus
    completion_notes: Text | None = None
    reason: Text | None = None


class NoteBody(s.Model):
    text: Text


class EvidenceBody(s.Model):
    kind: str
    description: Text
    reference: Text | None = None


@router.post("/actions", response_model=s.ActionDetail, status_code=201)
def create_action(body: ActionCreate, conn: WriteConn, request: Request):
    return service.create_action(conn, body.model_dump(), _actor(request))


@router.put("/actions/{action_id}", response_model=s.ActionDetail)
def update_action(action_id: str, body: ActionUpdate, conn: WriteConn, request: Request):
    return service.update_action(conn, action_id, body.model_dump(exclude_unset=True), _actor(request))


@router.post("/actions/{action_id}/transition", response_model=s.ActionDetail)
def transition_action(action_id: str, body: ActionTransition, conn: WriteConn, request: Request):
    return service.transition_action(conn, action_id, body.to, body.completion_notes, body.reason, _actor(request))


@router.post("/actions/{action_id}/notes", response_model=s.ActionDetail)
def add_action_note(action_id: str, body: NoteBody, conn: WriteConn, request: Request):
    return service.add_action_note(conn, action_id, body.text, _actor(request))


@router.post("/actions/{action_id}/evidence", response_model=s.ActionDetail)
def add_action_evidence(action_id: str, body: EvidenceBody, conn: WriteConn, request: Request):
    return service.add_action_evidence(conn, action_id, body.kind, body.description, body.reference, _actor(request))


# ---------- Impact ----------


class ImpactCreate(s.Model):
    action_id: str
    metric_key: str
    baseline_value: float | None = None
    baseline_period: str
    target_value: float | None = None
    target_period: str
    estimated_value: float | None = None
    notes: Text | None = None


class ImpactUpdate(s.Model):
    target_value: float | None = None
    target_period: str | None = None
    estimated_value: float | None = None
    observed_value: float | None = None
    observation_period: str | None = None
    measurement_source: Text | None = None
    notes: Text | None = None
    evidence_reference: Text | None = None


class ImpactVerify(s.Model):
    decision: Literal["verified", "rejected"]
    reviewer: Text
    rationale: Text
    evidence_reference: Text | None = None


@router.post("/impacts", response_model=s.ImpactRecord, status_code=201)
def create_impact(body: ImpactCreate, conn: WriteConn, request: Request):
    return service.create_impact(conn, body.model_dump(), _actor(request))


@router.put("/impacts/{impact_id}", response_model=s.ImpactRecord)
def update_impact(impact_id: str, body: ImpactUpdate, conn: WriteConn, request: Request):
    return service.update_impact(conn, impact_id, body.model_dump(exclude_unset=True), _actor(request))


@router.post("/impacts/{impact_id}/verify", response_model=s.ImpactRecord)
def verify_impact(impact_id: str, body: ImpactVerify, conn: WriteConn, request: Request):
    return service.verify_impact(conn, impact_id, body.decision, body.reviewer, body.rationale,
                                 body.evidence_reference, _actor(request))


# ---------- Settings ----------


class RuleOut(s.Model):
    id: str
    key: str
    label: str
    kpi_key: s.KpiKey
    comparator: Literal["lte"]
    threshold: float
    severity: s.Severity
    enabled: bool


class RuleConfigurationOut(s.Model):
    version: int
    activated_at: str
    rules: list[RuleOut]


class SettingsOut(s.Model):
    environment: Literal["demo", "production"]
    rule_configuration: RuleConfigurationOut
    ai_mode: Literal["live", "mock"]
    live_ai_available: bool


class RuleUpdate(s.Model):
    id: str
    threshold: float
    enabled: bool


class SettingsUpdate(s.Model):
    rules: list[RuleUpdate] | None = None
    ai_mode: Literal["live", "mock"] | None = None


@router.get("/settings", response_model=SettingsOut)
def get_settings(conn: WriteConn, request: Request):
    return service.get_settings(conn, request.app.state.settings, request.app.state.ai_mode)


@router.put("/settings", response_model=SettingsOut)
def update_settings(body: SettingsUpdate, conn: WriteConn, request: Request):
    settings = request.app.state.settings
    if body.ai_mode == "live" and not settings.gemini_api_key:
        raise ApiError(422, "validation_error", "Live AI needs GEMINI_API_KEY on the backend.",
                       {"fieldErrors": [{"field": "aiMode", "message": "No AI provider is configured."}]})
    if body.rules:
        service.update_rules(conn, [r.model_dump() for r in body.rules], _actor(request))
    if body.ai_mode:
        request.app.state.ai_mode = body.ai_mode  # per server process; resets to the .env default on restart
    return service.get_settings(conn, settings, request.app.state.ai_mode)
