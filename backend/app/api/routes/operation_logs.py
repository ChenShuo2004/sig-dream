from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import bearer_scheme, decode_access_token, extract_bearer_token
from app.schemas.operation_log import OperationLogListResponse, OperationLogRead
from app.services.operation_log_service import list_operation_log_enums, list_operation_logs
from app.services.settings_service import ensure_permission

router = APIRouter(prefix="/operation-logs", tags=["operation_logs"])


def _to_read(item) -> OperationLogRead:
    return OperationLogRead(
        id=str(item.id),
        user_id=str(item.user_id) if item.user_id else None,
        username=item.username,
        operation_type=item.operation_type,
        target_type=item.target_type,
        target_name=item.target_name,
        before_data=item.before_data,
        after_data=item.after_data,
        success=item.success,
        error_message=item.error_message,
        ip_address=item.ip_address,
        user_agent=item.user_agent,
        created_at=item.created_at,
    )


@router.get("", response_model=OperationLogListResponse)
def operation_logs(
    operation_type: str | None = None,
    target_type: str | None = None,
    target_name: str | None = None,
    username: str | None = None,
    user_id: str | None = None,
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> OperationLogListResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "log.view")

    rows, total = list_operation_logs(
        db,
        operation_type=operation_type,
        target_type=target_type,
        target_name=target_name,
        username=username,
        user_id=user_id,
        start_at=start_at,
        end_at=end_at,
        page=page,
        page_size=page_size,
    )
    return OperationLogListResponse(
        items=[_to_read(item) for item in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/enums", response_model=dict[str, list[str]])
def operation_logs_enums(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, list[str]]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "log.view")
    return list_operation_log_enums(db)


@router.get("/{user_id}", response_model=OperationLogListResponse)
def operation_logs_by_user(
    user_id: str,
    operation_type: str | None = None,
    target_type: str | None = None,
    target_name: str | None = None,
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> OperationLogListResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "log.view")

    rows, total = list_operation_logs(
        db,
        operation_type=operation_type,
        target_type=target_type,
        target_name=target_name,
        user_id=user_id,
        start_at=start_at,
        end_at=end_at,
        page=page,
        page_size=page_size,
    )
    return OperationLogListResponse(
        items=[_to_read(item) for item in rows],
        total=total,
        page=page,
        page_size=page_size,
    )
