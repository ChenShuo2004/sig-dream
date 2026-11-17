import hashlib
import uuid
from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.operation_log import OperationLog
from app.models.system_settings import Permission, Role, RolePermission, SystemConfig, UserRole
from app.models.user import User

ROLE_DEFINITIONS = [
    {"id": 1, "code": "super_admin", "name": "超级管理员", "level": 1, "is_system": True, "description": "平台最高权限角色"},
    {"id": 2, "code": "material_admin", "name": "素材管理员", "level": 2, "is_system": True, "description": "素材与标签管理角色"},
    {"id": 3, "code": "member", "name": "普通成员", "level": 3, "is_system": True, "description": "日常协作角色"},
    {"id": 4, "code": "external_collaborator", "name": "外部协作者", "level": 4, "is_system": True, "description": "外协只读协作角色"},
]

PERMISSION_POINTS = [
    {"module": "用户与系统", "code": "user.manage", "name": "用户管理", "description": "管理系统用户"},
    {"module": "用户与系统", "code": "role.manage", "name": "角色管理", "description": "配置角色权限"},
    {"module": "用户与系统", "code": "system.setting.manage", "name": "系统参数管理", "description": "修改平台级策略"},
    {"module": "标签管理", "code": "tag.view", "name": "查看标签", "description": "查看标签列表"},
    {"module": "标签管理", "code": "tag.create", "name": "新增标签", "description": "创建新标签"},
    {"module": "标签管理", "code": "tag.edit", "name": "编辑标签", "description": "修改标签信息"},
    {"module": "标签管理", "code": "tag.disable", "name": "停用标签", "description": "停用标签"},
    {"module": "标签管理", "code": "tag.merge", "name": "合并标签", "description": "合并重复标签"},
    {"module": "标签管理", "code": "tag.delete", "name": "删除标签", "description": "删除标签"},
    {"module": "标签管理", "code": "tag.request", "name": "申请标签", "description": "提交标签申请"},
    {"module": "标签管理", "code": "tag.review", "name": "审核标签申请", "description": "审核标签申请"},
    {"module": "素材资产", "code": "asset.view", "name": "查看素材", "description": "查看素材内容"},
    {"module": "素材资产", "code": "asset.upload", "name": "上传素材", "description": "上传素材文件"},
    {"module": "素材资产", "code": "asset.download", "name": "下载素材", "description": "下载素材文件"},
    {"module": "素材资产", "code": "asset.batch_download", "name": "批量下载", "description": "批量下载素材"},
    {"module": "素材资产", "code": "asset.edit_own", "name": "编辑自己上传素材", "description": "编辑自己上传的素材"},
    {"module": "素材资产", "code": "asset.edit_all", "name": "编辑全部素材", "description": "编辑全部素材"},
    {"module": "素材资产", "code": "asset.delete_own", "name": "移入自己上传素材到回收站", "description": "将自己上传的素材移入回收站"},
    {"module": "素材资产", "code": "asset.delete_all", "name": "移入所有素材到回收站", "description": "将任意素材移入回收站"},
    {"module": "素材资产", "code": "asset.restore_own", "name": "回收站恢复自己上传的素材", "description": "从回收站恢复自己上传的素材"},
    {"module": "素材资产", "code": "asset.restore_all", "name": "回收站恢复所有素材", "description": "从回收站恢复任意素材"},
    {"module": "素材资产", "code": "asset.permanent_delete", "name": "回收站永久删除素材", "description": "从回收站彻底删除素材"},
    {"module": "素材集合", "code": "collection.view", "name": "查看集合", "description": "查看素材集合"},
    {"module": "素材集合", "code": "collection.create", "name": "创建集合", "description": "创建素材集合"},
    {"module": "素材集合", "code": "collection.edit_own", "name": "编辑自己集合", "description": "编辑自己创建的集合"},
    {"module": "素材集合", "code": "collection.edit_all", "name": "编辑全部集合", "description": "编辑任意集合"},
    {"module": "素材集合", "code": "collection.delete_own", "name": "删除自己集合", "description": "删除自己创建的集合"},
    {"module": "素材集合", "code": "collection.delete_all", "name": "删除全部集合", "description": "删除任意集合"},
    {"module": "操作日志", "code": "log.view", "name": "查看操作日志", "description": "查看系统操作日志"},
    {"module": "画布工作室", "code": "studio.use", "name": "使用画布工作室", "description": "使用剧本、复刻、替换工作室并管理自己的工作室项目"},
]

DEPRECATED_PERMISSION_CODES = {"trash.permanent_delete", "trash.view", "trash.restore"}
ASSET_TRASH_PERMISSION_COPY = {
    "asset.delete_own": ("移入自己上传素材到回收站", "将自己上传的素材移入回收站"),
    "asset.delete_all": ("移入所有素材到回收站", "将任意素材移入回收站"),
    "asset.restore_own": ("回收站恢复自己上传的素材", "从回收站恢复自己上传的素材"),
    "asset.restore_all": ("回收站恢复所有素材", "从回收站恢复任意素材"),
    "asset.permanent_delete": ("回收站永久删除素材", "从回收站彻底删除素材"),
}

ALL_PERMISSION_CODES = [p["code"] for p in PERMISSION_POINTS]

DEFAULT_ROLE_PERMISSIONS = {
    "super_admin": list(ALL_PERMISSION_CODES),
    "material_admin": [
        "tag.view", "tag.create", "tag.edit", "tag.disable", "tag.merge", "tag.delete", "tag.request", "tag.review",
        "asset.view", "asset.upload", "asset.download", "asset.batch_download", "asset.edit_own", "asset.edit_all",
        "asset.delete_own", "asset.delete_all", "asset.restore_own", "asset.restore_all", "asset.permanent_delete",
        "collection.view", "collection.create", "collection.edit_own", "collection.edit_all", "collection.delete_own", "collection.delete_all", "log.view",
        "studio.use",
    ],
    "member": [
        "tag.view", "tag.request", "asset.view", "asset.upload", "asset.download", "asset.batch_download",
        "asset.edit_own", "asset.delete_own", "asset.restore_own", "collection.view", "collection.create", "collection.edit_own", "collection.delete_own",
    ],
    "external_collaborator": ["asset.view", "asset.download", "asset.delete_own", "asset.restore_own", "collection.view"],
}

DEFAULT_SETTINGS = {
    "security_policy": {
        "public_forbid_asset_delete": True,
        "public_forbid_asset_permanent_delete": True,
        "public_forbid_role_manage": True,
        "public_forbid_system_setting_manage": True,
        "public_forbid_user_manage": True,
        "login_lock_enabled": True,
        "login_failed_limit": 5,
        "login_lock_minutes": 30,
        "maintenance_mode_enabled": False,
        "maintenance_announcement": "",
        "maintenance_announcement_published": False,
        "maintenance_started_at": None,
        "maintenance_started_by": None,
    },
    "storage_upload_policy": {
        "single_file_size_limit_gb": 10,
        "chunk_size_mb": 50,
        "allowed_file_types": ["视频", "图片", "音频", "文档"],
        "default_storage": "NAS",
        "originals_path": "/NAS/material-assets/originals",
        "thumbnails_path": "/NAS/material-assets/thumbnails",
        "previews_path": "/NAS/material-assets/previews",
        "trash_path": "/NAS/material-assets/trash",
        "auto_generate_thumbnail": True,
        "auto_generate_preview": True,
        "duplicate_file_strategy": "提示并禁止重复入库",
        "same_name_diff_hash_strategy": "允许上传并提醒",
    },
    "trash_download_policy": {
        "trash_retention_days": 30,
        "auto_clean_trash": True,
        "keep_selected_assets": True,
        "keep_referenced_assets": True,
        "keep_risk_assets": True,
        "keep_reviewing_assets": True,
        "download_log_required": True,
        "batch_download_log_required": True,
        "download_count_usage_enabled": True,
        "batch_download_count_each_asset": True,
    },
}
USER_GROUPS_KEY = "user_groups"
DEFAULT_USER_GROUPS = ["默认分组"]


def _hash_password(raw_password: str) -> str:
    return hashlib.md5(raw_password.encode("utf-8")).hexdigest()


def _require_role(db: Session, code: str) -> Role:
    role = db.scalar(select(Role).where(Role.code == code))
    if role is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Role not initialized: {code}")
    return role


def ensure_settings_seeded(db: Session) -> None:
    existing_roles = {r.code for r in db.scalars(select(Role)).all()}
    for item in ROLE_DEFINITIONS:
        if item["code"] not in existing_roles:
            db.add(Role(**item))

    existing_permissions = {p.code for p in db.scalars(select(Permission)).all()}
    for point in PERMISSION_POINTS:
        if point["code"] not in existing_permissions:
            db.add(Permission(**point))
    db.commit()
    # Keep permission display copy consistent with current business semantics.
    for code, (name, description) in ASSET_TRASH_PERMISSION_COPY.items():
        row = db.scalar(select(Permission).where(Permission.code == code))
        if row is not None and (row.name != name or row.description != description):
            row.name = name
            row.description = description
            db.add(row)
    db.commit()
    deprecated_perm_rows = list(
        db.scalars(select(Permission).where(Permission.code.in_(DEPRECATED_PERMISSION_CODES))).all()
    )
    if deprecated_perm_rows:
        deprecated_perm_ids = [perm.id for perm in deprecated_perm_rows]
        db.query(RolePermission).filter(RolePermission.permission_id.in_(deprecated_perm_ids)).delete(
            synchronize_session=False
        )
        db.query(Permission).filter(Permission.id.in_(deprecated_perm_ids)).delete(
            synchronize_session=False
        )
        db.commit()

    role_code_to_id = {r.code: r.id for r in db.scalars(select(Role)).all()}
    perm_code_to_id = {p.code: p.id for p in db.scalars(select(Permission)).all()}
    existing_pairs = {(rp.role_id, str(rp.permission_id)) for rp in db.scalars(select(RolePermission)).all()}
    role_has_any_permission = {rid for rid, _ in existing_pairs}

    for role_code, perm_codes in DEFAULT_ROLE_PERMISSIONS.items():
        rid = role_code_to_id.get(role_code)
        if rid is None:
            continue
        # 仅在该角色没有任何权限记录时注入默认权限，避免覆盖后续人工配置。
        if rid in role_has_any_permission:
            continue
        for code in perm_codes:
            pid = perm_code_to_id.get(code)
            if pid is None:
                continue
            key = (rid, str(pid))
            if key not in existing_pairs:
                db.add(RolePermission(id=uuid.uuid4(), role_id=rid, permission_id=pid))
                # Track it so the backfills below don't insert the same pair again on a fresh database.
                existing_pairs.add(key)

    # Backfill: ensure material_admin always has tag.delete (for delete/permanent-delete tag operations).
    material_admin_rid = role_code_to_id.get("material_admin")
    tag_delete_pid = perm_code_to_id.get("tag.delete")
    if material_admin_rid is not None and tag_delete_pid is not None:
        key = (material_admin_rid, str(tag_delete_pid))
        if key not in existing_pairs:
            db.add(RolePermission(id=uuid.uuid4(), role_id=material_admin_rid, permission_id=tag_delete_pid))

    studio_use_pid = perm_code_to_id.get("studio.use")
    if material_admin_rid is not None and studio_use_pid is not None:
        key = (material_admin_rid, str(studio_use_pid))
        if key not in existing_pairs:
            db.add(RolePermission(id=uuid.uuid4(), role_id=material_admin_rid, permission_id=studio_use_pid))

    # Backfill: ensure external_collaborator can trash/restore own materials.
    external_rid = role_code_to_id.get("external_collaborator")
    ext_delete_own_pid = perm_code_to_id.get("asset.delete_own")
    ext_restore_own_pid = perm_code_to_id.get("asset.restore_own")
    if external_rid is not None:
        if ext_delete_own_pid is not None:
            key = (external_rid, str(ext_delete_own_pid))
            if key not in existing_pairs:
                db.add(RolePermission(id=uuid.uuid4(), role_id=external_rid, permission_id=ext_delete_own_pid))
        if ext_restore_own_pid is not None:
            key = (external_rid, str(ext_restore_own_pid))
            if key not in existing_pairs:
                db.add(RolePermission(id=uuid.uuid4(), role_id=external_rid, permission_id=ext_restore_own_pid))

    existing_configs = {c.key for c in db.scalars(select(SystemConfig)).all()}
    for key, value in DEFAULT_SETTINGS.items():
        if key not in existing_configs:
            db.add(SystemConfig(key=key, value=value))
    if USER_GROUPS_KEY not in existing_configs:
        db.add(SystemConfig(key=USER_GROUPS_KEY, value={"groups": list(DEFAULT_USER_GROUPS)}))

    db.commit()


def get_user_permissions(db: Session, username: str) -> set[str]:
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.is_active:
        return set()
    role = db.scalar(select(Role).where(Role.code == user.role))
    if role is None:
        return set()
    stmt = (
        select(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role_id == role.id)
    )
    codes = set(db.scalars(stmt).all())
    if user.role == "super_admin":
        return set(ALL_PERMISSION_CODES)
    return codes


def ensure_permission(db: Session, username: str, permission_code: str) -> None:
    perms = get_user_permissions(db, username)
    if permission_code not in perms:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Missing permission: {permission_code}")


def ensure_not_last_super_admin(db: Session, target_user_id: str, next_role: str | None = None, next_status: str | None = None) -> None:
    user = db.get(User, target_user_id)
    if user is None:
        return
    will_not_be_super = next_role is not None and next_role != "super_admin"
    will_be_disabled = next_status is not None and next_status != "active"
    if user.role != "super_admin":
        return
    if not will_not_be_super and not will_be_disabled:
        return

    active_super_admin_count = (
        db.query(User)
        .filter(User.role == "super_admin", User.is_active.is_(True), User.id != user.id)
        .count()
    )
    if active_super_admin_count <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove or disable the last active super admin")


def get_permissions() -> list[dict]:
    return PERMISSION_POINTS


def get_roles(db: Session) -> list[dict]:
    ensure_settings_seeded(db)
    roles = db.scalars(select(Role).order_by(Role.level.asc())).all()
    perm_rows = db.execute(
        select(RolePermission.role_id, Permission.code)
        .join(Permission, Permission.id == RolePermission.permission_id)
    ).all()
    role_to_permissions: dict[int, list[str]] = defaultdict(list)
    for role_id, code in perm_rows:
        role_to_permissions[int(role_id)].append(str(code))

    result: list[dict] = []
    for role in roles:
        perms = sorted(set(role_to_permissions.get(role.id, [])))
        if role.code == "super_admin":
            perms = list(ALL_PERMISSION_CODES)
        result.append(
            {
                "id": role.code,
                "name": role.name,
                "level": role.level,
                "is_system": role.is_system,
                "permissions": perms,
            }
        )
    return result


def update_role_permissions(db: Session, role_code: str, permissions: list[str]) -> dict:
    ensure_settings_seeded(db)
    if role_code == "super_admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Super admin permissions cannot be modified")
    role = _require_role(db, role_code)
    valid_codes = {p.code: p.id for p in db.scalars(select(Permission)).all()}
    cleaned = sorted({p for p in permissions if p in valid_codes})

    db.query(RolePermission).filter(RolePermission.role_id == role.id).delete(synchronize_session=False)
    for code in cleaned:
        db.add(RolePermission(id=uuid.uuid4(), role_id=role.id, permission_id=valid_codes[code]))
    db.commit()

    role_item = next((item for item in get_roles(db) if item["id"] == role_code), None)
    if role_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role_item


def get_settings(db: Session) -> dict:
    ensure_settings_seeded(db)
    rows = db.scalars(select(SystemConfig)).all()
    merged = {"security_policy": {}, "storage_upload_policy": {}, "trash_download_policy": {}}
    for row in rows:
        if row.key in merged:
            merged[row.key] = row.value
    for key, default_value in DEFAULT_SETTINGS.items():
        if not merged[key]:
            merged[key] = default_value
    return merged


def update_settings(db: Session, payload: dict, updated_by_username: str | None = None) -> dict:
    ensure_settings_seeded(db)
    updater = None
    if updated_by_username:
        updater = db.scalar(select(User).where(User.username == updated_by_username))

    for key in ["security_policy", "storage_upload_policy", "trash_download_policy"]:
        if key not in payload or not isinstance(payload[key], dict):
            continue
        row = db.get(SystemConfig, key)
        if row is None:
            row = SystemConfig(key=key, value=payload[key])
        else:
            row.value = payload[key]
        row.updated_by = updater.id if updater else row.updated_by
        db.add(row)
    db.commit()
    return get_settings(db)


def get_maintenance_status(db: Session) -> dict:
    current = get_settings(db)
    sec = current.get("security_policy", {}) if isinstance(current, dict) else {}
    return {
        "enabled": bool(sec.get("maintenance_mode_enabled", False)),
        "announcement": str(sec.get("maintenance_announcement", "") or ""),
        "announcement_published": bool(sec.get("maintenance_announcement_published", False)),
        "started_at": sec.get("maintenance_started_at"),
        "started_by": sec.get("maintenance_started_by"),
    }


def set_maintenance_mode(
    db: Session,
    *,
    enabled: bool,
    announcement: str | None = None,
    operator_username: str | None = None,
) -> dict:
    all_settings = get_settings(db)
    sec = dict(all_settings.get("security_policy", {}))
    current_announcement = str(sec.get("maintenance_announcement", "") or "")
    sec["maintenance_mode_enabled"] = enabled
    sec["maintenance_announcement"] = current_announcement if announcement is None else (announcement or "").strip()
    sec["maintenance_started_at"] = None if not enabled else datetime.utcnow().isoformat()
    sec["maintenance_started_by"] = None if not enabled else (operator_username or "")
    update_settings(db, {"security_policy": sec}, updated_by_username=operator_username)
    return get_maintenance_status(db)


def set_maintenance_announcement(
    db: Session,
    *,
    announcement: str,
    published: bool,
    operator_username: str | None = None,
) -> dict:
    all_settings = get_settings(db)
    sec = dict(all_settings.get("security_policy", {}))
    sec["maintenance_announcement"] = (announcement or "").strip()
    sec["maintenance_announcement_published"] = bool(published)
    update_settings(db, {"security_policy": sec}, updated_by_username=operator_username)
    return get_maintenance_status(db)


def list_users(db: Session) -> list[User]:
    return db.query(User).order_by(User.created_at.desc()).all()


def _get_user_groups(db: Session) -> list[str]:
    ensure_settings_seeded(db)
    row = db.get(SystemConfig, USER_GROUPS_KEY)
    if row is None or not isinstance(row.value, dict):
        return list(DEFAULT_USER_GROUPS)
    groups = row.value.get("groups", [])
    if not isinstance(groups, list):
        return list(DEFAULT_USER_GROUPS)
    cleaned = sorted({str(x).strip() for x in groups if str(x).strip()})
    return cleaned or list(DEFAULT_USER_GROUPS)


def list_user_groups(db: Session) -> list[str]:
    return _get_user_groups(db)


def create_user_group(db: Session, group_name: str) -> list[str]:
    ensure_settings_seeded(db)
    name = (group_name or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="group_name is required")
    row = db.get(SystemConfig, USER_GROUPS_KEY)
    groups = _get_user_groups(db)
    if name in groups:
        return groups
    groups.append(name)
    groups = sorted(set(groups))
    if row is None:
        row = SystemConfig(key=USER_GROUPS_KEY, value={"groups": groups})
    else:
        row.value = {"groups": groups}
    db.add(row)
    db.commit()
    return groups


def delete_user_group(db: Session, group_name: str) -> list[str]:
    ensure_settings_seeded(db)
    name = (group_name or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="group_name is required")
    if db.query(User).filter(User.display_name == name).count() > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group is in use by users")
    row = db.get(SystemConfig, USER_GROUPS_KEY)
    groups = [g for g in _get_user_groups(db) if g != name]
    if not groups:
        groups = list(DEFAULT_USER_GROUPS)
    if row is None:
        row = SystemConfig(key=USER_GROUPS_KEY, value={"groups": groups})
    else:
        row.value = {"groups": groups}
    db.add(row)
    db.commit()
    return sorted(set(groups))


def create_user(db: Session, username: str, group_name: str, password: str, role: str, status_value: str) -> User:
    ensure_settings_seeded(db)
    exists = db.query(User).filter(User.username == username.strip()).one_or_none()
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")

    role_obj = _require_role(db, role)
    if group_name.strip() not in _get_user_groups(db):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group not found")
    user = User(
        username=username.strip(),
        display_name=group_name.strip(),
        password_hash=_hash_password(password),
        role=role,
        is_active=status_value == "active",
    )
    db.add(user)
    db.flush()
    db.add(UserRole(id=uuid.uuid4(), user_id=user.id, role_id=role_obj.id))
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user_id: str, group_name: str | None, role: str | None, status_value: str | None) -> User:
    ensure_settings_seeded(db)
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if group_name is not None:
        if group_name.strip() not in _get_user_groups(db):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group not found")
        user.display_name = group_name.strip()

    if role is not None:
        _require_role(db, role)
        ensure_not_last_super_admin(db, target_user_id=str(user.id), next_role=role)
        user.role = role
        db.query(UserRole).filter(UserRole.user_id == user.id).delete(synchronize_session=False)
        role_obj = _require_role(db, role)
        db.add(UserRole(id=uuid.uuid4(), user_id=user.id, role_id=role_obj.id))

    if status_value is not None:
        ensure_not_last_super_admin(db, target_user_id=str(user.id), next_status=status_value)
        user.is_active = status_value == "active"

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def reset_user_password(db: Session, user_id: str, new_password: str) -> None:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if len(new_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 6 characters")
    user.password_hash = _hash_password(new_password)
    user.failed_login_count = 0
    user.locked_until = None
    db.add(user)
    db.commit()


def delete_user(db: Session, user_id: str, operator_username: str) -> User:
    ensure_settings_seeded(db)
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only disabled users can be deleted")
    if user.username == operator_username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete current login user")
    # user_id may be referenced by nullable FKs without ON DELETE CASCADE (operation logs / settings updater).
    db.query(OperationLog).filter(OperationLog.user_id == user.id).update(
        {OperationLog.user_id: None}, synchronize_session=False
    )
    db.query(SystemConfig).filter(SystemConfig.updated_by == user.id).update(
        {SystemConfig.updated_by: None}, synchronize_session=False
    )
    db.query(UserRole).filter(UserRole.user_id == user.id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    return user
