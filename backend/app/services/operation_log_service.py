from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.models.operation_log import OperationLog
from app.models.user import User

_TARGET_TYPE_ALIASES = {
    "系统设置": "system_settings",
    "素材集合": "collection",
    "素材": "material",
    "标签": "tag",
    "上传": "upload",
    "文件": "upload",
    "错误信息": "error",
    "用户": "auth",
}


def _normalize_target_type(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return "unknown"
    return _TARGET_TYPE_ALIASES.get(raw, raw)


def record_operation_log(
    db: Session,
    *,
    username: str | None,
    operation_type: str,
    target_type: str,
    target_name: str | None = None,
    before_data: dict | None = None,
    after_data: dict | None = None,
    success: bool = True,
    error_message: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> OperationLog:
    user_id = None
    if username:
        user = db.scalar(select(User).where(User.username == username))
        if user is not None:
            user_id = user.id
    row = OperationLog(
        username=username,
        user_id=user_id,
        operation_type=operation_type,
        target_type=_normalize_target_type(target_type),
        target_name=target_name,
        before_data=before_data,
        after_data=after_data,
        success=success,
        error_message=error_message,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(row)
    db.commit()
    return row


def record_operation_log_safe(
    db: Session,
    *,
    username: str | None,
    operation_type: str,
    target_type: str,
    target_name: str | None = None,
    before_data: dict | None = None,
    after_data: dict | None = None,
    success: bool = True,
    error_message: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    try:
        record_operation_log(
            db,
            username=username,
            operation_type=operation_type,
            target_type=target_type,
            target_name=target_name,
            before_data=before_data,
            after_data=after_data,
            success=success,
            error_message=error_message,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    except Exception:
        db.rollback()


def list_operation_logs(
    db: Session,
    *,
    operation_type: str | None = None,
    target_type: str | None = None,
    target_name: str | None = None,
    username: str | None = None,
    user_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[OperationLog], int]:
    stmt: Select[tuple[OperationLog]] = select(OperationLog)
    if operation_type:
        stmt = stmt.where(OperationLog.operation_type.ilike(f"%{operation_type}%"))
    if target_type:
        stmt = stmt.where(OperationLog.target_type.ilike(f"%{target_type}%"))
    if target_name:
        stmt = stmt.where(OperationLog.target_name.ilike(f"%{target_name}%"))
    if username:
        stmt = stmt.where(OperationLog.username == username)
    if user_id:
        try:
            uid = UUID(user_id)
            stmt = stmt.where(OperationLog.user_id == uid)
        except ValueError:
            stmt = stmt.where(OperationLog.user_id == None)  # noqa: E711
    if start_at:
        stmt = stmt.where(OperationLog.created_at >= start_at)
    if end_at:
        stmt = stmt.where(OperationLog.created_at <= end_at)

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = int(db.scalar(total_stmt) or 0)
    stmt = stmt.order_by(OperationLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = list(db.scalars(stmt).all())
    return rows, total


def list_operation_log_enums(db: Session) -> dict[str, list[str]]:
    operation_types = [
        str(item)
        for item in db.scalars(
            select(OperationLog.operation_type).distinct().order_by(OperationLog.operation_type.asc())
        ).all()
        if item
    ]
    target_types = [
        str(item)
        for item in db.scalars(select(OperationLog.target_type).distinct().order_by(OperationLog.target_type.asc())).all()
        if item
    ]
    return {"operation_types": operation_types, "target_types": target_types}
