import base64
import os
import re
import sys
import tempfile
import threading
import time
from pathlib import Path
import shutil
import subprocess
import json
from urllib.parse import quote

import requests


API_BASE_URL = os.getenv("NAS_API_BASE_URL", "http://127.0.0.1:8000")
def _read_client_token() -> str:
    raw = os.getenv("NAS_CLIENT_TOKEN", "") or ""
    return raw.strip().lstrip("\ufeff").strip()


CLIENT_TOKEN = _read_client_token()
NAS_MOUNT_ROOT = Path(os.getenv("NAS_MOUNT_ROOT", "/mnt/nas/material-assets"))
POLL_INTERVAL_SECONDS = int(os.getenv("NAS_POLL_INTERVAL_SECONDS", "5"))
TIMEOUT_SECONDS = int(os.getenv("NAS_HTTP_TIMEOUT_SECONDS", "60"))
PREPARE_UPLOAD_TIMEOUT_SECONDS = int(os.getenv("NAS_PREPARE_UPLOAD_TIMEOUT_SECONDS", "900"))
DOWNLOAD_CHUNK_SIZE_BYTES = int(os.getenv("NAS_DOWNLOAD_CHUNK_SIZE_BYTES", str(8 * 1024 * 1024)))
WORKER_CONCURRENCY = int(os.getenv("NAS_WORKER_CONCURRENCY", "1"))
# Comma-separated: poll only these job_type values (e.g. generate_derivatives). Do not set together with NAS_EXCLUDE_JOB_TYPES.
POLL_JOB_TYPES = os.getenv("NAS_POLL_JOB_TYPES", "").strip()
# Comma-separated: skip these job types (e.g. generate_derivatives) for a full worker paired with a thumbnail-only worker.
EXCLUDE_JOB_TYPES = os.getenv("NAS_EXCLUDE_JOB_TYPES", "").strip()
WORKER_LABEL = os.getenv("NAS_WORKER_LABEL", "").strip() or "default"
FFMPEG_BIN = os.getenv("NAS_FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = os.getenv("NAS_FFPROBE_BIN", "ffprobe")
VIDEO_EXTENSIONS = {"mp4", "mov", "mkv", "avi", "webm", "m4v"}
# 内容分析（analyze_content）：文件机调视觉模型，ECS 只编排。默认走 OpenAI 兼容接口（vLLM / lmdeploy / 百炼），不依赖 Ollama。
VLM_BASE_URL = os.getenv("NAS_VLM_BASE_URL", "http://127.0.0.1:23333/v1").rstrip("/")
VLM_MODEL = os.getenv("NAS_VLM_MODEL", "Qwen2.5-VL-7B-Instruct")
VLM_API_KEY = (os.getenv("NAS_VLM_API_KEY", "") or "").strip()
VLM_PROVIDER = (os.getenv("NAS_VLM_PROVIDER", "") or "").strip().lower()
VLM_TIMEOUT_SECONDS = int(os.getenv("NAS_VLM_TIMEOUT_SECONDS", "300"))
VLM_FRAME_COUNT = max(1, min(int(os.getenv("NAS_VLM_VIDEO_FRAMES", "1")), 8))
VLM_FRAME_MAX_WIDTH = int(os.getenv("NAS_VLM_FRAME_MAX_WIDTH", "512"))
VLM_RETRY_FRAME_MAX_WIDTH = int(os.getenv("NAS_VLM_RETRY_FRAME_MAX_WIDTH", "384"))
VLM_MAX_TOKENS = int(os.getenv("NAS_VLM_MAX_TOKENS", "800"))

_startup_guidance_lock = threading.Lock()
_startup_guidance_once = [False]


def _job_type_set(env_csv: str) -> set[str]:
    return {x.strip() for x in (env_csv or "").split(",") if x.strip()}


def _one_time_startup_guidance() -> str:
    poll = _job_type_set(POLL_JOB_TYPES)
    excl = _job_type_set(EXCLUDE_JOB_TYPES)
    if poll and poll <= {"generate_derivatives", "analyze_content"}:
        hint = "Media worker: polling " + ", ".join(sorted(poll)) + " (ffmpeg on this host, not on ECS)."
        if "analyze_content" in poll:
            hint += f" Content analysis calls {VLM_BASE_URL} model={VLM_MODEL} (OpenAI-compatible by default)."
        return hint
    if "generate_derivatives" in excl:
        return (
            "Full worker: generate_derivatives excluded here; "
            "run run-derivative-worker.ps1 in another window for thumbnails and content analysis."
        )
    if poll:
        return f"Poll filter active (NAS_POLL_JOB_TYPES={POLL_JOB_TYPES!r})."
    return (
        "Full-queue worker: generate_derivatives also runs here unless excluded. "
        "To split load: derivative-only window with NAS_POLL_JOB_TYPES=generate_derivatives, "
        "and NAS_EXCLUDE_JOB_TYPES=generate_derivatives on this process."
    )


def _headers() -> dict[str, str]:
    return {"X-NAS-Client-Token": CLIENT_TOKEN}


def _ensure_token() -> None:
    if not CLIENT_TOKEN:
        raise RuntimeError("NAS_CLIENT_TOKEN is required")
    if POLL_JOB_TYPES and EXCLUDE_JOB_TYPES:
        raise RuntimeError("Set only one of NAS_POLL_JOB_TYPES or NAS_EXCLUDE_JOB_TYPES")


def _poll_job() -> dict | None:
    params: dict[str, str] = {}
    if POLL_JOB_TYPES:
        params["job_types"] = POLL_JOB_TYPES
    if EXCLUDE_JOB_TYPES:
        params["exclude_job_types"] = EXCLUDE_JOB_TYPES
    resp = requests.get(
        f"{API_BASE_URL}/nas-jobs/poll",
        headers=_headers(),
        params=params or None,
        timeout=TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    return resp.json()


def _report_progress(
    job_id: str,
    step: str,
    percent: int | None = None,
    label: str = "",
    result_patch: dict | None = None,
) -> None:
    try:
        body: dict = {"step": step}
        if percent is not None:
            body["percent"] = percent
        if label:
            body["label"] = label
        if isinstance(result_patch, dict) and result_patch:
            body["result_patch"] = result_patch
        resp = requests.post(
            f"{API_BASE_URL}/nas-jobs/{job_id}/progress",
            headers={**_headers(), "Content-Type": "application/json"},
            json=body,
            timeout=min(15, TIMEOUT_SECONDS),
        )
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"[nas-client][{WORKER_LABEL}] progress {step} ignored: {exc}")


def _mark_success(job_id: str, result: dict) -> None:
    resp = requests.post(
        f"{API_BASE_URL}/nas-jobs/{job_id}/complete",
        headers={**_headers(), "Content-Type": "application/json"},
        json={"result": result},
        timeout=TIMEOUT_SECONDS,
    )
    resp.raise_for_status()


def _mark_fail(job_id: str, error_message: str, *, non_retryable: bool = False) -> None:
    body: dict = {"error_message": error_message}
    if non_retryable:
        body["result"] = {"non_retryable": True}
    resp = requests.post(
        f"{API_BASE_URL}/nas-jobs/{job_id}/fail",
        headers={**_headers(), "Content-Type": "application/json"},
        json=body,
        timeout=TIMEOUT_SECONDS,
    )
    resp.raise_for_status()


def _download_source(job_id: str, target_file: Path) -> int:
    target_file.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(
        f"{API_BASE_URL}/nas-jobs/{job_id}/source",
        headers=_headers(),
        stream=True,
        timeout=TIMEOUT_SECONDS,
    ) as resp:
        resp.raise_for_status()
        total = 0
        with target_file.open("wb") as f:
            for chunk in resp.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE_BYTES):
                if not chunk:
                    continue
                f.write(chunk)
                total += len(chunk)
    return total


def _handle_store_original(job: dict) -> dict:
    payload = job.get("payload") or {}
    target_rel_path = payload.get("target_rel_path")
    if not isinstance(target_rel_path, str) or not target_rel_path:
        raise RuntimeError("Invalid target_rel_path")
    target_file = NAS_MOUNT_ROOT / target_rel_path
    bytes_written = _download_source(job["id"], target_file)
    return {"target_file": str(target_file), "bytes_written": bytes_written}


def _resolve_nas_local_path(raw_path: str) -> Path:
    path = (raw_path or "").strip()
    if not path:
        raise RuntimeError("Invalid file_path for prepare_download")
    normalized = path.replace("\\", "/")
    candidate = Path(normalized)
    if candidate.is_absolute():
        return Path(path)
    return NAS_MOUNT_ROOT / normalized


def _sanitize_rel_path(path_value: str) -> str:
    normalized = path_value.replace("\\", "/").strip("/")
    if not normalized:
        return "unknown.bin"
    return normalized


def _build_trash_target(source_path: Path) -> Path:
    timestamp = str(int(time.time()))
    try:
        rel = source_path.resolve().relative_to(NAS_MOUNT_ROOT.resolve())
        rel_str = rel.as_posix()
    except Exception:
        rel_str = source_path.name
    safe_rel = _sanitize_rel_path(rel_str)
    return NAS_MOUNT_ROOT / ".trash" / timestamp / safe_rel


def _upload_prepared_download(job_id: str, local_file: Path, original_filename: str) -> None:
    with local_file.open("rb") as f:
        files = {
            "download_file": (
                original_filename,
                f,
                "application/octet-stream",
            )
        }
        resp = requests.post(
            f"{API_BASE_URL}/materials/download-prepare/{quote(job_id)}/upload",
            headers=_headers(),
            files=files,
            timeout=(10, PREPARE_UPLOAD_TIMEOUT_SECONDS),
        )
    resp.raise_for_status()


def _handle_prepare_download(job: dict) -> dict:
    payload = job.get("payload") or {}
    file_path = str(payload.get("file_path") or "")
    original_filename = str(payload.get("original_filename") or "")
    if not original_filename:
        raise RuntimeError("Missing original_filename")
    local_file = _resolve_nas_local_path(file_path)
    if not local_file.exists() or not local_file.is_file():
        raise RuntimeError(f"Local NAS file not found: {local_file}")
    fs = local_file.stat().st_size
    print(
        f"[nas-client][{WORKER_LABEL}] prepare_download job={job.get('id')} "
        f"uploading {fs} bytes to ECS {API_BASE_URL}/materials/download-prepare/.../upload "
        f"(this is worker.py / run-worker.ps1, NOT the LAN HTTP download_server window)"
    )
    _upload_prepared_download(job["id"], local_file, original_filename)
    return {"uploaded": True, "file_size": fs}


def _handle_move_to_trash(job: dict) -> dict:
    payload = job.get("payload") or {}
    file_path = str(payload.get("file_path") or "")
    source_file = _resolve_nas_local_path(file_path)
    if not source_file.exists() or not source_file.is_file():
        raise RuntimeError(f"Source file not found for trash move: {source_file}")
    trash_target = _build_trash_target(source_file)
    trash_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source_file), str(trash_target))
    return {"target_file": str(trash_target)}


def _handle_restore_from_trash(job: dict) -> dict:
    payload = job.get("payload") or {}
    file_path = str(payload.get("file_path") or "")
    restore_to_path = str(payload.get("restore_to_path") or "")
    source_file = _resolve_nas_local_path(file_path)
    target_file = _resolve_nas_local_path(restore_to_path)
    if not source_file.exists() or not source_file.is_file():
        raise RuntimeError(f"Trash file not found for restore: {source_file}")
    target_file.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source_file), str(target_file))
    return {"target_file": str(target_file)}


def _run_cmd(args: list[str]) -> tuple[int, str]:
    proc = subprocess.run(args, capture_output=True, text=True)
    output = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, output


def _run_cmd_timeout(args: list[str], *, timeout_sec: int | None) -> tuple[int, str]:
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout_sec)
        output = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode, output
    except subprocess.TimeoutExpired as exc:
        return -124, f"timeout after {timeout_sec}s: {exc!r}"


def _read_env_int(name: str, default: int) -> int:
    raw = (os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _probe_stream_width_height(source_file: Path) -> tuple[int | None, int | None]:
    """ffprobe 取首路视频流宽高（图片/多数视频容器均可用）；失败返回 (None, None)。"""
    code, output = _run_cmd(
        [
            FFPROBE_BIN,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            str(source_file),
        ]
    )
    if code != 0:
        return None, None
    try:
        data = json.loads(output)
        streams = data.get("streams") if isinstance(data, dict) else None
        if not isinstance(streams, list) or not streams:
            return None, None
        s0 = streams[0] if isinstance(streams[0], dict) else {}
        w_raw, h_raw = s0.get("width"), s0.get("height")
        wi = int(w_raw) if isinstance(w_raw, (int, float)) and int(w_raw) > 0 else None
        hi = int(h_raw) if isinstance(h_raw, (int, float)) and int(h_raw) > 0 else None
        if wi is not None and hi is not None:
            return wi, hi
        if isinstance(w_raw, str) and w_raw.isdigit() and isinstance(h_raw, str) and h_raw.isdigit():
            wi2, hi2 = int(w_raw), int(h_raw)
            if wi2 > 0 and hi2 > 0:
                return wi2, hi2
    except Exception:
        return None, None
    return None, None


def _probe_video_duration_seconds(source_file: Path) -> float | None:
    code, output = _run_cmd(
        [
            FFPROBE_BIN,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(source_file),
        ]
    )
    if code != 0:
        return None
    try:
        data = json.loads(output)
        duration_raw = (((data.get("format") or {}).get("duration")) if isinstance(data, dict) else None)
        if duration_raw is None:
            return None
        return float(duration_raw)
    except Exception:
        return None


def _representative_seek_seconds(duration: float | None) -> float | None:
    """跳过片头空镜/封面，取片中更有内容的一帧；短片取 40%。"""
    if duration is None or duration <= 0:
        return None
    if duration <= 3:
        return max(duration * 0.4, 0.05)
    return min(max(duration * 0.28, 1.0), max(duration - 0.4, 0.05))


def _analysis_seek_offsets(duration: float, count: int) -> list[float | None]:
    if duration <= 0:
        return [None]
    if count <= 1:
        return [_representative_seek_seconds(duration)]
    start = duration * 0.22
    end = duration * 0.78
    if end <= start:
        return [_representative_seek_seconds(duration)]
    return [start + (end - start) * i / (count - 1) for i in range(count)]


def _ffmpeg_extract_jpeg(
    source_file: Path,
    target_file: Path,
    seek_seconds: float | None,
    *,
    max_width: int | None = None,
    quality: int = 3,
) -> bool:
    """混合定位：先粗跳再精确 -ss，避免只落在最近关键帧导致预览/识别都看片头。"""
    cmd = [FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y"]
    offset = float(seek_seconds) if seek_seconds is not None and seek_seconds > 0 else 0.0
    if offset > 0:
        coarse = max(0.0, offset - 1.5)
        if coarse > 0:
            cmd.extend(["-ss", f"{coarse:.3f}"])
        cmd.extend(["-i", str(source_file)])
        fine = offset - coarse
        if fine > 0.01:
            cmd.extend(["-ss", f"{fine:.3f}"])
    else:
        cmd.extend(["-i", str(source_file)])
    cmd.extend(["-frames:v", "1"])
    if max_width and max_width > 0:
        cmd.extend(["-vf", rf"scale=min({max_width}\,iw):-2"])
    cmd.extend(["-q:v", str(max(2, min(quality, 12))), str(target_file)])
    code, _ = _run_cmd_timeout(cmd, timeout_sec=180)
    return code == 0 and target_file.exists() and target_file.stat().st_size > 0
    """
    H.264 / AAC / yuv420p MP4，默认前 30 秒，-movflags +faststart。
    仅视频扩展名调用；失败返回 preview_video_status=failed，不影响上传原文件。
    """
    if ext not in VIDEO_EXTENSIONS:
        return {}
    preview_path = derivatives_root / f"{stem}_preview.mp4"
    try:
        preview_path.unlink(missing_ok=True)
    except OSError:
        pass
    max_sec = _read_env_int("NAS_PREVIEW_VIDEO_MAX_SECONDS", 30)
    timeout_sec = _read_env_int("NAS_PREVIEW_TRANSCODE_TIMEOUT_SECONDS", 600)
    base_cmd: list[str] = [
        FFMPEG_BIN,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_file),
        "-t",
        str(max_sec),
        "-vf",
        # 逗号在 ffmpeg 滤镜链中有语法意义，表达式内的逗号必须转义，否则 scale 被截断、预览必失败
        # force_divisible_by=2：避免缩放后宽高为奇数导致 libx264+yuv420p 报错（竖屏大图等）
        r"scale=min(1280\,iw):-2:force_divisible_by=2",
        "-c:v",
        "libx264",
        "-profile:v",
        "main",
        "-level",
        "4.0",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-movflags",
        "+faststart",
    ]
    try_with_audio = base_cmd + ["-c:a", "aac", "-b:a", "128k", str(preview_path)]
    code, output = _run_cmd_timeout(try_with_audio, timeout_sec=timeout_sec)
    audio_label = "aac"
    if code != 0 or not preview_path.exists() or preview_path.stat().st_size <= 0:
        try:
            preview_path.unlink(missing_ok=True)
        except OSError:
            pass
        no_audio_cmd = base_cmd + ["-an", str(preview_path)]
        code2, output2 = _run_cmd_timeout(no_audio_cmd, timeout_sec=timeout_sec)
        merged_err = ((output or "") + "\n" + (output2 or "")).strip()
        if code2 != 0 or not preview_path.exists() or preview_path.stat().st_size <= 0:
            err_tail = merged_err[-2500:] if merged_err else "ffmpeg transcode failed"
            print(f"[nas-client][{WORKER_LABEL}] preview_video failed: {err_tail[:400]}…")
            return {
                "preview_video_status": "failed",
                "preview_video_error": f"ffmpeg transcode failed: {err_tail}",
            }
        audio_label = "none"
    try:
        rel = str(preview_path.relative_to(NAS_MOUNT_ROOT)).replace("\\", "/")
    except ValueError:
        rel = str(preview_path).replace("\\", "/")
    dur_probe = _probe_video_duration_seconds(preview_path)
    if dur_probe is None:
        dur_probe = float(min(max_sec, 30))
    dur_fin = min(float(dur_probe), float(max_sec))
    print(f"[nas-client][{WORKER_LABEL}] preview_video ok {rel} dur={dur_fin}s audio={audio_label}")
    return {
        "preview_video_path": rel,
        "preview_video_status": "success",
        "preview_video_duration": round(dur_fin, 2),
        "preview_video_codec": "h264",
        "preview_video_audio": audio_label,
    }


def _handle_generate_derivatives(job: dict) -> dict:
    payload = job.get("payload") or {}
    file_path = str(payload.get("file_path") or "")
    material_id = str(payload.get("material_id") or "")
    material_file_id = str(payload.get("material_file_id") or "")
    source_file = _resolve_nas_local_path(file_path)
    if not source_file.exists() or not source_file.is_file():
        raise RuntimeError(f"Source file not found for ffmpeg: {source_file}")

    stem = source_file.stem
    ext = source_file.suffix.lower().lstrip(".")
    month = time.strftime("%Y/%m")
    derivatives_root = NAS_MOUNT_ROOT / "derivatives" / month
    thumb_path = derivatives_root / f"{stem}_thumb.jpg"
    derivatives_root.mkdir(parents=True, exist_ok=True)

    duration_seconds = _probe_video_duration_seconds(source_file) if ext in VIDEO_EXTENSIONS else None
    mw, mh = _probe_stream_width_height(source_file)
    thumb_seek = _representative_seek_seconds(duration_seconds) if ext in VIDEO_EXTENSIONS else None
    if not _ffmpeg_extract_jpeg(source_file, thumb_path, thumb_seek, quality=2):
        if thumb_seek is None or not _ffmpeg_extract_jpeg(source_file, thumb_path, None, quality=2):
            raise RuntimeError("thumbnail generation failed: empty or missing jpeg")

    try:
        thumb_for_db = str(thumb_path.relative_to(NAS_MOUNT_ROOT)).replace("\\", "/")
    except ValueError:
        thumb_for_db = str(thumb_path).replace("\\", "/")
    out: dict = {
        "material_id": material_id,
        "material_file_id": material_file_id,
        "thumbnail_path": thumb_for_db,
        "duration_seconds": duration_seconds,
    }
    if mw is not None and mh is not None:
        out["media_width"] = mw
        out["media_height"] = mh
    try:
        pv_meta = _generate_browser_preview_video(source_file, stem, derivatives_root, ext)
        if pv_meta:
            out.update(pv_meta)
    except Exception as exc:
        err_msg = f"preview_video exception: {exc}"
        print(f"[nas-client][{WORKER_LABEL}] {err_msg}")
        out["preview_video_status"] = "failed"
        out["preview_video_error"] = err_msg[:2500]
    return out


def _extract_analysis_frame(
    source_file: Path,
    target_file: Path,
    seek_seconds: float | None,
    *,
    max_width: int | None = None,
) -> bool:
    """抽一帧并缩到指定宽度；混合定位，避免只抽到片头关键帧。"""
    width = VLM_FRAME_MAX_WIDTH if max_width is None else max_width
    return _ffmpeg_extract_jpeg(source_file, target_file, seek_seconds, max_width=width, quality=3)


def _collect_analysis_frames(
    payload: dict,
    work_dir: Path,
    *,
    frame_count: int | None = None,
    max_width: int | None = None,
) -> list[Path]:
    """图片取缩略图/原图一帧；视频从原片按完整时长抽帧，不用只有片头的预览 MP4。"""
    media_kind = str(payload.get("media_kind") or "image")
    file_path = str(payload.get("file_path") or "")
    thumbnail_path = str(payload.get("thumbnail_path") or "")
    preview_path = str(payload.get("preview_video_path") or "")
    wanted = max(1, frame_count or VLM_FRAME_COUNT)
    frames: list[Path] = []
    if media_kind == "image":
        for candidate in (thumbnail_path, file_path):
            if not candidate:
                continue
            image_source = _resolve_nas_local_path(candidate)
            if not image_source.exists():
                continue
            target = work_dir / "frame_1.jpg"
            if _extract_analysis_frame(image_source, target, None, max_width=max_width):
                frames.append(target)
                break
        return frames

    video_source: Path | None = None
    for candidate in (file_path, preview_path):
        if not candidate:
            continue
        resolved = _resolve_nas_local_path(candidate)
        if resolved.exists() and resolved.is_file():
            video_source = resolved
            break
    if video_source is None:
        return frames
    duration = _probe_video_duration_seconds(video_source) or 0.0
    offsets = _analysis_seek_offsets(duration, wanted)
    for idx, offset in enumerate(offsets):
        target = work_dir / f"frame_{idx + 1}.jpg"
        if _extract_analysis_frame(video_source, target, offset, max_width=max_width):
            frames.append(target)
    if not frames and thumbnail_path:
        thumb = _resolve_nas_local_path(thumbnail_path)
        target = work_dir / "frame_1.jpg"
        if thumb.exists() and _extract_analysis_frame(thumb, target, None, max_width=max_width):
            frames.append(target)
    return frames


def _build_analysis_prompt(payload: dict) -> str:
    groups = payload.get("allowed_tags") or []
    lines = [
        f"- {g.get('category')}：{'、'.join(g.get('names') or [])}"
        for g in groups
        if isinstance(g, dict) and (g.get("names") or [])
    ]
    is_video = str(payload.get("media_kind") or "") == "video"
    media_kind = "视频关键帧" if is_video else "图片"
    open_vocab = bool(payload.get("allow_open_vocab"))
    options = payload.get("taxonomy_options") or []
    option_lines = [
        f"  {o.get('primary')}：{'、'.join(o.get('secondary') or [])}"
        for o in options
        if isinstance(o, dict) and (o.get("secondary") or [])
    ]
    parts = [
        f"你在为素材库标注{media_kind}。视频和图片使用同一套字段，不要省略分类、主题或描述。",
        "只根据画面内容作答。只输出一行 JSON，不要解释、不要 markdown。",
        "",
    ]
    if open_vocab:
        parts.extend(
            [
                "已有适用主题（优先逐字选用；不够贴可自拟 2～8 个汉字，不要英文、不要句子）：",
                *(lines or ["- （当前还没有已有主题，请按画面自拟 3～6 个）"]),
                "",
            ]
        )
        if option_lines:
            parts.append("已有一二级分类（优先用这些名字）：")
            parts.extend(option_lines)
            parts.append("")
        parts.extend(
            [
                "字段都必须有，不允许空。按这个顺序写：",
                "- primary_taxonomy：一级分类，必填，不能空；优先已有一级，可自拟 2～8 个汉字",
                "- secondary_taxonomy：二级分类，必填，不能空，从属于上面的一级；优先已有二级，可自拟",
                "- keywords：3～6 个中文检索词，必填",
                "- copy_fit：1 句中文承接句意，必填",
                "- description：1～2 句中文画面描述（主体、动作、场景）",
                "- tags：3～8 个适用主题名；能对上已有就用已有名，对不上就给更贴画面的新词",
                '示例：{"primary_taxonomy":"关系张力","secondary_taxonomy":"犹豫不决","keywords":["门","侧身","阳光"],"copy_fit":"适合承接犹豫要不要推开门的旁白。","description":"女孩侧身站在门前，阳光从门缝洒在脸上","tags":["阳光","门"]}',
            ]
        )
    else:
        parts.extend(
            [
                "可选标签清单（只能从中选择，禁止自创新词）：",
                *lines,
                "",
                "输出严格的 JSON，不要任何解释文字，字段如下：",
                "- description：1～2 句中文画面描述（客观，说清主体、动作、场景、画面风格）",
                "- tags：字符串数组，从上面清单里选 3～8 个最贴合的标签名，必须逐字一致",
            ]
        )
        if payload.get("needs_keywords"):
            parts.append("- keywords：3～6 个中文检索词，可自由发挥")
        if payload.get("needs_copy_fit"):
            parts.append("- copy_fit：1 句中文文案，描述这段画面适合承接什么样的情绪或旁白")
        if option_lines:
            parts.append("- secondary_taxonomy：从下列二级分类中选且只选一个，逐字一致：")
            parts.extend(option_lines)
    return "\n".join(parts)


def _vlm_provider() -> str:
    if VLM_PROVIDER in {"openai", "openai-compatible", "vllm", "lmdeploy", "dashscope"}:
        return "openai"
    if VLM_PROVIDER == "ollama":
        return "ollama"
    lowered = VLM_BASE_URL.lower()
    if "/v1" in lowered or "dashscope" in lowered or "compatible-mode" in lowered:
        return "openai"
    if lowered.rstrip("/").endswith(":11434") or "/api/chat" in lowered:
        return "ollama"
    return "openai"


def _normalize_vlm_content(content) -> str:
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
            else:
                parts.append(str(item or ""))
        return "\n".join(part for part in parts if part).strip()
    return str(content or "").strip()


def _strip_vlm_fences(text: str) -> str:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    start = cleaned.find("{")
    if start > 0:
        cleaned = cleaned[start:]
    return cleaned


_ANALYSIS_KEY_ALIASES = {
    "primarytaxonomy": "primary_taxonomy",
    "primary_taxonomy": "primary_taxonomy",
    "primary": "primary_taxonomy",
    "一级分类": "primary_taxonomy",
    "一级": "primary_taxonomy",
    "secondarytaxonomy": "secondary_taxonomy",
    "secondary_taxonomy": "secondary_taxonomy",
    "secondary": "secondary_taxonomy",
    "二级分类": "secondary_taxonomy",
    "二级": "secondary_taxonomy",
    "copyfit": "copy_fit",
    "copy_fit": "copy_fit",
    "承接句意": "copy_fit",
    "description": "description",
    "描述": "description",
    "tags": "tags",
    "keywords": "keywords",
    "关键词": "keywords",
}


def _alias_key(raw: object) -> str:
    key = str(raw or "").strip()
    folded = key.lower().replace(" ", "").replace("-", "_")
    return _ANALYSIS_KEY_ALIASES.get(folded) or _ANALYSIS_KEY_ALIASES.get(key) or key


def _canonicalize_analysis(parsed: dict) -> dict:
    out: dict = {}
    for raw_key, value in parsed.items():
        key = _alias_key(raw_key)
        if key in {"tags", "keywords"}:
            current = [str(x).strip() for x in (out.get(key) or []) if str(x).strip()]
            incoming = [str(x).strip() for x in (value or []) if str(x).strip()] if isinstance(value, list) else []
            out[key] = current or incoming
            continue
        text = str(value or "").strip()
        if text and not str(out.get(key) or "").strip():
            out[key] = text
    secondary = str(out.get("secondary_taxonomy") or "").strip()
    description = str(out.get("description") or "").strip()
    if secondary and not description and (len(secondary) > 16 or any(ch in secondary for ch in "，。！？")):
        out["description"] = secondary
        out["secondary_taxonomy"] = ""
    return out


def _extract_json_object(text: str) -> str:
    start = text.find("{")
    if start < 0:
        return text
    depth = 0
    in_str = False
    escape = False
    for idx, ch in enumerate(text[start:], start=start):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]
    return text[start:]


def _repair_truncated_json(text: str) -> str:
    start = text.find("{")
    if start < 0:
        return text
    snippet = text[start:]
    in_str = False
    escape = False
    stack: list[str] = []
    for ch in snippet:
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            stack.append("}")
        elif ch == "[":
            stack.append("]")
        elif ch in {"}", "]"} and stack and stack[-1] == ch:
            stack.pop()
    repaired = snippet.rstrip()
    if in_str:
        last_comma = repaired.rfind(",")
        last_colon = repaired.rfind(":")
        if last_comma > last_colon:
            repaired = repaired[:last_comma].rstrip()
            in_str = False
        else:
            repaired += '"'
    if repaired.endswith(","):
        repaired = repaired[:-1]
    while stack:
        repaired += stack.pop()
    return repaired


def _recover_analysis_fields(text: str) -> dict | None:
    recovered: dict = {}
    for match in re.finditer(r'"([^"\\]+)"\s*:\s*"((?:\\.|[^"\\])*)"', text, re.S):
        key = _alias_key(match.group(1))
        value = match.group(2).replace('\\"', '"').strip()
        if key and value and not str(recovered.get(key) or "").strip():
            recovered[key] = value
    for match in re.finditer(r'"([^"\\]+)"\s*:\s*\[(.*?)\]', text, re.S):
        key = _alias_key(match.group(1))
        if key not in {"tags", "keywords"}:
            continue
        items = [item.strip() for item in re.findall(r'"((?:\\.|[^"\\])*)"', match.group(2)) if item.strip()]
        if items and not recovered.get(key):
            recovered[key] = items
    recovered = _canonicalize_analysis(recovered)
    if any(recovered.get(k) for k in ("description", "tags", "keywords", "copy_fit", "primary_taxonomy", "secondary_taxonomy")):
        return recovered
    return None


def _parse_vlm_json(content) -> dict:
    text = _strip_vlm_fences(_normalize_vlm_content(content))
    candidates = [text, _extract_json_object(text), _repair_truncated_json(text)]
    last_error: Exception | None = None
    decoder = json.JSONDecoder()
    for raw in candidates:
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            last_error = exc
            try:
                parsed, _ = decoder.raw_decode(raw[raw.find("{") :] if "{" in raw else raw)
            except Exception as raw_exc:  # noqa: BLE001
                last_error = raw_exc
                continue
        if isinstance(parsed, dict):
            return _canonicalize_analysis(parsed)
        last_error = RuntimeError("视觉模型输出不是 JSON 对象")
    recovered = _recover_analysis_fields(text)
    if recovered:
        return recovered
    raise RuntimeError(f"视觉模型输出不是 JSON：{text[:400]}") from last_error


def _vlm_http_error_message(status: int, body: str) -> str:
    text = body or ""
    lowered = text.lower()
    if "exceed_context" in lowered or "context_size" in lowered or "prompt is too long" in lowered:
        return f"视觉模型上下文超限（画面过大或帧数过多）：HTTP {status}"
    return f"视觉模型返回 {status}: {text[:400]}"


def _is_vlm_input_retryable(exc: BaseException) -> bool:
    msg = str(exc)
    return any(
        token in msg
        for token in ("上下文超限", "exceed_context", "context_size", "视觉模型输出不是 JSON")
    )


def _call_vlm_openai(prompt: str, frames: list[Path]) -> dict:
    content: list[dict] = [{"type": "text", "text": prompt}]
    for frame in frames:
        raw = base64.b64encode(frame.read_bytes()).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{raw}"}})
    root = VLM_BASE_URL.rstrip("/")
    if not root.endswith("/v1"):
        root = f"{root}/v1"
    headers = {"Content-Type": "application/json"}
    if VLM_API_KEY:
        headers["Authorization"] = f"Bearer {VLM_API_KEY}"
    body = {
        "model": VLM_MODEL,
        "temperature": 0.1,
        "stream": False,
        "max_tokens": VLM_MAX_TOKENS,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": content}],
    }
    try:
        resp = requests.post(f"{root}/chat/completions", headers=headers, json=body, timeout=VLM_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise RuntimeError(
            f"视觉模型不可用（{root}）：{exc}。请先用 cmd 启动 Qwen 的 OpenAI 兼容服务，"
            f"或设置 NAS_VLM_BASE_URL / NAS_VLM_MODEL / NAS_VLM_API_KEY"
        ) from exc
    if resp.status_code != 200:
        raise RuntimeError(_vlm_http_error_message(resp.status_code, resp.text))
    message = (((resp.json() or {}).get("choices") or [{}])[0].get("message") or {})
    return _parse_vlm_json(message.get("content"))


def _call_vlm_ollama(prompt: str, frames: list[Path]) -> dict:
    images = [base64.b64encode(f.read_bytes()).decode("ascii") for f in frames]
    body = {
        "model": VLM_MODEL,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1},
        "messages": [{"role": "user", "content": prompt, "images": images}],
    }
    try:
        resp = requests.post(f"{VLM_BASE_URL.rstrip('/')}/api/chat", json=body, timeout=VLM_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise RuntimeError(f"视觉模型不可用（{VLM_BASE_URL}）：{exc}") from exc
    if resp.status_code != 200:
        raise RuntimeError(_vlm_http_error_message(resp.status_code, resp.text))
    return _parse_vlm_json(((resp.json() or {}).get("message") or {}).get("content"))


def _call_vlm(prompt: str, frames: list[Path]) -> dict:
    if _vlm_provider() == "ollama":
        return _call_vlm_ollama(prompt, frames)
    return _call_vlm_openai(prompt, frames)


def _first_nonempty(*values: object) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _requires_full_personal_fields(payload: dict) -> bool:
    return bool(payload.get("allow_open_vocab") or payload.get("needs_keywords") or payload.get("needs_copy_fit"))


def _analysis_taxonomy(parsed: dict) -> tuple[str, str]:
    primary = _first_nonempty(
        parsed.get("primary_taxonomy"),
        parsed.get("primary"),
        parsed.get("一级分类"),
        parsed.get("一级"),
    )
    secondary = _first_nonempty(
        parsed.get("secondary_taxonomy"),
        parsed.get("secondary"),
        parsed.get("二级分类"),
        parsed.get("二级"),
    )
    return primary, secondary


def _analysis_keywords(parsed: dict) -> list[str]:
    return [str(x).strip() for x in (parsed.get("keywords") or []) if str(x).strip()]


def _missing_required_analysis_fields(payload: dict, parsed: dict) -> list[str]:
    if not _requires_full_personal_fields(payload):
        return []
    missing: list[str] = []
    primary, secondary = _analysis_taxonomy(parsed)
    if not primary:
        missing.append("一级分类")
    if not secondary:
        missing.append("二级分类")
    if len(_analysis_keywords(parsed)) < 3:
        missing.append("关键词")
    if not str(parsed.get("copy_fit") or "").strip():
        missing.append("承接句意")
    return missing


def _merge_analysis(base: dict, extra: dict) -> dict:
    merged = dict(base)
    for key, value in extra.items():
        if key == "tags" or key == "keywords":
            current = [str(x).strip() for x in (merged.get(key) or []) if str(x).strip()]
            incoming = [str(x).strip() for x in (value or []) if str(x).strip()]
            merged[key] = current or incoming
            continue
        if not str(merged.get(key) or "").strip() and str(value or "").strip():
            merged[key] = value
    return merged


def _complete_incomplete_analysis(payload: dict, frames: list[Path], parsed: dict) -> dict:
    missing = _missing_required_analysis_fields(payload, parsed)
    if not missing:
        return parsed
    draft = json.dumps(
        {
            "description": str(parsed.get("description") or "").strip(),
            "primary_taxonomy": _analysis_taxonomy(parsed)[0],
            "secondary_taxonomy": _analysis_taxonomy(parsed)[1],
            "tags": [str(x).strip() for x in (parsed.get("tags") or []) if str(x).strip()],
            "keywords": _analysis_keywords(parsed),
            "copy_fit": str(parsed.get("copy_fit") or "").strip(),
        },
        ensure_ascii=False,
    )
    options = payload.get("taxonomy_options") or []
    option_lines = [
        f"  {o.get('primary')}：{'、'.join(o.get('secondary') or [])}"
        for o in options
        if isinstance(o, dict) and (o.get("secondary") or [])
    ]
    prompt = "\n".join(
        [
            f"上一份识别 JSON 缺少：{'、'.join(missing)}。一级分类、二级分类、关键词、承接句意不允许空。",
            "请根据画面补全，只输出一行完整 JSON，不要解释。",
            *option_lines,
            f"当前：{draft}",
        ]
    )
    filled = _call_vlm(prompt, frames)
    return _merge_analysis(parsed, filled)


def _overlap_score(left: str, right: str) -> int:
    a = left.strip().lower().replace(" ", "").replace("/", "")
    b = right.strip().lower().replace(" ", "").replace("/", "")
    if not a or not b:
        return 0
    if a == b:
        return 100
    score = 0
    for n in (2, 3):
        grams_a = {a[i : i + n] for i in range(0, max(len(a) - n + 1, 0))}
        grams_b = {b[i : i + n] for i in range(0, max(len(b) - n + 1, 0))}
        score += len(grams_a & grams_b) * n
    skip = set("的与和及或了着过")
    score += len((set(a) - skip) & (set(b) - skip))
    return score


def _infer_primary_from_options(options: object, secondary: str) -> str:
    rows = [o for o in (options or []) if isinstance(o, dict)]
    best_name = ""
    best_score = 0
    for row in rows:
        primary = str(row.get("primary") or "").strip()
        if not primary:
            continue
        for child in row.get("secondary") or []:
            score = _overlap_score(str(child), secondary)
            if score > best_score:
                best_score = score
                best_name = primary
        score = _overlap_score(primary, secondary)
        if score > best_score:
            best_score = score
            best_name = primary
    if best_name:
        return best_name
    first = next((str(row.get("primary") or "").strip() for row in rows if str(row.get("primary") or "").strip()), "")
    return first


def _publish_analysis_thumbnail(frame: Path, payload: dict) -> str | None:
    """把识别实际看过的那一帧覆盖成封面，卡片和预览区跟识别画面一致。"""
    if not frame.exists() or frame.stat().st_size <= 0:
        return None
    dest: Path | None = None
    existing = str(payload.get("thumbnail_path") or "").strip()
    if existing:
        dest = _resolve_nas_local_path(existing)
    if dest is None:
        file_path = str(payload.get("file_path") or "").strip()
        source = _resolve_nas_local_path(file_path) if file_path else None
        stem = source.stem if source is not None else "analysis"
        dest = NAS_MOUNT_ROOT / "derivatives" / time.strftime("%Y/%m") / f"{stem}_thumb.jpg"
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(frame, dest)
    except OSError:
        return None
    try:
        return str(dest.relative_to(NAS_MOUNT_ROOT)).replace("\\", "/")
    except ValueError:
        return str(dest).replace("\\", "/")


def _handle_analyze_content(job: dict) -> dict:
    payload = job.get("payload") or {}
    job_id = str(job.get("id") or "")
    work_dir = Path(tempfile.mkdtemp(prefix="analyze-", dir=tempfile.gettempdir()))
    try:
        if job_id:
            _report_progress(job_id, "frames", 40, "正在从原片抽帧")
        frames = _collect_analysis_frames(payload, work_dir)
        if not frames:
            raise RuntimeError("没有可用的缩略图或抽帧，请先生成派生文件再识别")
        if job_id:
            _report_progress(job_id, "vision", 75, "视觉模型正在看画面")
        prompt = _build_analysis_prompt(payload)
        try:
            parsed = _call_vlm(prompt, frames)
        except RuntimeError as exc:
            if not _is_vlm_input_retryable(exc):
                raise
            if job_id:
                _report_progress(job_id, "vision", 78, "画面过大或输出不完整，改为单帧缩小重试")
            retry_dir = work_dir / "retry"
            retry_dir.mkdir(exist_ok=True)
            retry_frames = _collect_analysis_frames(
                payload,
                retry_dir,
                frame_count=1,
                max_width=min(VLM_RETRY_FRAME_MAX_WIDTH, VLM_FRAME_MAX_WIDTH),
            ) or frames[:1]
            parsed = _call_vlm(prompt, retry_frames)
            frames = retry_frames
        parsed = _complete_incomplete_analysis(payload, frames[:1], parsed)
        tags = [str(x).strip() for x in (parsed.get("tags") or []) if str(x).strip()]
        keywords = _analysis_keywords(parsed)
        primary, secondary = _analysis_taxonomy(parsed)
        if secondary and not primary:
            primary = _infer_primary_from_options(payload.get("taxonomy_options") or [], secondary)
            parsed["primary_taxonomy"] = primary
        missing = _missing_required_analysis_fields(payload, {**parsed, "primary_taxonomy": primary, "secondary_taxonomy": secondary, "keywords": keywords})
        if missing:
            raise RuntimeError(f"识别结果缺少必填项：{'、'.join(missing)}")
        print(
            f"[nas-client][{WORKER_LABEL}] analyze_content frames={len(frames)} "
            f"model={VLM_MODEL} tags={len(tags)} primary={primary} secondary={secondary}"
        )
        if job_id:
            _report_progress(job_id, "saving", 90, "正在回写识别建议")
        out: dict = {
            "material_id": str(payload.get("material_id") or ""),
            "material_file_id": str(payload.get("material_file_id") or ""),
            "analysis": {
                "description": str(parsed.get("description") or "").strip(),
                "tags": tags,
                "keywords": keywords,
                "copy_fit": str(parsed.get("copy_fit") or "").strip(),
                "primary_taxonomy": primary,
                "secondary_taxonomy": secondary,
                "model": VLM_MODEL,
                "frames": len(frames),
            },
        }
        thumb_rel = _publish_analysis_thumbnail(frames[0], payload)
        if thumb_rel:
            out["thumbnail_path"] = thumb_rel
        return out
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _download_job_input(job_id: str, name: str, target_file: Path) -> None:
    target_file.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(
        f"{API_BASE_URL}/nas-jobs/{job_id}/input/{name}",
        headers=_headers(),
        stream=True,
        timeout=TIMEOUT_SECONDS,
    ) as resp:
        if resp.status_code >= 400:
            raise RuntimeError(f"下载任务文件失败 HTTP {resp.status_code} {resp.text[:300]}")
        with target_file.open("wb") as handle:
            for chunk in resp.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE_BYTES):
                if chunk:
                    handle.write(chunk)


def _upload_job_output(job_id: str, path: Path, media_type: str) -> None:
    with path.open("rb") as handle:
        resp = requests.post(
            f"{API_BASE_URL}/nas-jobs/{job_id}/output",
            headers=_headers(),
            files={"file": (path.name, handle, media_type)},
            timeout=max(TIMEOUT_SECONDS, 900),
        )
    resp.raise_for_status()


def _upload_named_job_output(job_id: str, name: str, path: Path, media_type: str) -> None:
    with path.open("rb") as handle:
        resp = requests.post(
            f"{API_BASE_URL}/nas-jobs/{job_id}/outputs/{name}",
            headers=_headers(),
            files={"file": (name, handle, media_type)},
            timeout=max(TIMEOUT_SECONDS, 900),
        )
    resp.raise_for_status()


def _lan_media():
    client_dir = str(Path(__file__).resolve().parent)
    if client_dir not in sys.path:
        sys.path.insert(0, client_dir)
    import lan_media

    return lan_media


def _studio_media():
    client_dir = str(Path(__file__).resolve().parent)
    if client_dir not in sys.path:
        sys.path.insert(0, client_dir)
    import studio_media

    return studio_media


def _handle_replication_intake(job: dict) -> dict:
    payload = job.get("payload") or {}
    options = payload.get("intake") if isinstance(payload.get("intake"), dict) else {}
    work = Path(tempfile.mkdtemp(prefix="replication-intake-"))
    try:
        source = work / "source.bin"
        _download_job_input(str(job["id"]), "source", source)
        result, outputs = _studio_media().run_replication_intake(source, work, options)
        for name, path, media_type in outputs:
            _upload_named_job_output(str(job["id"]), name, path, media_type)
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_replacement_intake(job: dict) -> dict:
    job_id = str(job["id"])
    payload = job.get("payload") or {}
    options = payload.get("intake") if isinstance(payload.get("intake"), dict) else {}
    work = Path(tempfile.mkdtemp(prefix="replacement-intake-"))
    try:
        _studio_media()
        import person_pipeline

        source = work / "source.bin"
        _report_progress(job_id, "download", 5, "文件机正在下载原片")
        _download_job_input(job_id, "source", source)
        result, outputs = person_pipeline.run_replacement_intake(source, work, options, progress=lambda label: _report_progress(job_id, "process", None, label))
        for index, (name, path, media_type) in enumerate(outputs, start=1):
            if index == 1 or index % 20 == 0:
                _report_progress(job_id, "upload", None, f"回传结果 {index}/{len(outputs)}")
            _upload_named_job_output(job_id, name, path, media_type)
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_replacement_compose(job: dict) -> dict:
    job_id = str(job["id"])
    payload = job.get("payload") or {}
    plan = payload.get("compose") if isinstance(payload.get("compose"), dict) else {}
    work = Path(tempfile.mkdtemp(prefix="replacement-compose-"))
    try:
        bundle = work / "bundle.bin"
        _report_progress(job_id, "download", 5, "文件机正在下载合成素材")
        _download_job_input(job_id, "source", bundle)
        result, outputs = _studio_media().run_replacement_compose(bundle, work, plan, progress=lambda label: _report_progress(job_id, "process", None, label))
        _report_progress(job_id, "upload", 95, "回传成片")
        for name, path, media_type in outputs:
            _upload_named_job_output(job_id, name, path, media_type)
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_replacement_media(job: dict) -> dict:
    job_id = str(job["id"])
    payload = job.get("payload") or {}
    media = payload.get("media") if isinstance(payload.get("media"), dict) else {}
    work = Path(tempfile.mkdtemp(prefix="replacement-media-"))
    try:
        source = work / "source.bin"
        _report_progress(job_id, "download", 5, "文件机正在下载素材")
        _download_job_input(job_id, "source", source)
        result, outputs = _studio_media().run_replacement_media(source, work, media, progress=lambda label: _report_progress(job_id, "process", None, label))
        _report_progress(job_id, "upload", 95, "回传结果")
        for name, path, media_type in outputs:
            _upload_named_job_output(job_id, name, path, media_type)
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_lan_tts(job: dict) -> dict:
    payload = job.get("payload") or {}
    text = str(payload.get("text") or "")
    tts = payload.get("tts") if isinstance(payload.get("tts"), dict) else {}
    inputs = payload.get("inputs") if isinstance(payload.get("inputs"), dict) else {}
    work = Path(tempfile.mkdtemp(prefix="lan-tts-"))
    try:
        reference = work / "reference.bin"
        target = work / "output.wav"
        _download_job_input(str(job["id"]), "reference", reference)
        options = dict(tts)
        if inputs.get("emo_audio"):
            emo_audio = work / "emo_audio.bin"
            _download_job_input(str(job["id"]), "emo_audio", emo_audio)
            options["emo_audio"] = emo_audio
        endpoint = _lan_media().synthesize_voice(reference, text, target, options)
        _upload_job_output(str(job["id"]), target, "audio/wav")
        return {"media_type": "audio/wav", "filename": "output.wav", "endpoint": endpoint}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_lan_voice_design(job: dict) -> dict:
    payload = job.get("payload") or {}
    mode = str(payload.get("mode") or "generate")
    description = str(payload.get("description") or "")
    if mode == "describe":
        described = _lan_media().describe_voicestudio(description)
        return {"design": {key: described.get(key) for key in ("attrs", "instruct", "unmatched")}}
    work = Path(tempfile.mkdtemp(prefix="lan-voice-design-"))
    try:
        target = work / "output.wav"
        seed = payload.get("seed")
        options = {
            "description": description,
            "attrs": payload.get("attrs") if isinstance(payload.get("attrs"), dict) else {},
            "seed": seed if isinstance(seed, int) else None,
        }
        endpoint, design = _lan_media().synthesize_voice_design(str(payload.get("text") or ""), target, options)
        _upload_job_output(str(job["id"]), target, "audio/wav")
        return {"media_type": "audio/wav", "filename": "output.wav", "endpoint": endpoint, "design": design}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_lan_asr(job: dict) -> dict:
    payload = job.get("payload") or {}
    asr = payload.get("asr") if isinstance(payload.get("asr"), dict) else {}
    work = Path(tempfile.mkdtemp(prefix="lan-asr-"))
    try:
        audio = work / "audio.bin"
        _download_job_input(str(job["id"]), "audio", audio)
        transcript, endpoint = _lan_media().transcribe_audio(audio, dict(asr))
        return {"transcript": transcript, "endpoint": endpoint}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_lan_voice_convert(job: dict) -> dict:
    payload = job.get("payload") or {}
    convert = payload.get("convert") if isinstance(payload.get("convert"), dict) else {}
    work = Path(tempfile.mkdtemp(prefix="lan-vc-"))
    try:
        source = work / "source.bin"
        reference = work / "reference.bin"
        target = work / "output.wav"
        _download_job_input(str(job["id"]), "source", source)
        _download_job_input(str(job["id"]), "reference", reference)
        endpoint = _lan_media().convert_voice(source, reference, target, dict(convert))
        _upload_job_output(str(job["id"]), target, "audio/wav")
        return {"media_type": "audio/wav", "filename": "output.wav", "endpoint": endpoint}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_lan_seedvc(job: dict) -> dict:
    payload = job.get("payload") or {}
    seedvc = payload.get("seedvc") if isinstance(payload.get("seedvc"), dict) else {}
    work = Path(tempfile.mkdtemp(prefix="lan-seedvc-"))
    try:
        source = work / "source.bin"
        reference = work / "reference.bin"
        target = work / "output.wav"
        _download_job_input(str(job["id"]), "source", source)
        _download_job_input(str(job["id"]), "reference", reference)
        endpoint = _lan_media().convert_seedvc_page(source, reference, target, dict(seedvc))
        _upload_job_output(str(job["id"]), target, "audio/wav")
        return {"media_type": "audio/wav", "filename": "output.wav", "endpoint": endpoint}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_lan_svs_remake(job: dict) -> dict:
    payload = job.get("payload") or {}
    lyrics = str(payload.get("lyrics") or "").strip()
    convert = payload.get("convert") if isinstance(payload.get("convert"), dict) else {}
    work = Path(tempfile.mkdtemp(prefix="lan-svs-"))
    try:
        melody = work / "melody.bin"
        reference = work / "reference.bin"
        target = work / "output.wav"
        _download_job_input(str(job["id"]), "melody", melody)
        _download_job_input(str(job["id"]), "reference", reference)
        endpoints = _lan_media().remake_singing(lyrics, melody, reference, target, dict(convert))
        _upload_job_output(str(job["id"]), target, "audio/wav")
        return {
            "media_type": "audio/wav",
            "filename": "output.wav",
            "endpoint": endpoints.get("seedvc_endpoint"),
            "svs_endpoint": endpoints.get("svs_endpoint"),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_lan_yue2(job: dict) -> dict:
    payload = job.get("payload") or {}
    kind = str(payload.get("kind") or "generate")
    request_body = dict(payload.get("request") if isinstance(payload.get("request"), dict) else {})
    inputs = payload.get("inputs") if isinstance(payload.get("inputs"), dict) else {}
    job_id = str(job["id"])
    work = Path(tempfile.mkdtemp(prefix="lan-yue2-"))
    _report_progress(job_id, "queued", percent=1, label="文件机已领取，正在连接 YuE2", result_patch={"stage": "queued"})

    def _on_yue2_update(patch: dict) -> None:
        stage = str(patch.get("stage") or "starting")
        progress = patch.get("progress")
        percent = None
        if isinstance(progress, (int, float)):
            percent = int(max(1, min(99, round(float(progress) * 100))))
        _report_progress(
            job_id,
            stage,
            percent=percent,
            label=str(patch.get("summary") or "")[:120],
            result_patch={
                key: patch[key]
                for key in ("yue2_job_id", "stage", "progress", "summary", "kind", "endpoint")
                if key in patch
            },
        )

    try:
        # ECS-staged remix/cover audio: pull from API, then upload to YuE2 on LAN.
        if inputs:
            _report_progress(job_id, "uploading", percent=3, label="正在从云端拉取参考素材并上传到 YuE2", result_patch={"stage": "uploading"})
            lan = _lan_media()
            for name, filename in inputs.items():
                key = str(name or "").strip()
                if not key:
                    continue
                local_name = Path(str(filename or key)).name or f"{key}.bin"
                local = work / local_name
                _download_job_input(job_id, key, local)
                yue2_path = lan.yue2_upload_local_file(local, local_name)
                marker = f"input://{key}"
                if request_body.get(key) == marker or str(request_body.get(key) or "").startswith("input://"):
                    request_body[key] = yue2_path
                for field, value in list(request_body.items()):
                    if value == marker:
                        request_body[field] = yue2_path
        # YuE2 only accepts package-upload / job-output / asset-library paths.
        for field, value in list(request_body.items()):
            if not isinstance(value, str):
                continue
            raw = value.strip()
            if raw.startswith("input://") or raw.startswith("ecs://"):
                raise RuntimeError(
                    f"参考素材未落到 YuE2 整合包路径（{field}），请确认文件机 worker 已更新并重试直传"
                )
        target = work / "output.flac"
        meta = _lan_media().run_yue2_job(kind, request_body, target, on_update=_on_yue2_update)
        out: dict = {
            "endpoint": meta.get("endpoint"),
            "yue2_job_id": meta.get("yue2_job_id"),
            "kind": meta.get("kind") or kind,
            "summary": meta.get("summary") or "",
            "audio_seconds": meta.get("audio_seconds"),
            "yue2_result": meta.get("yue2_result") if isinstance(meta.get("yue2_result"), dict) else {},
            "stage": "complete",
            "progress": 1.0,
        }
        # Transcribe / plan: pass ABC and timing through so cover UI can fill 旋律 ABC.
        for key in ("abc", "timing", "warnings", "melody_only", "duration_seconds"):
            if key in meta:
                out[key] = meta[key]
        if meta.get("has_audio") and target.is_file() and target.stat().st_size > 32:
            media_type = str(meta.get("media_type") or "audio/flac")
            _upload_job_output(job_id, target, media_type)
            out["media_type"] = media_type
            out["filename"] = target.name
            out["has_audio"] = True
        else:
            out["has_audio"] = False
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _handle_lan_comfy(job: dict) -> dict:
    payload = job.get("payload") or {}
    comfy = payload.get("comfy") or {}
    inputs = payload.get("inputs") or {}
    work = Path(tempfile.mkdtemp(prefix="lan-comfy-"))
    try:
        images: list[tuple[str, Path]] = []
        for name in ("image", "image2", *(f"image{index}" for index in range(3, 10))):
            if name not in inputs:
                continue
            path = work / name
            _download_job_input(str(job["id"]), name, path)
            images.append((name, path))
        videos: list[Path] = []
        for name in ("video", "video2", "video3"):
            if name not in inputs:
                continue
            path = work / name
            _download_job_input(str(job["id"]), name, path)
            videos.append(path)
        audios: list[Path] = []
        for name in ("audio", "audio2", "audio3"):
            if name not in inputs:
                continue
            path = work / name
            _download_job_input(str(job["id"]), name, path)
            audios.append(path)
        last_frame = None
        if "last_frame" in inputs:
            last_frame = work / "last_frame"
            _download_job_input(str(job["id"]), "last_frame", last_frame)
        target = work / "output.mp4"
        seed_raw = comfy.get("seed")
        seed = None
        try:
            if seed_raw is not None and str(seed_raw).strip() != "":
                seed = max(0, min(2**31 - 1, int(seed_raw)))
        except (TypeError, ValueError):
            seed = None
        endpoint = _lan_media().run_comfy_video(
            mode=str(comfy.get("mode") or "t2v"),
            prompt=str(comfy.get("prompt") or payload.get("text") or ""),
            duration=float(comfy.get("duration") or 5),
            aspect=str(comfy.get("aspect") or "16:9 (Widescreen)"),
            megapixels=float(comfy.get("megapixels") or 0.4),
            images=images,
            last_frame=last_frame,
            target=target,
            seed=seed,
            workflow=str(comfy.get("workflow") or ""),
            videos=videos,
            audios=audios,
            quality=str(comfy.get("quality") or ""),
            deoil=comfy.get("deoil"),
        )
        _upload_job_output(str(job["id"]), target, "video/mp4")
        return {"media_type": "video/mp4", "filename": "output.mp4", "endpoint": endpoint}
    finally:
        shutil.rmtree(work, ignore_errors=True)


_AI007_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


def _handle_ai007_forward(job: dict) -> dict:
    payload = job.get("payload") or {}
    method = str(payload.get("method") or "POST").upper()
    path = str(payload.get("path") or "")
    if not path.startswith("/"):
        path = f"/{path}"
    api_key = str(payload.get("api_key") or "").strip()
    if not api_key:
        raise RuntimeError("AI007 密钥还没保存")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": _AI007_BROWSER_UA,
    }
    timeout = 180 if path.startswith("/images/") else 90
    body = payload.get("body") if isinstance(payload.get("body"), dict) else None
    url = f"https://api.ai007.my/v1{path}"
    if method == "GET":
        response = requests.get(url, headers=headers, timeout=timeout)
    else:
        response = requests.post(
            url,
            headers={**headers, "Content-Type": "application/json"},
            json=body or {},
            timeout=timeout,
        )
    text = response.text or ""
    try:
        parsed = response.json()
    except ValueError:
        parsed = {"message": "AI007 的网络拦截了这次调用" if text.lstrip().startswith("<") else text[:300]}
    if response.status_code < 400 and isinstance(parsed, dict):
        if path.startswith("/images/"):
            _inline_ai007_images(parsed)
        elif path.startswith("/video/generations/"):
            _store_ai007_video(str(job.get("id") or ""), parsed, api_key, path)
    return {"status_code": response.status_code, "body": parsed if isinstance(parsed, dict) else {"data": parsed}}


_AI007_URL_KEYS = ("video_url", "url", "output_url", "download_url", "mp4_url", "file_url", "result_url")
_AI007_FETCH_HEADERS = {
    "User-Agent": _AI007_BROWSER_UA,
    "Accept": "*/*",
    "Referer": "https://www.dola.com/",
}


def _ai007_http_url(value: object) -> str:
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return value
    if isinstance(value, list):
        for item in value:
            found = _ai007_http_url(item)
            if found:
                return found
    if isinstance(value, dict):
        for key in _AI007_URL_KEYS:
            found = _ai007_http_url(value.get(key))
            if found:
                return found
    return ""


def _extract_ai007_video_url(payload: dict) -> str:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    inner = data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), dict) else None
    for source in (inner, data):
        if not isinstance(source, dict):
            continue
        found = _ai007_http_url({key: source.get(key) for key in _AI007_URL_KEYS})
        if found:
            return found
    if isinstance(data, dict):
        found = _ai007_http_url(data.get("result_url"))
        if found:
            return found
    return _ai007_http_url(payload.get("result_url"))


def _download_ai007_bytes(url: str, limit: int) -> tuple[bytes, str]:
    proxies = (None, {"http": "http://127.0.0.1:7897", "https": "http://127.0.0.1:7897"})
    last_error = "下载失败"
    for proxy in proxies:
        try:
            response = requests.get(url, headers=_AI007_FETCH_HEADERS, timeout=180, proxies=proxy, allow_redirects=True)
        except requests.RequestException as exc:
            last_error = str(exc)
            continue
        if response.status_code == 403:
            last_error = "源站拒绝下载"
            continue
        if response.status_code >= 400:
            last_error = f"下载失败 HTTP {response.status_code}"
            continue
        mime = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip()
        if mime.startswith("text/"):
            raise RuntimeError("下载到的不是媒体文件")
        raw = response.content[:limit]
        if len(raw) < 32:
            raise RuntimeError("下载到的文件是空的")
        return raw, mime or "application/octet-stream"
    raise RuntimeError(last_error)


def _inline_ai007_images(payload: dict) -> None:
    lists = [payload.get(key) for key in ("data", "images", "results")]
    for items in lists:
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict) or item.get("b64_json"):
                continue
            image_url = _ai007_http_url(item.get("url"))
            if not image_url:
                continue
            try:
                raw, mime = _download_ai007_bytes(image_url, 12 * 1024 * 1024)
            except RuntimeError:
                continue
            item["b64_json"] = base64.b64encode(raw).decode("ascii")
            if mime.startswith("image/"):
                item["mime_type"] = mime


_ai007_video_locks: dict[str, threading.Lock] = {}
_ai007_video_locks_guard = threading.Lock()


def _ai007_task_lock(task_id: str) -> threading.Lock:
    with _ai007_video_locks_guard:
        lock = _ai007_video_locks.get(task_id)
        if lock is None:
            lock = threading.Lock()
            _ai007_video_locks[task_id] = lock
        return lock


def _ai007_video_cache(task_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", task_id)[:80] or "video"
    return Path(tempfile.gettempdir()) / "ai007-video-cache" / f"{safe}.mp4"


def _store_ai007_video(job_id: str, payload: dict, api_key: str, path: str) -> None:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    inner = data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), dict) else None
    status_name = str((data or {}).get("status") or (inner or {}).get("status") or "").upper()
    if status_name not in {"SUCCESS", "COMPLETED", "SUCCEEDED"}:
        return
    video_url = _extract_ai007_video_url(payload)
    task_id = path.rstrip("/").split("/")[-1]
    cache = _ai007_video_cache(task_id)
    with _ai007_task_lock(task_id):
        if cache.is_file() and cache.stat().st_size >= 1024:
            _upload_job_output(job_id, cache, "video/mp4")
            payload["platform_file"] = "output.mp4"
            return
        work = Path(tempfile.mkdtemp(prefix="ai007-video-"))
        target = work / "output.mp4"
        try:
            content = b""
            if video_url:
                try:
                    content, _mime = _download_ai007_bytes(video_url, 150 * 1024 * 1024)
                except RuntimeError:
                    content = b""
            if len(content) < 1024 and task_id:
                try:
                    gateway = requests.get(
                        f"https://api.ai007.my/v1/videos/{task_id}/content",
                        headers={"Authorization": f"Bearer {api_key}", "Accept": "*/*", "User-Agent": _AI007_BROWSER_UA},
                        timeout=90,
                        allow_redirects=True,
                    )
                    mime = str(gateway.headers.get("Content-Type") or "")
                    if gateway.status_code == 200 and not mime.startswith(("text/", "application/json")) and len(gateway.content) >= 1024:
                        content = gateway.content[: 150 * 1024 * 1024]
                except requests.RequestException:
                    content = b""
            if len(content) < 1024:
                return
            target.write_bytes(content)
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(content)
            _upload_job_output(job_id, target, "video/mp4")
            payload["platform_file"] = "output.mp4"
        finally:
            shutil.rmtree(work, ignore_errors=True)


def run_forever(worker_name: str = "worker-1") -> None:
    _ensure_token()
    poll_hint = f", poll_job_types={POLL_JOB_TYPES!r}" if POLL_JOB_TYPES else ""
    excl_hint = f", exclude_job_types={EXCLUDE_JOB_TYPES!r}" if EXCLUDE_JOB_TYPES else ""
    print(
        f"[nas-client][{WORKER_LABEL}] {worker_name} start polling: {API_BASE_URL}, "
        f"chunk={DOWNLOAD_CHUNK_SIZE_BYTES} bytes{poll_hint}{excl_hint}"
    )
    with _startup_guidance_lock:
        if not _startup_guidance_once[0]:
            print(f"[nas-client][{WORKER_LABEL}] {_one_time_startup_guidance()}")
            _startup_guidance_once[0] = True
    while True:
        job_id: str | None = None
        job_type: str | None = None
        try:
            job = _poll_job()
            if not job:
                time.sleep(POLL_INTERVAL_SECONDS)
                continue

            job_id = job["id"]
            job_type = job.get("job_type")
            print(f"[nas-client][{WORKER_LABEL}] {worker_name} picked job {job_id} type={job_type}")

            if job_type == "store_original":
                result = _handle_store_original(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} job success {job_id}")
            elif job_type == "prepare_download":
                _ = _handle_prepare_download(job)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} download ready {job_id}")
            elif job_type == "move_to_trash":
                result = _handle_move_to_trash(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} moved to trash {job_id}")
            elif job_type == "restore_from_trash":
                result = _handle_restore_from_trash(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} restored from trash {job_id}")
            elif job_type == "generate_derivatives":
                result = _handle_generate_derivatives(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} generated derivatives {job_id}")
            elif job_type == "analyze_content":
                result = _handle_analyze_content(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} analyzed content {job_id}")
            elif job_type == "lan_tts":
                result = _handle_lan_tts(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} lan tts {job_id} via {result.get('endpoint')}")
            elif job_type == "lan_voice_design":
                result = _handle_lan_voice_design(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} lan voice design {job_id} via {result.get('endpoint')}")
            elif job_type == "lan_asr":
                result = _handle_lan_asr(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} lan asr {job_id} via {result.get('endpoint')}")
            elif job_type == "lan_voice_convert":
                result = _handle_lan_voice_convert(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} lan voice convert {job_id} via {result.get('endpoint')}")
            elif job_type == "lan_seedvc":
                result = _handle_lan_seedvc(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} lan seed-vc {job_id} via {result.get('endpoint')}")
            elif job_type == "lan_svs_remake":
                result = _handle_lan_svs_remake(job)
                _mark_success(job_id, result)
                print(
                    f"[nas-client][{WORKER_LABEL}] {worker_name} lan svs remake {job_id} "
                    f"svs={result.get('svs_endpoint')} seedvc={result.get('endpoint')}"
                )
            elif job_type == "lan_yue2":
                result = _handle_lan_yue2(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} lan yue2 {job_id} via {result.get('endpoint')} yue2={result.get('yue2_job_id')}")
            elif job_type == "lan_comfy":
                result = _handle_lan_comfy(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} lan comfy {job_id} via {result.get('endpoint')}")
            elif job_type == "replication_intake":
                result = _handle_replication_intake(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} replication intake {job_id} shots={len(result.get('shots') or [])}")
            elif job_type == "replacement_intake":
                result = _handle_replacement_intake(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} replacement intake {job_id} shots={len(result.get('shots') or [])} people={len(result.get('identities') or [])}")
            elif job_type == "replacement_compose":
                result = _handle_replacement_compose(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} replacement compose {job_id} segments={result.get('segments')}")
            elif job_type == "replacement_media":
                result = _handle_replacement_media(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} replacement media {job_id} op={result.get('op')}")
            elif job_type == "ai007_forward":
                result = _handle_ai007_forward(job)
                _mark_success(job_id, result)
                print(f"[nas-client][{WORKER_LABEL}] {worker_name} ai007 {job_id} status={result.get('status_code')}")
            else:
                raise RuntimeError(f"Unsupported job_type: {job_type}")
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            extra = ""
            resp = getattr(exc, "response", None)
            if (
                isinstance(exc, requests.HTTPError)
                and resp is not None
                and resp.status_code == 401
            ):
                extra = (
                    " | NAS token: file machine NAS_CLIENT_TOKEN must equal ECS backend/.env NAS_CLIENT_TOKEN;"
                    " after changing .env run: systemctl restart light-content-api"
                )
            print(f"[nas-client][{WORKER_LABEL}] {worker_name} error: {message}{extra}")
            try:
                if job_id:
                    _mark_fail(
                        job_id,
                        message,
                        non_retryable=str(job_type or "") in {"analyze_content", "lan_tts", "lan_asr", "lan_voice_convert", "lan_seedvc", "lan_svs_remake", "lan_comfy", "lan_voice_design", "lan_yue2", "ai007_forward", "replication_intake", "replacement_intake", "replacement_compose", "replacement_media"}
                        or "视觉模型输出不是 JSON" in message
                        or "识别结果缺少必填项" in message
                        or "没有可用的缩略图或抽帧" in message,
                    )
            except Exception:
                pass
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    if WORKER_CONCURRENCY <= 1:
        run_forever("worker-1")
    else:
        threads: list[threading.Thread] = []
        for idx in range(WORKER_CONCURRENCY):
            name = f"worker-{idx + 1}"
            t = threading.Thread(target=run_forever, args=(name,), daemon=True)
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
