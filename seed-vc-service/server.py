"""Seed-VC FastAPI wrapper for zero-shot singing / speech voice conversion.

Runs on the office GPU (default :7865). File-machine worker posts
multipart source (content to convert) + reference (timbre) to /convert.
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

ROOT = Path(__file__).resolve().parent
UPSTREAM = ROOT / "upstream"
if str(UPSTREAM) not in sys.path:
    sys.path.insert(0, str(UPSTREAM))

os.chdir(UPSTREAM)
os.environ.setdefault("HF_HUB_CACHE", str(UPSTREAM / "checkpoints" / "hf_cache"))

app = FastAPI(title="Seed-VC LAN Service", version="1.0.0")

_lock = threading.Lock()
_wrapper = None
_load_error: str | None = None


def _get_wrapper():
    global _wrapper, _load_error
    if _wrapper is not None:
        return _wrapper
    if _load_error:
        raise RuntimeError(_load_error)
    try:
        from seed_vc_wrapper import SeedVCWrapper

        _wrapper = SeedVCWrapper()
        return _wrapper
    except Exception as exc:  # noqa: BLE001
        _load_error = f"Seed-VC 模型加载失败：{exc}"
        raise RuntimeError(_load_error) from exc


def _cleanup(path: Path) -> None:
    import shutil

    shutil.rmtree(path, ignore_errors=True)


def _run_convert_voice(wrapper, source_path: Path, ref_path: Path, **kwargs):
    """SeedVCWrapper.convert_voice uses yield, so the call always returns a generator.

    Drain the stream and keep the last full_audio payload (typically (sample_rate, wave)).
    """
    stream = wrapper.convert_voice(
        str(source_path),
        str(ref_path),
        stream_output=True,
        **kwargs,
    )
    full_audio = None
    for _mp3_bytes, audio in stream:
        if audio is not None:
            full_audio = audio
    return full_audio


def _audio_from_result(result, use_f0: bool) -> tuple[np.ndarray, int]:
    if result is None:
        raise RuntimeError("Seed-VC 没有返回音频")
    if isinstance(result, tuple) and len(result) == 2:
        sr, wave = result
        audio = np.asarray(wave, dtype=np.float32)
        return audio.squeeze(), int(sr)
    audio = np.asarray(result, dtype=np.float32).squeeze()
    return audio, 44100 if use_f0 else 22050


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "seed-vc",
        "cuda": bool(torch.cuda.is_available()),
        "model_loaded": _wrapper is not None,
        "load_error": _load_error,
    }


@app.post("/convert")
async def convert(
    source: UploadFile = File(..., description="要转换的干声 / 原唱"),
    reference: UploadFile = File(..., description="目标音色参考"),
    f0_condition: int = Form(1),
    diffusion_steps: int = Form(40),
    inference_cfg_rate: float = Form(0.7),
    auto_f0_adjust: int = Form(0),
    pitch_shift: int = Form(0),
    length_adjust: float = Form(1.0),
):
    """Convert source into reference timbre. f0_condition=1 for singing."""
    steps = max(4, min(100, int(diffusion_steps or 40)))
    cfg = max(0.0, min(1.0, float(inference_cfg_rate if inference_cfg_rate is not None else 0.7)))
    length = max(0.5, min(2.0, float(length_adjust if length_adjust is not None else 1.0)))
    shift = max(-24, min(24, int(pitch_shift or 0)))
    use_f0 = bool(int(f0_condition if f0_condition is not None else 1))
    auto_f0 = bool(int(auto_f0_adjust or 0))

    work = Path(tempfile.mkdtemp(prefix="seedvc-"))
    source_path = work / f"source{Path(source.filename or 'source.wav').suffix or '.wav'}"
    ref_path = work / f"reference{Path(reference.filename or 'reference.wav').suffix or '.wav'}"
    out_path = work / "output.wav"
    try:
        source_path.write_bytes(await source.read())
        ref_path.write_bytes(await reference.read())
        if source_path.stat().st_size < 32 or ref_path.stat().st_size < 32:
            raise HTTPException(status_code=400, detail="音频文件为空")

        with _lock:
            wrapper = _get_wrapper()
            result = _run_convert_voice(
                wrapper,
                source_path,
                ref_path,
                diffusion_steps=steps,
                length_adjust=length,
                inference_cfg_rate=cfg,
                f0_condition=use_f0,
                auto_f0_adjust=auto_f0,
                pitch_shift=shift,
            )

        audio, sr = _audio_from_result(result, use_f0)
        if audio.size == 0:
            raise HTTPException(status_code=500, detail="Seed-VC 输出为空")
        peak = float(np.max(np.abs(audio)))
        if peak > 1.0:
            audio = audio / peak
        sf.write(str(out_path), audio, int(sr))
        if not out_path.exists() or out_path.stat().st_size < 256:
            raise HTTPException(status_code=500, detail="输出音频无效")
        return FileResponse(
            path=out_path,
            media_type="audio/wav",
            filename="output.wav",
            background=BackgroundTask(_cleanup, work),
        )
    except HTTPException:
        _cleanup(work)
        raise
    except Exception as exc:  # noqa: BLE001
        _cleanup(work)
        return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.on_event("startup")
def _warmup_hint():
    cuda_ok = bool(torch.cuda.is_available())
    gpu_name = torch.cuda.get_device_name(0) if cuda_ok else "none"
    print("Seed-VC service ready on /health and /convert (models load on first convert).")
    print(f"  torch={torch.__version__}  cuda_available={cuda_ok}  gpu={gpu_name}")
    if not cuda_ok:
        print("  WARNING: CUDA not available — inference will use CPU and be very slow.")
        print("  Fix: delete .venv\\seedvc_deps_ok.txt, then reinstall CUDA torch via 一键启动.bat")
    print("  Note: torch.load(..., map_location='cpu') only loads weights from disk;")
    print("        models are moved to GPU afterward when cuda_available=True.")
