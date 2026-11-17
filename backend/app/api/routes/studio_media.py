"""Studio media blobs: IndexedDB keys mirrored to NAS studio-media/.

Upload stages on ECS then enqueues store_original. Restore uses prepare_download
when the ECS staging copy is gone after NAS transfer.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes.canvas_lan import canvas_lan_root
from app.core.database import get_db
from app.core.security import bearer_scheme, decode_access_token, extract_bearer_token
from app.models.material import NasJob
from app.models.studio_media import StudioMediaObject
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import ensure_permission, ensure_settings_seeded

router = APIRouter(prefix="/studio-media", tags=["studio-media"])

MAX_MEDIA_BYTES = 512 * 1024 * 1024
MEDIA_KEY_RE = re.compile(r"^studio-(image|video|audio):[A-Za-z0-9_-]{8,64}$")
KIND_SUFFIX = {
    "image": ".png",
    "video": ".mp4",
    "audio": ".wav",
}
ALLOWED_SUFFIX = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".mp4",
    ".webm",
    ".mov",
    ".mp3",
    ".wav",
    ".m4a",
    ".ogg",
}

_seeded = False


def _user(credentials: HTTPAuthorizationCredentials | None, db: Session):
    global _seeded
    user = decode_access_token(extract_bearer_token(credentials))
    if not _seeded:
        ensure_settings_seeded(db)
        _seeded = True
    ensure_permission(db, user.username, "studio.use")
    return user


def _owner_dir(username: str) -> str:
    return hashlib.sha256(username.encode("utf-8")).hexdigest()[:16]


def _safe_key(media_key: str) -> str:
    return media_key.replace(":", "__").replace("/", "_").replace("\\", "_")[:120]


def _parse_media_key(value: str) -> tuple[str, str]:
    key = (value or "").strip()
    match = MEDIA_KEY_RE.match(key)
    if not match:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="媒体键无效")
    return key, match.group(1)


def _row_out(row: StudioMediaObject) -> dict:
    return {
        "mediaKey": row.media_key,
        "kind": row.kind,
        "mimeType": row.mime_type or "",
        "bytes": row.byte_size or 0,
        "status": row.status,
        "nasRelPath": row.nas_rel_path or "",
        "createdAt": row.created_at.isoformat() if row.created_at else "",
        "updatedAt": row.updated_at.isoformat() if row.updated_at else "",
    }


def _owned_or_404(db: Session, media_key: str, username: str) -> StudioMediaObject:
    row = db.get(StudioMediaObject, media_key)
    if row is None or row.owner != username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工作室媒体不存在")
    return row


def _pick_suffix(filename: str | None, kind: str, mime_type: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in ALLOWED_SUFFIX:
        return suffix
    mime = (mime_type or "").lower()
    if "jpeg" in mime or mime == "image/jpg":
        return ".jpg"
    if "png" in mime:
        return ".png"
    if "webp" in mime:
        return ".webp"
    if "gif" in mime:
        return ".gif"
    if "webm" in mime:
        return ".webm"
    if "mp4" in mime:
        return ".mp4"
    if "wav" in mime:
        return ".wav"
    if "mpeg" in mime or "mp3" in mime:
        return ".mp3"
    return KIND_SUFFIX.get(kind, ".bin")


def _find_prepare_job(db: Session, media_key: str) -> NasJob | None:
    rows = list(
        db.scalars(
            select(NasJob)
            .where(NasJob.job_type == "prepare_download")
            .where(NasJob.status.in_(("pending", "running", "success")))
            .order_by(NasJob.created_at.desc())
            .limit(40)
        ).all()
    )
    for job in rows:
        payload = job.payload if isinstance(job.payload, dict) else {}
        if payload.get("studio_media_key") == media_key:
            if job.status == "success" and isinstance(job.result, dict):
                cache_path = str(job.result.get("cache_path") or "")
                if cache_path and Path(cache_path).exists():
                    return job
                continue
            return job
    return None


@router.get("/{media_key}")
def get_media_meta(
    media_key: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    key, _ = _parse_media_key(media_key)
    return _row_out(_owned_or_404(db, key, user.username))


@router.post("/file")
def save_media_file(
    request: Request,
    media_key: str = Form(...),
    kind: str = Form(...),
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    key, key_kind = _parse_media_key(media_key)
    clean_kind = (kind or key_kind).strip()
    if clean_kind not in {"image", "video", "audio"} or clean_kind != key_kind:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="媒体类型无效")
    existing = db.get(StudioMediaObject, key)
    if existing is not None and existing.owner != user.username:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="媒体键已被占用")

    suffix = _pick_suffix(file.filename, clean_kind, file.content_type)
    safe = _safe_key(key)
    directory = canvas_lan_root() / "studio-media" / safe
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"file{suffix}"
    size = 0
    with target.open("wb") as handle:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_MEDIA_BYTES:
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="工作室媒体过大")
            handle.write(chunk)
    if size < 16:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件为空")

    nas_rel_path = f"studio-media/{_owner_dir(user.username)}/{safe}{suffix}"
    now = datetime.utcnow()
    row = existing or StudioMediaObject(media_key=key, owner=user.username, kind=clean_kind, created_at=now)
    row.kind = clean_kind
    row.mime_type = file.content_type or ""
    row.byte_size = size
    row.nas_rel_path = nas_rel_path
    row.source_path = str(target)
    row.status = "pending"
    row.updated_at = now
    if existing is None:
        db.add(row)

    job = NasJob(
        id=uuid.uuid4(),
        job_type="store_original",
        payload={
            "studio_media_key": key,
            "source_path": str(target),
            "target_rel_path": nas_rel_path,
            "owner": user.username,
        },
        status="pending",
        max_retries=3,
    )
    db.add(job)
    record_operation_log(
        db,
        username=user.username,
        operation_type="保存工作室媒体",
        target_type="studio_media",
        target_name=key,
        after_data={"kind": clean_kind, "bytes": size, "nas_rel_path": nas_rel_path},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return _row_out(row)


@router.get("/{media_key}/file")
def download_media_file(
    media_key: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    user = _user(credentials, db)
    key, _ = _parse_media_key(media_key)
    row = _owned_or_404(db, key, user.username)

    if row.source_path:
        staging = Path(row.source_path)
        if staging.exists() and staging.is_file():
            media_type = row.mime_type or "application/octet-stream"
            filename = staging.name
            db.close()
            return FileResponse(path=staging, filename=filename, media_type=media_type)

    if row.status != "ready" or not row.nas_rel_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工作室媒体尚未就绪")

    job = _find_prepare_job(db, key)
    if job is None:
        original_filename = Path(row.nas_rel_path).name or f"{_safe_key(key)}.bin"
        job = NasJob(
            id=uuid.uuid4(),
            job_type="prepare_download",
            payload={
                "studio_media_key": key,
                "file_path": row.nas_rel_path,
                "original_filename": original_filename,
                "request_username": user.username,
                "record_download_count": False,
            },
            status="pending",
            max_retries=3,
        )
        db.add(job)
        db.commit()
        db.refresh(job)

    if job.status in {"pending", "running"}:
        return JSONResponse(
            status_code=202,
            content={"status": job.status, "jobId": str(job.id), "mediaKey": key},
        )

    if job.status != "success" or not isinstance(job.result, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=job.error_message or "恢复下载失败")

    cache_path = str(job.result.get("cache_path") or "")
    path = Path(cache_path) if cache_path else None
    if path is None or not path.exists():
        # Cache gone — re-queue
        original_filename = Path(row.nas_rel_path).name or f"{_safe_key(key)}.bin"
        job = NasJob(
            id=uuid.uuid4(),
            job_type="prepare_download",
            payload={
                "studio_media_key": key,
                "file_path": row.nas_rel_path,
                "original_filename": original_filename,
                "request_username": user.username,
                "record_download_count": False,
            },
            status="pending",
            max_retries=3,
        )
        db.add(job)
        db.commit()
        return JSONResponse(
            status_code=202,
            content={"status": "pending", "jobId": str(job.id), "mediaKey": key},
        )

    media_type = row.mime_type or "application/octet-stream"
    filename = path.name
    db.close()
    return FileResponse(path=path, filename=filename, media_type=media_type)
