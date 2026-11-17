from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    bearer_scheme,
    create_access_token,
    decode_access_token,
    ensure_internal_access,
    extract_bearer_token,
    resolve_access_context,
)
from app.schemas.auth import (
    ChangePasswordRequest,
    ChangePasswordResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    MeResponse,
)
from app.services.operation_log_service import record_operation_log
from app.services.auth_service import authenticate_user, change_password, resolve_user
from app.services.settings_service import get_user_permissions

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> LoginResponse:
    return authenticate_user(
        db,
        payload.username,
        payload.password,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


@router.post("/refresh", response_model=LoginResponse)
def refresh_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    request: Request = None,
    db: Session = Depends(get_db),
) -> LoginResponse:
    token = extract_bearer_token(credentials)
    token_user = decode_access_token(token, allow_expired=True)
    user = resolve_user(db, token_user.username)
    record_operation_log(
        db,
        username=user.username,
        operation_type="刷新登录",
        target_type="auth",
        target_name=user.username,
        success=True,
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
    )
    return LoginResponse(access_token=create_access_token(username=user.username, role=user.role), role=user.role)


@router.get("/me", response_model=MeResponse)
def me(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> MeResponse:
    token = extract_bearer_token(credentials)
    token_user = decode_access_token(token)
    user = resolve_user(db, token_user.username)
    permissions = sorted(get_user_permissions(db, user.username))
    return MeResponse(username=user.username, role=user.role, access_context=access_context, permissions=permissions)


@router.post("/change-password", response_model=ChangePasswordResponse)
def update_password(
    payload: ChangePasswordRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    request: Request = None,
    db: Session = Depends(get_db),
) -> ChangePasswordResponse:
    token = extract_bearer_token(credentials)
    token_user = decode_access_token(token)
    change_password(db, token_user.username, payload.current_password, payload.new_password)
    record_operation_log(
        db,
        username=token_user.username,
        operation_type="修改密码",
        target_type="auth",
        target_name=token_user.username,
        success=True,
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
    )
    return ChangePasswordResponse(message="Password updated successfully")


@router.post("/logout", response_model=LogoutResponse)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    request: Request = None,
    db: Session = Depends(get_db),
) -> LogoutResponse:
    token = extract_bearer_token(credentials)
    token_user = decode_access_token(token)
    record_operation_log(
        db,
        username=token_user.username,
        operation_type="登出",
        target_type="auth",
        target_name=token_user.username,
        success=True,
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
    )
    return LogoutResponse(message="Logout success")


@router.delete("/dangerous-delete-simulate")
def dangerous_delete_simulate(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
) -> dict[str, str]:
    token = extract_bearer_token(credentials)
    _ = decode_access_token(token)
    ensure_internal_access(access_context)
    return {"status": "ok", "message": "Delete operation allowed in internal context"}
