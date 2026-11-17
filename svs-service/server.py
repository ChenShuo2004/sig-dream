"""Local SVS guide service for lyric remake (port 7866 on GPU PC 88).

POST /sing: lyrics + melody dry vocal -> guide wav (new words, original F0).
File-machine then runs Seed-VC to apply the user reference timbre.
"""

from __future__ import annotations

import os
import tempfile
import threading
from pathlib import Path

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from pipeline import synthesize_guide

app = FastAPI(title="Local SVS Guide Service", version="1.0.0")
_lock = threading.Lock()


def _cleanup(path: Path) -> None:
    import shutil

    shutil.rmtree(path, ignore_errors=True)


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "svs-guide",
        "cuda": bool(torch.cuda.is_available()),
        "phase": "voicestudio+pyworld-f0",
        "note": "guide only; Seed-VC applies target timbre",
        "voicestudio": (os.getenv("SVS_VOICESTUDIO_URL") or "http://127.0.0.1:3901"),
    }


@app.post("/sing")
async def sing(
    lyrics: str = Form(...),
    melody: UploadFile = File(..., description="dry vocal clip for F0 / duration"),
    tts_ref: UploadFile | None = File(
        None,
        description="optional clean speech ref for Mandarin TTS (prefer user voice sample)",
    ),
):
    text = " ".join((lyrics or "").split())
    if not text:
        raise HTTPException(status_code=400, detail="lyrics empty")
    if len(text) > 200:
        raise HTTPException(status_code=400, detail="lyrics too long")

    work = Path(tempfile.mkdtemp(prefix="svs-sing-"))
    mel_path = work / f"melody{Path(melody.filename or 'melody.wav').suffix or '.wav'}"
    ref_path: Path | None = None
    out_path = work / "guide.wav"
    try:
        mel_path.write_bytes(await melody.read())
        if mel_path.stat().st_size < 32:
            raise HTTPException(status_code=400, detail="melody empty")
        if tts_ref is not None:
            raw = await tts_ref.read()
            if raw and len(raw) >= 32:
                ref_path = work / f"tts_ref{Path(tts_ref.filename or 'ref.wav').suffix or '.wav'}"
                ref_path.write_bytes(raw)
        with _lock:
            meta = synthesize_guide(text, mel_path, out_path, tts_ref_path=ref_path)
        if not out_path.exists() or out_path.stat().st_size < 256:
            raise HTTPException(status_code=500, detail="guide audio invalid")
        headers = {
            "X-SVS-Engine": str(meta.get("engine") or ""),
            "X-SVS-Melody-Sec": str(meta.get("melody_sec") or ""),
            "X-SVS-Tts-Lang": str(meta.get("tts_language") or ""),
            "X-SVS-Tts-Ref": str(meta.get("tts_ref") or ""),
        }
        return FileResponse(
            path=out_path,
            media_type="audio/wav",
            filename="guide.wav",
            headers=headers,
            background=BackgroundTask(_cleanup, work),
        )
    except HTTPException:
        _cleanup(work)
        raise
    except Exception as exc:  # noqa: BLE001
        _cleanup(work)
        return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.on_event("startup")
def _boot():
    print("SVS guide ready on /health and /sing")
    print(f"  cuda={torch.cuda.is_available()} voicestudio={os.getenv('SVS_VOICESTUDIO_URL') or 'http://127.0.0.1:3901'}")
