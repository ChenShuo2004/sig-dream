from __future__ import annotations

import uuid
from typing import Annotated, Any
from uuid import UUID

from fastapi import Header, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.asset_library import AssetLibrary, LibraryTaxonomyNode

LIBRARY_CODE_AUTO = "auto"
LIBRARY_CODE_PERSONAL_VIDEO = "personal_video"
LIBRARY_CODES = (LIBRARY_CODE_AUTO, LIBRARY_CODE_PERSONAL_VIDEO)

SCHEMA_AUTO_TAGS = "auto_tags"
SCHEMA_PERSONAL_VIDEO = "personal_video"

AUTO_LIBRARY_ID = uuid.uuid5(uuid.NAMESPACE_URL, "lcp.asset-library.auto")
PERSONAL_VIDEO_LIBRARY_ID = uuid.uuid5(uuid.NAMESPACE_URL, "lcp.asset-library.personal_video")

_LIBRARY_ID_BY_CODE: dict[str, UUID] = {
    LIBRARY_CODE_AUTO: AUTO_LIBRARY_ID,
    LIBRARY_CODE_PERSONAL_VIDEO: PERSONAL_VIDEO_LIBRARY_ID,
}
_LIBRARY_CODE_BY_ID: dict[UUID, str] = {v: k for k, v in _LIBRARY_ID_BY_CODE.items()}

AUTO_TAG_CATEGORIES = [
    "品牌",
    "车型",
    "版本",
    "外观",
    "内饰",
    "功能",
    "场景",
    "情绪",
    "B-roll",
    "系统状态",
]

PERSONAL_VIDEO_TAG_CATEGORIES = [
    "适用主题",
    "系统状态",
]

AUTO_TAG_CATEGORY_SORT_BANDS: dict[str, tuple[int, int]] = {
    "品牌": (1, 999),
    "车型": (1001, 9999),
    "版本": (10001, 19999),
    "外观": (20001, 29999),
    "内饰": (30001, 39999),
    "功能": (40001, 49999),
    "场景": (50001, 59999),
    "情绪": (60001, 69999),
    "B-roll": (70001, 79999),
    "系统状态": (80001, 89999),
}

PERSONAL_VIDEO_TAG_CATEGORY_SORT_BANDS: dict[str, tuple[int, int]] = {
    "适用主题": (1, 9999),
    "系统状态": (10001, 19999),
}

THEME_TAG_CATEGORY = "适用主题"
UNORGANIZED_TAG_NAME = "未整理"


def normalize_library_code(raw: str | None) -> str:
    code = (raw or "").strip() or LIBRARY_CODE_AUTO
    if code not in LIBRARY_CODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid library")
    return code


def resolve_library_code(
    library: str | None = Query(default=None, description="素材库域 code：auto | personal_video"),
    x_asset_library: Annotated[str | None, Header(alias="X-Asset-Library")] = None,
) -> str:
    return normalize_library_code(library or x_asset_library)


def library_id_for_code(code: str) -> UUID:
    cid = _LIBRARY_ID_BY_CODE.get(normalize_library_code(code))
    if cid is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid library")
    return cid


def library_code_for_id(library_id: UUID | None) -> str:
    if library_id is None:
        return LIBRARY_CODE_AUTO
    return _LIBRARY_CODE_BY_ID.get(library_id, LIBRARY_CODE_AUTO)


def is_personal_video_library(library_id: UUID | None = None, *, code: str | None = None) -> bool:
    if code is not None:
        return normalize_library_code(code) == LIBRARY_CODE_PERSONAL_VIDEO
    return library_id == PERSONAL_VIDEO_LIBRARY_ID


def tag_categories_for_library(code: str) -> list[str]:
    if normalize_library_code(code) == LIBRARY_CODE_PERSONAL_VIDEO:
        return list(PERSONAL_VIDEO_TAG_CATEGORIES)
    return list(AUTO_TAG_CATEGORIES)


def tag_sort_bands_for_library(code: str) -> dict[str, tuple[int, int]]:
    if normalize_library_code(code) == LIBRARY_CODE_PERSONAL_VIDEO:
        return dict(PERSONAL_VIDEO_TAG_CATEGORY_SORT_BANDS)
    return dict(AUTO_TAG_CATEGORY_SORT_BANDS)


def get_library_by_code(db: Session, code: str) -> AssetLibrary:
    library_id = library_id_for_code(code)
    row = db.get(AssetLibrary, library_id)
    if row is None:
        row = db.scalar(select(AssetLibrary).where(AssetLibrary.code == normalize_library_code(code)))
    if row is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Asset library not seeded")
    return row


def serialize_library(row: AssetLibrary) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "code": row.code,
        "name": row.name,
        "schema_profile": row.schema_profile,
    }


def list_libraries(db: Session) -> list[AssetLibrary]:
    return list(db.scalars(select(AssetLibrary).order_by(AssetLibrary.code.asc())).all())


def parse_uuid_or_400(raw: str, *, detail: str) -> UUID:
    try:
        return UUID(str(raw).strip())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc


def list_taxonomy_tree(db: Session, library_id: UUID) -> list[dict[str, Any]]:
    rows = list(
        db.scalars(
            select(LibraryTaxonomyNode)
            .where(LibraryTaxonomyNode.library_id == library_id)
            .order_by(LibraryTaxonomyNode.sort_order.asc(), LibraryTaxonomyNode.name.asc())
        ).all()
    )
    by_parent: dict[UUID | None, list[LibraryTaxonomyNode]] = {}
    for row in rows:
        by_parent.setdefault(row.parent_id, []).append(row)

    def as_dict(node: LibraryTaxonomyNode) -> dict[str, Any]:
        return {
            "id": str(node.id),
            "library_id": str(node.library_id),
            "parent_id": str(node.parent_id) if node.parent_id else None,
            "name": node.name,
            "sort_order": int(node.sort_order or 0),
            "description": node.description or "",
            "children": [as_dict(child) for child in by_parent.get(node.id, [])],
        }

    return [as_dict(node) for node in by_parent.get(None, [])]


def _next_taxonomy_sort(db: Session, library_id: UUID, parent_id: UUID | None) -> int:
    mx = db.scalar(
        select(func.max(LibraryTaxonomyNode.sort_order)).where(
            LibraryTaxonomyNode.library_id == library_id,
            LibraryTaxonomyNode.parent_id == parent_id if parent_id is not None else LibraryTaxonomyNode.parent_id.is_(None),
        )
    )
    return int(mx or 0) + 10


def create_taxonomy_node(
    db: Session,
    *,
    library_id: UUID,
    name: str,
    parent_id: str | None,
    description: str = "",
) -> LibraryTaxonomyNode:
    cleaned = (name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Taxonomy name cannot be empty")
    pid: UUID | None = None
    if parent_id and str(parent_id).strip():
        pid = parse_uuid_or_400(parent_id, detail="Invalid parent taxonomy id")
        parent = db.get(LibraryTaxonomyNode, pid)
        if parent is None or parent.library_id != library_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Parent taxonomy not found")
        if parent.parent_id is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Taxonomy tree is only two levels")
    dup_stmt = select(LibraryTaxonomyNode.id).where(
        LibraryTaxonomyNode.library_id == library_id,
        LibraryTaxonomyNode.name == cleaned,
        LibraryTaxonomyNode.parent_id == pid if pid is not None else LibraryTaxonomyNode.parent_id.is_(None),
    )
    if db.scalar(dup_stmt) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Taxonomy name already exists")
    row = LibraryTaxonomyNode(
        library_id=library_id,
        parent_id=pid,
        name=cleaned[:64],
        description=(description or "").strip(),
        sort_order=_next_taxonomy_sort(db, library_id, pid),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def patch_taxonomy_node(
    db: Session,
    *,
    library_id: UUID,
    node_id: str,
    name: str | None,
    description: str | None,
    sort_order: int | None,
) -> LibraryTaxonomyNode:
    nid = parse_uuid_or_400(node_id, detail="Invalid taxonomy id")
    row = db.get(LibraryTaxonomyNode, nid)
    if row is None or row.library_id != library_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Taxonomy node not found")
    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Taxonomy name cannot be empty")
        row.name = cleaned[:64]
    if description is not None:
        row.description = description.strip()
    if sort_order is not None:
        row.sort_order = int(sort_order)
    db.commit()
    db.refresh(row)
    return row


def delete_taxonomy_node(db: Session, *, library_id: UUID, node_id: str) -> None:
    from app.models.material import Material

    nid = parse_uuid_or_400(node_id, detail="Invalid taxonomy id")
    row = db.get(LibraryTaxonomyNode, nid)
    if row is None or row.library_id != library_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Taxonomy node not found")
    child = db.scalar(
        select(LibraryTaxonomyNode.id).where(LibraryTaxonomyNode.parent_id == nid).limit(1)
    )
    if child is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Taxonomy node has children")
    used = db.scalar(
        select(Material.id)
        .where((Material.primary_taxonomy_id == nid) | (Material.secondary_taxonomy_id == nid))
        .limit(1)
    )
    if used is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Taxonomy node is in use by materials")
    db.delete(row)
    db.commit()


def resolve_taxonomy_pair(
    db: Session,
    *,
    library_id: UUID,
    primary_taxonomy_id: str | None,
    secondary_taxonomy_id: str | None,
    required: bool,
) -> tuple[UUID | None, UUID | None]:
    if not secondary_taxonomy_id and not primary_taxonomy_id:
        if required:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="secondary_taxonomy_id is required")
        return None, None
    if not secondary_taxonomy_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="secondary_taxonomy_id is required")
    sid = parse_uuid_or_400(secondary_taxonomy_id, detail="Invalid secondary_taxonomy_id")
    secondary = db.get(LibraryTaxonomyNode, sid)
    if secondary is None or secondary.library_id != library_id or secondary.parent_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid secondary taxonomy")
    primary = db.get(LibraryTaxonomyNode, secondary.parent_id)
    if primary is None or primary.library_id != library_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid primary taxonomy")
    if primary_taxonomy_id:
        pid = parse_uuid_or_400(primary_taxonomy_id, detail="Invalid primary_taxonomy_id")
        if pid != primary.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="secondary taxonomy does not belong to primary")
    return primary.id, secondary.id


def normalize_keywords(raw: list[str] | None, *, required_min: int = 0) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in raw or []:
        value = str(item).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value[:32])
        if len(out) >= 12:
            break
    if required_min and len(out) < required_min:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"At least {required_min} keywords are required",
        )
    return out


def normalize_copy_fit(raw: str | None, *, required: bool = False) -> str | None:
    text = (raw or "").strip()
    if required and not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="copy_fit is required")
    if not text:
        return None
    return text[:2000]
