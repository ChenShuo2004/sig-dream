import hashlib
from pathlib import Path
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.material import AssetOperation, Material, MaterialFile, MaterialTag, NasJob
from app.models.upload import UploadChunk, UploadSession
from app.schemas.upload import UploadIngestRequest, UploadInitRequest
from app.services.library_service import (
    AUTO_LIBRARY_ID,
    library_code_for_id,
    library_id_for_code,
    normalize_library_code,
)
from app.services.sync_service import create_sync_operation, new_operation_id
from app.services.tag_service import load_active_business_tags, resolve_unorganized_tag

_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "data" / "uploads"
_LOCAL_DATA_ROOT = Path(__file__).resolve().parents[2] / "data"


def _session_dir(session_id: UUID) -> Path:
    return _UPLOAD_ROOT / str(session_id)


def _chunk_path(session_id: UUID, chunk_index: int) -> Path:
    return _session_dir(session_id) / "chunks" / f"{chunk_index}.part"


def _merged_path(session_id: UUID, file_name: str) -> Path:
    suffix = Path(file_name).suffix or ".bin"
    return _session_dir(session_id) / "merged" / f"final{suffix}"


def _material_file_exists_on_storage(file_row: MaterialFile) -> bool:
    raw_path = (file_row.file_path or "").strip()
    if not raw_path:
        return False
    normalized_raw_path = raw_path.replace("\\", "/")
    file_path = Path(normalized_raw_path)
    if file_path.is_absolute():
        return file_path.exists() and file_path.is_file()
    if file_row.storage_type == "nas":
        mount_root = settings.nas_mount_root.strip()
        if not mount_root:
            return False
        rel_path = normalized_raw_path
        marker = "/originals/"
        marker_idx = normalized_raw_path.lower().find(marker)
        if marker_idx >= 0:
            rel_path = normalized_raw_path[marker_idx + 1 :]
        elif ":" in normalized_raw_path and normalized_raw_path[1:3] == ":/":
            rel_path = normalized_raw_path[3:]
        abs_path = Path(mount_root) / rel_path
        return abs_path.exists() and abs_path.is_file()
    abs_path = _LOCAL_DATA_ROOT / raw_path
    return abs_path.exists() and abs_path.is_file()


def _require_library_id_for_sha256_dedup(library_id: UUID | None) -> UUID:
    """SHA256 去重只在当前素材库域内；禁止 library_id=None 扫全库。"""
    if library_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="library_id is required; SHA256 dedup is per asset library",
        )
    return library_id


def _has_live_original_material_by_sha256(db: Session, sha256: str, *, library_id: UUID) -> bool:
    """判断**当前库**内是否仍有「在架」同内容主文件（不跨 auto / personal_video）。

    - **NAS 主文件**：ECS 往往未挂载 `NAS_MOUNT_ROOT`，不能依赖本地 stat；只要素材未进回收态即视为仍存在。
    - **local 等**：仍要求 `_material_file_exists_on_storage`，避免仅 DB 残留行误挡上传。
    """
    lid = _require_library_id_for_sha256_dedup(library_id)
    stmt = (
        select(MaterialFile)
        .join(Material, Material.id == MaterialFile.material_id)
        .where(
            and_(
                MaterialFile.sha256 == sha256,
                MaterialFile.file_role == "original",
                Material.library_id == lid,
                Material.status.notin_(["trashed", "trash_pending"]),
            )
        )
    )
    for row in db.scalars(stmt).all():
        if (row.storage_type or "").strip().lower() == "nas":
            return True
        if _material_file_exists_on_storage(row):
            return True
    return False


def _validate_sha256(value: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) != 64 or any(c not in "0123456789abcdef" for c in normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sha256")
    return normalized


def find_live_original_material_file_by_sha256(db: Session, sha256: str, *, library_id: UUID) -> MaterialFile | None:
    """与 `_has_live_original_material_by_sha256` 同语义，返回第一条命中的 original `MaterialFile`（用于去重后回填 id）。"""
    lid = _require_library_id_for_sha256_dedup(library_id)
    normalized = _validate_sha256(sha256)
    stmt = (
        select(MaterialFile)
        .join(Material, Material.id == MaterialFile.material_id)
        .where(
            and_(
                MaterialFile.sha256 == normalized,
                MaterialFile.file_role == "original",
                Material.library_id == lid,
                Material.status.notin_(["trashed", "trash_pending"]),
            )
        )
    )
    for row in db.scalars(stmt).all():
        if (row.storage_type or "").strip().lower() == "nas":
            return row
        if _material_file_exists_on_storage(row):
            return row
    return None


def _get_session_or_404(db: Session, upload_session_id: str) -> UploadSession:
    try:
        uuid_value = UUID(upload_session_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload session id") from exc
    session = db.get(UploadSession, uuid_value)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")
    return session


def init_upload(db: Session, payload: UploadInitRequest, uploader: str, *, library_id=None) -> tuple[UploadSession, list[int]]:
    sha256 = _validate_sha256(payload.sha256)
    total_chunks = (payload.file_size + payload.chunk_size - 1) // payload.chunk_size
    if total_chunks <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid chunk settings")
    lid = library_id if library_id is not None else library_id_for_code(normalize_library_code(payload.library))

    # 与 /uploads/dedup、LAN 签票一致：只要本库内已有同内容 original 且文件仍在存储，即禁止再开新上传会话
    if live_original_material_exists_by_sha256(db, sha256, library_id=lid):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Material with same sha256 already exists",
        )

    session = db.scalar(
        select(UploadSession).where(
            and_(
                UploadSession.sha256 == sha256,
                UploadSession.uploader == uploader,
                UploadSession.library_id == lid,
                UploadSession.status.in_(["initialized", "uploading"]),
            )
        )
    )
    if session is None:
        session = UploadSession(
            library_id=lid,
            file_name=payload.file_name.strip(),
            file_size=payload.file_size,
            chunk_size=payload.chunk_size,
            total_chunks=total_chunks,
            sha256=sha256,
            uploader=uploader,
            status="initialized",
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    uploaded_chunks = list(
        db.scalars(
            select(UploadChunk.chunk_index)
            .where(UploadChunk.upload_session_id == session.id)
            .order_by(UploadChunk.chunk_index.asc())
        ).all()
    )
    return session, uploaded_chunks


def get_uploaded_chunks(db: Session, upload_session_id: str) -> tuple[UploadSession, list[int]]:
    session = _get_session_or_404(db, upload_session_id)
    uploaded_chunks = list(
        db.scalars(
            select(UploadChunk.chunk_index)
            .where(UploadChunk.upload_session_id == session.id)
            .order_by(UploadChunk.chunk_index.asc())
        ).all()
    )
    return session, uploaded_chunks


async def save_chunk(db: Session, upload_session_id: str, chunk_index: int, chunk_file: UploadFile) -> UploadSession:
    session = _get_session_or_404(db, upload_session_id)
    if chunk_index < 0 or chunk_index >= session.total_chunks:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid chunk index")

    content = await chunk_file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty chunk")

    expected_size = session.chunk_size
    if chunk_index == session.total_chunks - 1:
        expected_size = session.file_size - session.chunk_size * (session.total_chunks - 1)
    if len(content) > expected_size:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chunk too large")

    path = _chunk_path(session.id, chunk_index)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)

    row = db.scalar(
        select(UploadChunk).where(
            and_(UploadChunk.upload_session_id == session.id, UploadChunk.chunk_index == chunk_index)
        )
    )
    if row is None:
        db.add(
            UploadChunk(upload_session_id=session.id, chunk_index=chunk_index, chunk_size=len(content))
        )
    else:
        row.chunk_size = len(content)
    session.status = "uploading"
    db.commit()
    db.refresh(session)
    return session


def complete_upload(db: Session, upload_session_id: str) -> tuple[UploadSession, str]:
    session = _get_session_or_404(db, upload_session_id)
    uploaded_chunks = list(
        db.scalars(
            select(UploadChunk.chunk_index)
            .where(UploadChunk.upload_session_id == session.id)
            .order_by(UploadChunk.chunk_index.asc())
        ).all()
    )
    expected = list(range(session.total_chunks))
    if uploaded_chunks != expected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not all chunks uploaded")

    merged = _merged_path(session.id, session.file_name)
    merged.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    with merged.open("wb") as target:
        for idx in expected:
            chunk_bytes = _chunk_path(session.id, idx).read_bytes()
            target.write(chunk_bytes)
            hasher.update(chunk_bytes)
    merged_sha = hasher.hexdigest()
    if merged_sha != session.sha256:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SHA256 mismatch after merge")

    session.status = "completed"
    session.merged_path = str(merged)
    db.commit()
    db.refresh(session)
    return session, merged_sha


def live_original_material_exists_by_sha256(db: Session, sha256: str, *, library_id: UUID) -> bool:
    """与「去重」一致：仅当前库已有 original 主文件且 SHA256 相同（含 LAN 直传入库，可无 UploadSession）。不跨库。"""
    normalized = _validate_sha256(sha256)
    return _has_live_original_material_by_sha256(db, normalized, library_id=library_id)


def find_latest_completed_upload_session_by_sha256(db: Session, sha256: str, *, library_id: UUID) -> UploadSession | None:
    """分片上传路径：若曾合并完成，可返回最近一条 completed session（LAN 直传入库通常无此记录）。仅当前库。"""
    lid = _require_library_id_for_sha256_dedup(library_id)
    normalized = _validate_sha256(sha256)
    stmt = select(UploadSession).where(
        and_(
            UploadSession.sha256 == normalized,
            UploadSession.status == "completed",
            UploadSession.library_id == lid,
        )
    )
    return db.scalar(stmt.order_by(UploadSession.created_at.desc()).limit(1))


def check_sha256_exists(db: Session, sha256: str, *, library_id: UUID) -> UploadSession | None:
    """兼容旧名：语义同 find_latest_completed_upload_session_by_sha256（勿再用于推断「库内是否已有素材」）。"""
    return find_latest_completed_upload_session_by_sha256(db, sha256, library_id=library_id)


def _build_stored_filename(db: Session, source_name: str, sha256: str) -> str:
    now = datetime.utcnow()
    date_part = now.strftime("%Y%m%d")
    day_start = datetime(now.year, now.month, now.day)
    sequence = db.scalar(
        select(func.count(Material.id)).where(Material.created_at >= day_start)
    ) or 0
    ext = Path(source_name).suffix or ".bin"
    return f"mat_{date_part}_{sequence + 1:06d}_{sha256[:8]}{ext.lower()}"


def ingest_uploaded_material(
    db: Session,
    upload_session_id: str,
    payload: UploadIngestRequest,
    username: str,
) -> tuple[UploadSession, Material, MaterialFile, NasJob]:
    session = _get_session_or_404(db, upload_session_id)
    if session.status != "completed" or not session.merged_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload session is not completed")

    if live_original_material_exists_by_sha256(db, session.sha256, library_id=session.library_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Material with same sha256 already exists",
        )

    stored_filename = _build_stored_filename(db, session.file_name, session.sha256)
    source_path = Path(session.merged_path)
    if not source_path.exists():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Merged file not found on server")
    upload_month = datetime.utcnow().strftime("%Y/%m")
    lib_code = library_code_for_id(session.library_id)
    target_rel_path = f"originals/{lib_code}/{upload_month}/{stored_filename}"

    material = Material(
        library_id=session.library_id or AUTO_LIBRARY_ID,
        title=(payload.title or Path(session.file_name).stem).strip(),
        description=payload.description,
        status="nas_syncing",
        download_count=0,
        uploader=username,
        keywords=[],
    )
    db.add(material)
    db.flush()

    applied_tags = load_active_business_tags(db, library_id=material.library_id, tag_ids=payload.tag_ids)
    for tag in applied_tags:
        db.add(MaterialTag(material_id=material.id, tag_id=tag.id))

    if not applied_tags:
        unorganized_tag = resolve_unorganized_tag(db, material.library_id)
        db.add(MaterialTag(material_id=material.id, tag_id=unorganized_tag.id))

    sfx = Path(session.file_name).suffix.lower()
    # 与 material_service / 前端约定一致：不含前导点（避免 ".jpg" 再拼成 "..jpg"）
    extension = sfx[1:] if sfx.startswith(".") else (sfx or None)
    material_file = MaterialFile(
        material_id=material.id,
        file_role="original",
        storage_type="local",
        original_filename=session.file_name,
        stored_filename=stored_filename,
        file_path=target_rel_path,
        extension=extension,
        file_size=session.file_size,
        sha256=session.sha256,
        extra_metadata={"upload_session_id": str(session.id), "source_path": session.merged_path},
    )
    db.add(material_file)
    db.flush()

    nas_job = NasJob(
        job_type="store_original",
        payload={
            "material_id": str(material.id),
            "material_file_id": str(material_file.id),
            "upload_session_id": str(session.id),
            "source_path": session.merged_path,
            "target_rel_path": target_rel_path,
            "stored_filename": stored_filename,
        },
        status="pending",
    )
    sync_op = create_sync_operation(
        db,
        operation_id=new_operation_id("upload_ingest"),
        operation_type="upload.store_original",
        target_type="material",
        target_id=str(material.id),
        status="sync_pending",
        payload={"material_id": str(material.id), "material_file_id": str(material_file.id), "upload_session_id": str(session.id)},
    )
    nas_job.sync_operation_id = sync_op.id
    db.add(nas_job)

    operation = AssetOperation(
        username=username,
        operation_type="ingest_material",
        target_type="material",
        target_id=material.id,
        access_context="public",
        success=True,
    )
    db.add(operation)

    # Only mark ingestion as complete after NAS client confirms success.
    session.status = "nas_pending"
    db.commit()
    db.refresh(material)
    db.refresh(material_file)
    db.refresh(nas_job)
    db.refresh(session)
    return session, material, material_file, nas_job
