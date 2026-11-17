"""Per-user studio projects (script / replication / replacement).

The whole studio state (stages, episodes, clips, assets, task records) is one JSON
document; the client owns its shape. Media binaries are dual-written to browser
IndexedDB and NAS under studio-media/ (see /studio-media).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.core.security import bearer_scheme, decode_access_token, extract_bearer_token
from app.models.studio_project import StudioProject
from app.services.feature_media import referenced_studio_keys, release_unreferenced_studio_media
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import ensure_permission, ensure_settings_seeded

router = APIRouter(prefix="/studio-projects", tags=["studio-projects"])

STUDIO_KINDS = {"script", "replication", "replacement"}
KIND_LABELS = {"script": "剧本工作室", "replication": "复刻工作室", "replacement": "替换工作室"}
MAX_PROJECTS_PER_KIND = 300
MAX_DOCUMENT_CHARS = 8_000_000


_seeded = False


def _user(credentials: HTTPAuthorizationCredentials | None, db: Session):
    global _seeded
    user = decode_access_token(extract_bearer_token(credentials))
    if not _seeded:
        ensure_settings_seeded(db)
        _seeded = True
    ensure_permission(db, user.username, "studio.use")
    return user


def _kind(value: object) -> str:
    kind = str(value or "").strip()
    if kind not in STUDIO_KINDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="工作室类型无效")
    return kind


def _title(value: object) -> str:
    return str(value or "").strip()[:200] or "未命名项目"


def _document(value: object) -> dict:
    if not isinstance(value, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="项目内容无效")
    if len(str(value)) > MAX_DOCUMENT_CHARS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="项目内容过大")
    return value


def _summary(row: StudioProject) -> dict:
    meta = row.document.get("meta") if isinstance(row.document, dict) else None
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "meta": meta if isinstance(meta, dict) else {},
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def _detail(row: StudioProject) -> dict:
    return {**_summary(row), "document": row.document}


def _owned(db: Session, project_id: str, username: str) -> StudioProject:
    row = db.get(StudioProject, project_id)
    if row is None or row.owner != username or row.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")
    return row


def _log(db: Session, request: Request, username: str, operation: str, row: StudioProject, after: dict | None = None) -> None:
    record_operation_log(
        db,
        username=username,
        operation_type=operation,
        target_type="studio_project",
        target_name=f"{KIND_LABELS.get(row.kind, row.kind)}·{row.title}",
        after_data={"id": row.id, **(after or {})},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


@router.get("")
def list_projects(
    kind: str = Query(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    rows = db.scalars(
        select(StudioProject)
        .where(StudioProject.owner == user.username, StudioProject.kind == _kind(kind), StudioProject.deleted_at.is_(None))
        .order_by(StudioProject.updated_at.desc())
    ).all()
    return {"projects": [_summary(row) for row in rows]}


@router.get("/{project_id}")
def get_project(
    project_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    return _detail(_owned(db, project_id, user.username))


@router.post("")
def create_project(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    kind = _kind(payload.get("kind"))
    count = len(
        db.scalars(
            select(StudioProject.id).where(
                StudioProject.owner == user.username, StudioProject.kind == kind, StudioProject.deleted_at.is_(None)
            )
        ).all()
    )
    if count >= MAX_PROJECTS_PER_KIND:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="项目数量已达上限，请先删除不用的项目")
    now = datetime.utcnow()
    row = StudioProject(
        id=uuid.uuid4().hex,
        owner=user.username,
        kind=kind,
        title=_title(payload.get("title")),
        document=_document(payload.get("document") or {}),
        created_at=now,
        updated_at=now,
        deleted_at=None,
    )
    db.add(row)
    _log(db, request, user.username, "新建工作室项目", row, {"kind": kind})
    db.commit()
    return _detail(row)


@router.put("/{project_id}")
def save_project(
    project_id: str,
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    row = _owned(db, project_id, user.username)
    before_keys = referenced_studio_keys(db, user.username)
    if "title" in payload:
        row.title = _title(payload.get("title"))
    if "document" in payload:
        row.document = _document(payload.get("document"))
        flag_modified(row, "document")
    row.updated_at = datetime.utcnow()
    stage = row.document.get("meta", {}).get("stage") if isinstance(row.document.get("meta"), dict) else None
    db.flush()
    release_unreferenced_studio_media(db, user.username, before_keys - referenced_studio_keys(db, user.username))
    _log(db, request, user.username, "保存工作室项目", row, {"stage": stage})
    db.commit()
    return _summary(row)


@router.delete("/{project_id}")
def delete_project(
    project_id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    row = _owned(db, project_id, user.username)
    before_keys = referenced_studio_keys(db, user.username)
    row.deleted_at = datetime.utcnow()
    db.flush()
    release_unreferenced_studio_media(db, user.username, before_keys - referenced_studio_keys(db, user.username))
    _log(db, request, user.username, "删除工作室项目", row)
    db.commit()
    return {"deleted": row.id}
