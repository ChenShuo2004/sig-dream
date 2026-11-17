"""桌面端元数据同步：仅导出素材/文件/标签，供 LAN SMB 直连路径解析。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.material import MaterialFile, MaterialTag
from app.models.tag import Tag
from app.services.material_service import list_materials, serialize_material


def list_active_tags_for_desktop_sync(db: Session, *, library_id) -> list[dict]:
    rows = list(db.scalars(select(Tag).where(Tag.status == "active", Tag.library_id == library_id)).all())
    out: list[dict] = []
    for row in rows:
        out.append(
            {
                "id": str(row.id),
                "name": row.name,
                "category": row.category,
                "status": row.status,
                "sort_order": int(getattr(row, "sort_order", 0) or 0),
            }
        )
    return out


def _resolve_tag_ids(db: Session, material_id) -> list[str]:
    rows = list(db.scalars(select(MaterialTag).where(MaterialTag.material_id == material_id)).all())
    return [str(row.tag_id) for row in rows]


def _resolve_nas_files(db: Session, material_id) -> list[dict]:
    rows = list(
        db.scalars(
            select(MaterialFile)
            .where(MaterialFile.material_id == material_id)
            .order_by(MaterialFile.created_at.asc())
        ).all()
    )
    out: list[dict] = []
    for row in rows:
        fp = (row.file_path or "").strip()
        if row.storage_type != "nas" or not fp:
            continue
        out.append(
            {
                "id": str(row.id),
                "material_id": str(row.material_id),
                "file_role": row.file_role,
                "storage_type": row.storage_type,
                "original_filename": row.original_filename,
                "file_path": fp.replace("\\", "/"),
                "file_relative_path": fp.replace("\\", "/"),
                "extension": row.extension,
                "file_size": row.file_size,
            }
        )
    return out


def build_desktop_metadata_sync_page(
    db: Session,
    *,
    page: int,
    page_size: int,
    library_id,
    library_code: str,
) -> tuple[list[dict], list[dict], int]:
    rows, total = list_materials(
        db,
        only_available=True,
        page=page,
        page_size=page_size,
        sort_by="created_at",
        sort_order="desc",
        library_id=library_id,
        library_code=library_code,
    )
    materials: list[dict] = []
    files: list[dict] = []
    for row in rows:
        serialized = serialize_material(db, row)
        materials.append(
            {
                "id": serialized["id"],
                "title": serialized["title"],
                "status": serialized["status"],
                "tag_ids": serialized.get("tag_ids") or _resolve_tag_ids(db, row.id),
                "primary_file_id": serialized.get("primary_file_id"),
                "storage_pool_id": serialized.get("storage_pool_id") or "default",
                "created_at": serialized["created_at"],
            }
        )
        files.extend(_resolve_nas_files(db, row.id))
    return materials, files, total
