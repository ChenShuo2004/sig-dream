from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.material import MaterialTag
from app.models.tag import Tag
from app.schemas.tag import TagApplyRequest, TagCreate
from app.services.library_service import (
    LIBRARY_CODE_AUTO,
    THEME_TAG_CATEGORY,
    UNORGANIZED_TAG_NAME,
    is_personal_video_library,
    library_code_for_id,
    tag_categories_for_library,
    tag_sort_bands_for_library,
)

# 重排时暂存 sort_order，须避开所有正式号段（汽车库最大号段上界 89999）
_REORDER_STAGING_BASE = 1_000_000


def get_tag_categories(library_code: str | None = None) -> list[str]:
    return tag_categories_for_library(library_code or LIBRARY_CODE_AUTO)


def _sort_band(category: str, library_code: str) -> tuple[int, int]:
    band = tag_sort_bands_for_library(library_code).get(category)
    if band is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag category")
    return band


def next_sort_order_for_category(db: Session, category: str, *, library_id: UUID, library_code: str) -> int:
    low, high = _sort_band(category, library_code)
    mx = db.scalar(
        select(func.max(Tag.sort_order)).where(Tag.category == category, Tag.library_id == library_id)
    )
    if mx is None:
        return low
    cur = int(mx)
    if cur < low:
        return low
    nxt = cur + 1
    if nxt > high:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category sort_order band exhausted; reorder or delete tags in this category",
        )
    return nxt


def list_active_tags_grouped(db: Session, *, library_id: UUID, library_code: str) -> dict[str, list[dict[str, str]]]:
    rows = list(
        db.scalars(
            select(Tag)
            .where(
                Tag.status == "active",
                Tag.name != UNORGANIZED_TAG_NAME,
                Tag.library_id == library_id,
            )
            .order_by(Tag.category.asc(), Tag.sort_order.asc(), Tag.name.asc())
        ).all()
    )
    grouped: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        key = str(row.category).strip() or "未分类"
        if key not in grouped:
            grouped[key] = []
        grouped[key].append({"id": str(row.id), "name": row.name, "description": (row.description or "").strip()})
    ordered: dict[str, list[dict[str, str]]] = {}
    for cat in get_tag_categories(library_code):
        if cat in grouped:
            ordered[cat] = grouped[cat]
    for cat, items in grouped.items():
        if cat not in ordered:
            ordered[cat] = items
    return ordered


def list_tags(
    db: Session,
    *,
    library_id: UUID,
    category: str | None = None,
    status_filter: str | None = None,
) -> list[Tag]:
    stmt = select(Tag).where(Tag.library_id == library_id)
    if category:
        stmt = stmt.where(Tag.category == category)
    if status_filter:
        stmt = stmt.where(Tag.status == status_filter)
    stmt = stmt.order_by(Tag.sort_order.asc(), Tag.name.asc())
    return list(db.scalars(stmt).all())


def _assert_category(category: str, library_code: str) -> None:
    if category not in get_tag_categories(library_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag category")


def create_tag(db: Session, payload: TagCreate, *, library_id: UUID, library_code: str) -> Tag:
    _assert_category(payload.category, library_code)
    existing = db.scalar(select(Tag).where(Tag.library_id == library_id, Tag.name == payload.name.strip()))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag already exists")
    record = Tag(
        library_id=library_id,
        name=payload.name.strip(),
        category=payload.category,
        description=(payload.description or "").strip(),
        status="active",
        synonyms=payload.synonyms,
        sort_order=next_sort_order_for_category(db, payload.category, library_id=library_id, library_code=library_code),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def apply_tag(db: Session, payload: TagApplyRequest, *, library_id: UUID, library_code: str) -> Tag:
    _assert_category(payload.category, library_code)
    existing = db.scalar(select(Tag).where(Tag.library_id == library_id, Tag.name == payload.name.strip()))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag already exists")
    record = Tag(
        library_id=library_id,
        name=payload.name.strip(),
        category=payload.category,
        description=(payload.description or "").strip(),
        status="pending",
        synonyms=payload.synonyms,
        sort_order=next_sort_order_for_category(db, payload.category, library_id=library_id, library_code=library_code),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def review_tag_application(db: Session, tag_id: str, decision: str) -> Tag:
    try:
        uuid_value = UUID(tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id") from exc
    tag = db.get(Tag, uuid_value)
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    if tag.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag is not pending review")

    library_code = library_code_for_id(tag.library_id)
    if decision == "approve":
        tag.status = "active"
        tag.sort_order = next_sort_order_for_category(
            db, tag.category, library_id=tag.library_id, library_code=library_code
        )
    else:
        tag.status = "rejected"
    db.commit()
    db.refresh(tag)
    return tag


def update_tag_description(db: Session, tag_id: str, description: str) -> Tag:
    try:
        uuid_value = UUID(tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id") from exc
    tag = db.get(Tag, uuid_value)
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    tag.description = (description or "").strip()
    db.commit()
    db.refresh(tag)
    return tag


def deactivate_tag(db: Session, tag_id: str) -> Tag:
    try:
        uuid_value = UUID(tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id") from exc
    tag = db.get(Tag, uuid_value)
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    tag.status = "inactive"
    db.commit()
    db.refresh(tag)
    return tag


def activate_tag(db: Session, tag_id: str) -> Tag:
    try:
        uuid_value = UUID(tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id") from exc
    tag = db.get(Tag, uuid_value)
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    if tag.status != "inactive":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only inactive tag can be activated")
    tag.status = "active"
    db.commit()
    db.refresh(tag)
    return tag


def delete_tag_to_trash(db: Session, tag_id: str) -> Tag:
    try:
        uuid_value = UUID(tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id") from exc
    tag = db.get(Tag, uuid_value)
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    if tag.status != "inactive":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only inactive tag can be moved to trash")
    used_row = db.scalar(select(MaterialTag.id).where(MaterialTag.tag_id == uuid_value).limit(1))
    if used_row is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag is in use by materials")
    tag.status = "deleted"
    db.commit()
    db.refresh(tag)
    return tag


def permanently_delete_tag(db: Session, tag_id: str) -> str:
    try:
        uuid_value = UUID(tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id") from exc
    tag = db.get(Tag, uuid_value)
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    if tag.status != "deleted":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only deleted tag can be permanently deleted")
    if tag.name == UNORGANIZED_TAG_NAME:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System tag cannot be permanently deleted")
    deleted_id = str(tag.id)
    db.delete(tag)
    db.commit()
    return deleted_id


def merge_tag(db: Session, source_tag_id: str, target_tag_id: str) -> Tag:
    try:
        source_uuid = UUID(source_tag_id)
        target_uuid = UUID(target_tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id") from exc
    source = db.get(Tag, source_uuid)
    target = db.get(Tag, target_uuid)
    if source is None or target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    if source.id == target.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot merge same tag")
    if source.library_id != target.library_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot merge tags across libraries")
    target.synonyms = sorted(list(set(target.synonyms + [source.name] + source.synonyms)))
    source.status = "merged"
    db.commit()
    db.refresh(target)
    return target


def reorder_tags_in_category(
    db: Session,
    category: str,
    ordered_tag_ids: list[str],
    *,
    library_id: UUID,
    library_code: str,
) -> None:
    """按「单一分类」内顺序重写该分类下所有标签的 sort_order。"""
    _assert_category(category, library_code)
    low, high = _sort_band(category, library_code)
    parsed: list[UUID] = []
    for raw in ordered_tag_ids:
        s = str(raw).strip()
        if not s:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty tag id in reorder list")
        try:
            parsed.append(UUID(s))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id in reorder list") from exc
    if len(parsed) != len(set(parsed)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate tag id in reorder list")

    category_ids = set(
        db.scalars(select(Tag.id).where(Tag.category == category, Tag.library_id == library_id)).all()
    )
    if len(parsed) != len(category_ids) or set(parsed) != category_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ordered_tag_ids must list every tag in this category exactly once",
        )
    n = len(parsed)
    if n > high - low + 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many tags for category sort band")

    category_rows = list(
        db.scalars(select(Tag).where(Tag.category == category, Tag.library_id == library_id)).all()
    )
    for idx, row in enumerate(category_rows):
        row.sort_order = _REORDER_STAGING_BASE + idx
    db.flush()

    for idx, tid in enumerate(parsed):
        tag = db.get(Tag, tid)
        if tag is None or tag.category != category or tag.library_id != library_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found during reorder")
        tag.sort_order = low + idx
    db.commit()


def resolve_unorganized_tag(db: Session, library_id: UUID) -> Tag:
    tag = db.scalar(select(Tag).where(Tag.library_id == library_id, Tag.name == UNORGANIZED_TAG_NAME))
    if tag is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag '未整理' not found")
    return tag


def load_active_business_tags(
    db: Session,
    *,
    library_id: UUID,
    tag_ids: list[str],
    personal_video_themes_only: bool | None = None,
) -> list[Tag]:
    if not tag_ids:
        return []
    try:
        tag_uuid_list = [UUID(t) for t in tag_ids]
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tag id") from exc
    selected_tags = list(db.scalars(select(Tag).where(Tag.id.in_(tag_uuid_list))).all())
    if len(selected_tags) != len(tag_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Some tags not found")
    themes_only = (
        is_personal_video_library(library_id) if personal_video_themes_only is None else personal_video_themes_only
    )
    for tag in selected_tags:
        if tag.library_id != library_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag does not belong to current library")
        if tag.status != "active" or tag.name == UNORGANIZED_TAG_NAME:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only active non-unorganized tags are allowed",
            )
        if themes_only and tag.category != THEME_TAG_CATEGORY:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Personal video library only accepts 适用主题 tags",
            )
    return selected_tags
