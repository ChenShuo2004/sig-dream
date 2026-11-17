import hashlib
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import AuthUser, create_access_token
from app.models.user import User
from app.schemas.auth import LoginResponse
from app.services.operation_log_service import record_operation_log_safe
from app.services.settings_service import get_settings


def _hash_password(raw_password: str) -> str:
    return hashlib.md5(raw_password.encode("utf-8")).hexdigest()


def authenticate_user(
    db: Session,
    username: str,
    password: str,
    *,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> LoginResponse:
    user = db.query(User).filter(User.username == username).one_or_none()

    if user is None or not user.is_active:
        record_operation_log_safe(
            db,
            username=username,
            operation_type="登录失败",
            target_type="auth",
            target_name=username,
            success=False,
            error_message="Invalid credentials",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    settings = get_settings(db)
    security_policy = settings.get("security_policy", {})
    lock_enabled = bool(security_policy.get("login_lock_enabled", True))
    failed_limit = int(security_policy.get("login_failed_limit", 5))
    lock_minutes = int(security_policy.get("login_lock_minutes", 30))

    now = datetime.utcnow()
    if lock_enabled and user.locked_until and user.locked_until > now:
        record_operation_log_safe(
            db,
            username=user.username,
            operation_type="登录失败",
            target_type="auth",
            target_name=user.username,
            success=False,
            error_message="Account is locked temporarily",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account is locked temporarily")

    if user.password_hash != _hash_password(password):
        user.failed_login_count = int(user.failed_login_count or 0) + 1
        if lock_enabled and user.failed_login_count >= failed_limit:
            user.locked_until = now + timedelta(minutes=lock_minutes)
        db.add(user)
        db.commit()
        record_operation_log_safe(
            db,
            username=user.username,
            operation_type="登录失败",
            target_type="auth",
            target_name=user.username,
            success=False,
            error_message="Invalid credentials",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    db.add(user)
    db.commit()
    record_operation_log_safe(
        db,
        username=user.username,
        operation_type="登录成功",
        target_type="auth",
        target_name=user.username,
        success=True,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    token = create_access_token(username=user.username, role=user.role)
    return LoginResponse(access_token=token, role=user.role)


def resolve_user(db: Session, username: str) -> AuthUser:
    user = db.query(User).filter(User.username == username).one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return AuthUser(username=user.username, role=user.role)


def change_password(db: Session, username: str, current_password: str, new_password: str) -> None:
    user = db.query(User).filter(User.username == username).one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    if user.password_hash != _hash_password(current_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    if len(new_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be at least 6 characters")

    if current_password == new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different from current password")

    user.password_hash = _hash_password(new_password)
    db.add(user)
    db.commit()
