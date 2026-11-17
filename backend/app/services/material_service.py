import re
from uuid import UUID
from pathlib import Path
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.asset_library import LibraryTaxonomyNode
from app.models.material import AssetOperation, AssetUsage, Material, MaterialFile, MaterialTag, NasJob
from app.models.tag import Tag
from app.schemas.material import MaterialCreate, MaterialIngestFromNasRequest
from app.services.library_service import (
    LIBRARY_CODE_AUTO,
    is_personal_video_library,
    library_code_for_id,
    library_id_for_code,
    normalize_copy_fit,
    normalize_keywords,
    normalize_library_code,
    resolve_taxonomy_pair,
)
from app.services.settings_service import get_user_permissions
from app.services.tag_service import get_tag_categories, load_active_business_tags, resolve_unorganized_tag
from app.services.sync_service import create_sync_operation, new_operation_id
from app.services.upload_service import live_original_material_exists_by_sha256

_STORAGE_POOL_ID_RE = re.compile(r"^([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}[a-zA-Z0-9])$")


def _enrich_unorganized_ai_analysis(db: Session, library_id, analysis: object) -> dict | None:
    if not isinstance(analysis, dict):
        return None
    from app.services.content_analysis_service import enrich_ai_analysis_taxonomy

    return enrich_ai_analysis_taxonomy(db, library_id, analysis)


def validate_storage_pool_id(value: str) -> str:
    """存储池 ID：1～64 字符，字母数字或中间含 ._-（首尾须为字母数字）。"""
    s = (value or "").strip()
    if not s:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="storage_pool_id is empty")
    if len(s) > 64:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="storage_pool_id exceeds 64 characters")
    if not _STORAGE_POOL_ID_RE.fullmatch(s):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="storage_pool_id must be alphanumeric, or start/end alphanumeric with ._- inside only",
        )
    return s


def resolve_storage_pool_id_for_ingest(raw: str | None) -> str:
    if raw is None or not str(raw).strip():
        return (settings.default_storage_pool_id or "default").strip() or "default"
    return validate_storage_pool_id(str(raw))


def _normalize_extension_display(ext: str | None) -> str | None:
    """库内 extension 历史上可能带前导点（Path.suffix）；对外统一为无点小写，如 mp4、jpg。"""
    if ext is None:
        return None
    s = str(ext).strip().lower()
    if not s:
        return None
    return s[1:] if s.startswith(".") else s


# 与 nas_jobs.complete_job 中派生任务判断一致（图片/视频才排队 ffmpeg 缩略图）
_DERIVATIVE_VIDEO_EXTENSIONS = frozenset({"mp4", "mov", "mkv", "avi", "webm", "m4v"})
_DERIVATIVE_IMAGE_EXTENSIONS = frozenset({"jpg", "jpeg", "png", "gif", "webp", "bmp"})


def enqueue_generate_derivatives_if_applicable(db: Session, material_file: MaterialFile) -> None:
    """在文件已在 NAS 且路径已写入 DB 后，为图片/视频排队 generate_derivatives（供 ECS 落盘完成与 LAN 直传 ingest 共用）。"""
    ext = (material_file.extension or "").lower().lstrip(".")
    if ext not in _DERIVATIVE_VIDEO_EXTENSIONS and ext not in _DERIVATIVE_IMAGE_EXTENSIONS:
        return
    fp = (material_file.file_path or "").strip()
    if not fp:
        return
    db.add(
        NasJob(
            job_type="generate_derivatives",
            payload={
                "material_id": str(material_file.material_id),
                "material_file_id": str(material_file.id),
                "file_path": fp.replace("\\", "/"),
            },
            status="pending",
        )
    )


def _derive_restore_path_from_trash_path(current_path: str) -> str | None:
    normalized = (current_path or "").replace("\\", "/").strip()
    if not normalized:
        return None
    marker = "/.trash/"
    idx = normalized.lower().find(marker)
    if idx < 0:
        return None
    tail = normalized[idx + len(marker) :]
    parts = [p for p in tail.split("/") if p]
    if len(parts) < 2:
        return None
    restored_rel = "/".join(parts[1:])
    prefix = normalized[:idx]
    if prefix:
        return f"{prefix}/{restored_rel}"
    if normalized.startswith("/"):
        return f"/{restored_rel}"
    return restored_rel


def _resolve_tag_ids(db: Session, material_id: UUID) -> list[str]:
    rows = list(db.scalars(select(MaterialTag).where(MaterialTag.material_id == material_id)).all())
    return [str(row.tag_id) for row in rows]


def _resolve_material_files(db: Session, material_id: UUID) -> list[dict]:
    rows = list(
        db.scalars(
            select(MaterialFile)
            .where(MaterialFile.material_id == material_id)
            .order_by(MaterialFile.created_at.asc())
        ).all()
    )
    return [
        {
            "id": str(row.id),
            "file_role": row.file_role,
            "storage_type": row.storage_type,
            "original_filename": row.original_filename,
            "stored_filename": row.stored_filename,
            "file_path": row.file_path,
            "file_relative_path": (row.file_path or "").replace("\\", "/"),
            "extension": _normalize_extension_display(row.extension),
            "file_size": row.file_size,
            "sha256": row.sha256,
            "extra_metadata": row.extra_metadata,
            "created_at": row.created_at,
        }
        for row in rows
    ]


def _taxonomy_names(db: Session, primary_id, secondary_id) -> tuple[str | None, str | None]:
    primary_name = None
    secondary_name = None
    if primary_id:
        node = db.get(LibraryTaxonomyNode, primary_id)
        primary_name = node.name if node else None
    if secondary_id:
        node = db.get(LibraryTaxonomyNode, secondary_id)
        secondary_name = node.name if node else None
    return primary_name, secondary_name


def _build_material_query(
    keyword: str | None = None,
    uploader: str | None = None,
    tag_ids_all: list[str] | None = None,
    tag_category: str | None = None,
    status_filter: str | None = None,
    only_available: bool = True,
    quick_view: str | None = None,
    requester_username: str | None = None,
    owner_only_username: str | None = None,
    tag_match_mode: str = "and",
    *,
    library_id=None,
    library_code: str | None = None,
    primary_taxonomy_id: str | None = None,
    secondary_taxonomy_id: str | None = None,
    exclude_zero_byte_original: bool = False,
):
    stmt = select(Material)
    if library_id is not None:
        stmt = stmt.where(Material.library_id == library_id)
    if only_available:
        stmt = stmt.where(Material.status == "available")
    elif status_filter:
        raw_statuses = [x.strip() for x in str(status_filter).split(",") if x.strip()]
        if len(raw_statuses) == 1:
            stmt = stmt.where(Material.status == raw_statuses[0])
        elif len(raw_statuses) > 1:
            stmt = stmt.where(Material.status.in_(raw_statuses))
    if keyword:
        normalized = f"%{keyword.strip()}%"
        tax_match = exists(
            select(1)
            .select_from(LibraryTaxonomyNode)
            .where(
                LibraryTaxonomyNode.library_id == Material.library_id,
                LibraryTaxonomyNode.name.ilike(normalized),
                or_(
                    LibraryTaxonomyNode.id == Material.primary_taxonomy_id,
                    LibraryTaxonomyNode.id == Material.secondary_taxonomy_id,
                ),
            )
        )
        stmt = stmt.where(
            or_(
                Material.title.ilike(normalized),
                Material.description.ilike(normalized),
                Material.copy_fit.ilike(normalized),
                func.array_to_string(Material.keywords, ",").ilike(normalized),
                tax_match,
            )
        )
    if uploader:
        stmt = stmt.where(Material.uploader.ilike(f"%{uploader.strip()}%"))
    if primary_taxonomy_id:
        stmt = stmt.where(Material.primary_taxonomy_id == UUID(str(primary_taxonomy_id)))
    if secondary_taxonomy_id:
        stmt = stmt.where(Material.secondary_taxonomy_id == UUID(str(secondary_taxonomy_id)))
    if tag_category:
        cat = (tag_category or "").strip()
        code = library_code or (library_code_for_id(library_id) if library_id is not None else LIBRARY_CODE_AUTO)
        if cat not in get_tag_categories(code):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag_category")
        stmt = stmt.where(
            exists(
                select(1)
                .select_from(MaterialTag)
                .join(Tag, Tag.id == MaterialTag.tag_id)
                .where(
                    MaterialTag.material_id == Material.id,
                    Tag.category == cat,
                    Tag.status == "active",
                )
            )
        )
    if tag_ids_all:
        try:
            tag_uuid_list = [UUID(item) for item in tag_ids_all]
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id") from exc
        if tag_match_mode not in {"and", "or"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag_match_mode")
        if tag_match_mode == "and":
            for tag_uuid in tag_uuid_list:
                stmt = stmt.where(
                    select(MaterialTag.id)
                    .where(MaterialTag.material_id == Material.id)
                    .where(MaterialTag.tag_id == tag_uuid)
                    .exists()
                )
        else:
            stmt = stmt.where(
                select(MaterialTag.id)
                .where(MaterialTag.material_id == Material.id)
                .where(MaterialTag.tag_id.in_(tag_uuid_list))
                .exists()
            )
    if quick_view == "my_upload" and requester_username:
        stmt = stmt.where(Material.uploader == requester_username)
    if quick_view == "recent_download" and requester_username:
        stmt = stmt.where(
            select(AssetUsage.id)
            .where(
                AssetUsage.material_id == Material.id,
                AssetUsage.usage_type == "download",
                AssetUsage.username == requester_username,
            )
            .exists()
        )
    if owner_only_username:
        stmt = stmt.where(Material.uploader == owner_only_username)
    # 素材库默认列表：不展示主文件（original）为 0 字节的异常入库（未整理页仍可看到以便处理）
    if exclude_zero_byte_original:
        zero_original_exists = (
            select(MaterialFile.id)
            .where(
                MaterialFile.material_id == Material.id,
                MaterialFile.file_role == "original",
                MaterialFile.file_size == 0,
            )
            .exists()
        )
        stmt = stmt.where(~zero_original_exists)
    return stmt


def list_materials(
    db: Session,
    keyword: str | None = None,
    uploader: str | None = None,
    tag_ids_all: list[str] | None = None,
    tag_category: str | None = None,
    status_filter: str | None = None,
    only_available: bool = True,
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    quick_view: str | None = None,
    requester_username: str | None = None,
    owner_only_username: str | None = None,
    tag_match_mode: str = "and",
    *,
    library_id=None,
    library_code: str | None = None,
    primary_taxonomy_id: str | None = None,
    secondary_taxonomy_id: str | None = None,
) -> tuple[list[Material], int]:
    stmt = _build_material_query(
        keyword=keyword,
        uploader=uploader,
        tag_ids_all=tag_ids_all,
        tag_category=tag_category,
        status_filter=status_filter,
        only_available=only_available,
        quick_view=quick_view,
        requester_username=requester_username,
        owner_only_username=owner_only_username,
        tag_match_mode=tag_match_mode,
        library_id=library_id,
        library_code=library_code,
        primary_taxonomy_id=primary_taxonomy_id,
        secondary_taxonomy_id=secondary_taxonomy_id,
        exclude_zero_byte_original=only_available,
    )
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.scalar(count_stmt) or 0)

    allowed_sort_columns = {
        "created_at": Material.created_at,
        "title": Material.title,
        "status": Material.status,
    }
    sort_column = allowed_sort_columns.get(sort_by)
    if sort_column is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sort_by")
    if sort_order not in {"asc", "desc"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sort_order")
    if page <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page must be greater than 0")
    if page_size <= 0 or page_size > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="page_size must be between 1 and 100")

    ordered = sort_column.asc() if sort_order == "asc" else sort_column.desc()
    stmt = stmt.order_by(ordered).offset((page - 1) * page_size).limit(page_size)
    return list(db.scalars(stmt).all()), total


def list_distinct_active_tag_ids_for_material_filters(
    db: Session,
    keyword: str | None = None,
    uploader: str | None = None,
    tag_ids_all: list[str] | None = None,
    tag_category: str | None = None,
    status_filter: str | None = None,
    only_available: bool = True,
    quick_view: str | None = None,
    requester_username: str | None = None,
    owner_only_username: str | None = None,
    tag_match_mode: str = "and",
    *,
    library_id=None,
    library_code: str | None = None,
    primary_taxonomy_id: str | None = None,
    secondary_taxonomy_id: str | None = None,
) -> list[str]:
    """与 `list_materials` 同源 WHERE 子句下，出现在任一匹配素材上的启用标签 id（去重）。"""
    stmt = _build_material_query(
        keyword=keyword,
        uploader=uploader,
        tag_ids_all=tag_ids_all,
        tag_category=tag_category,
        status_filter=status_filter,
        only_available=only_available,
        quick_view=quick_view,
        requester_username=requester_username,
        owner_only_username=owner_only_username,
        tag_match_mode=tag_match_mode,
        library_id=library_id,
        library_code=library_code,
        primary_taxonomy_id=primary_taxonomy_id,
        secondary_taxonomy_id=secondary_taxonomy_id,
        exclude_zero_byte_original=only_available,
    )
    material_sq = stmt.with_only_columns(Material.id).subquery()
    rows = list(
        db.scalars(
            select(MaterialTag.tag_id)
            .distinct()
            .join(Tag, Tag.id == MaterialTag.tag_id)
            .where(
                MaterialTag.material_id.in_(select(material_sq.c.id)),
                Tag.status == "active",
            )
        ).all()
    )
    return [str(x) for x in rows]


def get_material(db: Session, material_id: str, only_available: bool = False) -> Material:
    try:
        uuid_value = UUID(material_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid material id") from exc
    row = db.get(Material, uuid_value)
    if row is None or (only_available and row.status != "available"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    return row


def get_material_file(db: Session, material_id: str, file_id: str) -> MaterialFile:
    try:
        material_uuid = UUID(material_id)
        file_uuid = UUID(file_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid id") from exc
    row = db.scalar(
        select(MaterialFile).where(
            MaterialFile.id == file_uuid,
            MaterialFile.material_id == material_uuid,
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material file not found")
    return row


def resolve_material_file_abs_path(file_row: MaterialFile) -> Path:
    raw_path = (file_row.file_path or "").strip()
    if not raw_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Material file path is empty")

    normalized_raw_path = raw_path.replace("\\", "/")
    file_path = Path(normalized_raw_path)
    if file_path.is_absolute():
        abs_path = file_path
    elif file_row.storage_type == "nas":
        mount_root = settings.nas_mount_root.strip()
        if not mount_root:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="NAS_MOUNT_ROOT is not configured on server",
            )
        rel_path = normalized_raw_path
        marker = "/originals/"
        marker_idx = normalized_raw_path.lower().find(marker)
        # Support Windows paths like Z:\material-assets\originals\2026\04\file.png
        # by mapping them to NAS_MOUNT_ROOT/originals/...
        if marker_idx >= 0:
            rel_path = normalized_raw_path[marker_idx + 1 :]
        elif ":" in normalized_raw_path and normalized_raw_path[1:3] == ":/":
            # Drive-letter path without expected marker: drop "Z:/" prefix.
            rel_path = normalized_raw_path[3:]
        abs_path = Path(mount_root) / rel_path
    else:
        abs_path = Path(__file__).resolve().parents[2] / "data" / raw_path

    if not abs_path.exists() or not abs_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material file not found on server")
    return abs_path


def create_material(db: Session, payload: MaterialCreate, *, library_id, library_code: str) -> Material:
    row = Material(
        library_id=library_id,
        title=payload.title.strip(),
        description=payload.description,
        status="available",
        download_count=0,
        uploader=payload.uploader,
        keywords=[],
    )
    db.add(row)
    db.flush()

    tags = load_active_business_tags(db, library_id=library_id, tag_ids=payload.tag_ids)
    for tag in tags:
        db.add(MaterialTag(material_id=row.id, tag_id=tag.id))

    db.commit()
    db.refresh(row)
    return row


def patch_material_storage_pool(db: Session, material_id: str, *, storage_pool_id: str) -> Material:
    """仅允许有 asset.edit_all 的调用方（路由层校验）修改素材所属存储池，用于多文件机/多池路由。"""
    row = get_material(db, material_id, only_available=False)
    row.storage_pool_id = validate_storage_pool_id(storage_pool_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def ingest_material_from_nas(db: Session, payload: MaterialIngestFromNasRequest) -> tuple[Material, MaterialFile, NasJob]:
    sha256 = payload.sha256.strip().lower()
    if len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sha256")

    material_library_id = library_id_for_code(normalize_library_code(getattr(payload, "library", None)))

    if live_original_material_exists_by_sha256(db, sha256, library_id=material_library_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Material with same sha256 already exists")

    pool_id = resolve_storage_pool_id_for_ingest(payload.storage_pool_id)
    material = Material(
        library_id=material_library_id,
        title=payload.title.strip(),
        description=payload.description,
        status="available",
        download_count=0,
        uploader=payload.uploader,
        storage_pool_id=pool_id,
        keywords=[],
    )
    db.add(material)
    db.flush()

    applied_tags = load_active_business_tags(db, library_id=material.library_id, tag_ids=payload.tag_ids) if payload.tag_ids else []
    for tag in applied_tags:
        db.add(MaterialTag(material_id=material.id, tag_id=tag.id))
    if not applied_tags:
        unorganized_tag = resolve_unorganized_tag(db, material.library_id)
        db.add(MaterialTag(material_id=material.id, tag_id=unorganized_tag.id))

    sfx = Path(payload.original_filename).suffix.lower()
    extension = sfx[1:] if sfx.startswith(".") else (sfx or None)
    material_file = MaterialFile(
        material_id=material.id,
        file_role="original",
        storage_type="nas",
        original_filename=payload.original_filename,
        stored_filename=payload.stored_filename,
        file_path=payload.nas_file_path,
        extension=extension,
        file_size=payload.file_size,
        sha256=sha256,
        extra_metadata={"ingest_mode": "lan_direct"},
    )
    try:
        db.add(material_file)
        db.flush()
        # LAN 直传从未走 nas-jobs/complete，须在此显式排队缩略图任务（否则缩略图接口一直回退原图路径）
        enqueue_generate_derivatives_if_applicable(db, material_file)

        nas_job = NasJob(
            job_type="store_original",
            payload={"ingest_mode": "lan_direct", "target_file": payload.nas_file_path},
            status="success",
            result={"target_file": payload.nas_file_path, "bytes_written": payload.file_size},
        )
        sync_op = create_sync_operation(
            db,
            operation_id=new_operation_id("lan_ingest"),
            operation_type="upload.ingest_from_nas",
            target_type="material",
            target_id=str(material.id),
            status="synced",
            payload={"material_id": str(material.id), "material_file_id": str(material_file.id), "nas_file_path": payload.nas_file_path},
        )
        nas_job.sync_operation_id = sync_op.id
        db.add(nas_job)

        db.add(
            AssetOperation(
                username=payload.uploader,
                operation_type="ingest_material_lan",
                target_type="material",
                target_id=material.id,
                access_context="internal",
                success=True,
            )
        )

        db.commit()
    except IntegrityError:
        db.rollback()
        if live_original_material_exists_by_sha256(db, sha256, library_id=material_library_id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Material with same sha256 already exists")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Material ingest unique constraint (not a cross-library sha256 duplicate)",
        )
    db.refresh(material)
    db.refresh(material_file)
    db.refresh(nas_job)
    return material, material_file, nas_job


def soft_delete_material(db: Session, material_id: str) -> Material:
    row = get_material(db, material_id)
    file_rows = list(
        db.scalars(select(MaterialFile).where(MaterialFile.material_id == row.id, MaterialFile.storage_type == "nas")).all()
    )
    for file_row in file_rows:
        sync_op = create_sync_operation(
            db,
            operation_id=new_operation_id("delete"),
            operation_type="delete.move_to_trash",
            target_type="material_file",
            target_id=str(file_row.id),
            status="sync_pending",
            payload={"material_id": str(row.id), "material_file_id": str(file_row.id), "file_path": file_row.file_path},
        )
        db.add(
            NasJob(
                job_type="move_to_trash",
                payload={
                    "material_id": str(row.id),
                    "material_file_id": str(file_row.id),
                    "file_path": file_row.file_path,
                    "restore_to_path": file_row.file_path,
                },
                status="pending",
                sync_operation_id=sync_op.id,
            )
        )
    row.status = "trash_pending" if file_rows else "trashed"
    db.commit()
    db.refresh(row)
    return row


def restore_material(db: Session, material_id: str) -> Material:
    row = get_material(db, material_id)
    has_pending_restore_job = False
    file_rows = list(
        db.scalars(select(MaterialFile).where(MaterialFile.material_id == row.id, MaterialFile.storage_type == "nas")).all()
    )
    for file_row in file_rows:
        restore_to_path = None
        if isinstance(file_row.extra_metadata, dict):
            value = file_row.extra_metadata.get("restore_to_path")
            if isinstance(value, str) and value.strip():
                restore_to_path = value.strip()
        if not restore_to_path:
            inferred = _derive_restore_path_from_trash_path(file_row.file_path)
            if inferred:
                restore_to_path = inferred
        if not restore_to_path:
            continue
        db.add(
            NasJob(
                job_type="restore_from_trash",
                payload={
                    "material_id": str(row.id),
                    "material_file_id": str(file_row.id),
                    "file_path": file_row.file_path,
                    "restore_to_path": restore_to_path,
                },
                status="pending",
            )
        )
        has_pending_restore_job = True
    row.status = "nas_syncing" if has_pending_restore_job else "available"
    db.commit()
    db.refresh(row)
    return row


def permanently_delete_material(db: Session, material_id: str) -> str:
    row = get_material(db, material_id, only_available=False)
    if row.status not in {"trashed", "trash_pending"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Material must be in trashed/trash_pending status before permanent delete",
        )
    deleted_id = str(row.id)
    db.delete(row)
    db.commit()
    return deleted_id


def _meta_media_dimensions(meta: dict) -> tuple[int | None, int | None]:
    w_raw, h_raw = meta.get("media_width"), meta.get("media_height")
    try:
        wi = int(w_raw) if w_raw is not None else None
    except (TypeError, ValueError):
        wi = None
    try:
        hi = int(h_raw) if h_raw is not None else None
    except (TypeError, ValueError):
        hi = None
    if wi is not None and hi is not None and wi > 0 and hi > 0:
        return wi, hi
    return None, None


def serialize_material(db: Session, row: Material) -> dict:
    first_file = db.scalar(
        select(MaterialFile).where(MaterialFile.material_id == row.id).order_by(MaterialFile.created_at.asc()).limit(1)
    )
    first_meta = dict(first_file.extra_metadata or {}) if first_file and isinstance(first_file.extra_metadata, dict) else {}
    mw, mh = _meta_media_dimensions(first_meta)
    primary_name, secondary_name = _taxonomy_names(db, row.primary_taxonomy_id, row.secondary_taxonomy_id)
    return {
        "id": str(row.id),
        "library_id": str(row.library_id),
        "library_code": library_code_for_id(row.library_id),
        "title": row.title,
        "description": row.description,
        "copy_fit": row.copy_fit,
        "keywords": list(row.keywords or []),
        "primary_taxonomy_id": str(row.primary_taxonomy_id) if row.primary_taxonomy_id else None,
        "secondary_taxonomy_id": str(row.secondary_taxonomy_id) if row.secondary_taxonomy_id else None,
        "primary_taxonomy_name": primary_name,
        "secondary_taxonomy_name": secondary_name,
        "tag_ids": _resolve_tag_ids(db, row.id),
        "original_filename": first_file.original_filename if first_file else None,
        "primary_file_id": str(first_file.id) if first_file else None,
        "primary_extension": _normalize_extension_display(first_file.extension) if first_file else None,
        "file_size": int(first_file.file_size) if first_file and first_file.file_size is not None else None,
        "primary_media_width": mw,
        "primary_media_height": mh,
        "preview_thumbnail_path": str(first_meta.get("thumbnail_path") or "") or None,
        "storage_pool_id": (getattr(row, "storage_pool_id", None) or "default").strip() or "default",
        "status": row.status,
        "download_count": row.download_count,
        "uploader": row.uploader,
        "created_at": row.created_at,
        "files": _resolve_material_files(db, row.id),
    }


def record_material_download_usage(
    db: Session,
    *,
    material_id: str,
    material_file_id: str | None,
    username: str | None,
    source: str,
) -> None:
    material = get_material(db, material_id, only_available=False)
    file_uuid = None
    if material_file_id:
        file_row = get_material_file(db, material_id, material_file_id)
        file_uuid = file_row.id

    db.add(
        AssetUsage(
            material_id=material.id,
            material_file_id=file_uuid,
            username=username,
            usage_type="download",
            source=source,
        )
    )
    material.download_count = int(material.download_count or 0) + 1
    db.commit()


def list_material_usages(db: Session, material_id: str, limit: int = 50) -> tuple[list[AssetUsage], int]:
    material = get_material(db, material_id, only_available=False)
    base = select(AssetUsage).where(AssetUsage.material_id == material.id).order_by(AssetUsage.created_at.desc())
    count_stmt = select(func.count()).select_from(select(AssetUsage.id).where(AssetUsage.material_id == material.id).subquery())
    total = int(db.scalar(count_stmt) or 0)
    rows = list(db.scalars(base.limit(max(1, min(limit, 200)))).all())
    return rows, total


def _resolve_tag_names(db: Session, material_id: UUID) -> list[str]:
    rows = db.execute(
        select(Tag.name).join(MaterialTag, MaterialTag.tag_id == Tag.id).where(MaterialTag.material_id == material_id)
    ).all()
    return [str(name) for (name,) in rows]


def _resolve_unorganized_tag(db: Session, library_id) -> Tag:
    return resolve_unorganized_tag(db, library_id)


def _can_edit_material(perms: set[str], material: Material, username: str) -> bool:
    if "asset.edit_all" in perms:
        return True
    return "asset.edit_own" in perms and material.uploader == username


def patch_material_fields(
    db: Session,
    *,
    username: str,
    material_id: str,
    title: str | None = None,
    description: str | None = None,
    tag_ids: list[str] | None = None,
    primary_original_filename: str | None = None,
    keywords: list[str] | None = None,
    copy_fit: str | None = None,
    primary_taxonomy_id: str | None = None,
    secondary_taxonomy_id: str | None = None,
) -> Material:
    perms = get_user_permissions(db, username)
    material = get_material(db, material_id, only_available=False)
    if str(material.status or "") == "trashed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Material is trashed")
    if not _can_edit_material(perms, material, username):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No edit permission for material")
    if primary_original_filename is not None:
        name = primary_original_filename.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="primary_original_filename cannot be empty")
        if any(sep in name for sep in ("/", "\\")) or ".." in name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid primary_original_filename")
        first_file = db.scalar(
            select(MaterialFile)
            .where(MaterialFile.material_id == material.id)
            .order_by(MaterialFile.created_at.asc())
            .limit(1)
        )
        if first_file is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Material has no files")
        first_file.original_filename = name[:255]
    if title is not None:
        t = title.strip()
        if not t:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title cannot be empty")
        material.title = t[:200]
    elif primary_original_filename is not None:
        stem = name.rsplit(".", 1)[0] if "." in name else name
        material.title = stem[:200]
    if description is not None:
        material.description = description
    if keywords is not None:
        material.keywords = normalize_keywords(keywords)
    if copy_fit is not None:
        material.copy_fit = normalize_copy_fit(copy_fit)
    if primary_taxonomy_id is not None or secondary_taxonomy_id is not None:
        pid, sid = resolve_taxonomy_pair(
            db,
            library_id=material.library_id,
            primary_taxonomy_id=primary_taxonomy_id,
            secondary_taxonomy_id=secondary_taxonomy_id,
            required=is_personal_video_library(material.library_id),
        )
        material.primary_taxonomy_id = pid
        material.secondary_taxonomy_id = sid
    if tag_ids is not None:
        selected_tags = load_active_business_tags(db, library_id=material.library_id, tag_ids=tag_ids)
        db.query(MaterialTag).filter(MaterialTag.material_id == material.id).delete(synchronize_session=False)
        for tag in selected_tags:
            db.add(MaterialTag(material_id=material.id, tag_id=tag.id))
    db.commit()
    db.refresh(material)
    return material


def _can_delete_material(perms: set[str], material: Material, username: str) -> bool:
    if "asset.delete_all" in perms:
        return True
    return "asset.delete_own" in perms and material.uploader == username


def list_unorganized_materials(
    db: Session,
    *,
    username: str,
    file_type: str | None = None,
    uploader_id: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    page: int = 1,
    page_size: int = 20,
    library_id=None,
) -> tuple[list[dict], int]:
    perms = get_user_permissions(db, username)
    can_view_all = "asset.edit_all" in perms or "asset.delete_all" in perms
    can_view_own = "asset.edit_own" in perms or "asset.delete_own" in perms
    if library_id is None:
        raise HTTPException(status_code=400, detail="library_id is required")
    unorganized_tag = _resolve_unorganized_tag(db, library_id)
    has_unorganized_tag = (
        select(MaterialTag.id)
        .where(MaterialTag.material_id == Material.id, MaterialTag.tag_id == unorganized_tag.id)
        .exists()
    )
    has_any_tag = select(MaterialTag.id).where(MaterialTag.material_id == Material.id).exists()
    stmt = (
        select(Material)
        .where(Material.library_id == library_id)
        .where(Material.status != "trashed")
        .where(or_(has_unorganized_tag, ~has_any_tag))
    )
    if not can_view_all and can_view_own:
        stmt = stmt.where(Material.uploader == username)
    if uploader_id:
        stmt = stmt.where(Material.uploader == uploader_id)
    if created_from:
        try:
            stmt = stmt.where(Material.created_at >= datetime.fromisoformat(created_from.replace("Z", "+00:00")))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid created_from") from exc
    if created_to:
        try:
            stmt = stmt.where(Material.created_at <= datetime.fromisoformat(created_to.replace("Z", "+00:00")))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid created_to") from exc
    if file_type:
        ft = file_type.strip().lower().lstrip(".")
        if ft:
            stmt = stmt.where(
                select(MaterialFile.id)
                .where(
                    MaterialFile.material_id == Material.id,
                    or_(MaterialFile.extension == ft, MaterialFile.extension == f".{ft}"),
                )
                .exists()
            )
    total = int(db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)
    rows = list(
        db.scalars(stmt.order_by(Material.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    )
    items: list[dict] = []
    for row in rows:
        first_file = db.scalar(
            select(MaterialFile).where(MaterialFile.material_id == row.id).order_by(MaterialFile.created_at.asc()).limit(1)
        )
        first_meta = dict(first_file.extra_metadata or {}) if first_file and isinstance(first_file.extra_metadata, dict) else {}
        thumb_path = str(first_meta.get("thumbnail_path") or "").strip() or None
        uw, uh = _meta_media_dimensions(first_meta)
        primary_name, secondary_name = _taxonomy_names(db, row.primary_taxonomy_id, row.secondary_taxonomy_id)
        items.append(
            {
                "id": str(row.id),
                "library_id": str(row.library_id),
                "library_code": library_code_for_id(row.library_id),
                "title": row.title,
                "description": row.description,
                "copy_fit": row.copy_fit,
                "keywords": list(row.keywords or []),
                "primary_taxonomy_id": str(row.primary_taxonomy_id) if row.primary_taxonomy_id else None,
                "secondary_taxonomy_id": str(row.secondary_taxonomy_id) if row.secondary_taxonomy_id else None,
                "primary_taxonomy_name": primary_name,
                "secondary_taxonomy_name": secondary_name,
                "original_filename": first_file.original_filename if first_file else None,
                "primary_file_id": str(first_file.id) if first_file else None,
                "file_size": int(first_file.file_size) if first_file and first_file.file_size is not None else None,
                "asset_type": _normalize_extension_display(first_file.extension) if first_file else None,
                "primary_media_width": uw,
                "primary_media_height": uh,
                "thumbnail_url": thumb_path,
                "uploader_name": row.uploader,
                "created_at": row.created_at,
                "tags": _resolve_tag_names(db, row.id),
                "ai_analysis": _enrich_unorganized_ai_analysis(db, row.library_id, first_meta.get("ai_analysis")),
            }
        )
    return items, total


def batch_add_tags_and_remove_unorganized(
    db: Session,
    *,
    username: str,
    asset_ids: list[str],
    tag_ids: list[str],
    primary_taxonomy_id: str | None = None,
    secondary_taxonomy_id: str | None = None,
    keywords: list[str] | None = None,
    copy_fit: str | None = None,
    description: str | None = None,
) -> tuple[int, int, list[dict]]:
    perms = get_user_permissions(db, username)
    if "asset.edit_all" not in perms and "asset.edit_own" not in perms:
        raise HTTPException(status_code=403, detail="Missing permission: asset.edit_own/asset.edit_all")
    success_count = 0
    failed_items: list[dict] = []
    for asset_id in asset_ids:
        try:
            material = get_material(db, asset_id, only_available=False)
            if not _can_edit_material(perms, material, username):
                raise HTTPException(status_code=403, detail="No edit permission for material")
            selected_tags = load_active_business_tags(db, library_id=material.library_id, tag_ids=tag_ids)
            if is_personal_video_library(material.library_id):
                pid, sid = resolve_taxonomy_pair(
                    db,
                    library_id=material.library_id,
                    primary_taxonomy_id=primary_taxonomy_id,
                    secondary_taxonomy_id=secondary_taxonomy_id,
                    required=True,
                )
                if not selected_tags:
                    raise HTTPException(status_code=400, detail="At least one 适用主题 is required")
                material.primary_taxonomy_id = pid
                material.secondary_taxonomy_id = sid
                material.keywords = normalize_keywords(keywords, required_min=1)
                material.copy_fit = normalize_copy_fit(copy_fit, required=True)
                if description is not None:
                    material.description = (description or "").strip() or None
            db.query(MaterialTag).filter(MaterialTag.material_id == material.id).delete(synchronize_session=False)
            for tag in selected_tags:
                db.add(MaterialTag(material_id=material.id, tag_id=tag.id))
            success_count += 1
        except HTTPException as exc:
            failed_items.append({"asset_id": asset_id, "reason": str(exc.detail)})
        except Exception as exc:
            failed_items.append({"asset_id": asset_id, "reason": str(exc)})
    db.commit()
    return success_count, len(failed_items), failed_items


def batch_mark_unorganized_materials(
    db: Session, *, username: str, asset_ids: list[str]
) -> tuple[int, int, list[dict]]:
    perms = get_user_permissions(db, username)
    if "asset.edit_all" not in perms and "asset.edit_own" not in perms:
        raise HTTPException(status_code=403, detail="Missing permission: asset.edit_own/asset.edit_all")
    success_count = 0
    failed_items: list[dict] = []
    for asset_id in asset_ids:
        try:
            material = get_material(db, asset_id, only_available=False)
            if not _can_edit_material(perms, material, username):
                raise HTTPException(status_code=403, detail="No edit permission for material")
            unorganized_tag = _resolve_unorganized_tag(db, material.library_id)
            exists = db.scalar(
                select(MaterialTag).where(
                    MaterialTag.material_id == material.id,
                    MaterialTag.tag_id == unorganized_tag.id,
                )
            )
            if exists is None:
                db.add(MaterialTag(material_id=material.id, tag_id=unorganized_tag.id))
            success_count += 1
        except HTTPException as exc:
            failed_items.append({"asset_id": asset_id, "reason": str(exc.detail)})
        except Exception as exc:
            failed_items.append({"asset_id": asset_id, "reason": str(exc)})
    db.commit()
    return success_count, len(failed_items), failed_items


def batch_trash_unorganized_materials(
    db: Session, *, username: str, asset_ids: list[str]
) -> tuple[int, int, list[dict]]:
    perms = get_user_permissions(db, username)
    if "asset.delete_all" not in perms and "asset.delete_own" not in perms:
        raise HTTPException(status_code=403, detail="Missing permission: asset.delete_own/asset.delete_all")
    success_count = 0
    failed_items: list[dict] = []
    for asset_id in asset_ids:
        try:
            material = get_material(db, asset_id, only_available=False)
            if not _can_delete_material(perms, material, username):
                raise HTTPException(status_code=403, detail="No delete permission for material")
            soft_delete_material(db, asset_id)
            success_count += 1
        except HTTPException as exc:
            failed_items.append({"asset_id": asset_id, "reason": str(exc.detail)})
        except Exception as exc:
            failed_items.append({"asset_id": asset_id, "reason": str(exc)})
    return success_count, len(failed_items), failed_items
