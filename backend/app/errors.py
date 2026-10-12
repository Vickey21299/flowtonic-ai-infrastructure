"""One error shape for every failure: { code, message, details, request_id }."""

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logs import request_id

log = logging.getLogger("flownetic")  # handlers set up in logs.py


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: object = None):
        self.status, self.code, self.message, self.details = status, code, message, details


def not_found(kind: str, id: str) -> ApiError:
    return ApiError(404, "not_found", f'{kind} "{id}" was not found.')


def _body(code: str, message: str, details: object = None) -> dict:
    rid = request_id.get()  # same id as the terminal log lines of this request
    return {"code": code, "message": message, "details": details,
            "request_id": rid if rid != "-" else f"req_{uuid.uuid4().hex[:6]}"}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, e: ApiError) -> JSONResponse:
        log.warning("  ✗ %s %s: %s", e.status, e.code, e.message)
        return JSONResponse(_body(e.code, e.message, e.details), status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError) -> JSONResponse:
        fields = [
            {"field": ".".join(str(p) for p in err["loc"] if p not in ("query", "path")), "message": err["msg"]}
            for err in e.errors()
        ]
        log.warning("  ✗ 422 validation_error: %s", "; ".join(f"{f['field']}: {f['message']}" for f in fields))
        return JSONResponse(
            _body("validation_error", "The request has invalid parameters.", {"fieldErrors": fields}),
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, e: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if e.status_code == 404 else "method_not_allowed" if e.status_code == 405 else "http_error"
        return JSONResponse(_body(code, str(e.detail)), status_code=e.status_code)

    @app.exception_handler(Exception)
    async def unexpected(_: Request, e: Exception) -> JSONResponse:
        log.exception("Unhandled error")
        return JSONResponse(_body("internal_error", "Unexpected server error."), status_code=500)
