"""Per-user canvas projects and canvas-only assets.

Projects and nodes are JSON on the server. Asset files are copied to the NAS
directory canvas-assets/ and are not materials.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.routes.canvas_lan import canvas_lan_root
from app.core.database import get_db
from app.core.security import ROLE_MATERIAL_ADMIN, ROLE_SUPER_ADMIN, bearer_scheme, decode_access_token, extract_bearer_token
from app.models.canvas_media import CanvasMediaObject
from app.models.canvas_workspace import CanvasAsset, CanvasDocument, CanvasDocumentShare
from app.models.material import NasJob
from app.services.feature_media import (
    CANVAS_KEY_RE,
    collect_matching_keys,
    referenced_canvas_media_keys,
    release_unreferenced_canvas_media,
)
from app.services.operation_log_service import record_operation_log

router = APIRouter(prefix="/canvas-workspace", tags=["canvas-workspace"])

CANVAS_ROLES = {ROLE_SUPER_ADMIN, ROLE_MATERIAL_ADMIN}
MAX_PROJECTS = 200
MAX_DOCUMENT_CHARS = 6_000_000
MAX_ASSET_BYTES = 512 * 1024 * 1024
MAX_TEXT_CHARS = 200_000


def _user(credentials: HTTPAuthorizationCredentials | None):
    user = decode_access_token(extract_bearer_token(credentials))
    if user.role not in CANVAS_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="画布需要素材管理员及以上权限")
    return user


def _parse_time(value: object, fallback: datetime) -> datetime:
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return fallback
    return fallback


def _clean_document(value: object) -> dict:
    if not isinstance(value, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="画布内容无效")
    nodes = value.get("nodes") if isinstance(value.get("nodes"), list) else []
    connections = value.get("connections") if isinstance(value.get("connections"), list) else []
    document = {
        "nodes": nodes,
        "connections": connections,
        "chatSessions": value.get("chatSessions") if isinstance(value.get("chatSessions"), list) else [],
        "activeChatId": value.get("activeChatId") if isinstance(value.get("activeChatId"), str) else None,
        "backgroundMode": value.get("backgroundMode") if isinstance(value.get("backgroundMode"), str) else "lines",
        "showImageInfo": bool(value.get("showImageInfo")),
        "viewport": value.get("viewport") if isinstance(value.get("viewport"), dict) else {"x": 0, "y": 0, "k": 1},
    }
    return document


def _project_out(row: CanvasDocument) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
        "document": row.document,
    }


def _asset_out(row: CanvasAsset) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "tags": row.tags or [],
        "content": row.content or "",
        "mimeType": row.mime_type or "",
        "bytes": row.byte_size or 0,
        "width": row.width or 0,
        "height": row.height or 0,
        "status": row.status,
        "nasRelPath": row.nas_rel_path or "",
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


@router.get("/projects")
def list_projects(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    rows = db.scalars(
        select(CanvasDocument)
        .where(CanvasDocument.owner == user.username, CanvasDocument.deleted_at.is_(None))
        .order_by(CanvasDocument.updated_at.desc())
    ).all()
    return {"projects": [_project_out(row) for row in rows]}


@router.put("/projects")
def save_projects(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    incoming = payload.get("projects") if isinstance(payload, dict) else None
    if not isinstance(incoming, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="画布列表无效")
    if len(incoming) > MAX_PROJECTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="画布数量过多")
    deleted_ids = payload.get("deletedIds") if isinstance(payload.get("deletedIds"), list) else []
    before_keys = referenced_canvas_media_keys(db, user.username)
    now = datetime.utcnow()
    saved = 0
    for item in incoming:
        if not isinstance(item, dict):
            continue
        project_id = str(item.get("id") or "").strip()[:64]
        if not project_id:
            continue
        document = _clean_document(item.get("document"))
        if len(str(document)) > MAX_DOCUMENT_CHARS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="画布节点内容过大")
        row = db.get(CanvasDocument, (project_id, user.username))
        title = str(item.get("title") or "未命名画布").strip()[:200] or "未命名画布"
        created_at = _parse_time(item.get("createdAt"), now)
        updated_at = _parse_time(item.get("updatedAt"), now)
        if row is None:
            row = CanvasDocument(
                id=project_id,
                owner=user.username,
                title=title,
                document=document,
                created_at=created_at,
                updated_at=updated_at,
                deleted_at=None,
            )
            db.add(row)
        elif row.deleted_at is None or updated_at >= row.updated_at:
            row.title = title
            row.document = document
            row.updated_at = updated_at
            row.deleted_at = None
            flag_modified(row, "document")
        saved += 1
    for raw_id in deleted_ids:
        project_id = str(raw_id or "").strip()[:64]
        if not project_id:
            continue
        row = db.get(CanvasDocument, (project_id, user.username))
        if row is not None and row.deleted_at is None:
            row.deleted_at = now
    db.flush()
    release_unreferenced_canvas_media(db, user.username, before_keys - referenced_canvas_media_keys(db, user.username))
    record_operation_log(
        db,
        username=user.username,
        operation_type="保存画布",
        target_type="canvas_document",
        target_name=user.username,
        after_data={"projects": saved, "deleted": len(deleted_ids)},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return {"saved": saved}


def _share_or_404(db: Session, share_id: str) -> CanvasDocumentShare:
    row = db.get(CanvasDocumentShare, share_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="共享画布不存在")
    return row


def _shared_document_or_404(db: Session, share: CanvasDocumentShare) -> CanvasDocument:
    document = db.get(CanvasDocument, (share.document_id, share.owner))
    if document is None or document.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="原画布已删除或不可用")
    return document


def _share_out(share: CanvasDocumentShare, document: CanvasDocument, *, username: str) -> dict:
    nodes = document.document.get("nodes") if isinstance(document.document, dict) else []
    connections = document.document.get("connections") if isinstance(document.document, dict) else []
    return {
        "shareId": share.id,
        "documentId": share.document_id,
        "owner": share.owner,
        "title": document.title or share.title or "未命名画布",
        "nodeCount": len(nodes) if isinstance(nodes, list) else 0,
        "connectionCount": len(connections) if isinstance(connections, list) else 0,
        "createdAt": share.created_at.isoformat() if share.created_at else "",
        "updatedAt": document.updated_at.isoformat() if document.updated_at else "",
        "isOwner": share.owner == username,
    }


@router.get("/shares")
def list_shared_projects(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    shares = db.scalars(select(CanvasDocumentShare).order_by(CanvasDocumentShare.created_at.desc())).all()
    items = []
    for share in shares:
        document = db.get(CanvasDocument, (share.document_id, share.owner))
        if document is None or document.deleted_at is not None:
            continue
        items.append(_share_out(share, document, username=user.username))
    return {"shares": items}


@router.post("/projects/{project_id}/share")
def share_project(
    project_id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    clean_id = (project_id or "").strip()[:64]
    if not clean_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="画布 ID 无效")
    document = db.get(CanvasDocument, (clean_id, user.username))
    if document is None or document.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="只能分享自己的画布，且需先同步到服务器")
    existing = db.scalars(
        select(CanvasDocumentShare).where(
            CanvasDocumentShare.document_id == clean_id,
            CanvasDocumentShare.owner == user.username,
        )
    ).first()
    if existing is not None:
        return _share_out(existing, document, username=user.username)
    share = CanvasDocumentShare(
        id=uuid.uuid4().hex,
        document_id=clean_id,
        owner=user.username,
        title=document.title[:200],
        created_at=datetime.utcnow(),
    )
    db.add(share)
    record_operation_log(
        db,
        username=user.username,
        operation_type="分享画布",
        target_type="canvas_document_share",
        target_name=share.id,
        after_data={"document_id": clean_id, "title": document.title},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    db.refresh(share)
    return _share_out(share, document, username=user.username)


@router.delete("/shares/{share_id}")
def unshare_project(
    share_id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    share = _share_or_404(db, share_id)
    if share.owner != user.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有分享者本人可以删除共享画布")
    record_operation_log(
        db,
        username=user.username,
        operation_type="取消分享画布",
        target_type="canvas_document_share",
        target_name=share.id,
        after_data={"document_id": share.document_id},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.delete(share)
    db.commit()
    return {"ok": True}


@router.get("/shares/{share_id}")
def get_shared_project(
    share_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    share = _share_or_404(db, share_id)
    document = _shared_document_or_404(db, share)
    keys: set[str] = set()
    collect_matching_keys(document.document, CANVAS_KEY_RE, keys)
    return {
        **_share_out(share, document, username=user.username),
        "project": _project_out(document),
        "mediaKeys": sorted(keys),
    }


@router.get("/shares/{share_id}/media/{media_key}/file")
def download_shared_media_file(
    share_id: str,
    media_key: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    """Allow any canvas user to download media referenced by a shared canvas (for copy-to-mine)."""
    from fastapi.responses import FileResponse, JSONResponse

    user = _user(credentials)
    share = _share_or_404(db, share_id)
    document = _shared_document_or_404(db, share)
    key = (media_key or "").strip()
    if not CANVAS_KEY_RE.fullmatch(key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="媒体键无效")
    keys: set[str] = set()
    collect_matching_keys(document.document, CANVAS_KEY_RE, keys)
    if key not in keys:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="该共享画布未引用此媒体")
    row = db.get(CanvasMediaObject, key)
    if row is None or row.owner != share.owner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="媒体不存在")

    if row.source_path:
        staging = Path(row.source_path)
        if staging.exists() and staging.is_file():
            return FileResponse(
                path=staging,
                filename=staging.name,
                media_type=row.mime_type or "application/octet-stream",
            )
    if row.status != "ready" or not row.nas_rel_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="媒体尚未就绪")

    from app.api.routes.canvas_media import _find_prepare_job, _safe_key

    job = _find_prepare_job(db, key)
    if job is None:
        original_filename = Path(row.nas_rel_path).name or f"{_safe_key(key)}.bin"
        job = NasJob(
            id=uuid.uuid4(),
            job_type="prepare_download",
            payload={
                "canvas_media_key": key,
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
        return JSONResponse(status_code=202, content={"status": job.status, "jobId": str(job.id), "mediaKey": key})
    if job.status != "success" or not isinstance(job.result, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=job.error_message or "恢复下载失败")
    cache_path = str(job.result.get("cache_path") or "")
    path = Path(cache_path) if cache_path else None
    if path is None or not path.exists():
        original_filename = Path(row.nas_rel_path).name or f"{_safe_key(key)}.bin"
        job = NasJob(
            id=uuid.uuid4(),
            job_type="prepare_download",
            payload={
                "canvas_media_key": key,
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
        return JSONResponse(status_code=202, content={"status": "pending", "jobId": str(job.id), "mediaKey": key})
    return FileResponse(
        path=path,
        filename=path.name,
        media_type=row.mime_type or "application/octet-stream",
    )


def _owner_dir(username: str) -> str:
    return hashlib.sha256(username.encode("utf-8")).hexdigest()[:16]


def _asset_or_404(db: Session, asset_id: str, username: str) -> CanvasAsset:
    row = db.get(CanvasAsset, asset_id)
    if row is None or row.owner != username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="画布资产不存在")
    return row


@router.get("/assets")
def list_assets(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    rows = db.scalars(select(CanvasAsset).where(CanvasAsset.owner == user.username).order_by(CanvasAsset.updated_at.desc())).all()
    return {"assets": [_asset_out(row) for row in rows]}


@router.post("/assets/text")
def save_text_asset(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    asset_id = str(payload.get("id") or "").strip()[:64]
    content = str(payload.get("content") or "")
    if not asset_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="资产编号无效")
    if len(content) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文本资产过长")
    now = datetime.utcnow()
    row = db.get(CanvasAsset, asset_id)
    if row is not None and row.owner != user.username:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="资产编号已被占用")
    title = str(payload.get("title") or "文本").strip()[:200] or "文本"
    tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
    if row is None:
        row = CanvasAsset(
            id=asset_id,
            owner=user.username,
            kind="text",
            title=title,
            tags=[str(tag)[:40] for tag in tags[:20]],
            content=content,
            byte_size=len(content.encode("utf-8")),
            status="ready",
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.title = title
        row.tags = [str(tag)[:40] for tag in tags[:20]]
        row.content = content
        row.byte_size = len(content.encode("utf-8"))
        row.status = "ready"
        row.updated_at = now
        flag_modified(row, "tags")
    record_operation_log(
        db,
        username=user.username,
        operation_type="保存画布资产",
        target_type="canvas_asset",
        target_name=asset_id,
        after_data={"kind": "text"},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return _asset_out(row)


@router.post("/assets/file")
def save_file_asset(
    request: Request,
    asset_id: str = Form(...),
    title: str = Form(""),
    kind: str = Form("image"),
    width: int = Form(0),
    height: int = Form(0),
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    clean_id = asset_id.strip()[:64]
    if not clean_id or kind not in {"image", "video", "audio"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="画布资产无效")
    existing = db.get(CanvasAsset, clean_id)
    if existing is not None and existing.owner != user.username:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="资产编号已被占用")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".m4a", ".ogg"}:
        suffix = ".bin"
    directory = canvas_lan_root() / "assets" / clean_id
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"file{suffix}"
    size = 0
    with target.open("wb") as handle:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_ASSET_BYTES:
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="画布资产过大")
            handle.write(chunk)
    if size < 32:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件为空")
    nas_rel_path = f"canvas-assets/{_owner_dir(user.username)}/{clean_id}{suffix}"
    now = datetime.utcnow()
    row = existing or CanvasAsset(id=clean_id, owner=user.username, kind=kind, created_at=now)
    row.title = (title or file.filename or kind).strip()[:200]
    row.kind = kind
    row.mime_type = file.content_type or ""
    row.byte_size = size
    row.width = width or None
    row.height = height or None
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
            "canvas_asset_id": clean_id,
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
        operation_type="保存画布资产",
        target_type="canvas_asset",
        target_name=clean_id,
        after_data={"kind": kind, "bytes": size, "nas_rel_path": nas_rel_path},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return _asset_out(row)


@router.get("/assets/{asset_id}/file")
def download_asset_file(
    asset_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    user = _user(credentials)
    row = _asset_or_404(db, asset_id, user.username)
    if row.kind == "text" or not row.source_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="没有可读取的文件")
    path = Path(row.source_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件已转到 NAS，当前服务器上没有可直接读取的副本")
    return FileResponse(path=path, filename=path.name, media_type=row.mime_type or "application/octet-stream")
