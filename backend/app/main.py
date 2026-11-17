from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import TimeoutError as SATimeoutError
from pathlib import Path
import os
import subprocess

from app.api.routes.api_call_logs import router as api_call_logs_router
from app.api.routes.canvas_api import router as canvas_api_router
from app.api.routes.canvas_workspace import router as canvas_workspace_router
from app.api.routes.canvas_media import router as canvas_media_router
from app.api.routes.workbench_records import router as workbench_records_router
from app.api.routes.voice_records import router as voice_records_router
from app.api.routes.canvas_lan import router as canvas_lan_router
from app.api.routes.libraries import router as libraries_router
from app.api.routes.collections import router as collections_router
from app.api.routes.auth import router as auth_router
from app.api.routes.feedback import router as feedback_router
from app.api.routes.tutorials import router as tutorials_router
from app.api.routes.materials import router as materials_router
from app.api.routes.nas_jobs import router as nas_jobs_router
from app.api.routes.operation_logs import router as operation_logs_router
from app.api.routes.settings import router as settings_router
from app.api.routes.studio_projects import router as studio_projects_router
from app.api.routes.studio_media import router as studio_media_router
from app.api.routes.studio_jobs import router as studio_jobs_router
from app.api.routes.tags import router as tags_router
from app.api.routes.uploads import router as uploads_router
from app.api.routes.workflows import router as workflows_router
from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.services.operation_log_service import record_operation_log_safe
from app.services.settings_service import get_maintenance_status

app = FastAPI(title="Light Content Workflow Platform API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(canvas_api_router)
app.include_router(api_call_logs_router)
app.include_router(canvas_workspace_router)
app.include_router(canvas_media_router)
app.include_router(workbench_records_router)
app.include_router(voice_records_router)
app.include_router(canvas_lan_router)
app.include_router(libraries_router)
app.include_router(workflows_router)
app.include_router(auth_router)
app.include_router(tags_router)
app.include_router(materials_router)
app.include_router(collections_router)
app.include_router(uploads_router)
app.include_router(nas_jobs_router)
app.include_router(settings_router)
app.include_router(studio_projects_router)
app.include_router(studio_media_router)
app.include_router(studio_jobs_router)
app.include_router(operation_logs_router)
app.include_router(feedback_router)
app.include_router(tutorials_router)


def _allow_write_during_maintenance(path: str) -> bool:
    allowed_prefixes = (
        "/auth/",
        "/nas-jobs/poll",
        "/nas-jobs/",
    )
    return path.startswith(allowed_prefixes)


@app.middleware("http")
async def maintenance_guard(request: Request, call_next):
    if request.method.upper() not in {"POST", "PUT", "PATCH", "DELETE"}:
        return await call_next(request)
    if _allow_write_during_maintenance(request.url.path):
        return await call_next(request)
    db = SessionLocal()
    try:
        status_payload = get_maintenance_status(db)
    finally:
        db.close()
    if status_payload.get("enabled"):
        announcement = str(status_payload.get("announcement") or "系统维护中，请稍后重试")
        return JSONResponse(status_code=423, content={"detail": announcement, "maintenance_enabled": True})
    return await call_next(request)


def _resolve_backend_version() -> str:
    configured_version = settings.app_build_version.strip()
    if configured_version:
        return configured_version
    try:
        repo_root = Path(__file__).resolve().parents[2]
        commit = (
            subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=repo_root, text=True)
            .strip()
        )
        if commit:
            return commit
    except Exception:
        pass
    return "unknown"


_BACKEND_VERSION = _resolve_backend_version()


def _safe_log_http_error(request: Request, *, operation_type: str, error_message: str) -> None:
    try:
        db = SessionLocal()
        try:
            record_operation_log_safe(
                db,
                username=None,
                operation_type=operation_type,
                target_type="error",
                target_name=request.url.path,
                success=False,
                error_message=error_message,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        finally:
            db.close()
    except Exception:
        pass


@app.exception_handler(HTTPException)
async def http_exception_logger(request: Request, exc: HTTPException):
    path = request.url.path
    poll_auth_noise = exc.status_code in {401, 403} and path.startswith("/nas-jobs/poll")
    should_log = (exc.status_code >= 500 or exc.status_code in {401, 403}) and not poll_auth_noise
    if should_log:
        _safe_log_http_error(
            request,
            operation_type="HTTP异常",
            error_message=f"{exc.status_code}: {exc.detail}",
        )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_logger(request: Request, exc: Exception):
    if not isinstance(exc, SATimeoutError):
        _safe_log_http_error(
            request,
            operation_type="系统异常",
            error_message=str(exc),
        )
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


@app.get("/health")
def health() -> dict[str, str]:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "version": _BACKEND_VERSION},
        )
    return {"status": "ok", "version": _BACKEND_VERSION}
