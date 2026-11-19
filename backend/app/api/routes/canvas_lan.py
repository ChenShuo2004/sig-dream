"""Queue canvas TTS, ASR, Seed-VC, ComfyUI and YuE2 jobs for a LAN GPU machine.

When deployed on a public server that cannot reach LAN GPU hosts directly, the file-machine
worker polls these jobs and calls IndexTTS (:7860), VoiceStudio ASR (:3901), Seed-VC (:7865),
ComfyUI (:8188), or YuE2 Studio (:8190). Short YuE2 API calls are reverse-proxied via the file machine.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
import uuid
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import ROLE_MATERIAL_ADMIN, ROLE_SUPER_ADMIN, bearer_scheme, decode_access_token, extract_bearer_token
from app.models.material import NasJob
from app.models.system_settings import SystemConfig
from app.services.file_service_registry_service import first_base_url, resolve_lan_base_urls, resolve_public_base_urls
from app.services.operation_log_service import record_operation_log
from sqlalchemy.orm.attributes import flag_modified

router = APIRouter(prefix="/canvas-lan", tags=["canvas-lan"])

MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_ASR_AUDIO_BYTES = 200 * 1024 * 1024
MAX_VOICE_CONVERT_BYTES = 80 * 1024 * 1024
MAX_YUE2_UPLOAD_BYTES = 80 * 1024 * 1024
MAX_IMAGE_BYTES = 30 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024
YUE2_ECS_UPLOAD_PREFIX = "ecs://staging/"
YUE2_UPLOAD_REQUEST_KEYS = (
    "source_path",
    "melody_midi",
    "chord_midi",
    "drum_midi",
    "reference_path",
    "audio_path",
    "input_path",
)
STUDIO_COMFY_WORKFLOWS = {"h3-face", "h3-goldfish"}
MAX_TEXT_CHARS = 8000
# Finished song/audio outputs must outlive a single work session. Old 6h + /tmp
# caused「可试听但 0:00」and missing history audio after overnight / new submits.
KEEP_SECONDS = 30 * 24 * 3600
LAN_JOB_TYPES = {
    "lan_tts",
    "lan_asr",
    "lan_voice_convert",
    "lan_seedvc",
    "lan_svs_remake",
    "lan_comfy",
    "lan_voice_design",
    "lan_yue2",
}
YUE2_PROXY_PREFIX = "/yue2-proxy"
# Keep short: sync urllib inside the API event loop used to freeze all routes
# (history list /docs hang) when private LAN :9001 was unreachable from ECS.
YUE2_PROXY_TIMEOUT = 8
MAX_YUE2_PROXY_BODY = 80 * 1024 * 1024
# WAN upload ladder (ECS → file-machine → YuE2). Bytes are inclusive upper bounds.
YUE2_PROXY_UPLOAD_TIMEOUT_LADDER = (
    (1 * 1024 * 1024, 60),
    (5 * 1024 * 1024, 120),
    (20 * 1024 * 1024, 300),
    (50 * 1024 * 1024, 600),
    (MAX_YUE2_PROXY_BODY, 900),
)


def _yue2_proxy_timeout(path: str, body_len: int) -> int:
    """Short probe timeout for metadata; size-tiered timeout for uploads."""
    safe = (path or "").lower()
    is_upload = "uploads" in safe or body_len > 256 * 1024
    if not is_upload:
        return YUE2_PROXY_TIMEOUT
    size = max(0, int(body_len or 0))
    for limit, seconds in YUE2_PROXY_UPLOAD_TIMEOUT_LADDER:
        if size <= limit:
            return seconds
    return YUE2_PROXY_UPLOAD_TIMEOUT_LADDER[-1][1]
VOICE_DESIGN_READING = (
    "你有没有发现，生活中有很多事情，看起来很简单，真正做起来却并不容易？"
    "就像今天早上，我走在回家的路上，阳光透过树叶，轻轻洒在地面。"
    "远处传来孩子们的笑声，风吹过的时候，空气里带着一点淡淡的花香。"
    "那一刻，我忽然觉得，平凡的日子，其实也有很多值得珍惜的地方。"
)
VOICE_DESIGN_ATTRS = {
    "Gender": {"Auto", "male", "female"},
    "Age": {"Auto", "child", "teenager", "young adult", "middle-aged", "elderly"},
    "Pitch": {"Auto", "very low pitch", "low pitch", "moderate pitch", "high pitch", "very high pitch"},
    "Style": {"Auto", "whisper"},
    "EnglishAccent": {
        "Auto",
        "american accent",
        "british accent",
        "australian accent",
        "canadian accent",
        "indian accent",
        "chinese accent",
        "korean accent",
        "japanese accent",
        "portuguese accent",
        "russian accent",
    },
    "ChineseDialect": {
        "Auto",
        "河南话",
        "陕西话",
        "四川话",
        "贵州话",
        "云南话",
        "桂林话",
        "济南话",
        "石家庄话",
        "甘肃话",
        "宁夏话",
        "青岛话",
        "东北话",
    },
}


def canvas_lan_root() -> Path:
    configured = (os.getenv("CANVAS_LAN_DIR") or "").strip()
    if configured:
        root = Path(configured)
    else:
        # Persist under backend/data (not /tmp — reboot/tmpwatch wiped finished songs).
        # __file__ = .../backend/app/api/routes/canvas_lan.py → parents[3] = backend/
        backend_root = Path(__file__).resolve().parents[3]
        root = backend_root / "data" / "canvas-lan"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _yue2_staging_root() -> Path:
    root = canvas_lan_root() / "staging"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_upload_name(name: str) -> str:
    cleaned = Path(name or "upload.bin").name.replace("\\", "_").replace("/", "_").strip() or "upload.bin"
    return cleaned[:180]


def _resolve_ecs_staging_ref(ref: str) -> Path:
    raw = str(ref or "").strip()
    if not raw.startswith(YUE2_ECS_UPLOAD_PREFIX):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的平台上传引用")
    rel = raw[len(YUE2_ECS_UPLOAD_PREFIX) :].lstrip("/").replace("\\", "/")
    if not rel or ".." in rel.split("/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="非法上传路径")
    path = (_yue2_staging_root() / rel).resolve()
    root = _yue2_staging_root().resolve()
    if root not in path.parents and path != root:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="非法上传路径")
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上传文件不存在或已过期")
    return path


def _attach_yue2_ecs_uploads(job_request: dict, directory: Path) -> dict[str, str]:
    """Move ecs://staging refs into the job dir and mark request fields as input://keys."""
    inputs: dict[str, str] = {}
    if not isinstance(job_request, dict):
        return inputs
    for key in YUE2_UPLOAD_REQUEST_KEYS:
        value = job_request.get(key)
        if not isinstance(value, str) or not value.startswith(YUE2_ECS_UPLOAD_PREFIX):
            continue
        source = _resolve_ecs_staging_ref(value)
        suffix = source.suffix.lower() or ".bin"
        dest_name = f"{key}{suffix}"
        dest = directory / dest_name
        shutil.copy2(source, dest)
        inputs[key] = dest_name
        job_request[key] = f"input://{key}"
    return inputs


def _user(credentials: HTTPAuthorizationCredentials | None, access_token: str | None = None):
    token = ""
    if credentials is not None:
        try:
            token = extract_bearer_token(credentials)
        except Exception:
            token = ""
    if not token and access_token:
        token = str(access_token).strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")
    user = decode_access_token(token)
    if user.role not in {ROLE_SUPER_ADMIN, ROLE_MATERIAL_ADMIN}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="画布需要素材管理员及以上权限")
    return user


def _cleanup_old_jobs() -> None:
    """Drop only aged ephemeral dirs. Never delete dirs that still have output.* unless past KEEP."""
    root = canvas_lan_root()
    cutoff = time.time() - KEEP_SECONDS
    for child in root.iterdir():
        try:
            if not child.is_dir():
                continue
            # Keep shared asset buckets forever (managed elsewhere).
            if child.name in {"assets", "canvas-media", "studio-media"}:
                continue
            if child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


def _save_upload(directory: Path, name: str, upload: UploadFile, limit: int) -> str:
    suffix = Path(upload.filename or name).suffix.lower()
    if suffix not in {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        suffix = ".bin"
    filename = f"{name}{suffix}"
    target = directory / filename
    size = 0
    with target.open("wb") as handle:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="文件过大")
            handle.write(chunk)
    if size < 32:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件为空")
    return filename


def _owned_job(db: Session, job_id: str, username: str, role: str) -> NasJob:
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="任务编号无效") from exc
    job = db.get(NasJob, job_uuid)
    if job is None or str(job.job_type or "") not in LAN_JOB_TYPES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    owner = str((job.payload or {}).get("owner") or "")
    if owner != username and role != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return job


def _emotion_vector(raw: str) -> list[float] | None:
    text = (raw or "").strip()
    if not text:
        return None
    parts = [part.strip() for part in text.split(",") if part.strip()]
    if len(parts) != 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="情感向量需要 8 个数值")
    values: list[float] = []
    for part in parts:
        try:
            value = float(part)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="情感向量格式不正确") from exc
        if value < 0 or value > 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="情感向量每个值要在 0 到 1 之间")
        values.append(value)
    return values


@router.post("/tts")
def create_tts_job(
    request: Request,
    text: str = Form(...),
    reference: UploadFile = File(...),
    engine: str = Form("indextts"),
    emo_control_method: int = Form(0),
    emo_weight: float = Form(0.65),
    emo_text: str = Form(""),
    emo_vector: str = Form(""),
    emo_random: int = Form(0),
    max_text_tokens_per_segment: int = Form(120),
    do_sample: int = Form(1),
    top_p: float = Form(0.8),
    top_k: int = Form(30),
    temperature: float = Form(0.8),
    length_penalty: float = Form(0.0),
    num_beams: int = Form(3),
    repetition_penalty: float = Form(10.0),
    max_mel_tokens: int = Form(1500),
    emo_audio: UploadFile | None = File(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    user = _user(credentials)
    spoken = "\n".join(line.strip() for line in (text or "").splitlines() if line.strip())
    if not spoken:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先填写要配音的文本")
    if len(spoken) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="配音文本过长")
    tts_engine = (engine or "indextts").strip().lower()
    if tts_engine not in {"indextts", "voicestudio"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的配音引擎")
    method = int(emo_control_method or 0)
    if method not in {0, 1, 2, 3}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的情感控制方式")
    if method == 1 and (emo_audio is None or not emo_audio.filename):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请上传情感参考音频")
    vector = _emotion_vector(emo_vector) if method == 2 else None
    weight = max(0.0, min(1.0, float(emo_weight if emo_weight is not None else 0.65)))
    segment_tokens = max(20, min(600, int(max_text_tokens_per_segment or 120)))
    _cleanup_old_jobs()
    job_id = uuid.uuid4()
    directory = canvas_lan_root() / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        inputs = {"reference": _save_upload(directory, "reference", reference, MAX_AUDIO_BYTES)}
        if method == 1 and emo_audio is not None:
            inputs["emo_audio"] = _save_upload(directory, "emo_audio", emo_audio, MAX_AUDIO_BYTES)
        job = NasJob(
            id=job_id,
            job_type="lan_tts",
            payload={
                "owner": user.username,
                "text": spoken,
                "inputs": inputs,
                "tts": {
                    "engine": tts_engine,
                    "endpoint": os.getenv("LAN_INDEXTTS_URL", "").strip() if tts_engine == "indextts" else "",
                    "emo_control_method": method,
                    "emo_weight": weight,
                    "emo_text": (emo_text or "").strip()[:500] if method == 3 else "",
                    "emo_vector": vector,
                    "emo_random": bool(emo_random) if method in {2, 3} else False,
                    "max_text_tokens_per_segment": segment_tokens,
                    "do_sample": bool(int(do_sample)),
                    "top_p": max(0.0, min(1.0, float(top_p if top_p is not None else 0.8))),
                    "top_k": max(0, min(100, int(top_k if top_k is not None else 30))),
                    "temperature": max(0.1, min(2.0, float(temperature if temperature is not None else 0.8))),
                    "length_penalty": max(-2.0, min(2.0, float(length_penalty if length_penalty is not None else 0.0))),
                    "num_beams": max(1, min(10, int(num_beams if num_beams is not None else 3))),
                    "repetition_penalty": max(0.1, min(20.0, float(repetition_penalty if repetition_penalty is not None else 10.0))),
                    "max_mel_tokens": max(50, min(1815, int(max_mel_tokens if max_mel_tokens is not None else 1500))),
                },
            },
            status="pending",
            max_retries=0,
        )
        db.add(job)
        record_operation_log(
            db,
            username=user.username,
            operation_type="canvas_lan_tts",
            target_type="canvas_lan",
            target_name=str(job_id),
            after_data={"chars": len(spoken), "emo_control_method": method, "engine": tts_engine},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        db.commit()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return {"job_id": str(job_id)}


def _voice_design_attrs(gender: str, age: str, pitch: str, style: str, accent: str, dialect: str) -> dict[str, str]:
    raw = {
        "Gender": gender,
        "Age": age,
        "Pitch": pitch,
        "Style": style,
        "EnglishAccent": accent,
        "ChineseDialect": dialect,
    }
    cleaned: dict[str, str] = {}
    for key, allowed in VOICE_DESIGN_ATTRS.items():
        value = str(raw.get(key) or "Auto").strip()
        cleaned[key] = value if value in allowed else "Auto"
    if cleaned["EnglishAccent"] != "Auto" and cleaned["ChineseDialect"] != "Auto":
        cleaned["ChineseDialect"] = "Auto"
    return cleaned


@router.post("/voice-design")
def create_voice_design_job(
    request: Request,
    mode: str = Form("generate"),
    text: str = Form(""),
    description: str = Form(""),
    seed: str = Form(""),
    gender: str = Form("Auto"),
    age: str = Form("Auto"),
    pitch: str = Form("Auto"),
    style: str = Form("Auto"),
    accent: str = Form("Auto"),
    dialect: str = Form("Auto"),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    user = _user(credentials)
    design_mode = (mode or "generate").strip().lower()
    if design_mode not in {"describe", "generate"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的声音设计方式")
    spoken = "\n".join(line.strip() for line in (text or "").splitlines() if line.strip()) or VOICE_DESIGN_READING
    if len(spoken) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="配音文本过长")
    voice_description = (description or "").strip()[:500]
    if design_mode == "describe" and not voice_description:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="先写一句声音描述")
    seed_value: int | None = None
    if (seed or "").strip():
        try:
            seed_value = int(seed)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="种子需要是整数") from exc
        if seed_value < 0 or seed_value > 2147483647:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="种子超出范围")
    _cleanup_old_jobs()
    job_id = uuid.uuid4()
    directory = canvas_lan_root() / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        job = NasJob(
            id=job_id,
            job_type="lan_voice_design",
            payload={
                "owner": user.username,
                "mode": design_mode,
                "text": spoken,
                "description": voice_description,
                "seed": seed_value,
                "attrs": _voice_design_attrs(gender, age, pitch, style, accent, dialect),
            },
            status="pending",
            max_retries=0,
        )
        db.add(job)
        record_operation_log(
            db,
            username=user.username,
            operation_type="canvas_lan_voice_design",
            target_type="canvas_lan",
            target_name=str(job_id),
            after_data={"mode": design_mode, "chars": len(spoken)},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        db.commit()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return {"job_id": str(job_id)}


@router.post("/asr")
def create_asr_job(
    request: Request,
    audio: UploadFile = File(...),
    model: str = Form("whisper-1"),
    language: str = Form(""),
    prompt: str = Form(""),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    user = _user(credentials)
    asr_model = (model or "whisper-1").strip()[:80] or "whisper-1"
    asr_language = (language or "").strip()[:16]
    asr_prompt = (prompt or "").strip()[:800]
    _cleanup_old_jobs()
    job_id = uuid.uuid4()
    directory = canvas_lan_root() / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        inputs = {"audio": _save_upload(directory, "audio", audio, MAX_ASR_AUDIO_BYTES)}
        job = NasJob(
            id=job_id,
            job_type="lan_asr",
            payload={
                "owner": user.username,
                "inputs": inputs,
                "asr": {
                    "model": asr_model,
                    "language": asr_language,
                    "prompt": asr_prompt,
                },
            },
            status="pending",
            max_retries=0,
        )
        db.add(job)
        record_operation_log(
            db,
            username=user.username,
            operation_type="canvas_lan_asr",
            target_type="canvas_lan",
            target_name=str(job_id),
            after_data={"model": asr_model, "language": asr_language},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        db.commit()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return {"job_id": str(job_id)}


@router.post("/voice-convert")
def create_voice_convert_job(
    request: Request,
    source: UploadFile = File(...),
    reference: UploadFile = File(...),
    f0_condition: int = Form(1),
    diffusion_steps: int = Form(40),
    inference_cfg_rate: float = Form(0.7),
    auto_f0_adjust: int = Form(0),
    pitch_shift: int = Form(0),
    length_adjust: float = Form(1.0),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Queue Seed-VC singing / speech conversion (source dry vocal + reference timbre)."""
    user = _user(credentials)
    steps = max(4, min(100, int(diffusion_steps or 40)))
    cfg = max(0.0, min(1.0, float(inference_cfg_rate if inference_cfg_rate is not None else 0.7)))
    length = max(0.5, min(2.0, float(length_adjust if length_adjust is not None else 1.0)))
    shift = max(-24, min(24, int(pitch_shift or 0)))
    use_f0 = 1 if int(f0_condition if f0_condition is not None else 1) else 0
    auto_f0 = 1 if int(auto_f0_adjust or 0) else 0
    _cleanup_old_jobs()
    job_id = uuid.uuid4()
    directory = canvas_lan_root() / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        inputs = {
            "source": _save_upload(directory, "source", source, MAX_VOICE_CONVERT_BYTES),
            "reference": _save_upload(directory, "reference", reference, MAX_AUDIO_BYTES),
        }
        job = NasJob(
            id=job_id,
            job_type="lan_voice_convert",
            payload={
                "owner": user.username,
                "inputs": inputs,
                "convert": {
                    "f0_condition": use_f0,
                    "diffusion_steps": steps,
                    "inference_cfg_rate": cfg,
                    "auto_f0_adjust": auto_f0,
                    "pitch_shift": shift,
                    "length_adjust": length,
                },
            },
            status="pending",
            max_retries=0,
        )
        db.add(job)
        record_operation_log(
            db,
            username=user.username,
            operation_type="canvas_lan_voice_convert",
            target_type="canvas_lan",
            target_name=str(job_id),
            after_data={"f0_condition": use_f0, "diffusion_steps": steps, "pitch_shift": shift},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        db.commit()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return {"job_id": str(job_id)}


@router.post("/seed-vc")
def create_seedvc_job(
    request: Request,
    source: UploadFile = File(...),
    reference: UploadFile = File(...),
    diffusion_steps: int = Form(10),
    length_adjust: float = Form(1.0),
    inference_cfg_rate: float = Form(0.7),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Queue the Seed-VC Gradio page (source audio + reference timbre). The file machine calls :17860."""
    user = _user(credentials)
    steps = max(1, min(200, int(diffusion_steps or 10)))
    length = max(0.5, min(2.0, float(length_adjust if length_adjust is not None else 1.0)))
    cfg = max(0.0, min(1.0, float(inference_cfg_rate if inference_cfg_rate is not None else 0.7)))
    _cleanup_old_jobs()
    job_id = uuid.uuid4()
    directory = canvas_lan_root() / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        inputs = {
            "source": _save_upload(directory, "source", source, MAX_VOICE_CONVERT_BYTES),
            "reference": _save_upload(directory, "reference", reference, MAX_VOICE_CONVERT_BYTES),
        }
        job = NasJob(
            id=job_id,
            job_type="lan_seedvc",
            payload={
                "owner": user.username,
                "inputs": inputs,
                "seedvc": {
                    "endpoint": os.getenv("LAN_SEEDVC_PAGE_URL", "").strip(),
                    "diffusion_steps": steps,
                    "length_adjust": length,
                    "inference_cfg_rate": cfg,
                },
            },
            status="pending",
            max_retries=0,
        )
        db.add(job)
        record_operation_log(
            db,
            username=user.username,
            operation_type="canvas_lan_seedvc",
            target_type="canvas_lan",
            target_name=str(job_id),
            after_data={"diffusion_steps": steps, "length_adjust": length, "inference_cfg_rate": cfg},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        db.commit()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return {"job_id": str(job_id)}


@router.post("/svs-remake")
def create_svs_remake_job(
    request: Request,
    lyrics: str = Form(...),
    melody: UploadFile = File(...),
    reference: UploadFile = File(...),
    diffusion_steps: int = Form(25),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Queue lyric remake: SVS guide (new lyrics + dry F0) then Seed-VC to reference timbre."""
    user = _user(credentials)
    spoken = " ".join((lyrics or "").split())
    if not spoken:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请填写新歌词")
    if len(spoken) > 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="歌词过长")
    steps = max(4, min(100, int(diffusion_steps or 25)))
    _cleanup_old_jobs()
    job_id = uuid.uuid4()
    directory = canvas_lan_root() / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        inputs = {
            "melody": _save_upload(directory, "melody", melody, MAX_VOICE_CONVERT_BYTES),
            "reference": _save_upload(directory, "reference", reference, MAX_AUDIO_BYTES),
        }
        job = NasJob(
            id=job_id,
            job_type="lan_svs_remake",
            payload={
                "owner": user.username,
                "lyrics": spoken,
                "inputs": inputs,
                "convert": {
                    "f0_condition": 1,
                    "diffusion_steps": steps,
                    "auto_f0_adjust": 0,
                },
            },
            status="pending",
            max_retries=0,
        )
        db.add(job)
        record_operation_log(
            db,
            username=user.username,
            operation_type="canvas_lan_svs_remake",
            target_type="canvas_lan",
            target_name=str(job_id),
            after_data={"lyrics": spoken[:80], "diffusion_steps": steps},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        db.commit()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return {"job_id": str(job_id)}


@router.post("/comfy")
def create_comfy_job(
    request: Request,
    prompt: str = Form(...),
    mode: str = Form("t2v"),
    duration: float = Form(5),
    aspect: str = Form("16:9 (Widescreen)"),
    megapixels: float = Form(0.4),
    seed: int | None = Form(default=None),
    workflow: str = Form(""),
    quality: str = Form(""),
    deoil: str = Form(""),
    image: UploadFile | None = File(default=None),
    image2: UploadFile | None = File(default=None),
    image3: UploadFile | None = File(default=None),
    image4: UploadFile | None = File(default=None),
    image5: UploadFile | None = File(default=None),
    image6: UploadFile | None = File(default=None),
    image7: UploadFile | None = File(default=None),
    image8: UploadFile | None = File(default=None),
    image9: UploadFile | None = File(default=None),
    video: UploadFile | None = File(default=None),
    video2: UploadFile | None = File(default=None),
    video3: UploadFile | None = File(default=None),
    audio: UploadFile | None = File(default=None),
    audio2: UploadFile | None = File(default=None),
    audio3: UploadFile | None = File(default=None),
    last_frame: UploadFile | None = File(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    user = _user(credentials)
    spoken = (prompt or "").strip()
    if not spoken:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先填写视频提示词")
    studio = (workflow or "").strip()
    if studio and studio not in STUDIO_COMFY_WORKFLOWS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的局域网工作流")
    if not studio and mode not in {"t2v", "i2v", "r2v"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的视频模式")
    _cleanup_old_jobs()
    job_id = uuid.uuid4()
    directory = canvas_lan_root() / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    inputs: dict[str, str] = {}
    try:
        image_slots = (
            ("image", image),
            ("image2", image2),
            ("image3", image3),
            ("image4", image4),
            ("image5", image5),
            ("image6", image6),
            ("image7", image7),
            ("image8", image8),
            ("image9", image9),
            ("last_frame", last_frame),
        )
        media_slots = (
            ("video", video, MAX_VIDEO_BYTES),
            ("video2", video2, MAX_VIDEO_BYTES),
            ("video3", video3, MAX_VIDEO_BYTES),
            ("audio", audio, MAX_AUDIO_BYTES),
            ("audio2", audio2, MAX_AUDIO_BYTES),
            ("audio3", audio3, MAX_AUDIO_BYTES),
        )
        for slot, upload in image_slots:
            if upload is None or not upload.filename:
                continue
            inputs[slot] = _save_upload(directory, slot, upload, MAX_IMAGE_BYTES)
        for slot, upload, limit in media_slots:
            if upload is None or not upload.filename:
                continue
            inputs[slot] = _save_upload(directory, slot, upload, limit)
        if not studio and mode == "i2v" and "image" not in inputs:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图生视频需要一张参考图")
        if not studio and mode == "r2v" and "image" not in inputs:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="参考生视频需要参考图")
        comfy_payload: dict = {
            "mode": mode if mode in {"t2v", "i2v", "r2v"} else "t2v",
            "prompt": spoken[:4000],
            "duration": max(1.0, min(15.0, float(duration or 5))),
            "aspect": (aspect or "16:9 (Widescreen)")[:80],
            "megapixels": max(0.1, min(16.0, float(megapixels or 0.4))),
        }
        if studio:
            comfy_payload["workflow"] = studio
            tier = "".join(ch for ch in (quality or "").strip().lower() if ch.isdigit())[:4]
            if tier:
                comfy_payload["quality"] = tier
            if studio == "h3-face" and (deoil or "").strip():
                try:
                    comfy_payload["deoil"] = max(0.0, min(1.0, round(float(deoil), 2)))
                except ValueError:
                    pass
        if seed is not None:
            try:
                comfy_payload["seed"] = max(0, min(2**31 - 1, int(seed)))
            except (TypeError, ValueError):
                pass
        job = NasJob(
            id=job_id,
            job_type="lan_comfy",
            payload={
                "owner": user.username,
                "text": spoken[:4000],
                "inputs": inputs,
                "comfy": comfy_payload,
            },
            status="pending",
            max_retries=0,
        )
        db.add(job)
        record_operation_log(
            db,
            username=user.username,
            operation_type="canvas_lan_comfy",
            target_type="canvas_lan",
            target_name=str(job_id),
            after_data={"mode": mode, "workflow": studio},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        db.commit()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return {"job_id": str(job_id)}


@router.get("/jobs/{job_id}")
def get_canvas_lan_job(
    job_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    job = _owned_job(db, job_id, user.username, user.role)
    job_type = str(job.job_type or "")
    tts_engine = ""
    if job_type == "lan_tts" and isinstance(job.payload, dict):
        tts = job.payload.get("tts")
        if isinstance(tts, dict):
            tts_engine = str(tts.get("engine") or "indextts")
    running_message = {
        "lan_tts": (
            "文件机正在调用 VoiceStudio 配音。"
            if tts_engine == "voicestudio"
            else "文件机正在调用 IndexTTS 声音克隆。"
        ),
        "lan_asr": "文件机正在调用 VoiceStudio 听写。",
        "lan_voice_convert": "文件机正在调用 Seed-VC 歌声转换。",
        "lan_seedvc": "文件机正在调用 Seed-VC 音色替换。",
        "lan_svs_remake": "文件机正在改词翻唱（SVS 导唱 + Seed-VC）。",
        "lan_comfy": "文件机正在生成视频。",
        "lan_voice_design": "文件机正在用 VoiceStudio 设计声音并朗读。",
        "lan_yue2": "文件机正在调用 YuE2 生成歌曲。",
    }.get(job_type, "文件机正在处理局域网任务。")
    message = {
        "pending": "已进入文件机队列，等待领取。",
        "running": running_message,
        "success": "完成",
        "failed": job.error_message or "局域网任务失败",
    }.get(str(job.status or ""), job.status)
    payload: dict = {
        "job_id": str(job.id),
        "status": job.status,
        "message": message,
        "error_message": job.error_message,
    }
    if job_type == "lan_asr" and job.status == "success" and isinstance(job.result, dict):
        transcript = job.result.get("transcript")
        if isinstance(transcript, dict):
            payload["transcript"] = transcript
        endpoint = job.result.get("endpoint")
        if isinstance(endpoint, str) and endpoint:
            payload["endpoint"] = endpoint
    if job_type == "lan_voice_design" and job.status == "success" and isinstance(job.result, dict):
        design = job.result.get("design")
        if isinstance(design, dict):
            payload["design"] = design
    return payload


@router.get("/jobs/{job_id}/output")
def download_canvas_lan_output(
    job_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    user = _user(credentials)
    job = _owned_job(db, job_id, user.username, user.role)
    if job.status != "success":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="任务还没有完成")
    directory = canvas_lan_root() / str(job.id)
    matches = sorted(directory.glob("output.*")) if directory.exists() else []
    if not matches:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="结果文件不存在")
    media_type = str((job.result or {}).get("media_type") or "application/octet-stream")
    return FileResponse(path=matches[0], filename=matches[0].name, media_type=media_type)


def _is_private_http_base(url: str) -> bool:
    raw = (url or "").strip().lower()
    return (
        "://127." in raw
        or "://localhost" in raw
        or "://10." in raw
        or "://192.168." in raw
        or "://172.16." in raw
        or "://172.17." in raw
        or "://172.18." in raw
        or "://172.19." in raw
        or "://172.2" in raw
        or "://172.3" in raw
    )


def _yue2_proxy_bases(db: Session) -> list[str]:
    """ECS must use the public file-machine base only.

    Private LAN :9001 addresses are unreachable from the cloud API host; trying
    them with multi-second timeouts wedged the single uvicorn worker and made
   「任务与版本」look empty.
    """
    bases: list[str] = []
    override = (os.getenv("CANVAS_LAN_YUE2_PROXY_BASE") or "").strip().rstrip("/")
    if override:
        bases.append(override)
    _, pub_down = resolve_public_base_urls(db, settings.default_storage_pool_id)
    if pub_down:
        value = pub_down.rstrip("/")
        if value and value not in bases:
            bases.append(value)
    # Optional LAN bases only when explicitly allowed (API running on LAN).
    allow_lan = (os.getenv("CANVAS_LAN_YUE2_PROXY_ALLOW_LAN") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if allow_lan:
        _, lan_down = resolve_lan_base_urls(db, settings.default_storage_pool_id)
        for item in (first_base_url(lan_down), *(x for x in (lan_down or "").split(",") if x.strip())):
            value = item.strip().rstrip("/")
            if value and value not in bases:
                bases.append(value)
        for fallback in ("http://127.0.0.1:9001",):
            if fallback not in bases:
                bases.append(fallback)
    # Drop private targets unless LAN mode is on — belt and suspenders.
    if not allow_lan:
        bases = [b for b in bases if not _is_private_http_base(b)]
    return bases


def _forward_yue2_proxy(
    db: Session,
    method: str,
    path: str,
    *,
    query: str = "",
    body: bytes | None = None,
    content_type: str | None = None,
) -> Response:
    return _forward_yue2_proxy_bases(
        _yue2_proxy_bases(db),
        method,
        path,
        query=query,
        body=body,
        content_type=content_type,
    )


def _forward_yue2_proxy_bases(
    bases: list[str],
    method: str,
    path: str,
    *,
    query: str = "",
    body: bytes | None = None,
    content_type: str | None = None,
) -> Response:
    safe = path.lstrip("/")
    if ".." in safe or safe.startswith("\\"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="非法路径")
    if not bases:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="未配置可用的 YuE2 文件机公网地址",
        )
    suffix = f"{YUE2_PROXY_PREFIX}/{safe}"
    if query:
        suffix = f"{suffix}?{query}"
    headers = {"X-NAS-Client-Token": settings.nas_client_token}
    if content_type:
        headers["Content-Type"] = content_type
    last_error = ""
    body_len = len(body or b"")
    timeout = _yue2_proxy_timeout(safe, body_len)
    for base in bases:
        url = f"{base}{suffix}"
        try:
            req = urllib.request.Request(
                url,
                data=body if body is not None else None,
                method=method.upper(),
                headers=headers,
            )
            with urllib.request.urlopen(req, timeout=timeout) as upstream:
                payload = upstream.read()
                status_code = getattr(upstream, "status", None) or upstream.getcode()
                excluded = {"content-encoding", "transfer-encoding", "connection", "content-length"}
                out_headers = {
                    key: value
                    for key, value in upstream.headers.items()
                    if key.lower() not in excluded
                }
                return Response(content=payload, status_code=int(status_code), headers=out_headers)
        except urllib.error.HTTPError as exc:
            payload = exc.read() if hasattr(exc, "read") else b""
            excluded = {"content-encoding", "transfer-encoding", "connection", "content-length"}
            out_headers = {
                key: value
                for key, value in (exc.headers.items() if exc.headers else [])
                if key.lower() not in excluded
            }
            return Response(content=payload, status_code=int(exc.code), headers=out_headers)
        except urllib.error.URLError as exc:
            last_error = str(exc.reason if getattr(exc, "reason", None) else exc)
            continue
        except TimeoutError as exc:
            last_error = f"timed out after {timeout}s ({exc})"
            continue
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"无法经文件机转发 YuE2（{last_error or '无可用文件机'}）",
    )


def _yue2_job_view(job: NasJob) -> dict:
    """Shape a platform lan_yue2 row like a YuE2 job object for the copied UI."""
    payload = job.payload if isinstance(job.payload, dict) else {}
    result = job.result if isinstance(job.result, dict) else {}
    created = job.created_at.timestamp() if job.created_at else time.time()
    # NasJob has no updated_at; use finished/started/created.
    touched = job.finished_at or job.started_at or job.created_at
    updated = touched.timestamp() if touched else created
    status_map = {
        "pending": "queued",
        "running": "running",
        "success": "complete",
        "failed": "failed",
        "cancelled": "cancelled",
    }
    yue_status = status_map.get(str(job.status or ""), str(job.status or "queued"))
    # Avoid UI mapping bare status "running" → first pipeline step「加载模型」when the
    # file machine has not created a YuE2 job yet (orphan claim / dispatch lag).
    if yue_status in {"complete", "failed", "cancelled", "queued"}:
        stage = yue_status
    elif yue_status == "running" and not str(result.get("yue2_job_id") or "").strip():
        stage = "queued"
    else:
        stage = str(result.get("stage") or "starting")
    request_body = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    project_id = str(
        request_body.get("project_id")
        or (request_body.get("generate") or {}).get("project_id")
        or payload.get("project_id")
        or ""
    ).strip()
    view: dict = {
        "id": str(job.id),
        "kind": str(payload.get("kind") or result.get("kind") or "generate"),
        "status": yue_status,
        "stage": stage,
        "created_at": created,
        "updated_at": updated,
        "source": str(payload.get("source") or "webui"),
        "summary": str(payload.get("summary") or result.get("summary") or ""),
        "result_panel": payload.get("result_panel"),
        "progress": result.get("progress"),
        "yue2_job_id": result.get("yue2_job_id"),
        "project_id": project_id or None,
        "request": request_body,
    }
    if yue_status == "failed":
        view["error"] = job.error_message or result.get("error") or "YuE2 任务失败"
    if yue_status == "complete":
        kind_key = str(view.get("kind") or "")
        audio_seconds = result.get("audio_seconds")
        # Transcribe/plan finish with structured fields (ABC), not a mixdown file.
        if kind_key in {"transcribe", "plan", "doctor", "midi_extract"} or result.get("has_audio") is False:
            view["result"] = {
                key: result[key]
                for key in (
                    "abc",
                    "timing",
                    "warnings",
                    "melody_only",
                    "duration_seconds",
                    "audio_seconds",
                    "partial",
                    "truncated",
                    "requested_candidates",
                    "completed_candidates",
                )
                if key in result
            }
            if isinstance(result.get("yue2_result"), dict):
                for key, value in result["yue2_result"].items():
                    view["result"].setdefault(key, value)
        else:
            view["result"] = {
                "audio": "platform-output",
                "audio_seconds": audio_seconds,
                "candidates": [
                    {
                        "index": 1,
                        "audio": "platform-output",
                        "audio_seconds": audio_seconds,
                    }
                ],
                "artifact_dir": "platform-output",
            }
            if isinstance(result.get("yue2_result"), dict):
                # Keep non-path extras (seconds, truncated flags) without leaking NAS paths.
                extra = result["yue2_result"]
                for key in ("truncated", "partial", "requested_candidates", "completed_candidates"):
                    if key in extra:
                        view["result"][key] = extra[key]
    return view


@router.get("/yue2/queue/jobs")
def list_yue2_queue_jobs(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
    status: str | None = None,
    kind: str | None = None,
    project_id: str | None = None,
    q: str | None = None,
    compact: int | None = None,
    latest_by_panel: int | None = None,
) -> dict:
    """List platform lan_yue2 jobs in a YuE2-shaped {jobs, total} payload.

    Supports the copied UI history filters (status/kind/project/q/offset).
    YuE2 UI uses status=complete; NasJob stores success.
    """
    user = _user(credentials)
    capped = max(1, min(int(limit or 100), 200))
    start = max(0, int(offset or 0))
    status_key = str(status or "").strip().lower()
    kind_key = str(kind or "").strip()
    project_key = str(project_id or "").strip()
    query_text = str(q or "").strip().lower()

    # Map YuE2 UI statuses → NasJob.status values.
    status_map = {
        "complete": {"success"},
        "success": {"success"},
        "failed": {"failed"},
        "cancelled": {"cancelled", "canceled"},
        "running": {"running"},
        "queued": {"pending"},
        "pending": {"pending"},
        "paused": {"paused"},
    }
    wanted_statuses = status_map.get(status_key) if status_key else None

    query = db.query(NasJob).filter(NasJob.job_type.in_(("lan_yue2", "lan_assistant")))
    rows = query.order_by(NasJob.created_at.desc()).limit(500).all()
    if user.role != ROLE_SUPER_ADMIN:
        rows = [
            job
            for job in rows
            if str((job.payload or {}).get("owner") or "") == user.username
        ]

    views: list[dict] = []
    for job in rows:
        view = _assistant_job_view(job) if str(job.job_type or "") == "lan_assistant" else _yue2_job_view(job)
        if wanted_statuses and str(job.status or "") not in wanted_statuses:
            continue
        if kind_key and str(view.get("kind") or "") != kind_key:
            continue
        payload = job.payload if isinstance(job.payload, dict) else {}
        request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
        job_project = str(
            request.get("project_id")
            or payload.get("project_id")
            or ""
        ).strip()
        if project_key and project_key not in {"__global__", ""} and job_project != project_key:
            continue
        if query_text:
            blob = " ".join(
                [
                    str(view.get("id") or ""),
                    str(view.get("summary") or ""),
                    str(view.get("error") or ""),
                    str(view.get("yue2_job_id") or ""),
                    str(job.error_message or ""),
                ]
            ).lower()
            if query_text not in blob:
                continue
        views.append(view)

    if latest_by_panel:
        # One newest job per result_panel (create/plan/cover…), for workspace restore.
        picked: dict[str, dict] = {}
        for view in views:
            panel = str(view.get("result_panel") or "") or "_none"
            if panel not in picked:
                picked[panel] = view
        views = list(picked.values())

    total = len(views)
    page = views[start : start + capped]
    return {"jobs": page, "total": total}


@router.get("/yue2/queue/jobs/{job_id}/content")
def download_yue2_queue_content(
    job_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    access_token: str | None = None,
):
    # <audio src> / download links cannot set Authorization; allow ?access_token=
    user = _user(credentials, access_token=access_token)
    job = _owned_job(db, job_id, user.username, user.role)
    if str(job.job_type or "") != "lan_yue2":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    if job.status != "success":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="任务还没有完成")
    directory = canvas_lan_root() / str(job.id)
    matches = sorted(directory.glob("output.*")) if directory.exists() else []
    if not matches:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="结果音频不存在或已过期。请重新生成；新成品会保存在持久目录。",
        )
    media_type = str((job.result or {}).get("media_type") or "audio/flac")
    return FileResponse(path=matches[0], filename=matches[0].name, media_type=media_type)


@router.post("/yue2/queue/jobs")
async def create_yue2_queue_job(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请求体必须是 JSON") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请求体必须是对象")
    kind = str(body.get("kind") or "generate").strip() or "generate"
    job_request = body.get("request")
    if not isinstance(job_request, dict):
        job_request = {}
    # Lyric assistant must NOT go through the music GPU queue (YuE2 /api/jobs).
    if kind == "assistant":
        import asyncio

        from app.core.database import SessionLocal

        username = user.username
        role = user.role
        client_host = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")

        def _run() -> dict:
            thread_db = SessionLocal()
            try:
                class _U:
                    pass

                fake = _U()
                fake.username = username
                fake.role = role

                class _R:
                    pass

                fake_req = _R()
                fake_req.client = type("C", (), {"host": client_host})()
                fake_req.headers = {"user-agent": user_agent}
                return _run_platform_assistant_job(
                    thread_db,
                    user=fake,
                    body=body,
                    request=fake_req,
                )
            finally:
                thread_db.close()

        return await asyncio.to_thread(_run)
    _cleanup_old_jobs()
    job_id = uuid.uuid4()
    directory = canvas_lan_root() / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        inputs = _attach_yue2_ecs_uploads(job_request, directory)
        (directory / "request.json").write_text(json.dumps(job_request, ensure_ascii=False), encoding="utf-8")
        payload = {
            "owner": user.username,
            "kind": kind,
            "request": job_request,
            "source": str(body.get("source") or "webui")[:32],
            "client_request_id": str(body.get("client_request_id") or "")[:128],
            "result_panel": body.get("result_panel"),
            "summary": str(job_request.get("style") or job_request.get("lyrics") or kind)[:200],
        }
        if inputs:
            payload["inputs"] = inputs
        job = NasJob(
            id=job_id,
            job_type="lan_yue2",
            payload=payload,
            status="pending",
            max_retries=0,
        )
        db.add(job)
        record_operation_log(
            db,
            username=user.username,
            operation_type="canvas_lan_yue2",
            target_type="canvas_lan",
            target_name=str(job_id),
            after_data={"kind": kind},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        db.commit()
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return _yue2_job_view(job)


@router.get("/yue2/queue/jobs/{job_id}")
def get_yue2_queue_job(
    job_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    job = _owned_job(db, job_id, user.username, user.role)
    job_type = str(job.job_type or "")
    if job_type == "lan_assistant":
        return _assistant_job_view(job)
    if job_type != "lan_yue2":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return _yue2_job_view(job)


@router.post("/yue2/queue/jobs/{job_id}/cancel")
def cancel_yue2_queue_job(
    job_id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    job = _owned_job(db, job_id, user.username, user.role)
    if str(job.job_type or "") != "lan_yue2":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    if job.status in {"success", "failed"}:
        return _yue2_job_view(job)
    yue2_id = ""
    if isinstance(job.result, dict):
        yue2_id = str(job.result.get("yue2_job_id") or "")
    if yue2_id and job.status == "running":
        try:
            body = json.dumps({"force": True}).encode("utf-8")
            _forward_yue2_proxy(db, "POST", f"api/jobs/{yue2_id}/cancel", body=body, content_type="application/json")
        except HTTPException:
            pass
    job.status = "failed"
    job.error_message = "已取消"
    db.commit()
    record_operation_log(
        db,
        username=user.username,
        operation_type="canvas_lan_yue2_cancel",
        target_type="canvas_lan",
        target_name=str(job.id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return _yue2_job_view(job)


@router.post("/yue2/uploads")
async def upload_yue2_asset(
    request: Request,
    filename: str = "",
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Store remix/cover source audio on ECS.

    ECS often cannot reach the file-machine WAN port, so browser uploads no longer
    go through `/yue2/proxy/api/uploads`. The file-machine worker later pulls these
    files and posts them to YuE2 on the LAN.
    """
    user = _user(credentials)
    raw_name = (filename or request.query_params.get("filename") or "upload.bin").strip()
    safe_name = _safe_upload_name(raw_name)
    body = await request.body()
    if not body or len(body) < 16:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="上传文件为空")
    if len(body) > MAX_YUE2_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="音频过大（上限 80MB）")
    upload_id = uuid.uuid4().hex
    directory = _yue2_staging_root() / upload_id
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / safe_name
    target.write_bytes(body)
    ref = f"{YUE2_ECS_UPLOAD_PREFIX}{upload_id}/{safe_name}"
    record_operation_log(
        db,
        username=user.username,
        operation_type="上传YuE2素材",
        target_type="canvas_lan",
        target_name=upload_id,
        after_data={"filename": safe_name, "bytes": len(body)},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    return {"path": ref, "filename": safe_name, "bytes": len(body), "upload_id": upload_id}


@router.api_route("/yue2/proxy/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
async def proxy_yue2_api(
    path: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Response:
    import asyncio

    from starlette.requests import ClientDisconnect

    _user(credentials)
    try:
        body = await request.body()
    except ClientDisconnect:
        # Browser aborted a proxied short request; do not dump ASGI ERROR noise.
        return Response(status_code=499)
    if body and len(body) > MAX_YUE2_PROXY_BODY:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="请求体过大")
    content_type = request.headers.get("content-type")
    bases = _yue2_proxy_bases(db)
    # urlopen is blocking — never run it on the event loop / with a request-scoped Session.
    return await asyncio.to_thread(
        _forward_yue2_proxy_bases,
        bases,
        request.method,
        path,
        query=request.url.query,
        body=body or None,
        content_type=content_type,
    )


YUE2_ASSISTANT_LLM_KEY = "yue2_assistant_llm"
YUE2_ASSISTANT_LYRICS_MODES = [
    "AUTO（有词保留，无词创作）",
    "生成新歌词 / New lyrics",
    "严格保留歌词 / Preserve",
    "定向改词 / Edit section",
    "纯器乐 / Instrumental",
]
YUE2_ASSISTANT_ABC_SOURCES = [
    "自动创作 ABC（T8 LLM）/ Compose",
    "交给下游 YuE2 规划（ABC 留空）/ Downstream",
]


def _assistant_llm_binding(db: Session) -> dict:
    row = db.get(SystemConfig, YUE2_ASSISTANT_LLM_KEY)
    value = row.value if row is not None and isinstance(row.value, dict) else {}
    return {
        "channel_id": str(value.get("channel_id") or "").strip(),
        "model": str(value.get("model") or "").strip(),
        "max_tokens": int(value.get("max_tokens") or 32768),
    }


def _assistant_text_channels(db: Session, username: str, role: str) -> list[dict]:
    from app.api.routes.canvas_api import _key_for_user, _model_open_to, _stored_channels

    out: list[dict] = []
    for item in _stored_channels(db):
        if not isinstance(item, dict):
            continue
        if str(item.get("apiFormat") or "openai") == "gemini":
            continue
        base = str(item.get("baseUrl") or "").strip().rstrip("/")
        if not base:
            continue
        models: list[dict] = []
        for model in item.get("models") if isinstance(item.get("models"), list) else []:
            if not isinstance(model, dict):
                continue
            name = str(model.get("name") or "").strip()
            capability = str(model.get("capability") or "text").strip() or "text"
            if not name or capability != "text":
                continue
            if role != ROLE_SUPER_ADMIN and not _model_open_to(model, username):
                continue
            models.append(
                {
                    "name": name,
                    "label": str(model.get("label") or name),
                    "capability": capability,
                }
            )
        if not models:
            continue
        out.append(
            {
                "id": str(item.get("id") or "").strip(),
                "name": str(item.get("name") or "未命名渠道"),
                "baseUrl": base,
                "has_key": bool(_key_for_user(item, username)),
                "models": models,
            }
        )
    return out


def _resolve_assistant_llm(db: Session, username: str, role: str) -> dict:
    from app.api.routes.canvas_api import _key_for_user, _stored_channels

    binding = _assistant_llm_binding(db)
    channels = _assistant_text_channels(db, username, role)
    channel = next((item for item in channels if item["id"] == binding["channel_id"]), None)
    if channel is None and len(channels) == 1:
        channel = channels[0]
    model_name = binding["model"]
    if channel and model_name and not any(m["name"] == model_name for m in channel["models"]):
        model_name = ""
    if channel and not model_name and channel["models"]:
        model_name = channel["models"][0]["name"]
    api_key = ""
    raw_channel = None
    if channel:
        raw_channel = next(
            (item for item in _stored_channels(db) if isinstance(item, dict) and str(item.get("id") or "") == channel["id"]),
            None,
        )
        if raw_channel:
            api_key = _key_for_user(raw_channel, username)
    ready = bool(channel and model_name and api_key)
    return {
        "binding": {
            "channel_id": channel["id"] if channel else binding["channel_id"],
            "model": model_name,
            "max_tokens": binding["max_tokens"],
        },
        "channel": channel,
        "api_key": api_key,
        "ready": ready,
        "channels": channels,
    }


def _assistant_runtime_payload(resolved: dict) -> dict:
    channel = resolved.get("channel") or {}
    binding = resolved.get("binding") or {}
    model = str(binding.get("model") or "")
    base = str(channel.get("baseUrl") or "").rstrip("/")
    label = str(channel.get("name") or "平台渠道")
    models = [item["name"] for item in (channel.get("models") or [])]
    credential_id = f"platform:{channel.get('id') or 'none'}"
    return {
        "config": {
            "provider": "compatible",
            "base_url": base,
            "model": model,
            "credential_id": credential_id,
            "max_tokens": int(binding.get("max_tokens") or 32768),
            "temperature_policy": "auto",
            "stream": True,
            "extra_parameters": {},
            "llm_directory": "",
            "context_size": 16384,
            "gpu_layers": 24,
            "threads": 4,
            "think": False,
        },
        "credential": {
            "available": bool(resolved.get("ready")),
            "required": True,
            "reason": None if resolved.get("ready") else "missing",
            "source": "platform_channels",
        },
        "providers": {
            "compatible": {
                "label": label,
                "base_url": base,
                "models": models,
            }
        },
        "options": {
            "lyrics_modes": YUE2_ASSISTANT_LYRICS_MODES,
            "abc_sources": YUE2_ASSISTANT_ABC_SOURCES,
        },
        "defaults": {
            "lyrics_mode": "严格保留歌词 / Preserve",
            "lyrics_language": "中文",
            "abc_source": "交给下游 YuE2 规划（ABC 留空）/ Downstream",
            "music_idea": "",
            "lyrics": "",
        },
        "platform": {
            "channel_id": channel.get("id") or "",
            "channel_name": label,
            "model": model,
            "ready": bool(resolved.get("ready")),
            "channels": resolved.get("channels") or [],
        },
    }


def _sync_assistant_llm_to_yue2(db: Session, resolved: dict) -> dict:
    if not resolved.get("ready"):
        return {"ok": False, "detail": "请先在 API设置里选择带 Key 的文本渠道和模型"}
    runtime = _assistant_runtime_payload(resolved)
    config = runtime["config"]
    api_key = str(resolved.get("api_key") or "")
    try:
        cred_body = json.dumps(
            {"api_key": api_key, "remember": True, "config": config},
            ensure_ascii=False,
        ).encode("utf-8")
        _forward_yue2_proxy(
            db,
            "POST",
            "api/assistant/credentials",
            body=cred_body,
            content_type="application/json",
        )
        cfg_body = json.dumps(config, ensure_ascii=False).encode("utf-8")
        _forward_yue2_proxy(
            db,
            "POST",
            "api/assistant/config",
            body=cfg_body,
            content_type="application/json",
        )
        return {"ok": True}
    except HTTPException as exc:
        return {"ok": False, "detail": str(exc.detail)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "detail": str(exc)}


def _message_text(message: object) -> str:
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(
            str(part.get("text") or "") if isinstance(part, dict) else str(part) for part in content
        )
    text = str(content or "").strip()
    if text:
        return text
    # DeepSeek reasoning models sometimes put the answer only in reasoning_content
    # when output tokens are exhausted by thinking.
    for key in ("reasoning_content", "reasoning"):
        alt = message.get(key)
        if not isinstance(alt, str) or not alt.strip():
            continue
        cleaned = alt.strip()
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return cleaned[start : end + 1]
        return cleaned
    return ""


def _local_tag_lyrics(raw: str) -> str:
    """Deterministic fallback when the LLM returns empty (common with reasoning models)."""
    import re

    tag_re = re.compile(
        r"^\[(Intro|Verse|Pre-?Chorus|Chorus|Bridge|Outro|Hook|Rap)[^\]]*\]$",
        re.IGNORECASE,
    )
    lines: list[str] = []
    has_tags = False
    for line in str(raw or "").replace("\r\n", "\n").split("\n"):
        text = line.strip()
        if not text:
            continue
        if tag_re.match(text):
            has_tags = True
            # Normalize PreChorus → Pre-Chorus style brackets as-is
            lines.append(text if text.startswith("[") else f"[{text}]")
        else:
            lines.append(text)
    if not lines:
        return str(raw or "").strip()
    if has_tags:
        return "\n".join(lines)
    if len(lines) <= 2:
        return "[Verse]\n" + "\n".join(lines)
    mid = (len(lines) + 1) // 2
    return "\n".join(["[Verse]", *lines[:mid], "", "[Chorus]", *lines[mid:]])


def _openai_chat_completion(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    max_tokens: int = 4096,
    timeout: int = 90,
    json_object: bool = False,
) -> str:
    root = base_url.rstrip("/")
    if root.endswith("/v1"):
        url = f"{root}/chat/completions"
    else:
        url = f"{root}/v1/chat/completions"
    # Reasoning models (e.g. deepseek-v4-pro) spend tokens on thinking; keep headroom.
    token_cap = 16384 if "reason" in model.lower() or "v4" in model.lower() or "pro" in model.lower() else 8192
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2 if json_object else 0.4,
        "max_tokens": max(512, min(int(max_tokens or 4096), token_cap)),
    }
    if json_object:
        payload["response_format"] = {"type": "json_object"}
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        # Some gateways reject response_format; retry once without it.
        if json_object and exc.code in {400, 422}:
            return _openai_chat_completion(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                timeout=timeout,
                json_object=False,
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"创作助手调用渠道失败（HTTP {exc.code}）：{detail}",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        hint = ""
        if "Network is unreachable" in msg or "Name or service not known" in msg or "timed out" in msg.lower():
            hint = "。云端 ECS 当前访问不到该渠道地址，请在 API设置改选「DeepSeek 官方」等服务器可直连的渠道"
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"创作助手调用渠道失败：{exc}{hint}",
        ) from exc
    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="渠道未返回模型内容")
    message = choices[0].get("message") if isinstance(choices[0], dict) else {}
    text = _message_text(message)
    if not text:
        finish = choices[0].get("finish_reason") if isinstance(choices[0], dict) else ""
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"模型返回空内容（finish_reason={finish or 'unknown'}）",
        )
    return text


def _parse_assistant_llm_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(cleaned[start : end + 1])
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    return {"lyrics": cleaned, "style": ""}


def _assistant_job_view(job: NasJob) -> dict:
    payload = job.payload if isinstance(job.payload, dict) else {}
    result = job.result if isinstance(job.result, dict) else {}
    created = job.created_at.timestamp() if job.created_at else time.time()
    touched = job.finished_at or job.started_at or job.created_at
    updated = touched.timestamp() if touched else created
    status_map = {
        "pending": "queued",
        "running": "running",
        "success": "complete",
        "failed": "failed",
        "cancelled": "cancelled",
    }
    yue_status = status_map.get(str(job.status or ""), str(job.status or "queued"))
    view = {
        "id": str(job.id),
        "kind": "assistant",
        "status": yue_status,
        "stage": yue_status,
        "created_at": created,
        "updated_at": updated,
        "source": str(payload.get("source") or "webui"),
        "summary": str(payload.get("summary") or "assistant"),
        "result_panel": payload.get("result_panel") or "assistant",
        "request": payload.get("request") if isinstance(payload.get("request"), dict) else {},
    }
    if yue_status == "failed":
        view["error"] = job.error_message or "创作助手失败"
    if yue_status == "complete":
        view["result"] = result
    return view


def _run_platform_assistant_job(
    db: Session,
    *,
    user,
    body: dict,
    request: Request,
) -> dict:
    """Run lyric/style assistant on platform channels (not YuE2 GPU music queue)."""
    job_request = body.get("request") if isinstance(body.get("request"), dict) else {}
    values = job_request.get("values") if isinstance(job_request.get("values"), dict) else {}
    test_connection = bool(job_request.get("test_connection"))
    resolved = _resolve_assistant_llm(db, user.username, user.role)
    if not resolved.get("ready"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先在 API设置里选择带 Key 的文本渠道和模型",
        )
    channel = resolved["channel"] or {}
    binding = resolved["binding"] or {}
    api_key = str(resolved.get("api_key") or "")
    model = str(binding.get("model") or "")
    base_url = str(channel.get("baseUrl") or "")
    job_id = uuid.uuid4()
    now = time.time()
    values_preview = job_request.get("values") if isinstance(job_request.get("values"), dict) else {}
    task_preview = str(values_preview.get("task") or "").strip()
    lyrics_mode_preview = str(values_preview.get("lyrics_mode") or "")
    if test_connection:
        summary = "测试模型连接"
    elif task_preview == "tag_lyrics" or "仅打标签" in lyrics_mode_preview or "Tag structure" in lyrics_mode_preview:
        summary = "歌词打标签"
    else:
        summary = "创作助手"
    job = NasJob(
        id=job_id,
        job_type="lan_assistant",
        payload={
            "owner": user.username,
            "kind": "assistant",
            "request": job_request,
            "source": str(body.get("source") or "webui")[:32],
            "client_request_id": str(body.get("client_request_id") or "")[:128],
            "result_panel": body.get("result_panel") or "assistant",
            "summary": summary,
        },
        status="running",
        max_retries=0,
        started_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()

    try:
        if test_connection:
            _openai_chat_completion(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=[
                    {"role": "system", "content": "Reply with exactly: ok"},
                    {"role": "user", "content": "ping"},
                ],
                max_tokens=16,
                timeout=30,
            )
            result = {
                "lyrics": "",
                "style": "",
                "abc": "",
                "abc_status": "empty",
                "cot": "full",
                "instrumental": False,
                "note": f"连接成功：{channel.get('name')} · {model}",
                "test_connection": True,
            }
        else:
            lyrics_mode = str(values.get("lyrics_mode") or "")
            task = str(values.get("task") or "").strip()
            raw_lyrics = str(values.get("lyrics") or "").strip()
            music_idea = str(values.get("music_idea") or "").strip()
            constraints = str(values.get("constraints") or "").strip()
            language = str(values.get("lyrics_language") or "中文").strip() or "中文"
            tag_only = (
                task == "tag_lyrics"
                or "仅打标签" in lyrics_mode
                or "Tag structure" in lyrics_mode
            )
            system = (
                "你是歌曲创作助手。只输出一个 JSON 对象，不要 Markdown。"
                '字段：lyrics（字符串）、style（英文字符串曲风提示）、instrumental（布尔）。'
                "lyrics 必须用 [Verse]/[Chorus]/[Bridge]/[Outro] 等标签分段，每句歌词单独一行。"
                "不要翻译用户要求保留的原词；不要编造段落标签以外的说明文字。"
            )
            if tag_only:
                if not raw_lyrics:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先填写歌词再打标签")
                system = (
                    "你是歌词结构整理助手。只输出一个 JSON 对象，不要 Markdown。"
                    '字段：lyrics（字符串）、style（必须为空字符串）、instrumental（false）。'
                    "严格保留原词，不得改写、增删字句、翻译或润色。"
                    "只添加或规范化 [Intro]/[Verse]/[Pre-Chorus]/[Chorus]/[Bridge]/[Outro] 等段落标签；"
                    "每句歌词单独一行；不要输出解释或其它字段。"
                )
                user_prompt = (
                    f"歌词语言：{language}\n"
                    "任务：仅为下列歌词打段落标签并分段（一句一行），不要改词。\n"
                    f"额外约束：{constraints or '无'}\n"
                    f"原始歌词：\n{raw_lyrics}"
                )
            elif "严格保留" in lyrics_mode or "Preserve" in lyrics_mode or ("AUTO" in lyrics_mode and raw_lyrics):
                user_prompt = (
                    f"歌词语言：{language}\n"
                    "任务：严格保留下列歌词的文字，只做结构整理（加段落标签、一句一行）。\n"
                    f"其他要求：{constraints or '无'}\n"
                    f"曲风想法（用于生成 style 字段，不要改写歌词）：{music_idea or '根据歌词推断'}\n"
                    f"原始歌词：\n{raw_lyrics or '（无）'}"
                )
            elif "纯器乐" in lyrics_mode or "Instrumental" in lyrics_mode:
                user_prompt = (
                    "任务：生成纯器乐风格描述，lyrics 置空字符串，instrumental=true。\n"
                    f"想法：{music_idea or '情绪器乐'}\n要求：{constraints or '无'}"
                )
            elif "生成新歌词" in lyrics_mode or "New lyrics" in lyrics_mode or not raw_lyrics:
                user_prompt = (
                    f"歌词语言：{language}\n"
                    "任务：根据想法创作带段落标签的新歌词，并给出英文 style。\n"
                    f"想法：{music_idea or '一首有故事的流行歌'}\n"
                    f"要求：{constraints or '无'}\n"
                    f"可参考的旧词（可忽略）：\n{raw_lyrics or '（无）'}"
                )
            else:
                user_prompt = (
                    f"歌词语言：{language}\n模式：{lyrics_mode}\n"
                    f"想法：{music_idea}\n要求：{constraints}\n"
                    f"已有歌词：\n{raw_lyrics or '（无）'}\n"
                    "请输出整理后的 lyrics 与 style。"
                )
            fallback_note = ""
            parsed: dict = {}
            try:
                content = _openai_chat_completion(
                    base_url=base_url,
                    api_key=api_key,
                    model=model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user_prompt},
                    ],
                    max_tokens=max(int(binding.get("max_tokens") or 4096), 8192 if tag_only else 4096),
                    timeout=120,
                    json_object=True,
                )
                parsed = _parse_assistant_llm_json(content)
                out_lyrics = str(parsed.get("lyrics") or "").strip() or raw_lyrics
                out_style = "" if tag_only else (str(parsed.get("style") or "").strip() or music_idea)
            except HTTPException as exc:
                if not tag_only or not raw_lyrics:
                    raise
                # Keep the one-click button usable when reasoning models return empty content.
                out_lyrics = _local_tag_lyrics(raw_lyrics)
                out_style = ""
                fallback_note = f"模型未返回有效内容，已用本地规则分段（{exc.detail}）"
            instrumental = bool(parsed.get("instrumental")) or ("纯器乐" in lyrics_mode)
            if instrumental and not tag_only:
                out_lyrics = ""
            result = {
                "lyrics": out_lyrics,
                "style": out_style,
                "abc": "",
                "abc_status": "empty",
                "cot": str(values.get("cot") or "full") or "full",
                "instrumental": instrumental if not tag_only else False,
                "task": "tag_lyrics" if tag_only else "assistant",
                "provider": "platform_channels",
                "model": model,
                "channel_name": channel.get("name") or "",
                "note": fallback_note,
            }
        job.status = "success"
        job.result = result
        job.finished_at = datetime.utcnow()
        job.error_message = None
        record_operation_log(
            db,
            username=user.username,
            operation_type="canvas_lan_assistant",
            target_type="canvas_lan",
            target_name=str(job_id),
            after_data={"model": model, "channel_id": channel.get("id"), "test": test_connection},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        db.commit()
        db.refresh(job)
        return _assistant_job_view(job)
    except HTTPException as exc:
        job.status = "failed"
        job.error_message = str(exc.detail)
        job.finished_at = datetime.utcnow()
        job.result = {"non_retryable": True}
        db.commit()
        raise
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error_message = str(exc)
        job.finished_at = datetime.utcnow()
        job.result = {"non_retryable": True}
        db.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/yue2/assistant-llm")
def get_yue2_assistant_llm(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    resolved = _resolve_assistant_llm(db, user.username, user.role)
    binding = resolved["binding"]
    channel = resolved.get("channel")
    return {
        "channel_id": binding.get("channel_id") or "",
        "model": binding.get("model") or "",
        "max_tokens": binding.get("max_tokens") or 32768,
        "ready": bool(resolved.get("ready")),
        "channel_name": (channel or {}).get("name") or "",
        "channels": resolved.get("channels") or [],
    }


@router.put("/yue2/assistant-llm")
def put_yue2_assistant_llm(
    payload: dict,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    user = _user(credentials)
    if user.role != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅超级管理员可修改创作助手渠道")
    channel_id = str(payload.get("channel_id") or "").strip()
    model = str(payload.get("model") or "").strip()
    max_tokens = int(payload.get("max_tokens") or 32768)
    max_tokens = max(64, min(max_tokens, 262144))
    channels = _assistant_text_channels(db, user.username, user.role)
    channel = next((item for item in channels if item["id"] == channel_id), None)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请选择已添加的 OpenAI 兼容文本渠道")
    if not any(item["name"] == model for item in channel["models"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请选择该渠道下的文本模型")
    if not channel.get("has_key"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该渠道还没有 API Key，请先在上方渠道里保存密钥")
    value = {"channel_id": channel_id, "model": model, "max_tokens": max_tokens}
    row = db.get(SystemConfig, YUE2_ASSISTANT_LLM_KEY)
    if row is None:
        row = SystemConfig(key=YUE2_ASSISTANT_LLM_KEY, value=value)
        db.add(row)
    else:
        row.value = value
        flag_modified(row, "value")
    record_operation_log(
        db,
        username=user.username,
        operation_type="更新AI歌曲创作助手渠道",
        target_type="canvas_lan",
        target_name=f"{channel.get('name')}:{model}",
        after_data=value,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.commit()
    # Lyric assistant runs on platform channels; no need to sync credentials to YuE2 file machine.
    return {
        "channel_id": channel_id,
        "model": model,
        "max_tokens": max_tokens,
        "ready": True,
        "channel_name": channel.get("name") or "",
        "channels": channels,
        "sync": {"ok": True, "detail": "创作助手已改为平台渠道直连，无需同步文件机"},
    }


@router.get("/yue2/assistant-llm/runtime")
def get_yue2_assistant_llm_runtime(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """YuE2-shaped assistant/config for the platform bridge (no raw API key)."""
    user = _user(credentials)
    resolved = _resolve_assistant_llm(db, user.username, user.role)
    return _assistant_runtime_payload(resolved)


@router.post("/yue2/assistant-llm/sync")
def sync_yue2_assistant_llm(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Push platform channel key/model into YuE2 assistant credentials (file machine)."""
    user = _user(credentials)
    resolved = _resolve_assistant_llm(db, user.username, user.role)
    runtime = _assistant_runtime_payload(resolved)
    sync = _sync_assistant_llm_to_yue2(db, resolved)
    return {**runtime, "sync": sync}
