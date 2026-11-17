"""Voice-clone results saved per user. The audio file is canvas media on NAS."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes.canvas_workspace import _user
from app.core.database import get_db
from app.core.security import bearer_scheme
from app.models.voice_record import VoiceRecord
from app.services.feature_media import CANVAS_KEY_RE, collect_matching_keys, referenced_canvas_media_keys, release_unreferenced_canvas_media
from app.services.operation_log_service import record_operation_log

router = APIRouter(prefix="/voice-records", tags=["voice-records"])

MAX_TEXT = 8000


def _out(row: VoiceRecord) -> dict:
    document = row.document if isinstance(row.document, dict) else {}
    return {
        "id": row.id,
        "text": str(document.get("text") or row.title or ""),
        "storageKey": str(document.get("storageKey") or ""),
        "bytes": int(document.get("bytes") or 0),
        "mimeType": str(document.get("mimeType") or ""),
        "createdAt": row.created_at.isoformat(),
    }


@router.get("")
def list_records(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    rows = db.scalars(
        select(VoiceRecord)
        .where(VoiceRecord.owner == user.username, VoiceRecord.deleted_at.is_(None))
        .order_by(VoiceRecord.created_at.desc())
        .limit(200)
    ).all()
    return {"records": [_out(row) for row in rows]}


@router.post("")
def create_record(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    record_id = str(payload.get("id") or "").strip()[:64]
    text = str(payload.get("text") or "").strip()
    storage_key = str(payload.get("storageKey") or "").strip()
    if not record_id or not CANVAS_KEY_RE.fullmatch(storage_key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="语音记录无效")
    if not text or len(text) > MAX_TEXT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="配音文本无效")
    existing = db.get(VoiceRecord, record_id)
    if existing is not None and existing.owner != user.username:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="记录编号已被占用")
    now = datetime.utcnow()
    reference_keys = []
    for raw in payload.get("referenceKeys") or []:
        key = str(raw or "").strip()
        if CANVAS_KEY_RE.fullmatch(key):
            reference_keys.append(key)
    document = {
        "text": text,
        "storageKey": storage_key,
        "bytes": int(payload.get("bytes") or 0),
        "mimeType": str(payload.get("mimeType") or "audio/wav")[:120],
        "referenceKeys": reference_keys,
    }
    if existing is None:
        existing = VoiceRecord(id=record_id, owner=user.username, title=text[:200], document=document, created_at=now, updated_at=now, deleted_at=None)
        db.add(existing)
    else:
        existing.title = text[:200]
        existing.document = document
        existing.updated_at = now
        existing.deleted_at = None
    record_operation_log(
        db,
        username=user.username,
        operation_type="保存克隆语音",
        target_type="voice_record",
        target_name=record_id,
        after_data={"bytes": document["bytes"]},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return _out(existing)


@router.delete("/{record_id}")
def delete_record(
    record_id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    row = db.get(VoiceRecord, record_id[:64])
    if row is None or row.owner != user.username or row.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="语音记录不存在")
    before = referenced_canvas_media_keys(db, user.username)
    immediate: set[str] = set()
    collect_matching_keys(row.document, CANVAS_KEY_RE, immediate)
    row.deleted_at = datetime.utcnow()
    db.flush()
    release_unreferenced_canvas_media(db, user.username, before - referenced_canvas_media_keys(db, user.username) | immediate)
    record_operation_log(
        db,
        username=user.username,
        operation_type="删除克隆语音",
        target_type="voice_record",
        target_name=row.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return {"deleted": row.id}
