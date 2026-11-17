from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    ROLE_SUPER_ADMIN,
    bearer_scheme,
    decode_access_token,
    ensure_internal_access,
    extract_bearer_token,
    resolve_access_context,
)
from app.schemas.settings import (
    PermissionPointRead,
    SettingsResetPasswordRequest,
    SettingsRolePermissionUpdate,
    SettingsRoleRead,
    SettingsUserCreate,
    SettingsUserRead,
    SettingsUserUpdate,
    SystemSettingsRead,
    SystemSettingsUpdate,
)
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import (
    create_user,
    create_user_group,
    delete_user,
    delete_user_group,
    ensure_permission,
    get_permissions,
    get_roles,
    get_settings,
    list_users,
    list_user_groups,
    reset_user_password,
    update_role_permissions,
    update_settings,
    update_user,
)

router = APIRouter(prefix="/settings", tags=["settings"])
def _request_meta(request: Request | None) -> dict[str, str | None]:
    if request is None:
        return {"ip_address": None, "user_agent": None}
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }




def _auth_username(credentials: HTTPAuthorizationCredentials | None) -> str:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    return user.username


def _require_super_admin(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    username = _auth_username(credentials)
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    if user.role != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only super admin can manage system settings")
    ensure_permission(db, username, "system.setting.manage")
    return username


def _serialize_user(item) -> SettingsUserRead:
    return SettingsUserRead(
        id=str(item.id),
        username=item.username,
        group_name=item.display_name or "默认分组",
        role=item.role,
        status="active" if item.is_active else "disabled",
        last_login_at=item.last_login_at,
        created_at=item.created_at,
    )


@router.get("/users", response_model=list[SettingsUserRead], dependencies=[Depends(_require_super_admin)])
def settings_users(db: Session = Depends(get_db)) -> list[SettingsUserRead]:
    rows = list_users(db)
    return [_serialize_user(item) for item in rows]


@router.post("/users", response_model=SettingsUserRead, dependencies=[Depends(_require_super_admin)])
def settings_create_user(
    payload: SettingsUserCreate,
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> SettingsUserRead:
    row = create_user(
        db,
        username=payload.username,
        group_name=payload.group_name,
        password=payload.password,
        role=payload.role,
        status_value=payload.status,
    )
    record_operation_log(
        db,
        username=operator_username,
        operation_type="创建用户",
        target_type="system_settings",
        target_name=row.username,
        before_data=None,
        after_data={"role": row.role, "status": "active" if row.is_active else "disabled"},
        **_request_meta(request),
    )
    return _serialize_user(row)


@router.patch("/users/{user_id}", response_model=SettingsUserRead, dependencies=[Depends(_require_super_admin)])
def settings_update_user(
    user_id: str,
    payload: SettingsUserUpdate,
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> SettingsUserRead:
    row = update_user(
        db,
        user_id=user_id,
        group_name=payload.group_name,
        role=payload.role,
        status_value=payload.status,
    )
    record_operation_log(
        db,
        username=operator_username,
        operation_type="更新用户",
        target_type="system_settings",
        target_name=row.username,
        before_data=None,
        after_data={"role": row.role, "status": "active" if row.is_active else "disabled"},
        **_request_meta(request),
    )
    return _serialize_user(row)


@router.post("/users/{user_id}/disable", response_model=SettingsUserRead, dependencies=[Depends(_require_super_admin)])
def settings_disable_user(
    user_id: str,
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> SettingsUserRead:
    row = update_user(db, user_id=user_id, group_name=None, role=None, status_value="disabled")
    record_operation_log(
        db,
        username=operator_username,
        operation_type="禁用用户",
        target_type="system_settings",
        target_name=row.username,
        after_data={"status": "disabled"},
        **_request_meta(request),
    )
    return _serialize_user(row)


@router.post("/users/{user_id}/enable", response_model=SettingsUserRead, dependencies=[Depends(_require_super_admin)])
def settings_enable_user(
    user_id: str,
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> SettingsUserRead:
    row = update_user(db, user_id=user_id, group_name=None, role=None, status_value="active")
    record_operation_log(
        db,
        username=operator_username,
        operation_type="启用用户",
        target_type="system_settings",
        target_name=row.username,
        after_data={"status": "active"},
        **_request_meta(request),
    )
    return _serialize_user(row)


@router.delete("/users/{user_id}", dependencies=[Depends(_require_super_admin)])
def settings_delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> dict[str, str]:
    row = delete_user(db, user_id=user_id, operator_username=operator_username)
    record_operation_log(
        db,
        username=operator_username,
        operation_type="删除用户",
        target_type="system_settings",
        target_name=row.username,
        after_data={"status": "deleted"},
        **_request_meta(request),
    )
    return {"status": "ok"}


@router.post("/users/{user_id}/reset-password", dependencies=[Depends(_require_super_admin)])
def settings_reset_password(
    user_id: str,
    payload: SettingsResetPasswordRequest,
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> dict[str, str]:
    reset_user_password(db, user_id=user_id, new_password=payload.new_password)
    record_operation_log(
        db,
        username=operator_username,
        operation_type="重置密码",
        target_type="system_settings",
        target_name=user_id,
        success=True,
        **_request_meta(request),
    )
    return {"status": "ok"}


@router.patch("/users/{user_id}/roles", response_model=SettingsUserRead, dependencies=[Depends(_require_super_admin)])
def settings_update_user_role(
    user_id: str,
    payload: SettingsUserUpdate,
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> SettingsUserRead:
    if not payload.role:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role is required")
    row = update_user(db, user_id=user_id, group_name=None, role=payload.role, status_value=None)
    record_operation_log(
        db,
        username=operator_username,
        operation_type="修改用户角色",
        target_type="system_settings",
        target_name=row.username,
        after_data={"role": row.role},
        **_request_meta(request),
    )
    return _serialize_user(row)


@router.get("/user-groups", response_model=list[str], dependencies=[Depends(_require_super_admin)])
def settings_user_groups(db: Session = Depends(get_db)) -> list[str]:
    return list_user_groups(db)


@router.post("/user-groups", response_model=list[str], dependencies=[Depends(_require_super_admin)])
def settings_create_user_group(
    payload: dict[str, str],
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> list[str]:
    group_name = payload.get("group_name", "")
    groups = create_user_group(db, group_name)
    record_operation_log(
        db,
        username=operator_username,
        operation_type="创建用户分组",
        target_type="system_settings",
        target_name=group_name,
        after_data={"groups": groups},
        **_request_meta(request),
    )
    return groups


@router.delete("/user-groups/{group_name}", response_model=list[str], dependencies=[Depends(_require_super_admin)])
def settings_delete_user_group(
    group_name: str,
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> list[str]:
    groups = delete_user_group(db, group_name)
    record_operation_log(
        db,
        username=operator_username,
        operation_type="删除用户分组",
        target_type="system_settings",
        target_name=group_name,
        after_data={"groups": groups},
        **_request_meta(request),
    )
    return groups


@router.get("/roles", response_model=list[SettingsRoleRead], dependencies=[Depends(_require_super_admin)])
def settings_roles(db: Session = Depends(get_db)) -> list[SettingsRoleRead]:
    return [SettingsRoleRead.model_validate(item) for item in get_roles(db)]


@router.get("/roles/{role_id}/permissions", response_model=list[str], dependencies=[Depends(_require_super_admin)])
def settings_role_permissions(role_id: str, db: Session = Depends(get_db)) -> list[str]:
    role = next((item for item in get_roles(db) if item["id"] == role_id), None)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role["permissions"]


@router.patch(
    "/roles/{role_id}/permissions",
    response_model=SettingsRoleRead,
    dependencies=[Depends(_require_super_admin)],
)
def settings_update_role_permissions(
    role_id: str,
    payload: SettingsRolePermissionUpdate,
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> SettingsRoleRead:
    ensure_internal_access(access_context)
    role = update_role_permissions(db, role_id, payload.permissions)
    record_operation_log(
        db,
        username=operator_username,
        operation_type="修改角色权限",
        target_type="system_settings",
        target_name=role_id,
        after_data={"permissions": payload.permissions},
        **_request_meta(request),
    )
    return SettingsRoleRead.model_validate(role)


@router.get("/permissions", response_model=list[PermissionPointRead], dependencies=[Depends(_require_super_admin)])
def settings_permissions() -> list[PermissionPointRead]:
    return [PermissionPointRead.model_validate(item) for item in get_permissions()]


@router.get("", response_model=SystemSettingsRead, dependencies=[Depends(_require_super_admin)])
def settings_get(db: Session = Depends(get_db)) -> SystemSettingsRead:
    payload = get_settings(db)
    return SystemSettingsRead.model_validate(payload)


@router.patch("", response_model=SystemSettingsRead, dependencies=[Depends(_require_super_admin)])
def settings_patch(
    payload: SystemSettingsUpdate,
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
    operator_username: str = Depends(_require_super_admin),
    request: Request = None,
) -> SystemSettingsRead:
    ensure_internal_access(access_context)
    updated = update_settings(db, payload.model_dump(exclude_none=True), updated_by_username=operator_username)
    record_operation_log(
        db,
        username=operator_username,
        operation_type="修改系统设置",
        target_type="system_settings",
        target_name="settings",
        after_data=payload.model_dump(exclude_none=True),
        **_request_meta(request),
    )
    return SystemSettingsRead.model_validate(updated)
