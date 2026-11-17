"""Call the office GPU machine from the file-machine worker.

The 4090 has two addresses. Voice clone (IndexTTS) calls only http://192.168.1.88:7860.
TTS is IndexTTS (Gradio :7860, with a FastAPI /api/tts fallback).
ASR is VoiceStudio OpenAI-compatible (:3901 /v1/audio/transcriptions).
Singing / voice convert is Seed-VC (:7865 /convert).
Timbre replacement on the voice-clone page is the Seed-VC Gradio app (:17860 /convert), not :7865.
Video is ComfyUI (:8188) using the same MiniMax H3 workflows as the whiteboard studio.
"""

from __future__ import annotations

import json
import os
import random
import time
import uuid
from pathlib import Path
from typing import Any

import requests

from comfy_converter import apply_studio_h3_params, apply_video_params, graph_to_prompt

WORKFLOW_DIR = Path(__file__).resolve().parent / "comfy_workflows"
# 声音克隆只打这一台 IndexTTS。不回落到 192.168.2.88。
INDEXTTS_URL = "http://192.168.1.88:7860"
TTS_URLS = [INDEXTTS_URL]
ASR_URLS = [
    os.getenv("LAN_ASR_URL", "http://192.168.1.88:3901/v1").rstrip("/"),
    os.getenv("LAN_ASR_URL_2", "http://192.168.2.88:3901/v1").rstrip("/"),
]
# VoiceStudio root (not /v1) — POST /generate accepts ref_audio multipart.
VOICESTUDIO_URLS = [
    os.getenv("LAN_VOICESTUDIO_URL", "http://192.168.1.88:3901").rstrip("/"),
    os.getenv("LAN_VOICESTUDIO_URL_2", "http://192.168.2.88:3901").rstrip("/"),
]
SEEDVC_URLS = [
    os.getenv("LAN_SEEDVC_URL_1", "http://192.168.1.88:7865").rstrip("/"),
    os.getenv("LAN_SEEDVC_URL_2", "http://192.168.2.88:7865").rstrip("/"),
]
# 声音克隆页的 Seed-VC 只打这一台 Gradio。不改歌声转换的 7865。
SEEDVC_PAGE_URL = "http://192.168.1.88:17860"
SVS_URLS = [
    os.getenv("LAN_SVS_URL_1", "http://192.168.1.88:7866").rstrip("/"),
    os.getenv("LAN_SVS_URL_2", "http://192.168.2.88:7866").rstrip("/"),
]
COMFY_URLS = [
    os.getenv("LAN_COMFY_URL_1", "http://192.168.1.88:8188").rstrip("/"),
    os.getenv("LAN_COMFY_URL_2", "http://192.168.2.88:8188").rstrip("/"),
]
# Separate ComfyUI. The two studio graphs (人脸优化 / YZ金鱼) live only here.
COMFY_H3_URLS = [
    os.getenv("LAN_COMFY_H3_URL", "http://192.168.1.88:8189").rstrip("/"),
    os.getenv("LAN_COMFY_H3_URL_2", "http://192.168.2.88:8189").rstrip("/"),
]
YUE2_URLS = [
    os.getenv("LAN_YUE2_URL", "http://192.168.1.88:8190").rstrip("/"),
    os.getenv("LAN_YUE2_URL_2", "http://192.168.2.88:8190").rstrip("/"),
]
YUE2_WAIT_SECONDS = max(10 * 60, int(os.getenv("LAN_YUE2_WAIT_SECONDS", str(60 * 60))))
YUE2_POLL_SECONDS = max(2.0, float(os.getenv("LAN_YUE2_POLL_SECONDS", "3")))
# Do not hammer ECS progress on every YuE2 poll tick (was ~3s and could wedge single uvicorn).
YUE2_PROGRESS_EVERY_SECONDS = max(5.0, float(os.getenv("LAN_YUE2_PROGRESS_EVERY_SECONDS", "12")))
# MiniMax H3 / long reference jobs often finish just after the old 30m cutoff.
COMFY_WAIT_SECONDS = max(10 * 60, int(os.getenv("LAN_COMFY_WAIT_SECONDS", str(60 * 60))))
COMFY_POLL_SECONDS = max(2.0, float(os.getenv("LAN_COMFY_POLL_SECONDS", "3")))
DEFAULT_ASR_MODEL = (os.getenv("LAN_ASR_MODEL") or "whisper-1").strip() or "whisper-1"
WORKFLOWS = {
    "t2v": "minimax_h3_t2v.json",
    "i2v": "video_minimax_h3_i2v.json",
    "r2v": "video_minimax_h3_r2v.json",
}
STUDIO_WORKFLOWS = {
    "h3-face": "h3_face_8189.json",
    "h3-goldfish": "h3_goldfish_8189.json",
}
PROBE_TIMEOUT = 4


def _alive(url: str) -> bool:
    try:
        response = requests.get(url, timeout=PROBE_TIMEOUT)
    except requests.RequestException:
        return False
    return response.status_code < 500


def first_reachable(urls: list[str], probe_path: str) -> str:
    errors: list[str] = []
    seen: list[str] = []
    for base in urls:
        base = base.rstrip("/")
        if not base or base in seen:
            continue
        seen.append(base)
        if _alive(f"{base}{probe_path}"):
            return base
        errors.append(base)
    raise RuntimeError("无法连接 " + "、".join(errors or urls))


EMO_LABELS = [
    "与参考音频的音色相同",
    "使用单独的情感参考音频",
    "使用情感向量控制",
    "使用情感描述文本控制",
]


def transcribe_audio(audio: Path, options: dict[str, Any] | None = None) -> tuple[dict[str, Any], str]:
    """Call VoiceStudio OpenAI-compatible ASR; return (verbose_json body, endpoint)."""
    settings = options or {}
    model = str(settings.get("model") or DEFAULT_ASR_MODEL).strip() or DEFAULT_ASR_MODEL
    language = str(settings.get("language") or "").strip()
    prompt = str(settings.get("prompt") or "").strip()
    last_error: Exception | None = None
    for base in _unique(ASR_URLS):
        try:
            probe = base if base.endswith("/v1") else f"{base}/v1"
            root = probe[: -len("/v1")] if probe.endswith("/v1") else probe
            if not _alive(f"{probe}/models") and not _alive(root):
                last_error = RuntimeError(
                    f"无法连接 VoiceStudio ASR（{probe}）。请确认 192.168.1.88 已启动 VoiceStudio（端口 3901）。"
                )
                continue
            with audio.open("rb") as handle:
                files = {"file": (audio.name or "audio.wav", handle, "application/octet-stream")}
                data: dict[str, str] = {
                    "model": model,
                    "response_format": "verbose_json",
                }
                if language:
                    data["language"] = language
                if prompt:
                    data["prompt"] = prompt[:800]
                response = requests.post(
                    f"{probe}/audio/transcriptions",
                    data=data,
                    files=files,
                    timeout=900,
                )
            if response.status_code >= 400:
                detail = (response.text or "")[:400]
                raise RuntimeError(f"VoiceStudio 听写失败：HTTP {response.status_code} {detail}")
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("VoiceStudio 返回不是 JSON 对象")
            text = str(payload.get("text") or "").strip()
            segments = payload.get("segments")
            if not text and not (isinstance(segments, list) and segments):
                raise RuntimeError("VoiceStudio 没有听写出有效文本")
            return payload, probe
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(str(last_error or "无法连接 VoiceStudio ASR（默认 http://192.168.1.88:3901/v1）"))


def synthesize_voice(reference: Path, text: str, target: Path, options: dict[str, Any] | None = None) -> str:
    spoken = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not spoken:
        raise RuntimeError("配音文本为空")
    engine = str((options or {}).get("engine") or "indextts").strip().lower()
    if engine == "voicestudio":
        return synthesize_voicestudio(reference, spoken, target, options)
    settings = _tts_settings(options or {})
    pinned = str((options or {}).get("endpoint") or "").strip().rstrip("/")
    targets = [pinned] if pinned else list(TTS_URLS)
    last_error: Exception | None = None
    for base in _unique(targets):
        try:
            if not _alive(base):
                last_error = RuntimeError(f"无法连接语音服务 {base}")
                continue
            try:
                _synthesize_fastapi(base, reference, spoken, target, settings)
            except _TryGradio:
                _synthesize_gradio(base, reference, spoken, target, settings)
            if not target.exists() or target.stat().st_size < 1024:
                raise RuntimeError("语音服务返回的音频无效")
            return base
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(str(last_error or "无法连接局域网 IndexTTS（默认 192.168.1.88:7860）"))


def synthesize_svs_guide(
    lyrics: str,
    melody: Path,
    target: Path,
    tts_ref: Path | None = None,
) -> str:
    """Call local SVS guide service POST /sing (new lyrics + dry-vocal melody)."""
    text = " ".join((lyrics or "").split())
    if not text:
        raise RuntimeError("改词翻唱歌词为空")
    last_error: Exception | None = None
    for base in _unique(SVS_URLS):
        try:
            if not _alive(f"{base}/health") and not _alive(base):
                last_error = RuntimeError(
                    f"无法连接 SVS（{base}）。请在 GPU 机启动 svs-service（默认端口 7866）。"
                )
                continue
            handles = []
            try:
                mel_fh = melody.open("rb")
                handles.append(mel_fh)
                files: dict[str, Any] = {
                    "melody": (melody.name or "melody.wav", mel_fh, "application/octet-stream"),
                }
                # Prefer user voice sample for Mandarin TTS; melody dry vocal often pulls Cantonese.
                if tts_ref is not None and tts_ref.exists() and tts_ref.stat().st_size >= 32:
                    ref_fh = tts_ref.open("rb")
                    handles.append(ref_fh)
                    files["tts_ref"] = (tts_ref.name or "tts_ref.wav", ref_fh, "application/octet-stream")
                response = requests.post(
                    f"{base}/sing",
                    data={"lyrics": text},
                    files=files,
                    timeout=1800,
                )
            finally:
                for fh in handles:
                    try:
                        fh.close()
                    except OSError:
                        pass
            if response.status_code >= 400:
                detail = (response.text or "")[:400]
                raise RuntimeError(f"SVS 导唱失败：HTTP {response.status_code} {detail}")
            if len(response.content) < 256:
                raise RuntimeError("SVS 没有返回有效导唱")
            target.write_bytes(response.content)
            return base
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(str(last_error or "无法连接 SVS（默认 http://192.168.1.88:7866）"))


def remake_singing(lyrics: str, melody: Path, reference: Path, target: Path, options: dict[str, Any] | None = None) -> dict[str, str]:
    """SVS guide (new lyrics + original F0) then Seed-VC to reference timbre."""
    work_guide = target.parent / f"{target.stem}.guide.wav"
    svs_endpoint = synthesize_svs_guide(lyrics, melody, work_guide, tts_ref=reference)
    convert_opts = dict(options or {})
    convert_opts.setdefault("f0_condition", 1)
    convert_opts.setdefault("diffusion_steps", 25)
    convert_opts.setdefault("auto_f0_adjust", 0)
    seed_endpoint = convert_voice(work_guide, reference, target, convert_opts)
    try:
        work_guide.unlink(missing_ok=True)
    except OSError:
        pass
    return {"svs_endpoint": svs_endpoint, "seedvc_endpoint": seed_endpoint}


def convert_voice(source: Path, reference: Path, target: Path, options: dict[str, Any] | None = None) -> str:
    """Call Seed-VC POST /convert (source melody/content + reference timbre)."""
    settings = options or {}
    try:
        steps = int(settings.get("diffusion_steps") or 40)
    except (TypeError, ValueError):
        steps = 40
    steps = max(4, min(100, steps))
    try:
        cfg = float(settings.get("inference_cfg_rate") if settings.get("inference_cfg_rate") is not None else 0.7)
    except (TypeError, ValueError):
        cfg = 0.7
    try:
        pitch = int(settings.get("pitch_shift") or 0)
    except (TypeError, ValueError):
        pitch = 0
    try:
        length = float(settings.get("length_adjust") if settings.get("length_adjust") is not None else 1.0)
    except (TypeError, ValueError):
        length = 1.0
    f0_condition = 0 if str(settings.get("f0_condition")).strip().lower() in {"0", "false", "no"} else 1
    auto_f0 = 1 if str(settings.get("auto_f0_adjust")).strip().lower() in {"1", "true", "yes"} else 0
    data = {
        "f0_condition": str(f0_condition),
        "diffusion_steps": str(steps),
        "inference_cfg_rate": str(max(0.0, min(1.0, cfg))),
        "auto_f0_adjust": str(auto_f0),
        "pitch_shift": str(max(-24, min(24, pitch))),
        "length_adjust": str(max(0.5, min(2.0, length))),
    }
    last_error: Exception | None = None
    for base in _unique(SEEDVC_URLS):
        try:
            if not _alive(f"{base}/health") and not _alive(base):
                last_error = RuntimeError(
                    f"无法连接 Seed-VC（{base}）。请在 GPU 机启动 seed-vc-service（默认端口 7865）。"
                )
                continue
            with source.open("rb") as src_handle, reference.open("rb") as ref_handle:
                files = {
                    "source": (source.name or "source.wav", src_handle, "application/octet-stream"),
                    "reference": (reference.name or "reference.wav", ref_handle, "application/octet-stream"),
                }
                response = requests.post(f"{base}/convert", data=data, files=files, timeout=1800)
            if response.status_code >= 400:
                detail = (response.text or "")[:400]
                raise RuntimeError(f"Seed-VC 转换失败：HTTP {response.status_code} {detail}")
            if len(response.content) < 256:
                raise RuntimeError("Seed-VC 没有返回有效音频")
            target.write_bytes(response.content)
            return base
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(str(last_error or "无法连接 Seed-VC（默认 http://192.168.1.88:7865）"))


def convert_seedvc_page(source: Path, reference: Path, target: Path, options: dict[str, Any] | None = None) -> str:
    """Call the running Seed-VC Gradio page at :17860, api_name convert. Full WAV is output index 1."""
    settings = options or {}
    try:
        steps = int(settings.get("diffusion_steps") if settings.get("diffusion_steps") is not None else 10)
    except (TypeError, ValueError):
        steps = 10
    steps = max(1, min(200, steps))
    try:
        length = float(settings.get("length_adjust") if settings.get("length_adjust") is not None else 1.0)
    except (TypeError, ValueError):
        length = 1.0
    length = max(0.5, min(2.0, length))
    try:
        cfg = float(settings.get("inference_cfg_rate") if settings.get("inference_cfg_rate") is not None else 0.7)
    except (TypeError, ValueError):
        cfg = 0.7
    cfg = max(0.0, min(1.0, cfg))
    base = SEEDVC_PAGE_URL.rstrip("/")
    if not _alive(base):
        raise RuntimeError(f"无法连接 Seed-VC 音色替换（{base}）。请确认 88 电脑上的 seed-vc 页面仍在运行。")
    source_file = _gradio_upload(base, source)
    reference_file = _gradio_upload(base, reference)
    result = _gradio_call_last(base, "convert", [source_file, reference_file, steps, length, cfg])
    full = _seedvc_full_audio(result)
    if isinstance(full, str) and full:
        full = {"path": full}
    if not isinstance(full, dict):
        raise RuntimeError("Seed-VC 没有返回完整音频")
    _save_gradio_audio(base, full, target)
    if not target.exists() or target.stat().st_size < 1024:
        raise RuntimeError("Seed-VC 没有返回完整音频")
    return base


def synthesize_voicestudio(reference: Path, text: str, target: Path, options: dict[str, Any] | None = None) -> str:
    """Clone via local VoiceStudio POST /generate (multipart text + ref_audio)."""
    spoken = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not spoken:
        raise RuntimeError("配音文本为空")
    language = str((options or {}).get("language") or "").strip()
    last_error: Exception | None = None
    for base in _unique(VOICESTUDIO_URLS):
        try:
            if not _alive(f"{base}/v1/models") and not _alive(base):
                last_error = RuntimeError(
                    f"无法连接 VoiceStudio（{base}）。请确认 192.168.1.88 已启动 VoiceStudio（端口 3901）。"
                )
                continue
            data: dict[str, str] = {"text": spoken, "denoise": "true", "effect_preset": "broadcast"}
            if language:
                data["language"] = language
            with reference.open("rb") as handle:
                files = {"ref_audio": (reference.name or "reference.wav", handle, "application/octet-stream")}
                response = requests.post(f"{base}/generate", data=data, files=files, timeout=900)
            if response.status_code >= 400:
                detail = (response.text or "")[:400]
                raise RuntimeError(f"VoiceStudio 配音失败：HTTP {response.status_code} {detail}")
            if len(response.content) < 1024 or not (response.headers.get("content-type") or "").startswith("audio/"):
                # Some builds may still return JSON with a downloadable id; refuse opaque bodies.
                raise RuntimeError("VoiceStudio 没有返回有效音频，请确认引擎已加载且参考音频可用。")
            target.write_bytes(response.content)
            return base
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(str(last_error or "无法连接 VoiceStudio（默认 http://192.168.1.88:3901）"))


_DESIGN_ATTR_ORDER = ("Gender", "Age", "Pitch", "Style", "EnglishAccent", "ChineseDialect")
_DESIGN_ACCENT_KEYS = {"EnglishAccent", "ChineseDialect"}


def _design_instruct(attrs: dict[str, Any]) -> str:
    chosen: list[str] = []
    accent_used = False
    for key in _DESIGN_ATTR_ORDER:
        value = str((attrs or {}).get(key) or "Auto").strip()
        if not value or value.lower() == "auto":
            continue
        if key in _DESIGN_ACCENT_KEYS:
            if accent_used:
                continue
            accent_used = True
        chosen.append(value.lower())
    return ", ".join(chosen)


def describe_voicestudio(description: str) -> dict[str, Any]:
    text = (description or "").strip()
    if not text:
        raise RuntimeError("声音描述为空")
    last_error: Exception | None = None
    for base in _unique(VOICESTUDIO_URLS):
        try:
            if not _alive(base):
                last_error = RuntimeError(f"无法连接 VoiceStudio（{base}）。请确认 192.168.1.88 已启动 VoiceStudio（端口 3901）。")
                continue
            response = requests.post(f"{base}/design/describe", json={"description": text}, timeout=60)
            if response.status_code >= 400:
                detail = (response.text or "")[:400]
                raise RuntimeError(f"VoiceStudio 声音描述识别失败：HTTP {response.status_code} {detail}")
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("VoiceStudio 声音描述返回不是 JSON")
            attrs = payload.get("attrs") if isinstance(payload.get("attrs"), dict) else {}
            unmatched = payload.get("unmatched") if isinstance(payload.get("unmatched"), list) else []
            return {
                "attrs": {key: str(attrs.get(key) or "Auto") for key in _DESIGN_ATTR_ORDER},
                "instruct": str(payload.get("instruct") or ""),
                "unmatched": [str(item) for item in unmatched if str(item).strip()],
                "endpoint": base,
            }
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(str(last_error or "无法连接 VoiceStudio（默认 http://192.168.1.88:3901）"))


def synthesize_voice_design(text: str, target: Path, options: dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
    """Design a voice with VoiceStudio /design, then read text via POST /generate. No reference audio."""
    spoken = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not spoken:
        raise RuntimeError("配音文本为空")
    settings = options or {}
    description = str(settings.get("description") or "").strip()
    requested = settings.get("attrs") if isinstance(settings.get("attrs"), dict) else {}
    described: dict[str, Any] = {}
    if description:
        try:
            described = describe_voicestudio(description)
        except Exception:
            if not _design_instruct(requested):
                raise
            described = {}
    base_attrs = described.get("attrs") if isinstance(described.get("attrs"), dict) else {}
    merged: dict[str, str] = {}
    for key in _DESIGN_ATTR_ORDER:
        chosen = str(requested.get(key) or "Auto").strip() or "Auto"
        merged[key] = chosen if chosen.lower() != "auto" else str(base_attrs.get(key) or "Auto")
    instruct = _design_instruct(merged) or str(described.get("instruct") or "").strip()
    recipe = {
        "description": description,
        "picks": {key: value for key, value in merged.items() if value and value.lower() != "auto"},
    }
    data: dict[str, str] = {
        "text": spoken,
        "denoise": "true",
        "effect_preset": "broadcast",
        "design_recipe": json.dumps(recipe, ensure_ascii=False),
    }
    if instruct:
        data["instruct"] = instruct
    seed = settings.get("seed")
    if isinstance(seed, int):
        data["seed"] = str(seed)
    last_error: Exception | None = None
    for base in _unique(VOICESTUDIO_URLS):
        try:
            if not _alive(f"{base}/v1/models") and not _alive(base):
                last_error = RuntimeError(f"无法连接 VoiceStudio（{base}）。请确认 192.168.1.88 已启动 VoiceStudio（端口 3901）。")
                continue
            response = requests.post(f"{base}/generate", data=data, timeout=900)
            if response.status_code >= 400:
                detail = (response.text or "")[:400]
                raise RuntimeError(f"VoiceStudio 声音设计失败：HTTP {response.status_code} {detail}")
            content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            if len(response.content) < 1024 or not content_type.startswith("audio/"):
                raise RuntimeError("VoiceStudio 没有返回有效音频，请确认设计引擎已加载。")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(response.content)
            design = {
                "attrs": merged,
                "instruct": instruct,
                "unmatched": described.get("unmatched") if isinstance(described.get("unmatched"), list) else [],
            }
            return base, design
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise RuntimeError(str(last_error or "无法连接 VoiceStudio（默认 http://192.168.1.88:3901）"))


class _TryGradio(Exception):
    pass


def _flag(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", ""}
    return bool(value)


def _number(value: Any, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(low, min(high, number))


def _tts_settings(options: dict[str, Any]) -> dict[str, Any]:
    method = int(options.get("emo_control_method") or 0)
    if method not in {0, 1, 2, 3}:
        method = 0
    raw_vector = options.get("emo_vector")
    vector = raw_vector if isinstance(raw_vector, list) and len(raw_vector) == 8 else [0, 0, 0, 0, 0, 0, 0, 0]
    try:
        weight = float(options.get("emo_weight") if options.get("emo_weight") is not None else 0.65)
    except (TypeError, ValueError):
        weight = 0.65
    try:
        tokens = int(options.get("max_text_tokens_per_segment") or 120)
    except (TypeError, ValueError):
        tokens = 120
    emo_audio = options.get("emo_audio")
    return {
        "method": method,
        "weight": max(0.0, min(1.0, weight)),
        "vector": [max(0.0, min(1.0, float(item or 0))) for item in vector],
        "emo_text": str(options.get("emo_text") or "") if method == 3 else "",
        "emo_random": bool(options.get("emo_random")) if method in {2, 3} else False,
        "tokens": max(20, min(600, tokens)),
        "emo_audio": emo_audio if method == 1 and isinstance(emo_audio, Path) else None,
        "do_sample": _flag(options.get("do_sample"), True),
        "top_p": _number(options.get("top_p"), 0.8, 0.0, 1.0),
        "top_k": int(_number(options.get("top_k"), 30, 0, 100)),
        "temperature": _number(options.get("temperature"), 0.8, 0.1, 2.0),
        "length_penalty": _number(options.get("length_penalty"), 0.0, -2.0, 2.0),
        "num_beams": int(_number(options.get("num_beams"), 3, 1, 10)),
        "repetition_penalty": _number(options.get("repetition_penalty"), 10.0, 0.1, 20.0),
        "max_mel_tokens": int(_number(options.get("max_mel_tokens"), 1500, 50, 1815)),
    }


def _synthesize_fastapi(base: str, reference: Path, text: str, target: Path, settings: dict[str, Any]) -> None:
    data = {
        "text": text,
        "emo_weight": str(settings["weight"]),
        "use_emo_text": "true" if settings["method"] == 3 else "false",
        "use_random": "true" if settings["emo_random"] else "false",
        "max_text_tokens_per_segment": str(settings["tokens"]),
        "do_sample": "true" if settings["do_sample"] else "false",
        "top_p": str(settings["top_p"]),
        "top_k": str(settings["top_k"]),
        "temperature": str(settings["temperature"]),
        "length_penalty": str(settings["length_penalty"]),
        "num_beams": str(settings["num_beams"]),
        "repetition_penalty": str(settings["repetition_penalty"]),
        "max_mel_tokens": str(settings["max_mel_tokens"]),
    }
    if settings["method"] == 3 and settings["emo_text"]:
        data["emo_text"] = settings["emo_text"]
    if settings["method"] == 2:
        data["emo_vector"] = ",".join(str(item) for item in settings["vector"])
    files: dict[str, Any] = {}
    with reference.open("rb") as audio:
        files["voice"] = (reference.name, audio.read(), "application/octet-stream")
    emo_audio = settings["emo_audio"]
    if isinstance(emo_audio, Path):
        files["emo_audio"] = (emo_audio.name, emo_audio.read_bytes(), "application/octet-stream")
    response = requests.post(f"{base}/api/tts", data=data, files=files, timeout=900)
    if response.status_code == 404:
        raise _TryGradio()
    if response.status_code >= 400:
        raise RuntimeError(f"语音克隆失败：{response.status_code} {response.text[:400]}")
    target.write_bytes(response.content)


def _synthesize_gradio(base: str, reference: Path, text: str, target: Path, settings: dict[str, Any]) -> None:
    file_data = _gradio_upload(base, reference)
    emo_audio = settings["emo_audio"]
    emo_file = _gradio_upload(base, emo_audio) if isinstance(emo_audio, Path) else None
    data = [
        EMO_LABELS[settings["method"]],
        file_data,
        text,
        emo_file,
        settings["weight"],
        *settings["vector"],
        settings["emo_text"],
        settings["emo_random"],
        settings["tokens"],
        settings["do_sample"],
        settings["top_p"],
        settings["top_k"],
        settings["temperature"],
        settings["length_penalty"],
        settings["num_beams"],
        settings["repetition_penalty"],
        settings["max_mel_tokens"],
    ]
    result = _gradio_call(base, "gen_single", data)
    _save_gradio_audio(base, result, target)


def _gradio_upload(base: str, path: Path) -> dict[str, Any]:
    last_status = 0
    for endpoint in (f"{base}/gradio_api/upload", f"{base}/upload"):
        with path.open("rb") as handle:
            response = requests.post(
                endpoint,
                files={"files": (path.name, handle, "application/octet-stream")},
                timeout=120,
            )
        last_status = response.status_code
        if response.status_code == 404:
            continue
        response.raise_for_status()
        payload = response.json()
        uploaded = payload[0] if isinstance(payload, list) and payload else payload
        if isinstance(uploaded, str):
            return {
                "path": uploaded,
                "orig_name": path.name,
                "size": path.stat().st_size,
                "mime_type": "audio/wav",
                "meta": {"_type": "gradio.FileData"},
            }
        if isinstance(uploaded, dict):
            uploaded.setdefault("meta", {"_type": "gradio.FileData"})
            uploaded.setdefault("orig_name", path.name)
            return uploaded
    raise RuntimeError(f"语音服务不接受参考音频上传（HTTP {last_status}）")


def _gradio_call(base: str, api_name: str, data: list[Any]) -> Any:
    last_error = "语音服务没有 Gradio 接口"
    for prefix in ("/gradio_api", ""):
        url = f"{base}{prefix}/call/{api_name}"
        response = requests.post(url, json={"data": data}, timeout=60)
        if response.status_code == 404:
            last_error = f"{url} 不存在"
            continue
        if response.status_code >= 400:
            raise RuntimeError(f"语音克隆失败：{response.status_code} {response.text[:400]}")
        event_id = str((response.json() or {}).get("event_id") or "")
        if not event_id:
            raise RuntimeError("语音服务没有返回任务编号")
        with requests.get(f"{url}/{event_id}", stream=True, timeout=1800) as stream:
            stream.raise_for_status()
            event = ""
            for raw_line in stream.iter_lines(decode_unicode=True):
                line = (raw_line or "").strip()
                if not line:
                    continue
                if line.startswith("event:"):
                    event = line.split(":", 1)[1].strip()
                    continue
                if not line.startswith("data:"):
                    continue
                payload = line.split(":", 1)[1].strip()
                if event == "error":
                    raise RuntimeError(payload or "语音克隆失败")
                if event == "complete":
                    return json.loads(payload) if payload else None
        last_error = "语音服务没有返回音频"
    raise RuntimeError(last_error)


def _seedvc_full_audio(result: Any) -> Any:
    """Gradio /convert returns [stream, full wav]. The stream item is HLS and must be skipped."""
    if isinstance(result, list) and len(result) > 1 and result[1]:
        return result[1]
    return None


def _gradio_call_last(base: str, api_name: str, data: list[Any]) -> Any:
    """Like _gradio_call, but keeps the last event that already has the full-audio output."""
    last_error = "Seed-VC 没有 Gradio 接口"
    for prefix in ("/gradio_api", ""):
        url = f"{base}{prefix}/call/{api_name}"
        response = requests.post(url, json={"data": data}, timeout=60)
        if response.status_code == 404:
            last_error = f"{url} 不存在"
            continue
        if response.status_code >= 400:
            raise RuntimeError(f"Seed-VC 转换失败：{response.status_code} {response.text[:400]}")
        event_id = str((response.json() or {}).get("event_id") or "")
        if not event_id:
            raise RuntimeError("Seed-VC 没有返回任务编号")
        preferred: Any = None
        last_complete: Any = None
        with requests.get(f"{url}/{event_id}", stream=True, timeout=1800) as stream:
            stream.raise_for_status()
            event = ""
            for raw_line in stream.iter_lines(decode_unicode=True):
                line = (raw_line or "").strip()
                if not line:
                    continue
                if line.startswith("event:"):
                    event = line.split(":", 1)[1].strip()
                    continue
                if not line.startswith("data:"):
                    continue
                payload = line.split(":", 1)[1].strip()
                if event == "error":
                    raise RuntimeError(payload or "Seed-VC 转换失败")
                if event not in {"complete", "generating"}:
                    continue
                parsed = json.loads(payload) if payload else None
                if event == "complete":
                    last_complete = parsed
                if _seedvc_full_audio(parsed) is not None:
                    preferred = parsed
        if preferred is not None or last_complete is not None:
            return preferred if preferred is not None else last_complete
        last_error = "Seed-VC 没有返回音频"
    raise RuntimeError(last_error)


def _save_gradio_audio(base: str, item: Any, target: Path) -> None:
    while True:
        if isinstance(item, (list, tuple)) and item:
            item = item[0]
            continue
        if isinstance(item, dict) and "value" in item and not item.get("path") and not item.get("url"):
            item = item["value"]
            continue
        break
    if isinstance(item, dict):
        url = str(item.get("url") or "")
        path = str(item.get("path") or "")
        candidates = []
        if url.startswith("http"):
            candidates.append(url)
        elif url.startswith("/"):
            candidates.append(base + url)
        if path.startswith("http"):
            candidates.append(path)
        elif path:
            candidates.append(f"{base}/gradio_api/file={path}")
            candidates.append(f"{base}/file={path}")
        for candidate in candidates:
            response = requests.get(candidate, timeout=300)
            if response.ok and len(response.content) > 1024:
                target.write_bytes(response.content)
                return
    raise RuntimeError("语音服务返回了无法识别的音频")


def run_comfy_video(
    *,
    mode: str,
    prompt: str,
    duration: float,
    aspect: str,
    megapixels: float,
    images: list[tuple[str, Path]],
    last_frame: Path | None,
    target: Path,
    seed: int | None = None,
    workflow: str = "",
    videos: list[Path] | None = None,
    audios: list[Path] | None = None,
    quality: str = "",
    deoil: float | None = None,
) -> str:
    studio = str(workflow or "")
    if studio:
        if studio not in STUDIO_WORKFLOWS:
            raise RuntimeError("不支持的 ComfyUI 工作流")
        workflow_path = WORKFLOW_DIR / STUDIO_WORKFLOWS[studio]
        bases = COMFY_H3_URLS
    else:
        if mode not in WORKFLOWS:
            raise RuntimeError("不支持的 ComfyUI 模式")
        workflow_path = WORKFLOW_DIR / WORKFLOWS[mode]
        bases = COMFY_URLS
    if not workflow_path.exists():
        raise RuntimeError(f"缺少工作流 {workflow_path.name}")
    base = first_reachable(bases, "/queue")
    image_names = [_upload_media(base, path) for _slot, path in images]
    video_names = [_upload_media(base, path) for path in (videos or [])]
    audio_names = [_upload_media(base, path) for path in (audios or [])]
    last_name = _upload_media(base, last_frame) if last_frame else ""
    graph_workflow = json.loads(workflow_path.read_text(encoding="utf-8"))
    resolved_seed = int(seed) if seed is not None and int(seed) >= 0 else None if studio else random.randint(1, 2**31 - 1)
    params = {
        "prompt": prompt,
        "duration": max(1.0, min(15.0, float(duration or 5))),
        "aspect": aspect or "16:9 (Widescreen)",
        "megapixels": float(megapixels or 0.4),
        "seed": resolved_seed,
        "image_names": image_names,
        "video_names": video_names,
        "audio_names": audio_names,
        "last_frame_name": last_name,
        "quality": quality,
        "deoil": deoil,
    }
    if studio:
        apply_studio_h3_params(graph_workflow, params)
    else:
        if resolved_seed is None:
            params["seed"] = random.randint(1, 2**31 - 1)
        apply_video_params(graph_workflow, params)
    info = requests.get(f"{base}/object_info", timeout=120)
    info.raise_for_status()
    graph = graph_to_prompt(graph_workflow, info.json())
    if not graph:
        raise RuntimeError("ComfyUI 工作流没有可执行节点")
    prompt_id = _queue_prompt(base, graph)
    _wait_comfy(base, prompt_id, target)
    return base


def _upload_media(base: str, path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".mp4", ".webm", ".mov", ".mkv", ".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac"}:
        suffix = ".png"
    safe_name = f"{uuid.uuid4().hex[:12]}{suffix}"
    with path.open("rb") as handle:
        response = requests.post(
            f"{base}/upload/image",
            data={"overwrite": "true", "type": "input", "subfolder": "canvas_lan"},
            files={"image": (safe_name, handle, "application/octet-stream")},
            timeout=120,
        )
    response.raise_for_status()
    payload = response.json()
    name = str(payload.get("name") or safe_name)
    subfolder = str(payload.get("subfolder") or "canvas_lan").strip("/\\")
    return f"{subfolder}/{name}" if subfolder else name


def _queue_prompt(base: str, prompt: dict[str, Any]) -> str:
    targets = [node_id for node_id, node in prompt.items() if node.get("class_type") == "VHS_VideoCombine"]
    body: dict[str, Any] = {"prompt": prompt, "client_id": uuid.uuid4().hex}
    if targets:
        body["partial_execution_targets"] = targets
    response = requests.post(f"{base}/prompt", json=body, timeout=120)
    if response.status_code >= 400:
        raise RuntimeError(f"提交 ComfyUI 失败：{response.status_code} {response.text[:800]}")
    data = response.json()
    if data.get("node_errors"):
        raise RuntimeError("ComfyUI 节点校验失败：" + json.dumps(data["node_errors"], ensure_ascii=False)[:1500])
    if data.get("error"):
        raise RuntimeError(json.dumps(data["error"], ensure_ascii=False)[:1200])
    prompt_id = str(data.get("prompt_id") or "")
    if not prompt_id:
        raise RuntimeError(f"提交 ComfyUI 失败：{data!r}"[:800])
    return prompt_id


def _history_item(base: str, prompt_id: str) -> dict[str, Any]:
    response = requests.get(f"{base}/history/{prompt_id}", timeout=60)
    response.raise_for_status()
    history = response.json()
    item = history.get(prompt_id) if isinstance(history, dict) else None
    return item if isinstance(item, dict) else {}


def _prompt_still_running(base: str, prompt_id: str) -> bool:
    """True when the prompt is still in ComfyUI's running or pending queue."""
    try:
        response = requests.get(f"{base}/queue", timeout=30)
        response.raise_for_status()
        raw = response.json()
        payload = raw if isinstance(raw, dict) else {}
    except requests.RequestException:
        return False
    for bucket in (payload.get("queue_running") or [], payload.get("queue_pending") or []):
        for entry in bucket:
            # Comfy queue rows look like [number, prompt_id, prompt, extra, outputs]
            if isinstance(entry, (list, tuple)) and len(entry) >= 2 and str(entry[1]) == prompt_id:
                return True
            if isinstance(entry, dict) and str(entry.get("prompt_id") or "") == prompt_id:
                return True
    return False


def _try_save_video(base: str, item: dict[str, Any], target: Path) -> bool:
    video = _first_video(item)
    if not video:
        return False
    raw = _download_output(base, video)
    target.write_bytes(raw)
    return True


def _wait_comfy(base: str, prompt_id: str, target: Path) -> None:
    deadline = time.time() + COMFY_WAIT_SECONDS
    last_error = ""
    while time.time() < deadline:
        try:
            item = _history_item(base, prompt_id)
        except requests.RequestException as exc:
            last_error = str(exc)
            time.sleep(COMFY_POLL_SECONDS)
            continue
        status = item.get("status") if isinstance(item.get("status"), dict) else {}
        if status.get("status_str") == "error" or status.get("error"):
            raise RuntimeError(str(status.get("error") or status.get("messages") or "ComfyUI 执行失败")[:1500])
        # Outputs can appear before status flips to success; prefer the file over status flags.
        if _try_save_video(base, item, target):
            return
        time.sleep(COMFY_POLL_SECONDS)

    # Soft deadline: if Comfy is still running this prompt, keep waiting a bit longer.
    soft_deadline = time.time() + min(20 * 60, COMFY_WAIT_SECONDS)
    while time.time() < soft_deadline and _prompt_still_running(base, prompt_id):
        try:
            if _try_save_video(base, _history_item(base, prompt_id), target):
                return
        except requests.RequestException as exc:
            last_error = str(exc)
        time.sleep(COMFY_POLL_SECONDS)

    # Final salvage: history may have landed just after the cutoff.
    try:
        if _try_save_video(base, _history_item(base, prompt_id), target):
            return
    except requests.RequestException as exc:
        last_error = str(exc)
    suffix = f"（{last_error}）" if last_error else ""
    raise RuntimeError(f"等待 ComfyUI 超时{suffix}")


def _first_video(history: dict[str, Any]) -> dict[str, str] | None:
    outputs = history.get("outputs") or {}
    found: list[dict[str, str]] = []
    for out in outputs.values():
        if not isinstance(out, dict):
            continue
        for key in ("gifs", "videos", "images", "files"):
            for item in out.get(key) or []:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("filename") or "")
                if not name.lower().endswith((".mp4", ".webm", ".mov", ".mkv")):
                    continue
                found.append(
                    {
                        "filename": name,
                        "subfolder": str(item.get("subfolder") or ""),
                        "type": str(item.get("type") or "output"),
                    }
                )
    found.sort(key=lambda video: (0 if video["filename"].lower().endswith(".mp4") else 1, video["filename"]))
    return found[0] if found else None


def _download_output(base: str, video: dict[str, str]) -> bytes:
    response = requests.get(
        f"{base}/view",
        params={"filename": video["filename"], "subfolder": video["subfolder"], "type": video["type"]},
        timeout=300,
    )
    response.raise_for_status()
    if len(response.content) < 1024:
        raise RuntimeError("ComfyUI 输出视频无效")
    return response.content


def _unique(urls: list[str]) -> list[str]:
    seen: list[str] = []
    for url in urls:
        base = url.rstrip("/")
        if base and base not in seen:
            seen.append(base)
    return seen


def _yue2_bases() -> list[str]:
    return _unique(YUE2_URLS)


def yue2_health() -> dict[str, Any]:
    last_error = ""
    for base in _yue2_bases():
        try:
            response = requests.get(f"{base}/api/health", timeout=PROBE_TIMEOUT)
            if response.status_code >= 500:
                last_error = f"HTTP {response.status_code}"
                continue
            payload = response.json() if response.content else {}
            if isinstance(payload, dict):
                payload = {**payload, "endpoint": base}
                return payload
        except (requests.RequestException, ValueError) as exc:
            last_error = str(exc)
    raise RuntimeError(f"无法连接 YuE2（{last_error or '无可用地址'}）")


# These YuE2 kinds finish without a main mixdown audio (ABC/MIDI/plan/etc.).
YUE2_NON_AUDIO_KINDS = frozenset({"transcribe", "plan", "doctor", "midi_extract"})


def run_yue2_job(
    kind: str,
    request_body: dict[str, Any],
    target: Path,
    on_update: Any | None = None,
) -> dict[str, Any]:
    """Create a YuE2 job, wait until terminal, download the main audio into target.

    Non-audio kinds (e.g. transcribe) return structured result fields instead of
    writing ``target``. on_update(dict) is optional; called after create and on each
    status poll so the platform NasJob can store yue2_job_id/stage before the long
    GPU wait finishes.
    """
    kind_key = str(kind or "generate").strip() or "generate"
    wants_audio = kind_key not in YUE2_NON_AUDIO_KINDS
    payload = {
        "kind": kind_key,
        "request": request_body if isinstance(request_body, dict) else {},
        "source": "api",
        "client_request_id": str(uuid.uuid4()),
    }

    last_progress_at = 0.0
    last_progress_stage = ""

    def _emit(patch: dict[str, Any], *, force: bool = False) -> None:
        nonlocal last_progress_at, last_progress_stage
        if not callable(on_update):
            return
        stage = str(patch.get("stage") or "")
        now = time.time()
        if (
            not force
            and stage == last_progress_stage
            and (now - last_progress_at) < YUE2_PROGRESS_EVERY_SECONDS
        ):
            return
        last_progress_at = now
        last_progress_stage = stage
        try:
            on_update(patch)
        except Exception as exc:  # noqa: BLE001
            print(f"[lan_media] yue2 on_update ignored: {exc}")

    last_error = ""
    for base in _yue2_bases():
        job_id = ""
        try:
            created = requests.post(f"{base}/api/jobs", json=payload, timeout=(8, 45))
            if created.status_code >= 400:
                last_error = f"HTTP {created.status_code} {created.text[:300]}"
                continue
            job = created.json() if created.content else {}
            if not isinstance(job, dict) or not job.get("id"):
                last_error = "YuE2 未返回任务编号"
                continue
            job_id = str(job["id"])
            _emit(
                {
                    "yue2_job_id": job_id,
                    "endpoint": base,
                    "kind": str(job.get("kind") or kind_key),
                    "summary": str(job.get("summary") or ""),
                    "stage": str(job.get("stage") or "queued"),
                    "progress": 0.02,
                },
                force=True,
            )
            deadline = time.time() + YUE2_WAIT_SECONDS
            while time.time() < deadline:
                try:
                    status_resp = requests.get(f"{base}/api/jobs/{job_id}", timeout=(5, 30))
                except requests.RequestException as exc:
                    last_error = str(exc)
                    time.sleep(YUE2_POLL_SECONDS)
                    continue
                if status_resp.status_code >= 400:
                    last_error = f"查询失败 HTTP {status_resp.status_code}"
                    time.sleep(YUE2_POLL_SECONDS)
                    continue
                status_job = status_resp.json() if status_resp.content else {}
                if not isinstance(status_job, dict):
                    time.sleep(YUE2_POLL_SECONDS)
                    continue
                state = str(status_job.get("status") or "")
                stage = str(status_job.get("stage") or state or "starting")
                progress = status_job.get("progress")
                emit_patch: dict[str, Any] = {
                    "yue2_job_id": job_id,
                    "endpoint": base,
                    "stage": stage if state == "running" else state,
                    "summary": str(status_job.get("summary") or job.get("summary") or ""),
                }
                if isinstance(progress, (int, float)):
                    emit_patch["progress"] = float(progress)
                _emit(emit_patch, force=state in {"complete", "failed", "cancelled"})
                if state == "complete":
                    result = status_job.get("result") if isinstance(status_job.get("result"), dict) else {}
                    meta: dict[str, Any] = {
                        "endpoint": base,
                        "yue2_job_id": job_id,
                        "kind": str(status_job.get("kind") or kind_key),
                        "summary": str(status_job.get("summary") or ""),
                        "has_audio": False,
                    }
                    if wants_audio:
                        audio_rel = _yue2_audio_relative(status_job)
                        if not audio_rel:
                            raise RuntimeError("YuE2 完成但没有音频结果")
                        audio_bytes = _yue2_download_file(base, job_id, audio_rel)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(audio_bytes)
                        meta["has_audio"] = True
                        meta["audio_seconds"] = result.get("audio_seconds") or (
                            (result.get("candidates") or [{}])[0].get("audio_seconds")
                        )
                        meta["yue2_result"] = {
                            key: result[key]
                            for key in ("truncated", "partial", "requested_candidates", "completed_candidates")
                            if key in result
                        }
                        meta["media_type"] = _yue2_media_type(target.name)
                    else:
                        # Preserve transcription / plan fields for the studio UI.
                        for key in (
                            "abc",
                            "timing",
                            "warnings",
                            "melody_only",
                            "duration_seconds",
                            "partial",
                            "truncated",
                            "requested_candidates",
                            "completed_candidates",
                        ):
                            if key in result:
                                meta[key] = result[key]
                        meta["yue2_result"] = {
                            key: result[key]
                            for key in ("timing", "warnings", "melody_only", "duration_seconds")
                            if key in result
                        }
                        meta["audio_seconds"] = result.get("duration_seconds")
                    return meta
                if state in {"failed", "cancelled"}:
                    raise RuntimeError(str(status_job.get("error") or f"YuE2 任务{state}"))
                time.sleep(YUE2_POLL_SECONDS)
            raise RuntimeError(f"等待 YuE2 任务超时（yue2_job_id={job_id}）")
        except requests.RequestException as exc:
            # Create failed on this base — try next. Do not abandon an already-created job_id.
            if job_id:
                raise RuntimeError(f"YuE2 任务已创建但通信中断（{job_id}）：{exc}") from exc
            last_error = str(exc)
            continue
    raise RuntimeError(f"YuE2 任务失败（{last_error or '无可用地址'}）")


def _yue2_audio_relative(job: dict[str, Any]) -> str:
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    candidates = result.get("candidates") if isinstance(result.get("candidates"), list) else []
    paths: list[str] = []
    for key in ("audio", "output", "mix", "song"):
        value = result.get(key)
        if isinstance(value, str) and value.strip():
            paths.append(value.strip())
    for item in candidates:
        if not isinstance(item, dict):
            continue
        for key in ("audio", "output", "path", "file"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                paths.append(value.strip())
    job_id = str(job.get("id") or "")
    job_dir = str(job.get("job_dir") or "").replace("\\", "/")
    for raw in paths:
        normalized = raw.replace("\\", "/")
        marker = f"/jobs/{job_id}/"
        idx = normalized.lower().find(marker.lower())
        if idx >= 0:
            return normalized[idx + len(marker) :]
        if job_dir and normalized.lower().startswith(job_dir.lower().rstrip("/") + "/"):
            return normalized[len(job_dir.rstrip("/")) + 1 :]
        art = normalized.lower().rfind("/artifacts/")
        if art >= 0:
            return normalized[art + 1 :]
        # Absolute Windows/YuE2 paths: keep basename under artifacts/ if present.
        lower = normalized.lower()
        for needle in ("/artifacts/", "/audio/", "/outputs/"):
            pos = lower.rfind(needle)
            if pos >= 0:
                return normalized[pos + 1 :]
        if not Path(normalized).is_absolute():
            return normalized.lstrip("/")
    return ""


def yue2_upload_local_file(path: Path, filename: str | None = None) -> str:
    """POST a local file to YuE2 /api/uploads on the office LAN and return server path."""
    from urllib.parse import quote

    file_path = Path(path)
    if not file_path.is_file():
        raise RuntimeError(f"YuE2 上传源文件不存在：{file_path}")
    name = (filename or file_path.name or "upload.bin").strip() or "upload.bin"
    last_error = ""
    for base in _yue2_bases():
        url = f"{base}/api/uploads?filename={quote(name)}"
        try:
            with file_path.open("rb") as handle:
                response = requests.post(
                    url,
                    data=handle,
                    headers={"Content-Type": "application/octet-stream"},
                    timeout=(10, 600),
                )
            if response.status_code >= 400:
                last_error = f"HTTP {response.status_code} {response.text[:300]}"
                continue
            payload = response.json() if response.content else {}
            if isinstance(payload, dict):
                uploaded = str(payload.get("path") or payload.get("file") or "").strip()
                if uploaded:
                    return uploaded
            last_error = "YuE2 上传未返回 path"
        except (requests.RequestException, ValueError) as exc:
            last_error = str(exc)
    raise RuntimeError(f"无法上传到 YuE2（{last_error or '无可用地址'}）")


def _yue2_download_file(base: str, job_id: str, relative: str) -> bytes:
    from urllib.parse import quote

    parts = [part for part in relative.replace("\\", "/").split("/") if part]
    url = f"{base}/api/files/{job_id}/" + "/".join(quote(part, safe="") for part in parts)
    response = requests.get(url, timeout=300)
    response.raise_for_status()
    if len(response.content) < 256:
        raise RuntimeError("YuE2 音频无效")
    return response.content


def _yue2_media_type(filename: str) -> str:
    lower = filename.lower()
    if lower.endswith(".wav"):
        return "audio/wav"
    if lower.endswith(".mp3"):
        return "audio/mpeg"
    if lower.endswith(".ogg"):
        return "audio/ogg"
    return "audio/flac"
