"""Phase-1 local SVS guide: new lyrics via VoiceStudio TTS + impose dry-vocal F0 (pyworld).

DiffSinger acoustic can later replace synthesize_guide() when upstream weights exist.
Final target timbre is applied by Seed-VC on the file machine after /sing returns.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import librosa
import numpy as np
import pyworld as pw
import requests
import soundfile as sf

VOICESTUDIO_URL = (os.getenv("SVS_VOICESTUDIO_URL") or "http://127.0.0.1:3901").rstrip("/")
TTS_TIMEOUT = int(os.getenv("SVS_TTS_TIMEOUT") or "600")
# Mandarin by default — singing dry-vocal refs (esp. Cantonese pop) otherwise bleed accent into TTS.
TTS_LANGUAGE = (os.getenv("SVS_TTS_LANGUAGE") or "zh").strip() or "zh"
# Blend WORLD resynthesis with time-stretched TTS to cut vocoder hiss.
F0_WET = float(os.getenv("SVS_F0_WET") or "0.55")


def _mono_float64(path: Path, sr: int | None = None) -> tuple[np.ndarray, int]:
    audio, rate = librosa.load(str(path), sr=sr, mono=True)
    return audio.astype(np.float64), int(rate)


def extract_f0(audio: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    f0, t = pw.harvest(audio, sr)
    f0 = pw.stonemask(audio, f0, t, sr)
    return f0, t


def _tts_voicestudio(lyrics: str, ref_wav: Path, out_wav: Path) -> None:
    # No broadcast FX: singing guide should stay dry before Seed-VC.
    data = {
        "text": lyrics.strip(),
        "denoise": "true",
        "language": TTS_LANGUAGE,
    }
    with ref_wav.open("rb") as handle:
        files = {"ref_audio": (ref_wav.name or "ref.wav", handle, "application/octet-stream")}
        response = requests.post(f"{VOICESTUDIO_URL}/generate", data=data, files=files, timeout=TTS_TIMEOUT)
    if response.status_code >= 400:
        detail = (response.text or "")[:400]
        raise RuntimeError(f"VoiceStudio TTS failed: HTTP {response.status_code} {detail}")
    if len(response.content) < 256:
        raise RuntimeError("VoiceStudio TTS returned empty audio")
    out_wav.write_bytes(response.content)


def _match_len(audio: np.ndarray, n: int) -> np.ndarray:
    """Trim or zero-pad 1-D audio to exactly n samples (WORLD synth length often drifts)."""
    if n <= 0:
        return audio[:0]
    if audio.size == n:
        return audio
    if audio.size > n:
        return audio[:n]
    return np.pad(audio, (0, n - audio.size))


def impose_melody_f0(guide: np.ndarray, guide_sr: int, melody_f0: np.ndarray, target_len: int) -> np.ndarray:
    """Replace guide spectral envelope carrier with melody F0; stretch to target_len samples."""
    if guide.size < guide_sr // 10:
        raise RuntimeError("TTS guide too short")
    # Match duration to dry vocal window first.
    ratio = max(0.25, min(4.0, target_len / max(1, guide.size)))
    stretched = librosa.effects.time_stretch(guide.astype(np.float32), rate=1.0 / ratio).astype(np.float64)
    stretched = _match_len(stretched, target_len)

    f0_g, t_g = extract_f0(stretched, guide_sr)
    if f0_g.size == 0:
        raise RuntimeError("cannot extract F0 from TTS guide")
    # Resize melody F0 to guide frame count.
    idx = np.linspace(0, max(len(melody_f0) - 1, 0), num=len(f0_g))
    f0_m = np.interp(idx, np.arange(len(melody_f0)), melody_f0).astype(np.float64)
    # Keep unvoiced frames unvoiced.
    f0_m[f0_g < 1.0] = 0.0
    voiced = (f0_m >= 1.0) & (f0_g >= 1.0)
    if not np.any(voiced):
        f0_m = f0_g.copy()
    sp = pw.cheaptrick(stretched, f0_g, t_g, guide_sr)
    ap = pw.d4c(stretched, f0_g, t_g, guide_sr)
    # Clamp aperiodicity — WORLD often injects harsh breath/noise on speech→song.
    ap = np.clip(ap, 0.0, 0.35)
    out = pw.synthesize(f0_m, sp, ap, guide_sr).astype(np.float64)
    # WORLD output length can differ from input by a few frames — align before mix.
    n = max(out.size, stretched.size)
    out = _match_len(out, n)
    stretched = _match_len(stretched, n)
    wet = max(0.0, min(1.0, F0_WET))
    if wet < 0.999:
        out = wet * out + (1.0 - wet) * stretched
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 1.0:
        out = out / peak
    return _match_len(out, target_len)


def synthesize_guide(
    lyrics: str,
    melody_path: Path,
    out_path: Path,
    tts_ref_path: Path | None = None,
) -> dict:
    lyrics = " ".join((lyrics or "").split())
    if not lyrics:
        raise RuntimeError("lyrics empty")
    melody, sr = _mono_float64(melody_path, sr=44100)
    if melody.size < sr // 5:
        raise RuntimeError("melody clip too short")
    mel_f0, _ = extract_f0(melody, sr)

    # Prefer user voice sample for TTS (Mandarin + clean speech). Melody dry vocal
    # as clone ref often pulls Cantonese / singing accent into the new lyrics.
    ref_for_tts = tts_ref_path if tts_ref_path and tts_ref_path.exists() else melody_path

    work = Path(tempfile.mkdtemp(prefix="svs-guide-"))
    try:
        tts_path = work / "tts.wav"
        _tts_voicestudio(lyrics, ref_for_tts, tts_path)
        guide, guide_sr = _mono_float64(tts_path, sr=sr)
        remade = impose_melody_f0(guide, guide_sr, mel_f0, target_len=melody.size)
        sf.write(str(out_path), remade.astype(np.float32), sr)
        return {
            "engine": "voicestudio+pyworld-f0",
            "sample_rate": sr,
            "lyrics": lyrics,
            "melody_sec": round(melody.size / sr, 3),
            "tts_language": TTS_LANGUAGE,
            "tts_ref": "voice" if ref_for_tts != melody_path else "melody",
        }
    finally:
        import shutil

        shutil.rmtree(work, ignore_errors=True)
