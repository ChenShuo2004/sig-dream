"""Image and video workbench logs, one row per generation, owned by the logged-in user."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.routes.canvas_workspace import _user
from app.core.database import get_db
from app.core.security import bearer_scheme
from app.models.workbench_record import WorkbenchRecord
from app.services.feature_media import referenced_canvas_media_keys, release_unreferenced_canvas_media
from app.services.operation_log_service import record_operation_log

router = APIRouter(prefix="/workbench-records", tags=["workbench-records"])

KINDS = {"image", "video"}
MAX_RECORDS = 400
MAX_DOCUMENT_CHARS = 1_500_000


def _kind(value: object) -> str:
    kind = str(value or "").strip()
    if kind not in KINDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="工作台类型无效")
    return kind


def _parse_time(value: object, fallback: datetime) -> datetime:
    if isinstance(value, (int, float)) and value > 0:
        try:
            return datetime.utcfromtimestamp(float(value) / 1000.0)
        except (OverflowError, OSError, ValueError):
            return fallback
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return fallback
    return fallback


def _out(row: WorkbenchRecord) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
        "document": row.document,
    }


@router.get("")
def list_records(
    kind: str = Query(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    clean_kind = _kind(kind)
    rows = db.scalars(
        select(WorkbenchRecord)
        .where(WorkbenchRecord.owner == user.username, WorkbenchRecord.kind == clean_kind, WorkbenchRecord.deleted_at.is_(None))
        .order_by(WorkbenchRecord.updated_at.desc())
    ).all()
    return {"records": [_out(row) for row in rows]}


@router.put("")
def save_records(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    clean_kind = _kind(payload.get("kind") if isinstance(payload, dict) else None)
    incoming = payload.get("records") if isinstance(payload, dict) else None
    if not isinstance(incoming, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="工作台记录无效")
    if len(incoming) > MAX_RECORDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="工作台记录过多")
    before = referenced_canvas_media_keys(db, user.username)
    now = datetime.utcnow()
    saved = 0
    for item in incoming:
        if not isinstance(item, dict):
            continue
        record_id = str(item.get("id") or "").strip()[:64]
        document = item.get("document")
        if not record_id or not isinstance(document, dict):
            continue
        if len(str(document)) > MAX_DOCUMENT_CHARS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="工作台记录过大")
        created_at = _parse_time(document.get("createdAt"), now)
        updated_at = _parse_time(document.get("updatedAt"), created_at)
        row = db.get(WorkbenchRecord, record_id)
        if row is not None and row.owner != user.username:
            continue
        if row is None:
            row = WorkbenchRecord(
                id=record_id,
                owner=user.username,
                kind=clean_kind,
                document=document,
                created_at=created_at,
                updated_at=updated_at,
                deleted_at=None,
            )
            db.add(row)
        elif row.deleted_at is None or updated_at >= row.updated_at:
            row.kind = clean_kind
            row.document = document
            row.updated_at = updated_at
            row.deleted_at = None
            flag_modified(row, "document")
        saved += 1
    deleted_ids = payload.get("deletedIds") if isinstance(payload.get("deletedIds"), list) else []
    deleted = 0
    for raw_id in deleted_ids:
        record_id = str(raw_id or "").strip()[:64]
        if not record_id:
            continue
        row = db.get(WorkbenchRecord, record_id)
        if row is None or row.owner != user.username or row.kind != clean_kind or row.deleted_at is not None:
            continue
        row.deleted_at = now
        deleted += 1
    db.flush()
    after = referenced_canvas_media_keys(db, user.username)
    release_unreferenced_canvas_media(db, user.username, before - after)
    record_operation_log(
        db,
        username=user.username,
        operation_type="保存工作台记录",
        target_type="workbench_record",
        target_name=clean_kind,
        after_data={"saved": saved, "deleted": deleted},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return {"saved": saved, "deleted": deleted}
