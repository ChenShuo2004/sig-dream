"""Shared canvas model channels.

Super admins write the channel list (base URL, API key, models).
Material admins and super admins read it so the canvas can call those APIs.
"""

from __future__ import annotations

import ipaddress
import asyncio
import json
import os
import re
import secrets
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.core.security import ROLE_MATERIAL_ADMIN, ROLE_SUPER_ADMIN, bearer_scheme, decode_access_token, extract_bearer_token
from app.models.material import NasJob
from app.models.system_settings import SystemConfig
from app.services.operation_log_service import record_operation_log

router = APIRouter(prefix="/canvas-api", tags=["canvas-api"])

CONFIG_KEY = "canvas_api_channels"
CANVAS_ROLES = {ROLE_SUPER_ADMIN, ROLE_MATERIAL_ADMIN}
CAPABILITIES = {"image", "video", "text", "audio"}
MAX_CHANNELS = 40
MAX_MODELS = 400
AI007_POST_PATHS = {"/video/generations", "/images/generations", "/images/edits"}
AI007_POLL_PATH = re.compile(r"^/video/generations/[A-Za-z0-9_-]{1,128}$")
AI007_MAX_BODY = 40 * 1024 * 1024


def _user(credentials: HTTPAuthorizationCredentials | None):
    user = decode_access_token(extract_bearer_token(credentials))
    if user.role not in CANVAS_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="画布需要素材管理员及以上权限")
    return user


def _text(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _number_list(value: object, limit: int) -> list[int]:
    if not isinstance(value, list):
        return []
    numbers: list[int] = []
    for item in value[:limit]:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            continue
        numbers.append(int(item))
    return numbers


def _text_list(value: object, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_text(item, 32) for item in value[:limit] if _text(item, 32)]


def _allowed_users(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    names: list[str] = []
    for item in value[:40]:
        name = _text(item, 64)
        if name and name not in names:
            names.append(name)
    return names


def _clean_api_keys(value: object, default_key: str) -> list[dict]:
    if not isinstance(value, list):
        return []
    cleaned: list[dict] = []
    seen_users: set[str] = set()
    fallback = default_key.strip()
    for item in value[:20]:
        if not isinstance(item, dict):
            continue
        key = _text(item.get("key"), 500)
        if not key or key == fallback:
            continue
        users: list[str] = []
        for name in _allowed_users(item.get("users")):
            if name in seen_users:
                continue
            seen_users.add(name)
            users.append(name)
        cleaned.append(
            {
                "id": _text(item.get("id"), 64) or f"key-{len(cleaned) + 1}",
                "label": _text(item.get("label"), 40) or f"Key {len(cleaned) + 1}",
                "key": key,
                "users": users,
            }
        )
    return cleaned


def _key_for_user(channel: dict, username: str) -> str:
    default_key = str(channel.get("apiKey") or "").strip()
    keys = channel.get("apiKeys") if isinstance(channel.get("apiKeys"), list) else []
    if username:
        for item in keys:
            if not isinstance(item, dict):
                continue
            users = item.get("users") if isinstance(item.get("users"), list) else []
            if username not in {str(name) for name in users}:
                continue
            key = str(item.get("key") or "").strip()
            if key:
                return key
    return default_key


def _provider_api_key(db: Session, marks: tuple[str, ...], username: str, missing: str) -> str:
    for item in _stored_channels(db):
        if not isinstance(item, dict):
            continue
        base_url = str(item.get("baseUrl") or "").lower()
        if not any(mark in base_url for mark in marks):
            continue
        api_key = _key_for_user(item, username)
        if api_key:
            return api_key
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=missing)


def _model_open_to(model: dict, username: str) -> bool:
    allowed = model.get("allowedUsers")
    if not isinstance(allowed, list) or not allowed:
        return True
    return username in {str(item) for item in allowed}


def _stored_channels(db: Session) -> list:
    row = db.get(SystemConfig, CONFIG_KEY)
    channels = row.value.get("channels") if row is not None and isinstance(row.value, dict) else []
    return channels if isinstance(channels, list) else []


def _require_model_access(db: Session, username: str, model_name: str) -> None:
    name = (model_name or "").strip()
    if not name:
        return
    matches: list[dict] = []
    for item in _stored_channels(db):
        if not isinstance(item, dict):
            continue
        models = item.get("models") if isinstance(item.get("models"), list) else []
        for model in models:
            if isinstance(model, dict) and str(model.get("name") or "") == name:
                matches.append(model)
    if not matches or any(_model_open_to(model, username) for model in matches):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前账号不能使用这个模型")


def _channels_for_user(channels: list, username: str, role: str) -> list:
    if role == ROLE_SUPER_ADMIN:
        return channels
    visible: list[dict] = []
    for item in channels:
        if not isinstance(item, dict):
            continue
        models = item.get("models") if isinstance(item.get("models"), list) else []
        kept: list[dict] = []
        for model in models:
            if not isinstance(model, dict):
                continue
            if _model_open_to(model, username):
                kept.append({key: value for key, value in model.items() if key != "allowedUsers"})
            elif isinstance(model.get("allowedUsers"), list) and model.get("allowedUsers"):
                kept.append(
                    {
                        "name": model.get("name"),
                        "capability": model.get("capability") or "text",
                        "allowedUsers": model.get("allowedUsers"),
                    }
                )
        published = {**item, "models": kept, "apiKey": _key_for_user(item, username)}
        published.pop("apiKeys", None)
        visible.append(published)
    return visible


def _clean_channels(payload: object) -> list[dict]:
    raw_channels = payload.get("channels") if isinstance(payload, dict) else None
    if not isinstance(raw_channels, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="渠道列表无效")
    if len(raw_channels) > MAX_CHANNELS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="渠道过多")
    cleaned: list[dict] = []
    for item in raw_channels:
        if not isinstance(item, dict):
            continue
        base_url = _text(item.get("baseUrl"), 500)
        if base_url and not (base_url.startswith("http://") or base_url.startswith("https://")):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="接口地址需以 http:// 或 https:// 开头")
        models: list[dict] = []
        raw_models = item.get("models") if isinstance(item.get("models"), list) else []
        for model in raw_models[:MAX_MODELS]:
            if isinstance(model, str):
                name = _text(model, 200)
                capability = "text"
                script = ""
            elif isinstance(model, dict):
                name = _text(model.get("name"), 200)
                capability = _text(model.get("capability"), 32) or "text"
                script = _text(model.get("script"), 200_000)
            else:
                continue
            if not name or capability not in CAPABILITIES:
                continue
            entry: dict = {"name": name, "capability": capability}
            if script:
                entry["script"] = script
            if isinstance(model, dict):
                label = _text(model.get("label"), 160)
                if label:
                    entry["label"] = label
                price = model.get("price")
                if isinstance(price, (int, float)) and not isinstance(price, bool) and price >= 0:
                    entry["price"] = int(price) if float(price).is_integer() else float(price)
                billing_mode = _text(model.get("billingMode"), 32)
                if billing_mode in {"per_task", "per_second"}:
                    entry["billingMode"] = billing_mode
                durations = _number_list(model.get("allowedDurations"), 40)
                ratios = _text_list(model.get("allowedRatios"), 20)
                resolutions = _text_list(model.get("resolutions"), 12)
                if durations:
                    entry["allowedDurations"] = durations
                if ratios:
                    entry["allowedRatios"] = ratios
                if isinstance(model.get("resolutions"), list):
                    entry["resolutions"] = resolutions
                for key in ("maxImages", "maxVideos", "maxAudios"):
                    value = model.get(key)
                    if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
                        entry[key] = int(value)
                allowed_users = _allowed_users(model.get("allowedUsers"))
                if allowed_users:
                    entry["allowedUsers"] = allowed_users
            models.append(entry)
        api_format = "gemini" if item.get("apiFormat") == "gemini" else "openai"
        api_key = _text(item.get("apiKey"), 500)
        channel = {
            "id": _text(item.get("id"), 64) or f"channel-{len(cleaned) + 1}",
            "name": _text(item.get("name"), 80) or f"渠道 {len(cleaned) + 1}",
            "baseUrl": base_url,
            "apiKey": api_key,
            "apiFormat": api_format,
            "models": models,
        }
        extra_keys = _clean_api_keys(item.get("apiKeys"), api_key)
        if extra_keys:
            channel["apiKeys"] = extra_keys
        cleaned.append(channel)
    return cleaned


@router.get("/channels")
def read_channels(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    row = db.get(SystemConfig, CONFIG_KEY)
    channels = row.value.get("channels") if row is not None and isinstance(row.value, dict) else []
    if not isinstance(channels, list):
        channels = []
    return {"channels": _channels_for_user(channels, user.username, user.role)}


@router.put("/channels")
def write_channels(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    if user.role != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅超级管理员可修改 API 设置")
    channels = _clean_channels(payload)
    row = db.get(SystemConfig, CONFIG_KEY)
    if row is None:
        row = SystemConfig(key=CONFIG_KEY, value={"channels": channels})
        db.add(row)
    else:
        row.value = {"channels": channels}
        flag_modified(row, "value")
    record_operation_log(
        db,
        username=user.username,
        operation_type="更新画布 API 渠道",
        target_type="canvas_api",
        target_name=CONFIG_KEY,
        after_data={"channel_count": len(channels), "channel_names": [item["name"] for item in channels]},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return {"channels": channels}


def _ai007_api_key(db: Session, username: str = "") -> str:
    return _provider_api_key(db, ("ai007.my",), username, "还没有保存 AI007 的密钥")


def _upstream_message(payload: object) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"].strip()
        if isinstance(error, str):
            return error.strip()
        for key in ("message", "msg", "fail_reason"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
        if isinstance(detail, dict):
            nested = _upstream_message(detail)
            if nested:
                return nested
    if isinstance(payload, str):
        return payload.strip()
    return ""


def _readable_upstream_message(payload: object, status_code: int) -> str:
    message = _upstream_message(payload) or f"AI007 返回 {status_code}"
    stripped = message.lstrip()
    if stripped.startswith("<") or "DOCTYPE" in stripped[:80]:
        return "AI007 的网络拦截了这次调用，请稍后再试"
    return message[:500]


def _clear_ai007_key(job: NasJob, db: Session) -> None:
    payload = dict(job.payload or {})
    if not payload.get("api_key"):
        return
    payload["api_key"] = ""
    job.payload = payload
    flag_modified(job, "payload")
    db.commit()


@router.post("/ai007")
def forward_ai007(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Queue the call for the file machine. This server's address is blocked by AI007's edge."""
    user = _user(credentials)
    method = str(payload.get("method") or "POST").upper()
    path = str(payload.get("path") or "").strip()
    if not path.startswith("/"):
        path = f"/{path}"
    body = payload.get("body")
    if method == "GET":
        if AI007_POLL_PATH.match(path) is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的 AI007 路径")
    elif method == "POST":
        if path not in AI007_POST_PATHS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的 AI007 路径")
        if not isinstance(body, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请求体无效")
        if len(json.dumps(body, ensure_ascii=False).encode("utf-8")) > AI007_MAX_BODY:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考内容太大，服务器转发不下")
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的请求方法")

    api_key = _ai007_api_key(db, user.username)
    job = NasJob(
        id=uuid.uuid4(),
        job_type="ai007_forward",
        payload={
            "owner": user.username,
            "method": method,
            "path": path,
            "body": body if isinstance(body, dict) else None,
            "api_key": api_key,
        },
        status="pending",
        max_retries=0,
    )
    db.add(job)
    if method == "POST":
        model_name = str(body.get("model") or "")[:80] if isinstance(body, dict) else ""
        _require_model_access(db, user.username, model_name)
        record_operation_log(
            db,
            username=user.username,
            operation_type="调用 AI007",
            target_type="canvas_api",
            target_name=model_name or path,
            after_data={"path": path},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    db.commit()
    return {"pending": True, "job_id": str(job.id)}


@router.get("/ai007/jobs/{job_id}")
def read_ai007_job(
    job_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    try:
        job = db.get(NasJob, uuid.UUID(job_id))
    except ValueError:
        job = None
    if job is None or job.job_type != "ai007_forward":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    owner = str((job.payload or {}).get("owner") or "")
    if owner != user.username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    if job.status in {"pending", "running"}:
        return {"pending": True, "job_id": str(job.id)}
    _clear_ai007_key(job, db)
    if job.status != "success":
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=(job.error_message or "AI007 请求失败")[:500])
    result = job.result if isinstance(job.result, dict) else {}
    status_code = int(result.get("status_code") or 200)
    raw_body = result.get("body")
    body = json.loads(json.dumps(raw_body)) if isinstance(raw_body, dict) else raw_body
    if status_code >= 400:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_readable_upstream_message(body, status_code))
    if isinstance(body, dict):
        return _attach_saved_file(body, str(job.id))
    return {"data": body}


def _attach_saved_file(body: dict, job_id: str) -> dict:
    filename = str(body.pop("platform_file", "") or "")
    if not filename:
        return body
    file_url = f"/canvas-api/ai007/jobs/{job_id}/file"
    data = body.get("data")
    if not isinstance(data, dict):
        data = {}
        body["data"] = data
    data["url"] = file_url
    data["video_url"] = file_url
    nested = data.get("data")
    if isinstance(nested, dict):
        nested["url"] = file_url
        nested["video_url"] = file_url
    return body


@router.get("/ai007/jobs/{job_id}/file")
def read_ai007_job_file(
    job_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> FileResponse:
    user = _user(credentials)
    try:
        job = db.get(NasJob, uuid.UUID(job_id))
    except ValueError:
        job = None
    if job is None or job.job_type != "ai007_forward":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    owner = str((job.payload or {}).get("owner") or "")
    if owner != user.username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    from app.api.routes.canvas_lan import canvas_lan_root

    directory = canvas_lan_root() / str(job.id)
    for name in ("output.mp4", "output.webm", "output.mov", "output.png", "output.jpg", "output.jpeg", "output.webp", "output.gif"):
        path = directory / name
        if path.is_file():
            return FileResponse(path)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")


def _media_dir() -> Path:
    path = Path(os.environ.get("AI007_MEDIA_DIR") or "/tmp/ai007-canvas-media")
    path.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - 6 * 60 * 60
    for item in path.iterdir():
        if item.is_file() and item.stat().st_mtime < cutoff:
            item.unlink(missing_ok=True)
    return path


@router.post("/ai007/media")
async def store_ai007_media(
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    """Keep a canvas reference file where AI007 can fetch it. The token is unguessable and expires with the file."""
    _user(credentials)
    raw = await file.read()
    if len(raw) < 32 or len(raw) > 100 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件为空或超过 100MB")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".webm", ".mov", ".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        content_type = (file.content_type or "").lower()
        suffix = ".mp4" if content_type.startswith("video/") else ".png" if content_type.startswith("image/") else ""
    if not suffix:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件格式不支持")
    token = secrets.token_urlsafe(24)
    target = _media_dir() / f"{token}{suffix}"
    target.write_bytes(raw)
    return {"path": f"/canvas-api/ai007/media/{token}{suffix}"}


@router.get("/ai007/media/{name}")
def read_ai007_media(name: str) -> FileResponse:
    if re.fullmatch(r"[A-Za-z0-9_-]{16,80}\.(mp4|webm|mov|png|jpg|jpeg|webp|gif)", name) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    path = _media_dir() / name
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    return FileResponse(path)


ONION_ORIGIN = "https://ai.onioncreate.xyz"
ONION_TASK_ID = re.compile(r"^[A-Za-z0-9_-]{6,80}$")


def _onion_api_key(db: Session, override: str = "", username: str = "") -> str:
    key = override.strip()
    if key:
        return key
    return _provider_api_key(db, ("onioncreate.xyz",), username, "还没有保存 OnionCreate 的密钥")


def _onion_message(payload: object, status_code: int) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, str) and error.strip():
            return error.strip()[:500]
    message = _upstream_message(payload)
    return (message or f"OnionCreate 返回 {status_code}")[:500]


def _onion_open(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 60):
    request = urllib.request.Request(
        f"{ONION_ORIGIN}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
            **(headers or {}),
        },
    )
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            payload = {}
        if exc.code == 409:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="视频尚未生成") from None
        if exc.code == 410:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="视频结果已过期，请重新生成") from None
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_onion_message(payload, exc.code)) from None


def _onion_json(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 60) -> dict:
    with _onion_open(method, path, api_key, data, headers, timeout) as response:
        raw = response.read()
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="OnionCreate 返回了无法识别的内容") from exc
    if not isinstance(payload, dict):
        return {"data": payload}
    if payload.get("ok") is False or payload.get("success") is False:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_onion_message(payload, 400))
    return payload


@router.post("/onion/models")
def list_onion_models(
    payload: dict = Body(default_factory=dict),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    override = str(payload.get("apiKey") or "").strip() if user.role == ROLE_SUPER_ADMIN else ""
    return _onion_json("GET", "/v1/models", _onion_api_key(db, override, user.username), timeout=30)


@router.get("/onion/tasks")
def list_onion_tasks(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    return _onion_json("GET", "/v1/tasks", _onion_api_key(db, username=user.username), timeout=40)


@router.post("/onion/videos")
def create_onion_video(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    model_id = _text(payload.get("model_id"), 80)
    prompt = _text(payload.get("prompt"), 8000)
    _require_model_access(db, user.username, model_id)
    if not model_id or not prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="缺少模型或提示词")
    asset_ids = payload.get("asset_ids") if isinstance(payload.get("asset_ids"), list) else []
    logical_task_id = _text(payload.get("logical_task_id"), 80)
    body: dict[str, object] = {
        "model_id": model_id,
        "prompt": prompt,
        "asset_ids": [str(item).strip() for item in asset_ids if str(item).strip()][:15],
        "logical_task_id": logical_task_id,
    }
    duration = payload.get("duration")
    if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration > 0:
        body["duration"] = int(duration)
    aspect_ratio = _text(payload.get("aspect_ratio"), 32)
    resolution = _text(payload.get("resolution"), 32)
    if aspect_ratio:
        body["aspect_ratio"] = aspect_ratio
    if resolution:
        body["resolution"] = resolution
    record_operation_log(
        db,
        username=user.username,
        operation_type="调用 OnionCreate",
        target_type="canvas_api",
        target_name=model_id,
        after_data={"path": "/v1/videos"},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return _onion_json(
        "POST",
        "/v1/videos",
        _onion_api_key(db, username=user.username),
        json.dumps(body, ensure_ascii=False).encode("utf-8"),
        {"Content-Type": "application/json", "Idempotency-Key": logical_task_id or model_id},
        timeout=90,
    )


@router.post("/onion/assets")
async def upload_onion_asset(
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    raw = await file.read()
    if len(raw) < 32 or len(raw) > 100 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件为空或超过 100MB")
    filename = Path(file.filename or "asset.bin").name
    quoted = urllib.parse.quote(filename, safe="")
    return await asyncio.to_thread(
        _onion_json,
        "POST",
        "/v1/assets",
        _onion_api_key(db, username=user.username),
        raw,
        {
            "Content-Type": file.content_type or "application/octet-stream",
            "X-File-Size": str(len(raw)),
            "X-Filename": quoted if quoted.isascii() else "asset",
            "X-Asset-Scope": "task",
        },
        180,
    )


@router.get("/onion/videos/{task_id}/content")
def read_onion_video(
    task_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    user = _user(credentials)
    if ONION_TASK_ID.fullmatch(task_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    response = _onion_open("GET", f"/v1/videos/{task_id}/content", _onion_api_key(db, username=user.username), headers={"Accept": "*/*"}, timeout=300)
    content_type = response.headers.get("Content-Type") or "video/mp4"
    if content_type.startswith("application/json") or content_type.startswith("text/"):
        response.close()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="视频尚未生成")

    def chunks():
        try:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            response.close()

    return StreamingResponse(chunks(), media_type=content_type.split(";", 1)[0])


GEEKNOW_ORIGIN = "https://www.geeknow.top"
GEEKNOW_TASK_ID = re.compile(r"^[A-Za-z0-9_-]{4,128}$")
GEEKNOW_DONE = {"succeeded", "success", "completed", "finish", "finished", "done"}
GEEKNOW_FAILED = {"failed", "fail", "error", "cancelled", "canceled", "expired", "deleted"}


def _geeknow_api_key(db: Session, override: str = "", username: str = "") -> str:
    key = override.strip()
    if key:
        return key
    return _provider_api_key(db, ("geeknow.top",), username, "还没有保存 Geeknow 的密钥")


def _geeknow_open(method: str, url: str, api_key: str = "", data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 60):
    request_headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0", **(headers or {})}
    if api_key:
        request_headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            payload = {}
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_onion_message(payload, exc.code) or f"Geeknow 返回 {exc.code}") from None


def _geeknow_json(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 90) -> dict:
    with _geeknow_open(method, f"{GEEKNOW_ORIGIN}{path}", api_key, data, headers, timeout) as response:
        raw = response.read()
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Geeknow 返回了无法识别的内容") from exc
    if not isinstance(payload, dict):
        return {"data": payload}
    if payload.get("success") is False:
        message = payload.get("message")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(message or "Geeknow 请求失败")[:500])
    return payload


def _geeknow_task(payload: dict) -> dict:
    task = payload.get("task")
    return task if isinstance(task, dict) else payload


def _geeknow_status(payload: dict) -> str:
    task = _geeknow_task(payload)
    return str(task.get("status") or payload.get("status") or "").strip().lower()


def _geeknow_result_url(payload: dict) -> str:
    task = _geeknow_task(payload)
    content = task.get("content") if isinstance(task.get("content"), dict) else {}
    for value in (content.get("url"), task.get("video_url"), task.get("url"), payload.get("video_url"), payload.get("url")):
        if not isinstance(value, str):
            continue
        parsed = urllib.parse.urlparse(value.strip())
        host = (parsed.hostname or "").lower()
        if parsed.scheme == "https" and host and host not in {"localhost"} and not host.endswith(".local") and not host.replace(".", "").isdigit():
            return value.strip()
    return ""


def _stream_response(response, content_type: str) -> StreamingResponse:
    media_type = (content_type or "video/mp4").split(";", 1)[0]

    def chunks():
        try:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            response.close()

    return StreamingResponse(chunks(), media_type=media_type)


@router.post("/geeknow/uploads")
async def upload_geeknow_file(
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    raw = await file.read()
    if len(raw) < 32 or len(raw) > 50 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件为空或超过 50MB")
    suffix = Path(file.filename or "asset.bin").suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        suffix = ".bin"
    filename = f"asset{suffix}"
    content_type = file.content_type or "application/octet-stream"
    presign = _geeknow_json(
        "POST",
        "/api/upload/presign",
        _geeknow_api_key(db, username=user.username),
        json.dumps({"file_name": filename, "content_type": content_type, "expires_in": 900}, ensure_ascii=False).encode("utf-8"),
        {"Content-Type": "application/json"},
        timeout=30,
    )
    data = presign.get("data") if isinstance(presign.get("data"), dict) else {}
    upload_url = str(data.get("upload_url") or "")
    public_url = str(data.get("public_url") or "")
    if not upload_url.startswith("https://") or not public_url.startswith("https://"):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Geeknow 没有返回可上传的地址")
    with _geeknow_open("PUT", upload_url, "", raw, {"Content-Type": content_type}, timeout=180) as uploaded:
        uploaded.read()
    return {"url": public_url}


@router.post("/geeknow/videos")
def create_geeknow_video(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    model = _text(payload.get("model"), 120)
    _require_model_access(db, user.username, model)
    prompt = _text(payload.get("prompt"), 8000)
    content = payload.get("content")
    content_prompt = ""
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                content_prompt = _text(item.get("text"), 8000)
                break
    if not model or not (prompt or content_prompt):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="缺少模型或提示词")
    body = {key: value for key, value in payload.items() if key != "idempotency_key"}
    idempotency = _text(payload.get("idempotency_key"), 80)
    record_operation_log(
        db,
        username=user.username,
        operation_type="调用 Geeknow",
        target_type="canvas_api",
        target_name=model,
        after_data={"path": "/v1/videos"},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return _geeknow_json(
        "POST",
        "/v1/videos",
        _geeknow_api_key(db, username=user.username),
        json.dumps(body, ensure_ascii=False).encode("utf-8"),
        {"Content-Type": "application/json", **({"Idempotency-Key": idempotency} if idempotency else {})},
        timeout=90,
    )


@router.get("/geeknow/videos/{task_id}")
def read_geeknow_video(
    task_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    if GEEKNOW_TASK_ID.fullmatch(task_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return _geeknow_json("GET", f"/v1/videos/{task_id}", _geeknow_api_key(db, username=user.username), timeout=40)


@router.get("/geeknow/videos/{task_id}/content")
def read_geeknow_video_content(
    task_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    user = _user(credentials)
    if GEEKNOW_TASK_ID.fullmatch(task_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    api_key = _geeknow_api_key(db, username=user.username)
    payload = _geeknow_json("GET", f"/v1/videos/{task_id}", api_key, timeout=40)
    state = _geeknow_status(payload)
    if state in GEEKNOW_FAILED:
        task = _geeknow_task(payload)
        error = task.get("error")
        message = error.get("message") if isinstance(error, dict) else error
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(message or "生成失败")[:500])
    if state not in GEEKNOW_DONE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="视频尚未生成")
    result_url = _geeknow_result_url(payload)
    if result_url:
        try:
            response = _geeknow_open("GET", result_url, "", headers={"Accept": "*/*"}, timeout=300)
            return _stream_response(response, response.headers.get("Content-Type") or "video/mp4")
        except HTTPException:
            pass
    response = _geeknow_open("GET", f"{GEEKNOW_ORIGIN}/v1/videos/{task_id}/content", api_key, headers={"Accept": "*/*"}, timeout=300)
    content_type = response.headers.get("Content-Type") or "video/mp4"
    if content_type.startswith("application/json") or content_type.startswith("text/"):
        response.close()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="视频尚未生成")
    return _stream_response(response, content_type)


# Metaso (秘塔) MiniMax v2 — https://metaso.cn/minimax-h3
METASO_ORIGIN = "https://metaso.cn"
METASO_TASK_ID = re.compile(r"^[A-Za-z0-9_-]{4,128}$")


def _metaso_api_key(db: Session, override: str = "", username: str = "") -> str:
    key = override.strip()
    if key:
        return key
    return _provider_api_key(db, ("metaso.cn",), username, "还没有保存秘塔 Metaso 的密钥")


def _metaso_open(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 90):
    request_headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        **(headers or {}),
    }
    request = urllib.request.Request(f"{METASO_ORIGIN}{path}", data=data, method=method, headers=request_headers)
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            payload = {}
        message = ""
        if isinstance(payload, dict):
            message = str(payload.get("detail") or payload.get("message") or payload.get("msg") or payload.get("errorMessage") or "").strip()
            err = payload.get("error")
            if not message and isinstance(err, dict):
                message = str(err.get("message") or "").strip()
            elif not message and isinstance(err, str):
                message = err.strip()
            base = payload.get("base_resp")
            if not message and isinstance(base, dict):
                message = str(base.get("status_msg") or "").strip()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message or f"秘塔返回 {exc.code}") from None


def _metaso_json(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 90) -> dict:
    with _metaso_open(method, path, api_key, data, headers, timeout) as response:
        raw = response.read()
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="秘塔返回了无法识别的内容") from exc
    if not isinstance(payload, dict):
        return {"data": payload}
    return payload


@router.post("/metaso/media")
async def store_metaso_media(
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    """Public-fetchable reference file for Metaso (same media dir as AI007 refs)."""
    _user(credentials)
    raw = await file.read()
    if len(raw) < 32 or len(raw) > 100 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件为空或超过 100MB")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".webm", ".mov", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3", ".wav", ".m4a"}:
        content_type = (file.content_type or "").lower()
        suffix = (
            ".mp4"
            if content_type.startswith("video/")
            else ".mp3"
            if content_type.startswith("audio/")
            else ".png"
            if content_type.startswith("image/")
            else ""
        )
    if not suffix:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件格式不支持")
    token = secrets.token_urlsafe(24)
    target = _media_dir() / f"{token}{suffix}"
    target.write_bytes(raw)
    return {"path": f"/canvas-api/metaso/media/{token}{suffix}"}


@router.get("/metaso/media/{name}")
def read_metaso_media(name: str) -> FileResponse:
    if re.fullmatch(r"[A-Za-z0-9_-]{16,80}\.(mp4|webm|mov|png|jpg|jpeg|webp|gif|mp3|wav|m4a)", name) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    path = _media_dir() / name
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    return FileResponse(path)


@router.post("/metaso/video_generation")
def create_metaso_video(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """POST https://metaso.cn/api/minimax/v2/video_generation"""
    user = _user(credentials)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请求体无效")
    model = str(payload.get("model") or "").strip()[:120]
    _require_model_access(db, user.username, model)
    record_operation_log(
        db,
        username=user.username,
        operation_type="调用秘塔 Metaso",
        target_type="canvas_api",
        target_name=model or "metaso",
        after_data={"path": "/api/minimax/v2/video_generation"},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return _metaso_json(
        "POST",
        "/api/minimax/v2/video_generation",
        _metaso_api_key(db, username=user.username),
        body,
        {"Content-Type": "application/json"},
        timeout=120,
    )


@router.get("/metaso/query/video_generation/{task_id}")
def query_metaso_video(
    task_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """GET https://metaso.cn/api/minimax/v2/query/video_generation/{task_id}"""
    user = _user(credentials)
    if METASO_TASK_ID.fullmatch(task_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="taskId 无效")
    try:
        return _metaso_json("GET", f"/api/minimax/v2/query/video_generation/{task_id}", _metaso_api_key(db, username=user.username), timeout=60)
    except HTTPException as exc:
        # Some Metaso builds accept query-string form.
        if exc.status_code != 502:
            raise
        return _metaso_json(
            "GET",
            f"/api/minimax/v2/query/video_generation?task_id={urllib.parse.quote(task_id)}",
            _metaso_api_key(db, username=user.username),
            timeout=60,
        )


# Volcano Ark Seedance — https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
VOLCANO_ORIGIN = "https://ark.cn-beijing.volces.com"
VOLCANO_TASK_ID = re.compile(r"^[A-Za-z0-9_-]{4,128}$")


def _volcano_api_key(db: Session, override: str = "", username: str = "") -> str:
    key = override.strip()
    if key:
        return key
    for item in _stored_channels(db):
        if not isinstance(item, dict):
            continue
        base_url = str(item.get("baseUrl") or "").lower()
        name = str(item.get("name") or "").lower()
        if not ("volces.com" in base_url or "volcengine" in base_url or name in {"volcengine", "火山引擎", "火山方舟"}):
            continue
        api_key = _key_for_user(item, username)
        if api_key:
            return api_key
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="还没有保存火山引擎的密钥")


def _volcano_open(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 90):
    request_headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        **(headers or {}),
    }
    request = urllib.request.Request(f"{VOLCANO_ORIGIN}{path}", data=data, method=method, headers=request_headers)
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            payload = {}
        message = ""
        if isinstance(payload, dict):
            message = str(payload.get("detail") or payload.get("message") or payload.get("msg") or payload.get("errorMessage") or "").strip()
            err = payload.get("error")
            if not message and isinstance(err, dict):
                message = str(err.get("message") or "").strip()
            elif not message and isinstance(err, str):
                message = err.strip()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message or f"火山引擎返回 {exc.code}") from None


def _volcano_json(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 90) -> dict:
    with _volcano_open(method, path, api_key, data, headers, timeout) as response:
        raw = response.read()
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="火山引擎返回了无法识别的内容") from exc
    if not isinstance(payload, dict):
        return {"data": payload}
    return payload


@router.post("/volcano/media")
async def store_volcano_media(
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    """Public-fetchable reference file for Volcano Ark (same media dir as Metaso refs)."""
    _user(credentials)
    raw = await file.read()
    if len(raw) < 32 or len(raw) > 100 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件为空或超过 100MB")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".webm", ".mov", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3", ".wav", ".m4a"}:
        content_type = (file.content_type or "").lower()
        suffix = (
            ".mp4"
            if content_type.startswith("video/")
            else ".mp3"
            if content_type.startswith("audio/")
            else ".png"
            if content_type.startswith("image/")
            else ""
        )
    if not suffix:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件格式不支持")
    token = secrets.token_urlsafe(24)
    target = _media_dir() / f"{token}{suffix}"
    target.write_bytes(raw)
    return {"path": f"/canvas-api/volcano/media/{token}{suffix}"}


@router.get("/volcano/media/{name}")
def read_volcano_media(name: str) -> FileResponse:
    if re.fullmatch(r"[A-Za-z0-9_-]{16,80}\.(mp4|webm|mov|png|jpg|jpeg|webp|gif|mp3|wav|m4a)", name) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    path = _media_dir() / name
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    return FileResponse(path)


@router.post("/volcano/video_generation")
def create_volcano_video(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"""
    user = _user(credentials)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请求体无效")
    model = str(payload.get("model") or "").strip()[:120]
    _require_model_access(db, user.username, model)
    record_operation_log(
        db,
        username=user.username,
        operation_type="调用火山引擎 Seedance",
        target_type="canvas_api",
        target_name=model or "volcengine",
        after_data={"path": "/api/v3/contents/generations/tasks"},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return _volcano_json(
        "POST",
        "/api/v3/contents/generations/tasks",
        _volcano_api_key(db, username=user.username),
        body,
        {"Content-Type": "application/json"},
        timeout=120,
    )


@router.get("/volcano/query/video_generation/{task_id}")
def query_volcano_video(
    task_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{task_id}"""
    user = _user(credentials)
    if VOLCANO_TASK_ID.fullmatch(task_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="taskId 无效")
    return _volcano_json(
        "GET",
        f"/api/v3/contents/generations/tasks/{urllib.parse.quote(task_id)}",
        _volcano_api_key(db, username=user.username),
        timeout=60,
    )


RUNNINGHUB_ORIGIN = "https://www.runninghub.cn"
RUNNINGHUB_WEBAPP_ID = re.compile(r"^\d{10,22}$")
RUNNINGHUB_TASK_ID = re.compile(r"^[A-Za-z0-9_-]{6,128}$")


def _runninghub_api_key(db: Session, override: str = "", username: str = "") -> str:
    key = override.strip()
    if key:
        return key
    return _provider_api_key(db, ("runninghub.cn", "runninghub.ai"), username, "还没有保存 RunningHub 的密钥")


def _runninghub_instance_type(value: object) -> str:
    """Map UI / config to RH OpenAPI instanceType: default(24G) | plus(48G) | ultra(84G).

    Docs: POST /task/openapi/create — instanceType enum only accepts these three strings.
    """
    raw = str(value or "").strip().lower().replace(" ", "")
    if raw in {"plus", "48", "48g", "48gb"}:
        return "plus"
    if raw in {"ultra", "84", "84g", "84gb"}:
        return "ultra"
    if raw in {"default", "standard", "24", "24g", "24gb", ""}:
        return "default"
    # Unknown values must not silently become default when they look like plus/ultra aliases.
    if "48" in raw or "plus" in raw:
        return "plus"
    if "84" in raw or "ultra" in raw:
        return "ultra"
    return "default"


def _runninghub_message(payload: object, status_code: int) -> str:
    if isinstance(payload, dict):
        for key in ("msg", "message", "errorMessage", "detail"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip() and value.strip().lower() not in {"success", "ok"}:
                return value.strip()[:500]
        error = payload.get("error")
        if isinstance(error, dict):
            nested = error.get("message") or error.get("exception_message")
            if isinstance(nested, str) and nested.strip():
                return nested.strip()[:500]
        if isinstance(error, str) and error.strip():
            return error.strip()[:500]
    return (_upstream_message(payload) or f"RunningHub 返回 {status_code}")[:500]


def _runninghub_multipart(file_name: str, content_type: str, raw: bytes) -> tuple[bytes, str]:
    boundary = f"----lcwpRH{uuid.uuid4().hex}"
    disposition = f'form-data; name="file"; filename="{file_name}"'
    chunks = [
        f"--{boundary}\r\n".encode("utf-8"),
        f"Content-Disposition: {disposition}\r\n".encode("utf-8"),
        f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
        raw,
        b"\r\n",
        f"--{boundary}--\r\n".encode("utf-8"),
    ]
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _runninghub_open(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 90):
    request_headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Host": "www.runninghub.cn",
        **(headers or {}),
    }
    request = urllib.request.Request(f"{RUNNINGHUB_ORIGIN}{path}", data=data, method=method, headers=request_headers)
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            payload = {}
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_runninghub_message(payload, exc.code)) from None


def _normalize_runninghub_v2_run_payload(payload: dict) -> dict:
    """OpenAPI v2 /run/ai-app returns a flat body (taskId/status/errorCode), not {code,data}."""
    if "code" in payload or "taskId" not in payload:
        return payload
    task_id = str(payload.get("taskId") or "").strip()
    error_code = str(payload.get("errorCode") or "").strip()
    error_message = str(payload.get("errorMessage") or "").strip()
    status_text = str(payload.get("status") or "").strip().upper()
    if error_code and error_code not in {"0", "200"}:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=error_message or f"RunningHub 错误 {error_code}",
        )
    if status_text in {"FAILED", "ERROR"}:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=error_message or "RunningHub 任务失败")
    if not task_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=error_message or "RunningHub 没有返回 taskId",
        )
    return {
        "code": 0,
        "msg": "success",
        "data": {
            "taskId": task_id,
            "taskStatus": payload.get("status") or "RUNNING",
            "clientId": payload.get("clientId") or "",
            "promptTips": payload.get("promptTips") or "",
            "netWssUrl": payload.get("netWssUrl") or "",
        },
    }


def _runninghub_json(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 90, *, reject_error_code: bool = False) -> dict:
    with _runninghub_open(method, path, api_key, data, headers, timeout) as response:
        raw = response.read()
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="RunningHub 返回了无法识别的内容") from exc
    if not isinstance(payload, dict):
        return {"data": payload}
    if "/openapi/v2/run/" in path or path.startswith("/openapi/v2/run/"):
        payload = _normalize_runninghub_v2_run_payload(payload)
    code = payload.get("code")
    # 0 success; 804/813 queued/running; others may still be useful query payloads.
    if reject_error_code and code not in (None, 0, "0") and str(code) not in {"804", "813"}:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_runninghub_message(payload, 400))
    return payload


@router.post("/runninghub/account-status")
def runninghub_account_status(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """RunningHub 账户剩余 RH 币。密钥留在服务端。"""
    user = _user(credentials)
    api_key = _runninghub_api_key(db, username=user.username)
    payload = _runninghub_json(
        "POST",
        "/uc/openapi/accountStatus",
        api_key,
        json.dumps({"apikey": api_key}).encode("utf-8"),
        {"Content-Type": "application/json"},
        timeout=20,
        reject_error_code=True,
    )
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    coins = str(data.get("remainCoins") or "").strip()
    if not coins:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="RunningHub 没有返回剩余 RH 币")
    return {"remainCoins": coins[:32]}


DEEPSEEK_ORIGIN = "https://api.deepseek.com"


def _deepseek_api_key(db: Session, username: str = "") -> str:
    return _provider_api_key(db, ("deepseek.com",), username, "还没有保存 DeepSeek 的密钥")


@router.get("/deepseek/balance")
def deepseek_balance(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """DeepSeek 官方账户余额。只返回金额和币种。"""
    user = _user(credentials)
    api_key = _deepseek_api_key(db, user.username)
    request = urllib.request.Request(
        f"{DEEPSEEK_ORIGIN}/user/balance",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json", "User-Agent": "Mozilla/5.0"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:180]
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail or "DeepSeek 余额查询失败") from None
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="DeepSeek 返回了无法识别的内容") from exc
    infos = payload.get("balance_infos") if isinstance(payload, dict) else None
    rows = [item for item in infos if isinstance(item, dict)] if isinstance(infos, list) else []
    chosen = next((item for item in rows if str(item.get("currency") or "") == "CNY"), rows[0] if rows else None)
    if not isinstance(chosen, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="DeepSeek 没有返回余额")
    total = str(chosen.get("total_balance") or "").strip()
    currency = str(chosen.get("currency") or "CNY").strip()[:8] or "CNY"
    if not total:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="DeepSeek 没有返回余额")
    return {"totalBalance": total[:32], "currency": currency}


@router.post("/runninghub/upload")
async def upload_runninghub_file(
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    raw = await file.read()
    if len(raw) < 8 or len(raw) > 200 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件为空或超过 200MB")
    filename = Path(file.filename or "asset.bin").name or "asset.bin"
    body, content_type = _runninghub_multipart(filename, file.content_type or "application/octet-stream", raw)
    return _runninghub_json(
        "POST",
        "/openapi/v2/media/upload/binary",
        _runninghub_api_key(db, username=user.username),
        body,
        {"Content-Type": content_type},
        timeout=180,
        reject_error_code=True,
    )


@router.post("/runninghub/workflow/run")
def run_runninghub_workflow(
    payload: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Start a RunningHub ComfyUI workflow.

    Prefer OpenAPI v2 /run/workflow/{id} (official Minimax examples send instanceType here).
    Fall back to /task/openapi/create. instanceType: default=24G, plus=48G, ultra=84G.
    """
    user = _user(credentials)
    workflow_id = str(payload.get("workflowId") or payload.get("webappId") or "").strip()
    _require_model_access(db, user.username, workflow_id)
    if RUNNINGHUB_WEBAPP_ID.fullmatch(workflow_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="workflowId 无效")
    node_info_list = payload.get("nodeInfoList")
    if not isinstance(node_info_list, list) or not node_info_list:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="nodeInfoList 不能为空")
    cleaned_nodes: list[dict] = []
    for item in node_info_list[:120]:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("nodeId") or "").strip()
        field_name = str(item.get("fieldName") or "").strip()
        field_value = item.get("fieldValue")
        if not node_id or not field_name:
            continue
        cleaned_nodes.append({"nodeId": node_id, "fieldName": field_name, "fieldValue": "" if field_value is None else str(field_value)})
    if not cleaned_nodes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="nodeInfoList 无效")
    api_key = _runninghub_api_key(db, username=user.username)
    raw_instance = payload.get("instanceType")
    instance_type = _runninghub_instance_type(raw_instance)
    logger = __import__("logging").getLogger("uvicorn.error")
    logger.info(
        "runninghub workflow/run workflowId=%s instanceType_raw=%r instanceType=%s nodes=%s",
        workflow_id,
        raw_instance,
        instance_type,
        len(cleaned_nodes),
    )
    # Official Minimax / workflow demos: v2 body includes instanceType (+ apiKey for consumer keys).
    v2_body = json.dumps(
        {
            "apiKey": api_key,
            "nodeInfoList": cleaned_nodes,
            "instanceType": instance_type,
            "addMetadata": True,
            "usePersonalQueue": False,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    try:
        return _runninghub_json(
            "POST",
            f"/openapi/v2/run/workflow/{workflow_id}",
            api_key,
            v2_body,
            {"Content-Type": "application/json"},
            timeout=120,
            reject_error_code=True,
        )
    except HTTPException as exc:
        detail = str(exc.detail or "").lower()
        if exc.status_code != 404 and "not found" not in detail:
            raise
        create_body = json.dumps(
            {
                "apiKey": api_key,
                "workflowId": workflow_id,
                "nodeInfoList": cleaned_nodes,
                "addMetadata": True,
                "instanceType": instance_type,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        return _runninghub_json(
            "POST",
            "/task/openapi/create",
            api_key,
            create_body,
            {"Content-Type": "application/json"},
            timeout=120,
            reject_error_code=True,
        )


@router.post("/runninghub/ai-app/run")
def run_runninghub_ai_app(
    payload: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    webapp_id = str(payload.get("webappId") or payload.get("workflowId") or "").strip()
    _require_model_access(db, user.username, webapp_id)
    if RUNNINGHUB_WEBAPP_ID.fullmatch(webapp_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="webappId 无效")
    node_info_list = payload.get("nodeInfoList")
    if not isinstance(node_info_list, list) or not node_info_list:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="nodeInfoList 不能为空")
    cleaned_nodes: list[dict] = []
    for item in node_info_list[:80]:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("nodeId") or "").strip()
        field_name = str(item.get("fieldName") or "").strip()
        field_value = item.get("fieldValue")
        if not node_id or not field_name:
            continue
        cleaned_nodes.append({"nodeId": node_id, "fieldName": field_name, "fieldValue": "" if field_value is None else str(field_value)})
    if not cleaned_nodes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="nodeInfoList 无效")
    api_key = _runninghub_api_key(db, username=user.username)
    # RH OpenAPI: instanceType default=24G Standard, plus=48G, ultra=84G — must forward on both v2 and legacy.
    instance_type = _runninghub_instance_type(payload.get("instanceType"))
    body_obj: dict = {"nodeInfoList": cleaned_nodes, "instanceType": instance_type}
    body = json.dumps(body_obj, ensure_ascii=False).encode("utf-8")
    try:
        return _runninghub_json(
            "POST",
            f"/openapi/v2/run/ai-app/{webapp_id}",
            api_key,
            body,
            {"Content-Type": "application/json"},
            timeout=120,
            reject_error_code=True,
        )
    except HTTPException as exc:
        detail = str(exc.detail or "").lower()
        # Only fall back when the v2 route itself is missing — not on business errors (e.g. queue full).
        if exc.status_code != 404 and "404" not in detail and "not found" not in detail:
            raise
        legacy_obj: dict = {
            "apiKey": api_key,
            "webappId": webapp_id,
            "nodeInfoList": cleaned_nodes,
            "instanceType": instance_type,
        }
        legacy = json.dumps(legacy_obj, ensure_ascii=False).encode("utf-8")
        return _runninghub_json(
            "POST",
            "/task/openapi/ai-app/run",
            api_key,
            legacy,
            {"Content-Type": "application/json"},
            timeout=120,
            reject_error_code=True,
        )


@router.post("/runninghub/query")
def query_runninghub_task(
    payload: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    task_id = str(payload.get("taskId") or payload.get("task_id") or "").strip()
    if RUNNINGHUB_TASK_ID.fullmatch(task_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="taskId 无效")
    api_key = _runninghub_api_key(db, username=user.username)
    body = json.dumps({"taskId": task_id}, ensure_ascii=False).encode("utf-8")
    try:
        return _runninghub_json(
            "POST",
            "/openapi/v2/query",
            api_key,
            body,
            {"Content-Type": "application/json"},
            timeout=60,
        )
    except HTTPException:
        legacy = json.dumps({"apiKey": api_key, "taskId": task_id}, ensure_ascii=False).encode("utf-8")
        return _runninghub_json(
            "POST",
            "/task/openapi/outputs",
            api_key,
            legacy,
            {"Content-Type": "application/json"},
            timeout=60,
        )


@router.post("/runninghub/cancel")
def cancel_runninghub_task(
    payload: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Cancel a RunningHub task: POST /task/openapi/cancel (apiKey + taskId)."""
    user = _user(credentials)
    task_id = str(payload.get("taskId") or payload.get("task_id") or "").strip()
    if RUNNINGHUB_TASK_ID.fullmatch(task_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="taskId 无效")
    api_key = _runninghub_api_key(db, username=user.username)
    body = json.dumps({"apiKey": api_key, "taskId": task_id}, ensure_ascii=False).encode("utf-8")
    return _runninghub_json(
        "POST",
        "/task/openapi/cancel",
        api_key,
        body,
        {"Content-Type": "application/json"},
        timeout=60,
        reject_error_code=True,
    )


@router.get("/media-auth", status_code=204)
def authorize_canvas_media(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> Response:
    """nginx auth_request before it sendfiles a cached image or video."""
    _user(credentials)
    return Response(status_code=204)


# RH CDN hosts (TOS / edge). Browser CORS blocks direct fetch; cache server-side then serve.
# Official query examples also use cos.ap-*.myqcloud.com; keep volces/xiaoyaoyou/runninghub.
RUNNINGHUB_RESULT_HOST = re.compile(
    r"(?i)^(?:[a-z0-9-]+\.)*(?:volces\.com|xiaoyaoyou\.com|runninghub\.cn|runninghub\.ai|myqcloud\.com)$"
)
RUNNINGHUB_RESULT_MAX_BYTES = 200 * 1024 * 1024
RUNNINGHUB_RESULT_NAME = re.compile(r"^rh-[A-Za-z0-9_-]{8,80}\.(mp4|webm|mov)$")


@router.post("/runninghub/result-file")
def fetch_runninghub_result_file(
    payload: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    """Download RH result to ECS cache; return a same-origin path (avoids streaming 30MB+ through Next rewrite)."""
    _user(credentials)
    url = str(payload.get("url") or "").strip()
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").strip().lower()
    if parsed.scheme not in {"http", "https"} or not host or RUNNINGHUB_RESULT_HOST.fullmatch(host) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结果地址无效")
    request = urllib.request.Request(
        url,
        method="GET",
        headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*"},
    )
    try:
        upstream = urllib.request.urlopen(request, timeout=600)
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"拉取 RunningHub 成片失败 ({exc.code})") from None
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="拉取 RunningHub 成片失败") from exc

    content_type = (upstream.headers.get("Content-Type") or "video/mp4").split(";")[0].strip() or "video/mp4"
    suffix = ".webm" if "webm" in content_type else ".mov" if "quicktime" in content_type or "mov" in content_type else ".mp4"
    name = f"rh-{secrets.token_urlsafe(18)}{suffix}"
    target = _media_dir() / name
    total = 0
    try:
        with target.open("wb") as out:
            while True:
                chunk = upstream.read(1024 * 256)
                if not chunk:
                    break
                total += len(chunk)
                if total > RUNNINGHUB_RESULT_MAX_BYTES:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="成片超过 200MB")
                out.write(chunk)
    except HTTPException:
        target.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="拉取 RunningHub 成片失败") from exc
    finally:
        upstream.close()

    if total < 64:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="RunningHub 成片为空")

    return {
        "path": f"/canvas-api/runninghub/cached-result/{name}",
        "bytes": total,
        "mimeType": content_type if content_type.startswith("video/") else "video/mp4",
    }


@router.get("/runninghub/cached-result/{name}")
def read_runninghub_cached_result(
    name: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> FileResponse:
    _user(credentials)
    if RUNNINGHUB_RESULT_NAME.fullmatch(name) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    path = _media_dir() / name
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    media = "video/webm" if name.endswith(".webm") else "video/quicktime" if name.endswith(".mov") else "video/mp4"
    return FileResponse(path, media_type=media, filename=name)


GENERATED_MEDIA_MAX_BYTES = 200 * 1024 * 1024
GENERATED_MEDIA_NAME = re.compile(r"^gen-[A-Za-z0-9_-]{8,80}\.(mp4|webm|mov|png|jpe?g|webp|gif)$")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def _public_https_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    host = (parsed.hostname or "").strip().lower().rstrip(".")
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结果地址无效")
    if host in {"localhost"} or host.endswith(".local") or host.endswith(".internal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结果地址无效")
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结果地址无效") from None
    if not infos:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结果地址无效")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结果地址无效")
    return url.strip()


def _generated_suffix(content_type: str, head: bytes) -> str:
    kind = content_type.split(";")[0].strip().lower()
    if kind == "image/png" or head.startswith(b"\x89PNG"):
        return ".png"
    if kind in {"image/jpeg", "image/jpg"} or head.startswith(b"\xff\xd8"):
        return ".jpg"
    if kind == "image/webp" or (head.startswith(b"RIFF") and b"WEBP" in head[:16]):
        return ".webp"
    if kind == "image/gif" or head.startswith(b"GIF8"):
        return ".gif"
    if kind == "video/webm" or head.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    if kind in {"video/quicktime", "video/mov"}:
        return ".mov"
    if kind.startswith("video/") or b"ftyp" in head[:32]:
        return ".mp4"
    if kind.startswith("image/"):
        return ".png"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="成品不是图片或视频")


def _open_generated_media(url: str):
    opener = urllib.request.build_opener(_NoRedirect)
    current = _public_https_url(url)
    for _ in range(4):
        request = urllib.request.Request(current, method="GET", headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*"})
        try:
            return opener.open(request, timeout=600)
        except urllib.error.HTTPError as exc:
            if exc.code in {301, 302, 303, 307, 308}:
                location = exc.headers.get("Location") or ""
                exc.close()
                current = _public_https_url(urllib.parse.urljoin(current, location))
                continue
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"拉取成品失败 ({exc.code})") from None
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="拉取成品失败") from exc
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="拉取成品失败")


@router.post("/generated-media")
def fetch_generated_media(
    payload: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    """Download a generated image or video the browser cannot fetch, then serve it same-origin."""
    _user(credentials)
    upstream = _open_generated_media(str(payload.get("url") or ""))
    content_type = (upstream.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    target: Path | None = None
    total = 0
    try:
        head = upstream.read(64)
        if not head:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="成品为空")
        suffix = _generated_suffix(content_type, head)
        name = f"gen-{secrets.token_urlsafe(18)}{suffix}"
        target = _media_dir() / name
        with target.open("wb") as out:
            out.write(head)
            total = len(head)
            while True:
                chunk = upstream.read(1024 * 256)
                if not chunk:
                    break
                total += len(chunk)
                if total > GENERATED_MEDIA_MAX_BYTES:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="成品超过 200MB")
                out.write(chunk)
    except HTTPException:
        if target is not None:
            target.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001
        if target is not None:
            target.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="拉取成品失败") from exc
    finally:
        upstream.close()
    if target is None or total < 32:
        if target is not None:
            target.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="成品为空")
    mime = "video/webm" if name.endswith(".webm") else "video/quicktime" if name.endswith(".mov") else "video/mp4" if name.endswith(".mp4") else "image/jpeg" if name.endswith(".jpg") else "image/webp" if name.endswith(".webp") else "image/gif" if name.endswith(".gif") else "image/png"
    return {"path": f"/canvas-api/generated-media/{name}", "bytes": total, "mimeType": mime}


@router.get("/generated-media/{name}")
def read_generated_media(
    name: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> FileResponse:
    _user(credentials)
    if GENERATED_MEDIA_NAME.fullmatch(name) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    path = _media_dir() / name
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    if name.endswith(".webm"):
        media = "video/webm"
    elif name.endswith(".mov"):
        media = "video/quicktime"
    elif name.endswith(".mp4"):
        media = "video/mp4"
    elif name.endswith(".jpg") or name.endswith(".jpeg"):
        media = "image/jpeg"
    elif name.endswith(".webp"):
        media = "image/webp"
    elif name.endswith(".gif"):
        media = "image/gif"
    else:
        media = "image/png"
    return FileResponse(path, media_type=media, filename=name)


# CRUN — https://docs.crun.ai/zh
CRUN_ORIGIN = "https://api.crun.ai"
CRUN_TASK_ID = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def _crun_api_key(db: Session, username: str = "") -> str:
    return _provider_api_key(db, ("crun.ai",), username, "还没有保存 CRUN 的密钥")


def _crun_message(payload: object, status_code: int) -> str:
    if isinstance(payload, dict):
        errors = payload.get("errors")
        if isinstance(errors, list):
            text = "；".join(str(item).strip() for item in errors if str(item).strip())
            if text:
                return text
        message = str(payload.get("message") or payload.get("msg") or payload.get("detail") or "").strip()
        if message and message.lower() != "success":
            return message
    return f"CRUN 返回 {status_code}"


def _crun_open(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 90):
    request_headers = {
        "X-API-KEY": api_key,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        **(headers or {}),
    }
    request = urllib.request.Request(f"{CRUN_ORIGIN}{path}", data=data, method=method, headers=request_headers)
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            payload = {}
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_crun_message(payload, exc.code)) from None


def _crun_json(method: str, path: str, api_key: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 90) -> dict:
    with _crun_open(method, path, api_key, data, headers, timeout) as response:
        raw = response.read()
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="CRUN 返回了无法识别的内容") from exc
    if not isinstance(payload, dict):
        return {"data": payload}
    code = payload.get("code")
    if isinstance(code, int) and code != 200:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_crun_message(payload, code))
    return payload


def _crun_endpoint_allowed(access_model: str, endpoint_model: str) -> bool:
    if endpoint_model == access_model:
        return True
    return endpoint_model.startswith(f"{access_model}-")


@router.post("/crun/uploads")
async def upload_crun_file(
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """GET a CRUN presigned URL, then PUT the bytes. CRUN only accepts media URLs."""
    user = _user(credentials)
    raw = await file.read()
    if len(raw) < 32 or len(raw) > 100 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件为空或超过 100MB")
    suffix = Path(file.filename or "").suffix.lower()
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".webm", ".mp3", ".wav", ".m4a"}:
        suffix = (
            ".mp4"
            if content_type.startswith("video/")
            else ".mp3"
            if content_type.startswith("audio/")
            else ".png"
            if content_type.startswith("image/")
            else ""
        )
    if not suffix:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考文件格式不支持")
    if not content_type or "/" not in content_type:
        content_type = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".mp4": "video/mp4",
            ".mov": "video/quicktime",
            ".webm": "video/webm",
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".m4a": "audio/mp4",
        }.get(suffix, "application/octet-stream")
    query = urllib.parse.urlencode({"content_type": content_type, "ext": suffix})
    issued = _crun_json("GET", f"/api/v1/client/files/upload-url?{query}", _crun_api_key(db, username=user.username), timeout=40)
    data = issued.get("data") if isinstance(issued.get("data"), dict) else {}
    presigned = str(data.get("presigned_url") or "").strip()
    file_url = str(data.get("file_url") or "").strip()
    if not presigned.startswith("https://") or not file_url.startswith("https://"):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="CRUN 没有返回上传地址")
    request = urllib.request.Request(presigned, data=raw, method="PUT", headers={"Content-Type": content_type})
    try:
        with urllib.request.urlopen(request, timeout=180) as uploaded:
            if uploaded.status >= 300:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="参考文件上传失败")
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"参考文件上传失败 ({exc.code})") from None
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="参考文件上传失败") from exc
    return {"file_url": file_url}


@router.post("/crun/tasks")
def create_crun_task(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """POST https://api.crun.ai/api/v1/client/job/CreateTask"""
    user = _user(credentials)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请求体无效")
    access_model = str(payload.get("accessModel") or "").strip()[:160]
    endpoint_model = str(payload.get("model") or "").strip()[:160]
    task_input = payload.get("input")
    if not access_model or not endpoint_model or not isinstance(task_input, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CRUN 模型或参数无效")
    if not _crun_endpoint_allowed(access_model, endpoint_model):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CRUN 模型不匹配")
    _require_model_access(db, user.username, access_model)
    record_operation_log(
        db,
        username=user.username,
        operation_type="调用 CRUN",
        target_type="canvas_api",
        target_name=endpoint_model,
        after_data={"path": "/api/v1/client/job/CreateTask", "accessModel": access_model},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    body = json.dumps({"model": endpoint_model, "input": task_input}, ensure_ascii=False).encode("utf-8")
    return _crun_json(
        "POST",
        "/api/v1/client/job/CreateTask",
        _crun_api_key(db, username=user.username),
        body,
        {"Content-Type": "application/json"},
        timeout=120,
    )


@router.get("/crun/tasks/{task_id}")
def query_crun_task(
    task_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """GET https://api.crun.ai/api/v1/client/job/TaskInfo"""
    user = _user(credentials)
    if CRUN_TASK_ID.fullmatch(task_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="taskId 无效")
    return _crun_json(
        "GET",
        f"/api/v1/client/job/TaskInfo?task_id={urllib.parse.quote(task_id)}",
        _crun_api_key(db, username=user.username),
        timeout=40,
    )
