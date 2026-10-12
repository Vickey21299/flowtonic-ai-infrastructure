"""Read-only endpoints under /api. Query parameters mirror the frontend filter types."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from psycopg import Connection

from . import repository as repo
from . import schemas as s
from .db import get_conn

router = APIRouter(prefix="/api")
Conn = Annotated[Connection, Depends(get_conn)]
Period = Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


@router.get("/health", response_model=s.Health)
def health(conn: Conn):
    role = conn.execute("select current_user as u").fetchone()["u"]
    return {"status": "ok", "database": "ok", "database_role": role, "latest_period": repo.latest_period(conn)}


@router.get("/workspace", response_model=s.WorkspaceInfo)
def workspace(conn: Conn, request: Request):
    return repo.workspace(conn, request.app.state.settings, request.app.state.ai_mode)


# ---------- Overview & companies ----------


@router.get("/dashboard/kpis", response_model=s.OverviewResponse)
def dashboard_kpis(
    conn: Conn,
    period: Period = None,
    sector: str | None = None,
    status: s.CompanyStatus | None = None,
    attention: bool | None = None,
    search: str | None = None,
):
    return repo.overview(conn, period, sector=sector, status=status, attention=attention, search=search)


@router.get("/companies", response_model=list[s.CompanySummary])
def list_companies(
    conn: Conn,
    period: Period = None,
    sector: str | None = None,
    status: s.CompanyStatus | None = None,
    attention: bool | None = None,
    search: str | None = None,
):
    return repo.company_rows(
        conn, period or repo.latest_period(conn) or "", sector=sector, status=status, attention=attention, search=search
    )


@router.get("/companies/{company_id}", response_model=s.CompanyDetail)
def get_company(conn: Conn, company_id: str):
    return repo.company_detail(conn, company_id)


# ---------- Exceptions ----------


@router.get("/exceptions", response_model=list[s.ExceptionSummary])
def list_exceptions(
    conn: Conn,
    severity: s.Severity | None = None,
    company_id: Annotated[str | None, Query(alias="companyId")] = None,
    metric_key: Annotated[s.MetricKey | None, Query(alias="metricKey")] = None,
    period: Period = None,
    status: s.ExceptionStatus | Literal["not_resolved"] | None = None,
    owner: str | None = None,
):
    return repo.list_exceptions(conn, severity, company_id, metric_key, period, status, owner)


@router.get("/exceptions/{exception_id}", response_model=s.ExceptionDetail)
def get_exception(conn: Conn, exception_id: str):
    return repo.exception_detail(conn, exception_id)


@router.get("/exceptions/{exception_id}/trace", response_model=list[s.TraceStep])
def get_exception_trace(conn: Conn, exception_id: str):
    return repo.exception_trace(conn, exception_id)


# ---------- Investigations ----------


@router.get("/investigations", response_model=list[s.InvestigationSummary])
def list_investigations(
    conn: Conn,
    company_id: Annotated[str | None, Query(alias="companyId")] = None,
    exception_id: Annotated[str | None, Query(alias="exceptionId")] = None,
    review_status: Annotated[s.ReviewStatus | None, Query(alias="reviewStatus")] = None,
):
    return repo.list_investigations(conn, company_id, exception_id, review_status)


@router.get("/investigations/{investigation_id}", response_model=s.InvestigationDetail)
def get_investigation(conn: Conn, investigation_id: str):
    return repo.investigation_detail(conn, investigation_id)


# ---------- Actions & impact ----------


@router.get("/actions", response_model=list[s.ActionSummary])
def list_actions(
    conn: Conn,
    status: s.ActionStatus | Literal["awaiting_verification"] | None = None,
    priority: s.Priority | None = None,
    owner: str | None = None,
    company_id: Annotated[str | None, Query(alias="companyId")] = None,
    overdue: bool | None = None,
):
    return repo.list_actions(conn, status, priority, owner, company_id, overdue)


@router.get("/actions/{action_id}", response_model=s.ActionDetail)
def get_action(conn: Conn, action_id: str):
    return repo.action_detail(conn, action_id)


@router.get("/impacts", response_model=list[s.ImpactRecord])
def list_impacts(
    conn: Conn,
    company_id: Annotated[str | None, Query(alias="companyId")] = None,
    action_id: Annotated[str | None, Query(alias="actionId")] = None,
    verification_status: Annotated[s.ImpactVerificationStatus | None, Query(alias="verificationStatus")] = None,
):
    return repo.list_impacts(conn, company_id, action_id, verification_status)
