"""FastAPI app: read endpoints, CSV import, investigations and workflow over the Flowtonic database.

    .venv/Scripts/uvicorn app.main:app --reload --port 8000
"""

import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .db import create_pool
from .errors import install_error_handlers
from .imports.routes import router as imports_router
from .investigations.routes import router as investigations_router
from .workflow.routes import router as workflow_router
from .logs import log, request_id, setup_logging
from .routes import router

setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings: Settings = app.state.settings
    pool = create_pool(settings, settings.api_database_url)
    write_pool = create_pool(settings, settings.api_write_database_url) if settings.api_write_database_url else None
    # Don't block startup on the database: requests return 503 until it is reachable.
    for p in (pool, write_pool):
        if p:
            p.open(wait=False)
    app.state.pool, app.state.write_pool = pool, write_pool
    try:
        yield
    finally:
        for p in (pool, write_pool):
            if p:
                p.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Flowtonic API", version="0.2.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.ai_mode = settings.ai_mode
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type", "Accept"],
    )
    install_error_handlers(app)

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        """→ request in, ← response out with status and duration. Every log line in between carries the id."""
        if not request.url.path.startswith("/api"):
            return await call_next(request)
        rid = f"req_{uuid.uuid4().hex[:6]}"
        token = request_id.set(rid)
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        size = request.headers.get("content-length")
        log.info("→ %s %s%s", request.method, path, f" ({int(size) / 1024:.1f} KB body)" if size else "")
        started = time.perf_counter()
        try:
            response = await call_next(request)
            ms = (time.perf_counter() - started) * 1000
            log.info("← %s %s %s (%.0f ms)", response.status_code, request.method, path, ms)
            response.headers["X-Request-Id"] = rid
            return response
        finally:
            request_id.reset(token)

    app.include_router(router)
    app.include_router(imports_router)
    app.include_router(investigations_router)
    app.include_router(workflow_router)
    return app


app = create_app()
