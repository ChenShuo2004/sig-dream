"""File-machine jobs for the canvas studios (replication / replacement intake, replacement compose).

The browser uploads the source video here in chunks; the file-machine worker
transcodes it, extracts audio, detects cuts and grabs frames (replacement intake
also detects and clusters people), then uploads each file as a named output.
Outputs live under the canvas LAN directory and are cleaned up with it, so the
browser copies them into its own studio media store right after the job succeeds.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.api.routes.canvas_lan import _cleanup_old_jobs, canvas_lan_root
from app.api.routes.nas_jobs import named_output_path
from app.core.database import get_db
from app.core.security import ROLE_SUPER_ADMIN, bearer_scheme, decode_access_token, extract_bearer_token
from app.models.material import NasJob
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import ensure_permission, ensure_settings_seeded

router = APIRouter(prefix="/studio-jobs", tags=["studio-jobs"])

# URL segment -> (job_type, worker options, operation log type, running message)
STUDIO_FLOWS: dict[str, tuple[str, dict, str, str]] = {
    "replication-intake": (
        "replication_intake",
        {"max_seconds": 180, "threshold": 0.2, "width": 320, "max_cuts": 500},
        "studio_replication_intake",
        "文件机正在分析原片（转码、抽音频、切镜）。",
    ),
    "replacement-intake": (
        "replacement_intake",
        {"max_seconds": 300, "threshold": 0.2, "width": 320, "max_cuts": 500},
        "studio_replacement_intake",
        "文件机正在处理原片（转码、切镜、检测和识别人物）。",
    ),
    "replacement-compose": (
        "replacement_compose",
        {},
        "studio_replacement_compose",
        "文件机正在合成视频。",
    ),
    "replacement-media": (
        "replacement_media",
        {},
        "studio_replacement_media",
        "文件机正在处理素材。",
    ),
}
# Flows whose upload is a packed bundle of segments/audio described by the compose plan, not a source video.
BUNDLE_FLOWS = {"replacement-compose"}
MEDIA_FLOWS = {"replacement-media"}
MEDIA_OPS = {"reverse", "trim", "separate"}
AUDIO_SUFFIXES = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}
MAX_CUT_BOUNDS = 500
MAX_COMPOSE_SEGMENTS = 300
MAX_COMPOSE_LINES = 600
STUDIO_JOB_TYPES = {flow[0] for flow in STUDIO_FLOWS.values()}
MAX_VIDEO_BYTES = 500 * 1024 * 1024
# The browser reaches the API through Next middleware, which buffers at most ~10MB per request body.
CHUNK_BYTES = 4 * 1024 * 1024
UPLOAD_META = "upload.json"
VIDEO_SUFFIXES = {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"}
_MEDIA_TYPES = {".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json"}

_seeded = False


def _user(credentials: HTTPAuthorizationCredentials | None, db: Session):
    global _seeded
    user = decode_access_token(extract_bearer_token(credentials))
    if not _seeded:
        ensure_settings_seeded(db)
        _seeded = True
    ensure_permission(db, user.username, "studio.use")
    return user


def _flow(flow: str) -> tuple[str, dict, str, str]:
    if flow not in STUDIO_FLOWS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未知的工作室任务")
    return STUDIO_FLOWS[flow]


def _owned_job(db: Session, job_id: str, username: str, role: str) -> NasJob:
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="任务编号无效") from exc
    job = db.get(NasJob, job_uuid)
    if job is None or str(job.job_type or "") not in STUDIO_JOB_TYPES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    owner = str((job.payload or {}).get("owner") or "")
    if owner != username and role != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return job


def _upload_dir(upload_id: str, username: str, flow: str) -> tuple[Path, dict]:
    try:
        upload_uuid = uuid.UUID(upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="上传编号无效") from exc
    directory = canvas_lan_root() / str(upload_uuid)
    meta_path = directory / UPLOAD_META
    if not meta_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传不存在或已过期")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("owner") != username or meta.get("flow", "replication-intake") != flow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传不存在或已过期")
    return directory, meta


def _bundle_entry(value, size: int) -> dict:
    if not isinstance(value, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="合成计划缺少文件位置")
    offset, length = int(value.get("offset") or 0), int(value.get("size") or 0)
    if offset < 0 or length <= 0 or offset + length > size:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="合成计划的文件位置超出素材包")
    return {"offset": offset, "size": length}


def _compose_plan(value, size: int) -> dict:
    if not isinstance(value, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="缺少合成计划")
    segments = value.get("segments") or []
    lines = value.get("lines") or []
    if not isinstance(segments, list) or not segments or len(segments) > MAX_COMPOSE_SEGMENTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"合成片段数量需在 1 到 {MAX_COMPOSE_SEGMENTS} 之间")
    if not isinstance(lines, list) or len(lines) > MAX_COMPOSE_LINES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="配音句子过多")
    audio = value.get("audio") if isinstance(value.get("audio"), dict) else {}
    return {
        "width": int(value.get("width") or 720),
        "height": int(value.get("height") or 1280),
        "fps": int(value.get("fps") or 30),
        "segments": [{"file": _bundle_entry(item.get("file"), size), "duration": float(item.get("duration") or 0)} for item in segments if isinstance(item, dict)],
        "audio": {"file": _bundle_entry(audio["file"], size), "volume": float(audio.get("volume", 1.0))} if audio.get("file") else {},
        "lines": [{"file": _bundle_entry(item.get("file"), size), "start": float(item.get("start") or 0), "volume": float(item.get("volume", 1.0))} for item in lines if isinstance(item, dict)],
    }


def _media_request(value) -> dict:
    if not isinstance(value, dict) or value.get("op") not in MEDIA_OPS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未知的素材处理类型")
    request = {"op": value["op"]}
    if value["op"] == "trim":
        start, end = float(value.get("start") or 0), float(value.get("end") or 0)
        if start < 0 or end <= start:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="裁剪区间无效")
        request.update(start=start, end=end)
    return request


def _intake_overrides(value) -> dict:
    if not isinstance(value, dict):
        return {}
    overrides: dict = {}
    if value.get("skip_cuts"):
        overrides["skip_cuts"] = True
    bounds = value.get("bounds")
    if isinstance(bounds, list):
        if len(bounds) > MAX_CUT_BOUNDS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="切点过多")
        overrides["bounds"] = [round(float(item), 3) for item in bounds if isinstance(item, (int, float))]
    return overrides


@router.post("/{flow}/uploads")
def init_studio_upload(
    flow: str,
    body: dict = Body(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    _flow(flow)
    filename = str(body.get("filename") or "")[:200]
    size = int(body.get("size") or 0)
    suffix = Path(filename or "source.mp4").suffix.lower()
    if flow in BUNDLE_FLOWS:
        suffix = ".bin"
    elif flow in MEDIA_FLOWS:
        if suffix not in VIDEO_SUFFIXES | AUDIO_SUFFIXES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="只支持常见视频或音频文件")
    elif suffix not in VIDEO_SUFFIXES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="只支持 mp4 / mov / webm / mkv / m4v / avi 视频")
    if size < 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="视频文件为空")
    if size > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="视频不能超过 500MB")
    _cleanup_old_jobs()
    upload_id = uuid.uuid4()
    directory = canvas_lan_root() / str(upload_id)
    directory.mkdir(parents=True, exist_ok=True)
    meta = {"owner": user.username, "flow": flow, "filename": filename, "stored": f"source{suffix}", "size": size, "received": 0, "next_index": 0}
    (directory / UPLOAD_META).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    (directory / meta["stored"]).touch()
    return {"upload_id": str(upload_id), "chunk_size": CHUNK_BYTES}


@router.post("/{flow}/uploads/{upload_id}/chunks/{index}")
async def upload_studio_chunk(
    flow: str,
    upload_id: str,
    index: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    directory, meta = _upload_dir(upload_id, user.username, flow)
    if meta.get("job_id"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="上传已完成")
    if index != int(meta.get("next_index") or 0):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"分片顺序不对，需要第 {meta.get('next_index')} 片")
    data = await request.body()
    if not data or len(data) > CHUNK_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="分片大小无效")
    received = int(meta.get("received") or 0) + len(data)
    if received > int(meta["size"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="上传内容超过声明大小")
    with (directory / meta["stored"]).open("ab") as handle:
        handle.write(data)
    meta.update(received=received, next_index=index + 1)
    (directory / UPLOAD_META).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"received": received}


@router.post("/{flow}/uploads/{upload_id}/complete")
def complete_studio_upload(
    flow: str,
    upload_id: str,
    request: Request,
    body: dict = Body(default={}),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    user = _user(credentials, db)
    job_type, options, operation_type, _ = _flow(flow)
    directory, meta = _upload_dir(upload_id, user.username, flow)
    if meta.get("job_id"):
        return {"job_id": str(meta["job_id"])}
    if int(meta.get("received") or 0) != int(meta["size"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="视频还没有上传完整")
    project_id = str(body.get("project_id") or "")[:64]
    job_id = uuid.UUID(upload_id)
    payload = {
        "owner": user.username,
        "project_id": project_id,
        "source_name": meta.get("filename") or "",
        "inputs": {"source": meta["stored"]},
        "intake": dict(options),
    }
    if flow in BUNDLE_FLOWS:
        payload["compose"] = _compose_plan(body.get("compose"), int(meta["size"]))
    if flow in MEDIA_FLOWS:
        payload["media"] = _media_request(body.get("media"))
    if flow == "replacement-intake":
        payload["intake"].update(_intake_overrides(body.get("intake")))
    job = NasJob(
        id=job_id,
        job_type=job_type,
        payload=payload,
        status="pending",
        max_retries=0,
    )
    db.add(job)
    record_operation_log(
        db,
        username=user.username,
        operation_type=operation_type,
        target_type="studio_project",
        target_name=(meta.get("filename") or str(job_id))[:200],
        after_data={"job_id": str(job_id), "project_id": project_id, "size": meta["size"]},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    meta["job_id"] = str(job_id)
    (directory / UPLOAD_META).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"job_id": str(job_id)}


@router.get("/{job_id}")
def get_studio_job(
    job_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials, db)
    job = _owned_job(db, job_id, user.username, user.role)
    running = next((flow[3] for flow in STUDIO_FLOWS.values() if flow[0] == job.job_type), "文件机正在处理。")
    progress = (job.payload or {}).get("progress") or {}
    message = {
        "pending": "已进入文件机队列，等待领取。",
        "running": str(progress.get("label") or "") or running,
        "success": "完成",
        "failed": job.error_message or "文件机处理失败",
    }.get(str(job.status or ""), job.status)
    return {
        "job_id": str(job.id),
        "status": job.status,
        "message": message,
        "error_message": job.error_message,
        "result": job.result if job.status == "success" else None,
    }


@router.get("/{job_id}/files/{name}")
def download_studio_job_file(
    job_id: str,
    name: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    user = _user(credentials, db)
    job = _owned_job(db, job_id, user.username, user.role)
    if job.status != "success":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="任务还没有完成")
    path = named_output_path(str(job.id), name)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="结果文件不存在或已过期")
    # Release the DB connection before streaming so parallel downloads do not exhaust the pool.
    db.close()
    return FileResponse(path=path, filename=name, media_type=_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"))
