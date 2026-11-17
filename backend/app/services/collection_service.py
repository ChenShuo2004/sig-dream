from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.asset_collection import (
    AssetCollection,
    AssetCollectionGroup,
    AssetCollectionItem,
    ProjectCollectionPermission,
)
from app.models.material import Material, MaterialFile, MaterialTag
from app.models.tag import Tag
from app.models.user import User
from app.services.material_service import _meta_media_dimensions, get_material, get_material_file
from app.services.settings_service import list_user_groups

_LEVEL_ORDER = {"view": 0, "edit": 1, "manage": 2}

_VIDEO_EXTS = frozenset(
    {"mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv", "mpeg", "mpg", "3gp"}
)
_IMAGE_EXTS = frozenset({"jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "tif", "tiff"})
_AUDIO_EXTS = frozenset({"mp3", "wav", "m4a", "aac", "ogg", "flac", "wma"})

# `patch_group`：区分「请求未带 parent_id」与「显式置空」
_PATCH_GROUP_PARENT_OMIT = object()


def _norm_ext(ext: str | None) -> str | None:
    if ext is None:
        return None
    s = str(ext).strip().lower()
    if not s:
        return None
    return s[1:] if s.startswith(".") else s


def _max_level(levels: list[str]) -> str | None:
    if not levels:
        return None
    return max(levels, key=lambda x: _LEVEL_ORDER.get(x, -1))


def _user_label(user: User | None) -> str:
    if user is None:
        return ""
    return (user.display_name or "").strip() or user.username


def _resolve_tag_names(db: Session, material_id: uuid.UUID) -> list[str]:
    rows = db.execute(
        select(Tag.name).join(MaterialTag, MaterialTag.tag_id == Tag.id).where(MaterialTag.material_id == material_id)
    ).all()
    return [str(name) for (name,) in rows]


def get_user_by_username(db: Session, username: str) -> User:
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def _user_primary_group_name(user: User) -> str | None:
    g = (user.display_name or "").strip()
    return g or None


def _project_group_visible(db: Session, *, user: User, group: AssetCollectionGroup, perms: set[str]) -> bool:
    if group.group_type != "project":
        return False
    if "collection.edit_all" in perms or user.role == "super_admin":
        return True
    bind = (group.user_group_name or "").strip()
    mine = _user_primary_group_name(user)
    if not bind:
        return True
    if mine and bind == mine:
        return True
    return False


def _personal_group_visible(*, user: User, group: AssetCollectionGroup) -> bool:
    if group.group_type != "personal":
        return False
    return group.owner_user_id == user.id


def _table_project_level(db: Session, collection_id: uuid.UUID, user: User) -> str | None:
    mine = _user_primary_group_name(user)
    if not mine:
        return None
    rows = list(
        db.scalars(select(ProjectCollectionPermission).where(ProjectCollectionPermission.collection_id == collection_id)).all()
    )
    levels = [r.permission_level for r in rows if (r.user_group_name or "").strip() == mine]
    return _max_level(levels)


def get_collection_permission_level(
    db: Session,
    *,
    user: User,
    collection: AssetCollection,
    perms: set[str],
) -> str | None:
    if collection.collection_type == "personal":
        if collection.owner_user_id != user.id:
            return None
        has_edit = "collection.edit_own" in perms or "collection.edit_all" in perms
        has_del = "collection.delete_own" in perms or "collection.delete_all" in perms
        if has_edit and has_del:
            return "manage"
        if has_edit:
            return "edit"
        if "collection.view" in perms:
            return "view"
        return None
    if collection.collection_type == "project":
        if user.role == "super_admin" or "collection.edit_all" in perms:
            return "manage"
        return _table_project_level(db, collection.id, user)
    return None


def _can_view_collection(
    db: Session,
    *,
    user: User,
    collection: AssetCollection,
    perms: set[str],
) -> bool:
    if collection.collection_type == "personal":
        if collection.owner_user_id != user.id:
            return False
        return "collection.view" in perms

    if user.role == "super_admin" or "collection.edit_all" in perms:
        return True
    if collection.status == "deleted":
        if "collection.delete_all" in perms:
            return True
        if _table_project_level(db, collection.id, user) == "manage":
            return "collection.view" in perms
        return False
    if _table_project_level(db, collection.id, user) is not None:
        return "collection.view" in perms
    return False


def _can_edit_items(
    db: Session,
    *,
    user: User,
    collection: AssetCollection,
    perms: set[str],
) -> bool:
    lv = get_collection_permission_level(db, user=user, collection=collection, perms=perms)
    if lv in {"edit", "manage"}:
        return True
    return False


def _can_patch_collection_meta(
    db: Session,
    *,
    user: User,
    collection: AssetCollection,
    perms: set[str],
) -> bool:
    if collection.collection_type == "personal":
        return collection.owner_user_id == user.id and (
            "collection.edit_own" in perms or "collection.edit_all" in perms
        )
    if user.role == "super_admin" or "collection.edit_all" in perms:
        return True
    lv = _table_project_level(db, collection.id, user)
    return lv == "manage"


def _can_manage_project_permissions(
    db: Session,
    *,
    user: User,
    collection: AssetCollection,
    perms: set[str],
) -> bool:
    if collection.collection_type != "project":
        return False
    if user.role == "super_admin" or "collection.edit_all" in perms:
        return True
    return _table_project_level(db, collection.id, user) == "manage"


def _can_delete_collection(
    db: Session,
    *,
    user: User,
    collection: AssetCollection,
    perms: set[str],
) -> bool:
    if collection.collection_type == "personal":
        return collection.owner_user_id == user.id and "collection.delete_own" in perms
    if user.role == "super_admin" or "collection.delete_all" in perms:
        return True
    lv = _table_project_level(db, collection.id, user)
    return lv == "manage"


def _can_archive_collection(
    db: Session,
    *,
    user: User,
    collection: AssetCollection,
    perms: set[str],
) -> bool:
    return _can_patch_collection_meta(db, user=user, collection=collection, perms=perms)


def _load_collection_or_404(db: Session, collection_id: str, *, library_id=None) -> AssetCollection:
    try:
        cid = uuid.UUID(collection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid collection id") from exc
    row = db.get(AssetCollection, cid)
    if row is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    if library_id is not None and row.library_id != library_id:
        raise HTTPException(status_code=404, detail="Collection not found")
    return row


def _serialize_permissions(db: Session, collection_id: uuid.UUID) -> list[dict[str, str]]:
    rows = list(
        db.scalars(
            select(ProjectCollectionPermission)
            .where(ProjectCollectionPermission.collection_id == collection_id)
            .order_by(ProjectCollectionPermission.user_group_name.asc())
        ).all()
    )
    return [{"user_group_name": r.user_group_name, "permission_level": r.permission_level} for r in rows]


def _item_count(db: Session, collection_id: uuid.UUID) -> int:
    return int(
        db.scalar(select(func.count()).select_from(AssetCollectionItem).where(AssetCollectionItem.collection_id == collection_id))
        or 0
    )


def list_groups_tree(
    db: Session,
    *,
    username: str,
    group_type: str,
    perms: set[str],
    library_id,
) -> list[dict[str, Any]]:
    user = get_user_by_username(db, username)
    if group_type not in {"personal", "project"}:
        raise HTTPException(status_code=400, detail="group_type must be personal or project")
    stmt = (
        select(AssetCollectionGroup)
        .where(
            AssetCollectionGroup.group_type == group_type,
            AssetCollectionGroup.status == "active",
            AssetCollectionGroup.library_id == library_id,
        )
        .order_by(AssetCollectionGroup.sort_order.asc(), AssetCollectionGroup.name.asc())
    )
    rows = list(db.scalars(stmt).all())
    visible: list[AssetCollectionGroup] = []
    for g in rows:
        if group_type == "personal" and _personal_group_visible(user=user, group=g):
            visible.append(g)
        elif group_type == "project" and _project_group_visible(db, user=user, group=g, perms=perms):
            visible.append(g)
    visible.sort(key=lambda x: (x.sort_order, x.name))
    # 产品模型：仅「分组 → 集合」两级；树 API 仍返回 { children } 但一律平铺、无嵌套展示
    return [
        {
            "id": str(g.id),
            "name": g.name,
            "group_type": g.group_type,
            "parent_id": str(g.parent_id) if g.parent_id else None,
            "user_group_name": g.user_group_name,
            "sort_order": g.sort_order,
            "children": [],
        }
        for g in visible
    ]


def create_group(
    db: Session,
    *,
    username: str,
    name: str,
    group_type: str,
    parent_id: str | None,
    user_group_name: str | None,
    perms: set[str],
    library_id,
) -> AssetCollectionGroup:
    user = get_user_by_username(db, username)
    if "collection.create" not in perms:
        raise HTTPException(status_code=403, detail="Missing permission: collection.create")
    if group_type not in {"personal", "project"}:
        raise HTTPException(status_code=400, detail="group_type must be personal or project")
    if group_type == "project":
        if user.role != "super_admin" and "collection.edit_all" not in perms:
            raise HTTPException(status_code=403, detail="Project group requires super admin or collection.edit_all")
    if parent_id and str(parent_id).strip():
        raise HTTPException(
            status_code=400,
            detail="分组仅单层：集合挂在分组下；不支持上级分组（请勿传 parent_id）",
        )
    pid: uuid.UUID | None = None
    row = AssetCollectionGroup(
        id=uuid.uuid4(),
        library_id=library_id,
        name=name.strip(),
        group_type=group_type,
        parent_id=pid,
        owner_user_id=user.id if group_type == "personal" else None,
        user_group_name=(user_group_name or "").strip() or None,
        sort_order=0,
        created_by=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def patch_group(
    db: Session,
    *,
    username: str,
    group_id: str,
    name: str | None,
    parent_id: Any,
    sort_order: int | None,
    user_group_name: str | None,
    perms: set[str],
) -> AssetCollectionGroup:
    user = get_user_by_username(db, username)
    if "collection.create" not in perms and "collection.edit_all" not in perms and user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Missing permission to edit groups")
    try:
        gid = uuid.UUID(group_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid group id") from exc
    row = db.get(AssetCollectionGroup, gid)
    if row is None:
        raise HTTPException(status_code=404, detail="Group not found")
    if row.status != "active":
        raise HTTPException(status_code=400, detail="Group is not active")
    if row.group_type == "personal" and row.owner_user_id != user.id:
        raise HTTPException(status_code=403, detail="Cannot edit this group")
    if row.group_type == "project" and not _project_group_visible(db, user=user, group=row, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot edit this group")
    if name is not None:
        row.name = name.strip()
    if sort_order is not None:
        row.sort_order = sort_order
    if user_group_name is not None and row.group_type == "project":
        row.user_group_name = (user_group_name or "").strip() or None
    if parent_id is not _PATCH_GROUP_PARENT_OMIT:
        if parent_id in (None, ""):
            row.parent_id = None
        else:
            raise HTTPException(
                status_code=400,
                detail="分组仅单层：不支持修改上级分组（可传 parent_id=null 解除历史嵌套）",
            )
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def delete_group(db: Session, *, username: str, group_id: str, perms: set[str]) -> None:
    user = get_user_by_username(db, username)
    try:
        gid = uuid.UUID(group_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid group id") from exc
    row = db.get(AssetCollectionGroup, gid)
    if row is None:
        raise HTTPException(status_code=404, detail="Group not found")
    if row.group_type == "personal" and row.owner_user_id != user.id:
        raise HTTPException(status_code=403, detail="Cannot delete this group")
    if row.group_type == "project" and not _project_group_visible(db, user=user, group=row, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot delete this group")
    if row.status != "active":
        raise HTTPException(status_code=400, detail="Group is not active")
    child = db.scalar(
        select(AssetCollectionGroup.id).where(
            AssetCollectionGroup.parent_id == gid,
            AssetCollectionGroup.status == "active",
        ).limit(1)
    )
    if child is not None:
        raise HTTPException(status_code=400, detail="Group has child groups")
    coll = db.scalar(
        select(AssetCollection.id)
        .where(
            AssetCollection.group_id == gid,
            AssetCollection.status != "deleted",
        )
        .limit(1)
    )
    if coll is not None:
        raise HTTPException(status_code=400, detail="Group still has collections")
    row.status = "deleted"
    row.updated_at = datetime.utcnow()
    db.commit()


def archive_group(db: Session, *, username: str, group_id: str, perms: set[str]) -> AssetCollectionGroup:
    user = get_user_by_username(db, username)
    try:
        gid = uuid.UUID(group_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid group id") from exc
    row = db.get(AssetCollectionGroup, gid)
    if row is None:
        raise HTTPException(status_code=404, detail="Group not found")
    if row.group_type == "personal" and row.owner_user_id != user.id:
        raise HTTPException(status_code=403, detail="Cannot archive this group")
    if row.group_type == "project" and not _project_group_visible(db, user=user, group=row, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot archive this group")
    if row.status != "active":
        raise HTTPException(status_code=400, detail="Group is not active")
    child = db.scalar(
        select(AssetCollectionGroup.id).where(
            AssetCollectionGroup.parent_id == gid,
            AssetCollectionGroup.status == "active",
        ).limit(1)
    )
    if child is not None:
        raise HTTPException(status_code=400, detail="Group has child groups")
    coll = db.scalar(
        select(AssetCollection.id)
        .where(
            AssetCollection.group_id == gid,
            AssetCollection.status != "deleted",
        )
        .limit(1)
    )
    if coll is not None:
        raise HTTPException(status_code=400, detail="Group still has collections")
    row.status = "archived"
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def restore_group(db: Session, *, username: str, group_id: str, perms: set[str]) -> AssetCollectionGroup:
    user = get_user_by_username(db, username)
    try:
        gid = uuid.UUID(group_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid group id") from exc
    row = db.get(AssetCollectionGroup, gid)
    if row is None:
        raise HTTPException(status_code=404, detail="Group not found")
    if row.group_type == "personal" and row.owner_user_id != user.id:
        raise HTTPException(status_code=403, detail="Cannot restore this group")
    if row.group_type == "project" and not _project_group_visible(db, user=user, group=row, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot restore this group")
    if row.status != "archived":
        raise HTTPException(status_code=400, detail="Group is not archived")
    row.status = "active"
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def list_collections(
    db: Session,
    *,
    username: str,
    collection_type: str | None,
    group_id: str | None,
    status: str | None,
    keyword: str | None,
    page: int,
    page_size: int,
    perms: set[str],
    for_item_edit: bool = False,
    library_id=None,
) -> tuple[list[dict[str, Any]], int]:
    user = get_user_by_username(db, username)
    stmt = select(AssetCollection)
    if library_id is not None:
        stmt = stmt.where(AssetCollection.library_id == library_id)
    if collection_type in {"personal", "project"}:
        stmt = stmt.where(AssetCollection.collection_type == collection_type)
    if group_id:
        try:
            gid = uuid.UUID(group_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid group_id") from exc
        stmt = stmt.where(AssetCollection.group_id == gid)
    if status in {"active", "archived", "deleted"}:
        stmt = stmt.where(AssetCollection.status == status)
    else:
        stmt = stmt.where(AssetCollection.status == "active")
    if keyword and keyword.strip():
        stmt = stmt.where(AssetCollection.name.ilike(f"%{keyword.strip()}%"))

    personal_ok = and_(AssetCollection.collection_type == "personal", AssetCollection.owner_user_id == user.id)
    is_collection_admin = "collection.edit_all" in perms or user.role == "super_admin"
    mine = _user_primary_group_name(user)
    if is_collection_admin:
        project_ok = AssetCollection.collection_type == "project"
    elif mine:
        sub_conds = [
            ProjectCollectionPermission.collection_id == AssetCollection.id,
            ProjectCollectionPermission.user_group_name == mine,
        ]
        if for_item_edit:
            sub_conds.append(ProjectCollectionPermission.permission_level.in_(["edit", "manage"]))
        subq = select(ProjectCollectionPermission.id).where(and_(*sub_conds)).exists()
        project_ok = and_(AssetCollection.collection_type == "project", subq)
    else:
        project_ok = and_(AssetCollection.collection_type == "project", False)
    stmt = stmt.where(or_(personal_ok, project_ok))

    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.scalar(count_stmt) or 0)
    stmt = stmt.order_by(AssetCollection.updated_at.desc())
    offset = (page - 1) * page_size
    rows = list(db.scalars(stmt.offset(offset).limit(page_size)).all())
    items: list[dict[str, Any]] = []
    for c in rows:
        creator = db.get(User, c.created_by) if c.created_by else None
        items.append(
            {
                "id": str(c.id),
                "name": c.name,
                "collection_type": c.collection_type,
                "group_id": str(c.group_id) if c.group_id else None,
                "status": c.status,
                "item_count": _item_count(db, c.id),
                "created_by_name": _user_label(creator),
                "created_at": c.created_at,
            }
        )
    return items, total


def create_collection(
    db: Session,
    *,
    username: str,
    name: str,
    description: str | None,
    collection_type: str,
    group_id: str | None,
    visibility: str | None,
    permissions: list[dict[str, str]] | None,
    perms: set[str],
    library_id,
) -> AssetCollection:
    user = get_user_by_username(db, username)
    if "collection.create" not in perms:
        raise HTTPException(status_code=403, detail="Missing permission: collection.create")
    if collection_type not in {"personal", "project"}:
        raise HTTPException(status_code=400, detail="collection_type must be personal or project")
    if group_id is None or not str(group_id).strip():
        raise HTTPException(status_code=400, detail="group_id is required")
    gid: uuid.UUID | None = None
    if group_id:
        try:
            gid = uuid.UUID(group_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid group_id") from exc
        g = db.get(AssetCollectionGroup, gid)
        if g is None or g.group_type != collection_type:
            raise HTTPException(status_code=400, detail="Invalid group")
        if g.library_id != library_id:
            raise HTTPException(status_code=400, detail="Group does not belong to current library")
        if collection_type == "personal" and g.owner_user_id != user.id:
            raise HTTPException(status_code=403, detail="Group not allowed")
        if collection_type == "project" and not _project_group_visible(db, user=user, group=g, perms=perms):
            raise HTTPException(status_code=403, detail="Group not allowed")
    vis = (visibility or ("team" if collection_type == "project" else "private")).strip()
    if collection_type == "personal":
        vis = "private"
    if vis not in {"private", "team"}:
        raise HTTPException(status_code=400, detail="Invalid visibility")
    perms_payload = permissions or []
    known_groups = set(list_user_groups(db))
    if collection_type == "project":
        if user.role != "super_admin" and not perms_payload:
            raise HTTPException(status_code=400, detail="Project collection requires at least one user group permission")
        for p in perms_payload:
            gname = (p.get("user_group_name") or "").strip()
            lv = (p.get("permission_level") or "").strip()
            if not gname or gname not in known_groups:
                raise HTTPException(status_code=400, detail=f"Invalid user_group_name: {gname}")
            if lv not in _LEVEL_ORDER:
                raise HTTPException(status_code=400, detail="Invalid permission_level")
    row = AssetCollection(
        id=uuid.uuid4(),
        library_id=library_id,
        name=name.strip(),
        description=(description or "").strip() or None,
        collection_type=collection_type,
        group_id=gid,
        owner_user_id=user.id if collection_type == "personal" else None,
        visibility=vis,
        status="active",
        created_by=user.id,
    )
    db.add(row)
    db.flush()
    if collection_type == "project":
        for p in perms_payload:
            db.add(
                ProjectCollectionPermission(
                    id=uuid.uuid4(),
                    collection_id=row.id,
                    user_group_name=(p.get("user_group_name") or "").strip(),
                    permission_level=(p.get("permission_level") or "").strip(),
                )
            )
    db.commit()
    db.refresh(row)
    return row


def get_collection_detail(
    db: Session,
    *,
    username: str,
    collection_id: str,
    perms: set[str],
) -> dict[str, Any]:
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if not _can_view_collection(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot view this collection")
    level = get_collection_permission_level(db, user=user, collection=c, perms=perms)
    creator = db.get(User, c.created_by) if c.created_by else None
    out: dict[str, Any] = {
        "id": str(c.id),
        "name": c.name,
        "description": c.description,
        "collection_type": c.collection_type,
        "group_id": str(c.group_id) if c.group_id else None,
        "status": c.status,
        "visibility": c.visibility,
        "permission_level": level,
        "item_count": _item_count(db, c.id),
        "created_by_name": _user_label(creator),
        "created_at": c.created_at,
        "permissions": _serialize_permissions(db, c.id) if c.collection_type == "project" else [],
    }
    return out


def patch_collection(
    db: Session,
    *,
    username: str,
    collection_id: str,
    name: str | None,
    description: str | None,
    group_id: str | None,
    status: str | None,
    visibility: str | None,
    permissions: list[dict[str, str]] | None,
    perms: set[str],
) -> AssetCollection:
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if not _can_patch_collection_meta(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot edit collection metadata")
    if name is not None:
        c.name = name.strip()
    if description is not None:
        c.description = (description or "").strip() or None
    if visibility is not None and c.collection_type != "personal":
        v = visibility.strip()
        if v not in {"private", "team"}:
            raise HTTPException(status_code=400, detail="Invalid visibility")
        c.visibility = v
    if status is not None:
        st = status.strip()
        if st not in {"active", "archived", "deleted"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        c.status = st
    if group_id is not None:
        if group_id == "":
            c.group_id = None
        else:
            try:
                gid = uuid.UUID(group_id)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid group_id") from exc
            g = db.get(AssetCollectionGroup, gid)
            if g is None or g.group_type != c.collection_type:
                raise HTTPException(status_code=400, detail="Invalid group")
            if c.collection_type == "personal" and g.owner_user_id != user.id:
                raise HTTPException(status_code=403, detail="Group not allowed")
            if c.collection_type == "project" and not _project_group_visible(db, user=user, group=g, perms=perms):
                raise HTTPException(status_code=403, detail="Group not allowed")
            c.group_id = gid
    if permissions is not None and c.collection_type == "project":
        if not _can_manage_project_permissions(db, user=user, collection=c, perms=perms):
            raise HTTPException(status_code=403, detail="Cannot manage project permissions")
        if not permissions and user.role != "super_admin":
            raise HTTPException(status_code=400, detail="Project collection requires at least one user group permission")
        known_groups = set(list_user_groups(db))
        for p in permissions:
            gname = (p.get("user_group_name") or "").strip()
            lv = (p.get("permission_level") or "").strip()
            if not gname or gname not in known_groups:
                raise HTTPException(status_code=400, detail=f"Invalid user_group_name: {gname}")
            if lv not in _LEVEL_ORDER:
                raise HTTPException(status_code=400, detail="Invalid permission_level")
        db.query(ProjectCollectionPermission).filter(ProjectCollectionPermission.collection_id == c.id).delete(
            synchronize_session=False
        )
        for p in permissions:
            db.add(
                ProjectCollectionPermission(
                    id=uuid.uuid4(),
                    collection_id=c.id,
                    user_group_name=(p.get("user_group_name") or "").strip(),
                    permission_level=(p.get("permission_level") or "").strip(),
                )
            )
    if c.collection_type == "personal":
        c.visibility = "private"
    c.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(c)
    return c


def archive_collection(db: Session, *, username: str, collection_id: str, perms: set[str]) -> AssetCollection:
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if not _can_archive_collection(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot archive collection")
    c.status = "archived"
    c.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(c)
    return c


def restore_collection(db: Session, *, username: str, collection_id: str, perms: set[str]) -> AssetCollection:
    """将已归档集合恢复为 active（与归档同一套元数据编辑权限）。"""
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if c.status != "archived":
        raise HTTPException(status_code=400, detail="Collection is not archived")
    if not _can_archive_collection(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot restore collection")
    c.status = "active"
    c.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(c)
    return c


def soft_delete_collection(db: Session, *, username: str, collection_id: str, perms: set[str]) -> None:
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if not _can_delete_collection(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot delete collection")
    c.status = "deleted"
    c.updated_at = datetime.utcnow()
    db.commit()


def _file_matches_file_type(ext: str | None, file_type: str | None) -> bool:
    if not file_type or not file_type.strip():
        return True
    ft = file_type.strip().lower()
    e = _norm_ext(ext) or ""
    if ft in {"video", "image", "audio"}:
        if ft == "video":
            return e in _VIDEO_EXTS
        if ft == "image":
            return e in _IMAGE_EXTS
        if ft == "audio":
            return e in _AUDIO_EXTS
    return e == ft.lstrip(".")


def _item_row_extension(db: Session, it: AssetCollectionItem) -> str | None:
    mf: MaterialFile | None = None
    if it.material_file_id:
        mf = db.get(MaterialFile, it.material_file_id)
    if mf is None:
        mf = db.scalar(
            select(MaterialFile)
            .where(MaterialFile.material_id == it.material_id)
            .order_by(MaterialFile.created_at.asc())
            .limit(1)
        )
    return mf.extension if mf else None


def list_collection_materials(
    db: Session,
    *,
    username: str,
    collection_id: str,
    keyword: str | None,
    file_type: str | None,
    page: int,
    page_size: int,
    sort: str,
    perms: set[str],
) -> tuple[list[dict[str, Any]], int]:
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if not _can_view_collection(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot view this collection")
    base = select(AssetCollectionItem).where(AssetCollectionItem.collection_id == c.id)
    material_joined = False
    if keyword and keyword.strip():
        kw = f"%{keyword.strip()}%"
        base = base.join(Material, Material.id == AssetCollectionItem.material_id).where(Material.title.ilike(kw))
        material_joined = True
    elif sort == "created_at":
        base = base.join(Material, Material.id == AssetCollectionItem.material_id)
        material_joined = True

    if file_type and file_type.strip():
        rows_all = list(db.scalars(base).all())
        filtered = [it for it in rows_all if _file_matches_file_type(_item_row_extension(db, it), file_type)]
        total = len(filtered)

        def sort_key_row(it: AssetCollectionItem) -> Any:
            if sort == "added_at":
                return it.added_at
            if sort == "created_at":
                m = db.get(Material, it.material_id)
                return m.created_at if m else datetime.min
            return it.sort_order

        reverse = sort in {"added_at", "created_at"}
        filtered.sort(key=sort_key_row, reverse=reverse)
        off = (page - 1) * page_size
        page_rows = filtered[off : off + page_size]
        return _serialize_item_rows(db, page_rows), total

    if sort == "sort_order" or sort not in {"added_at", "created_at"}:
        base = base.order_by(AssetCollectionItem.sort_order.asc(), AssetCollectionItem.added_at.desc())
    elif sort == "added_at":
        base = base.order_by(AssetCollectionItem.added_at.desc())
    else:
        if not material_joined:
            base = base.join(Material, Material.id == AssetCollectionItem.material_id)
        base = base.order_by(Material.created_at.desc())

    count_stmt = select(func.count()).select_from(base.order_by(None).subquery())
    total = int(db.scalar(count_stmt) or 0)
    off = (page - 1) * page_size
    rows = list(db.scalars(base.offset(off).limit(page_size)).all())
    return _serialize_item_rows(db, rows), total


def _serialize_item_rows(db: Session, rows: list[AssetCollectionItem]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for it in rows:
        m = db.get(Material, it.material_id)
        if m is None:
            continue
        mf: MaterialFile | None = None
        if it.material_file_id:
            mf = db.get(MaterialFile, it.material_file_id)
        if mf is None:
            mf = db.scalar(
                select(MaterialFile).where(MaterialFile.material_id == m.id).order_by(MaterialFile.created_at.asc()).limit(1)
            )
        meta = dict(mf.extra_metadata or {}) if mf and isinstance(mf.extra_metadata, dict) else {}
        uw, uh = _meta_media_dimensions(meta)
        thumb = str(meta.get("thumbnail_path") or "").strip() or None
        ext = _norm_ext(mf.extension) if mf else None
        ftype = "other"
        if ext in _VIDEO_EXTS:
            ftype = "video"
        elif ext in _IMAGE_EXTS:
            ftype = "image"
        elif ext in _AUDIO_EXTS:
            ftype = "audio"
        adder = db.get(User, it.added_by) if it.added_by else None
        out.append(
            {
                "item_id": str(it.id),
                "material_id": str(it.material_id),
                "material_file_id": str(it.material_file_id) if it.material_file_id else None,
                "primary_file_id": str(mf.id) if mf else None,
                "title": m.title,
                "description": m.description,
                "thumbnail_url": thumb,
                "file_type": ftype,
                "tags": _resolve_tag_names(db, m.id),
                "note": it.note,
                "sort_order": it.sort_order,
                "added_by_name": _user_label(adder),
                "added_at": it.added_at,
                "original_filename": mf.original_filename if mf else None,
                "file_size": int(mf.file_size) if mf and mf.file_size is not None else None,
                "primary_media_width": uw,
                "primary_media_height": uh,
                "download_count": int(m.download_count or 0),
                "material_status": m.status,
            }
        )
    return out


def add_collection_item(
    db: Session,
    *,
    username: str,
    collection_id: str,
    material_id: str,
    material_file_id: str | None,
    note: str | None,
    perms: set[str],
) -> tuple[str, bool]:
    """Returns (item_id, created_new)."""
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if not _can_edit_items(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot edit collection items")
    mat = get_material(db, material_id, only_available=True)
    if mat.library_id != c.library_id:
        raise HTTPException(status_code=400, detail="Cannot collect material across libraries")
    fid: uuid.UUID | None = None
    if material_file_id:
        fr = get_material_file(db, material_id, material_file_id)
        fid = fr.id
    existing = db.scalar(
        select(AssetCollectionItem).where(
            AssetCollectionItem.collection_id == c.id,
            AssetCollectionItem.material_id == mat.id,
            AssetCollectionItem.material_file_id == fid,
        )
    )
    if existing is not None:
        return str(existing.id), False
    max_sort = db.scalar(select(func.max(AssetCollectionItem.sort_order)).where(AssetCollectionItem.collection_id == c.id))
    next_order = int(max_sort or 0) + 10
    row = AssetCollectionItem(
        id=uuid.uuid4(),
        collection_id=c.id,
        material_id=mat.id,
        material_file_id=fid,
        note=(note or "").strip() or None,
        sort_order=next_order,
        added_by=user.id,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing2 = db.scalar(
            select(AssetCollectionItem).where(
                AssetCollectionItem.collection_id == c.id,
                AssetCollectionItem.material_id == mat.id,
                AssetCollectionItem.material_file_id == fid,
            )
        )
        if existing2 is None:
            raise
        return str(existing2.id), False
    db.refresh(row)
    return str(row.id), True


def add_collection_items_batch(
    db: Session,
    *,
    username: str,
    collection_id: str,
    items: list[dict[str, Any]],
    perms: set[str],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for it in items:
        mid = str(it.get("material_id") or "")
        mfid = it.get("material_file_id")
        mfid_s = str(mfid) if mfid else None
        note = it.get("note")
        iid, created = add_collection_item(
            db,
            username=username,
            collection_id=collection_id,
            material_id=mid,
            material_file_id=mfid_s,
            note=str(note) if note is not None else None,
            perms=perms,
        )
        results.append({"material_id": mid, "item_id": iid, "created": created})
    return results


def patch_collection_item(
    db: Session,
    *,
    username: str,
    collection_id: str,
    item_id: str,
    note: str | None,
    sort_order: int | None,
    perms: set[str],
) -> AssetCollectionItem:
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if not _can_edit_items(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot edit collection items")
    try:
        iid = uuid.UUID(item_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid item id") from exc
    row = db.get(AssetCollectionItem, iid)
    if row is None or row.collection_id != c.id:
        raise HTTPException(status_code=404, detail="Item not found")
    if note is not None:
        row.note = (note or "").strip() or None
    if sort_order is not None:
        row.sort_order = sort_order
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def delete_collection_item(
    db: Session,
    *,
    username: str,
    collection_id: str,
    item_id: str,
    perms: set[str],
) -> None:
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if not _can_edit_items(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot edit collection items")
    try:
        iid = uuid.UUID(item_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid item id") from exc
    row = db.get(AssetCollectionItem, iid)
    if row is None or row.collection_id != c.id:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(row)
    db.commit()


def reorder_collection_items(
    db: Session,
    *,
    username: str,
    collection_id: str,
    items: list[dict[str, Any]],
    perms: set[str],
) -> None:
    user = get_user_by_username(db, username)
    c = _load_collection_or_404(db, collection_id)
    if not _can_edit_items(db, user=user, collection=c, perms=perms):
        raise HTTPException(status_code=403, detail="Cannot edit collection items")
    for it in items:
        try:
            iid = uuid.UUID(str(it.get("item_id")))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid item_id") from exc
        row = db.get(AssetCollectionItem, iid)
        if row is None or row.collection_id != c.id:
            raise HTTPException(status_code=404, detail=f"Item not found: {iid}")
        row.sort_order = int(it.get("sort_order", 0))
        row.updated_at = datetime.utcnow()
    db.commit()


def collect_material_to_collection(
    db: Session,
    *,
    username: str,
    material_id: str,
    collection_id: str,
    material_file_id: str | None,
    note: str | None,
    perms: set[str],
) -> tuple[str, bool]:
    get_material(db, material_id, only_available=True)
    return add_collection_item(
        db,
        username=username,
        collection_id=collection_id,
        material_id=material_id,
        material_file_id=material_file_id,
        note=note,
        perms=perms,
    )
