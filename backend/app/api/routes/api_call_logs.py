"""Generation API call records. Callers report their own calls; super admins query and aggregate them."""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import ROLE_MATERIAL_ADMIN, ROLE_SUPER_ADMIN, bearer_scheme, decode_access_token, extract_bearer_token
from app.models.api_call_log import ApiCallLog
from app.models.user import User

router = APIRouter(prefix="/canvas-api/call-logs", tags=["api-call-logs"])

CANVAS_ROLES = {ROLE_SUPER_ADMIN, ROLE_MATERIAL_ADMIN}
CAPABILITIES = {"image", "video", "text", "audio"}
STATUSES = {"success", "failed", "cancelled"}
SENSITIVE_KEY = re.compile(r"(api[-_]?key|secret|password|authorization|bearer|data[_-]?url|base64|b64_json)", re.I)
MAX_TEXT = 500


def _user(credentials: HTTPAuthorizationCredentials | None):
    user = decode_access_token(extract_bearer_token(credentials))
    if user.role not in CANVAS_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="画布需要素材管理员及以上权限")
    return user


def _super_admin(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)):
    user = _user(credentials)
    if user.role != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅超级管理员可查看 API 调用记录")
    return user


def _clip(value: object, limit: int) -> str:
    text = value if isinstance(value, str) else ""
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _int(value: object, upper: int) -> int:
    try:
        number = int(value or 0)
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    return min(number, upper)


def _clean_parameters(value: object, depth: int = 0) -> dict | list | str | int | float | bool | None:
    if depth > 4:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        if value.startswith("data:") or len(value) > 800:
            return f"[省略 {len(value)} 字符]"
        return value[:MAX_TEXT]
    if isinstance(value, list):
        return [_clean_parameters(item, depth + 1) for item in value[:30]]
    if isinstance(value, dict):
        cleaned: dict = {}
        for key, item in list(value.items())[:40]:
            name = str(key)[:80]
            if SENSITIVE_KEY.search(name):
                continue
            cleaned[name] = _clean_parameters(item, depth + 1)
        return cleaned
    return None


def _apply_filters(query, username: str, capability: str, provider: str, model: str, action: str, call_status: str, q: str, date_from: str, date_to: str):
    if username.strip():
        query = query.filter(ApiCallLog.username == username.strip()[:64])
    if capability in CAPABILITIES:
        query = query.filter(ApiCallLog.capability == capability)
    if provider.strip():
        query = query.filter(ApiCallLog.provider == provider.strip()[:64])
    if model.strip():
        query = query.filter(ApiCallLog.model.ilike(f"%{model.strip()[:80]}%"))
    if action.strip():
        query = query.filter(ApiCallLog.action == action.strip()[:32])
    if call_status in STATUSES:
        query = query.filter(ApiCallLog.status == call_status)
    if q.strip():
        query = query.filter(ApiCallLog.prompt_excerpt.ilike(f"%{q.strip()[:80]}%"))
    start = _parse_day(date_from)
    end = _parse_day(date_to)
    if start:
        query = query.filter(ApiCallLog.created_at >= start)
    if end:
        query = query.filter(ApiCallLog.created_at < end + timedelta(days=1))
    return query


def _parse_day(value: str) -> datetime | None:
    text = value.strip()
    if not text:
        return None
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d")
    except ValueError:
        return None


def _row(item: ApiCallLog) -> dict:
    return {
        "id": str(item.id),
        "username": item.username,
        "source": item.source,
        "capability": item.capability,
        "action": item.action,
        "provider": item.provider,
        "model": item.model,
        "endpoint": item.endpoint,
        "status": item.status,
        "duration_ms": item.duration_ms,
        "task_id": item.task_id,
        "prompt_tokens": item.prompt_tokens,
        "completion_tokens": item.completion_tokens,
        "total_tokens": item.total_tokens,
        "credits": item.credits,
        "prompt_excerpt": item.prompt_excerpt,
        "parameters": item.parameters or {},
        "error_message": item.error_message,
        "created_at": item.created_at.isoformat(sep=" ", timespec="seconds") if item.created_at else "",
    }


@router.post("")
def create_api_call_log(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    user = _user(credentials)
    capability = str(payload.get("capability") or "")
    call_status = str(payload.get("status") or "")
    if capability not in CAPABILITIES or call_status not in STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="调用记录字段无效")
    parameters = _clean_parameters(payload.get("parameters"))
    if not isinstance(parameters, dict):
        parameters = {}
    prompt = _clip(parameters.get("prompt") if isinstance(parameters, dict) else "", 2000)
    account = db.query(User).filter(User.username == user.username).one_or_none()
    prompt_tokens = _int(payload.get("prompt_tokens"), 100_000_000)
    completion_tokens = _int(payload.get("completion_tokens"), 100_000_000)
    total_tokens = _int(payload.get("total_tokens"), 100_000_000) or (prompt_tokens + completion_tokens)
    credits = _int(payload.get("credits"), 100_000_000)
    row = ApiCallLog(
        user_id=account.id if account else None,
        username=user.username[:64],
        source=_clip(payload.get("source"), 64),
        capability=capability,
        action=_clip(payload.get("action"), 32),
        provider=_clip(payload.get("provider"), 64),
        model=_clip(payload.get("model"), 200),
        endpoint=_clip(payload.get("endpoint"), 200),
        status=call_status,
        duration_ms=_int(payload.get("duration_ms"), 24 * 60 * 60 * 1000),
        task_id=_clip(payload.get("task_id"), 128),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        credits=credits,
        prompt_excerpt=prompt,
        parameters=parameters,
        error_message=_clip(payload.get("error_message"), 500),
        ip_address=(request.client.host if request.client else "")[:64],
    )
    db.add(row)
    db.commit()
    return {"id": str(row.id)}


@router.get("")
def list_api_call_logs(
    username: str = "",
    capability: str = "",
    provider: str = "",
    model: str = "",
    action: str = "",
    call_status: str = Query("", alias="status"),
    q: str = "",
    date_from: str = "",
    date_to: str = "",
    page: int = 1,
    page_size: int = 20,
    _: object = Depends(_super_admin),
    db: Session = Depends(get_db),
):
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    query = _apply_filters(db.query(ApiCallLog), username, capability, provider, model, action, call_status, q, date_from, date_to)
    total = query.count()
    rows = query.order_by(ApiCallLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [_row(item) for item in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/summary")
def summarize_api_call_logs(
    username: str = "",
    capability: str = "",
    provider: str = "",
    model: str = "",
    action: str = "",
    call_status: str = Query("", alias="status"),
    q: str = "",
    date_from: str = "",
    date_to: str = "",
    _: object = Depends(_super_admin),
    db: Session = Depends(get_db),
):
    def matched():
        return _apply_filters(db.query(ApiCallLog), username, capability, provider, model, action, call_status, q, date_from, date_to)

    total = matched().count()
    success = matched().filter(ApiCallLog.status == "success").count()
    failed = matched().filter(ApiCallLog.status == "failed").count()
    cancelled = matched().filter(ApiCallLog.status == "cancelled").count()
    token_row = matched().with_entities(
        func.coalesce(func.sum(ApiCallLog.prompt_tokens), 0),
        func.coalesce(func.sum(ApiCallLog.completion_tokens), 0),
        func.coalesce(func.sum(ApiCallLog.total_tokens), 0),
        func.coalesce(func.sum(ApiCallLog.credits), 0),
    ).one()
    def failed_sum():
        return func.coalesce(func.sum(case((ApiCallLog.status == "failed", 1), else_=0)), 0)

    by_user = (
        matched().with_entities(ApiCallLog.username, func.count(ApiCallLog.id), func.coalesce(func.sum(ApiCallLog.total_tokens), 0), failed_sum(), func.coalesce(func.sum(ApiCallLog.credits), 0))
        .group_by(ApiCallLog.username)
        .order_by(func.count(ApiCallLog.id).desc())
        .limit(50)
        .all()
    )
    by_model = (
        matched().with_entities(ApiCallLog.provider, ApiCallLog.model, func.count(ApiCallLog.id), func.coalesce(func.sum(ApiCallLog.total_tokens), 0), failed_sum(), func.coalesce(func.sum(ApiCallLog.credits), 0))
        .group_by(ApiCallLog.provider, ApiCallLog.model)
        .order_by(func.count(ApiCallLog.id).desc())
        .limit(50)
        .all()
    )
    day = func.date(ApiCallLog.created_at)
    by_day = (
        matched().with_entities(day, func.count(ApiCallLog.id), func.coalesce(func.sum(ApiCallLog.total_tokens), 0), func.coalesce(func.sum(ApiCallLog.credits), 0))
        .group_by(day)
        .order_by(day.desc())
        .limit(31)
        .all()
    )
    return {
        "total": total,
        "success": success,
        "failed": failed,
        "cancelled": cancelled,
        "prompt_tokens": int(token_row[0] or 0),
        "completion_tokens": int(token_row[1] or 0),
        "total_tokens": int(token_row[2] or 0),
        "credits": int(token_row[3] or 0),
        "by_user": [{"username": item[0], "count": int(item[1]), "total_tokens": int(item[2]), "failed": int(item[3]), "credits": int(item[4])} for item in by_user],
        "by_model": [{"provider": item[0], "model": item[1], "count": int(item[2]), "total_tokens": int(item[3]), "failed": int(item[4]), "credits": int(item[5])} for item in by_model],
        "by_day": [{"day": str(item[0] or ""), "count": int(item[1]), "total_tokens": int(item[2]), "credits": int(item[3])} for item in by_day],
    }
