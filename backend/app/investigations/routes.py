"""Investigation write endpoints. Contract: InvestigationDetail in frontend/src/api/types.ts."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from psycopg import Connection
from pydantic import Field

from .. import schemas as s
from ..db import get_write_conn
from . import service

router = APIRouter(prefix="/api/investigations")
WriteConn = Annotated[Connection, Depends(get_write_conn)]


class GenerateRequest(s.Model):
    exception_id: str
    mode: Literal["live", "mock"]


class NoteRequest(s.Model):
    text: str = Field(max_length=5000)


class EditRequest(s.Model):
    edited: s.InvestigationOutput


def _actor(request: Request) -> str:
    return request.app.state.settings.workspace_user_name


@router.post("", response_model=s.InvestigationDetail, status_code=201)
def generate(body: GenerateRequest, conn: WriteConn, request: Request):
    return service.generate(conn, request.app.state.settings, body.exception_id, body.mode, _actor(request))


@router.post("/{investigation_id}/notes", response_model=s.InvestigationDetail)
def add_note(investigation_id: str, body: NoteRequest, conn: WriteConn, request: Request):
    return service.add_note(conn, investigation_id, body.text, _actor(request))


@router.put("/{investigation_id}/edit", response_model=s.InvestigationDetail)
def save_edit(investigation_id: str, body: EditRequest, conn: WriteConn, request: Request):
    return service.save_edit(conn, investigation_id, body.edited.model_dump(), _actor(request))


@router.post("/{investigation_id}/review", response_model=s.InvestigationDetail)
def mark_reviewed(investigation_id: str, conn: WriteConn, request: Request):
    return service.mark_reviewed(conn, investigation_id, _actor(request))
