"""Import endpoints under /api/imports. Contract: ImportJob in frontend/src/api/types.ts."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from psycopg import Connection
from pydantic import Field

from ..db import get_write_conn
from ..errors import ApiError
from ..schemas import Model
from . import service

router = APIRouter(prefix="/api/imports")
WriteConn = Annotated[Connection, Depends(get_write_conn)]


class SchemaFieldInfo(Model):
    field: str
    label: str
    required: bool
    description: str


class ImportIssue(Model):
    field: str
    severity: Literal["error", "warning"]
    message: str


class ImportRow(Model):
    row_number: int
    values: dict[str, str]
    classification: Literal["new", "unchanged", "changed", "invalid"]
    issues: list[ImportIssue]


class ImportSummary(Model):
    rows_read: int
    imported: int
    unchanged: int
    superseded: int
    invalid: int
    companies_created: int
    kpis_recalculated: int
    exceptions_created: int
    exceptions_updated: int
    exceptions_condition_cleared: int = 0


class ImportJob(Model):
    id: str
    file_name: str
    status: Literal["uploaded", "validated", "committed", "cancelled", "failed"]
    created_at: str
    detected_columns: list[str]
    schema_: list[SchemaFieldInfo] = Field(alias="schema")
    mapping: dict[str, str | None]
    rows: list[ImportRow]
    file_errors: list[str]
    summary: ImportSummary | None


class UploadRequest(Model):
    name: str = Field(max_length=255)
    text: str


class MappingRequest(Model):
    mapping: dict[str, str | None]


class ConfirmRequest(Model):
    acknowledge_invalid_rows: bool = False


def _settings(request: Request):
    return request.app.state.settings


def _actor(request: Request) -> str:
    # No user authentication exists yet (spec §18): writes are attributed to the configured demo actor.
    return _settings(request).workspace_user_name


def _check_size(request: Request) -> None:
    limit = _settings(request).import_max_bytes
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > limit * 2:  # JSON escaping can grow the body
        raise ApiError(413, "payload_too_large", f"The file is larger than {limit // (1024 * 1024)} MB.")


@router.post("", response_model=ImportJob, status_code=201, dependencies=[Depends(_check_size)])
def upload_import(body: UploadRequest, conn: WriteConn, request: Request):
    return service.upload(conn, _settings(request), body.name, body.text, _actor(request))


@router.get("/{job_id}", response_model=ImportJob)
def get_import(job_id: str, conn: WriteConn):
    return service.get(conn, job_id)


@router.put("/{job_id}/mapping", response_model=ImportJob)
def set_import_mapping(job_id: str, body: MappingRequest, conn: WriteConn):
    return service.set_mapping(conn, job_id, body.mapping)


@router.post("/{job_id}/confirm", response_model=ImportJob)
def confirm_import(job_id: str, body: ConfirmRequest, conn: WriteConn, request: Request):
    return service.confirm(conn, job_id, body.acknowledge_invalid_rows, _actor(request))


@router.post("/{job_id}/cancel", response_model=ImportJob)
def cancel_import(job_id: str, conn: WriteConn):
    return service.cancel(conn, job_id)
