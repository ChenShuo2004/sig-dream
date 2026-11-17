"""ffmpeg steps for canvas studio jobs (replication intake).

The worker downloads the uploaded source, calls these helpers in a temp
directory, then uploads every produced file as a named job output.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

FFMPEG_BIN = os.getenv("NAS_FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = os.getenv("NAS_FFPROBE_BIN", "ffprobe")
STEP_TIMEOUT_SECONDS = int(os.getenv("NAS_STUDIO_STEP_TIMEOUT", "900"))


def _run(args: list[str], *, timeout: int = STEP_TIMEOUT_SECONDS) -> str:
    proc = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        raise RuntimeError(f"{Path(args[0]).name} 失败（{proc.returncode}）：{output[-600:]}")
    return output


def probe(source: Path) -> dict:
    output = _run(
        [
            FFPROBE_BIN,
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height,r_frame_rate",
            "-of",
            "json",
            str(source),
        ],
        timeout=120,
    )
    data = json.loads(output or "{}")
    streams = data.get("streams") or []
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
    if not video:
        raise RuntimeError("上传的文件里没有视频流")
    fps = 0.0
    rate = str(video.get("r_frame_rate") or "0/1")
    if "/" in rate:
        num, _, den = rate.partition("/")
        try:
            fps = float(num) / float(den) if float(den) else 0.0
        except ValueError:
            fps = 0.0
    return {
        "duration": float((data.get("format") or {}).get("duration") or 0),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "fps": round(fps, 3),
        "has_audio": audio is not None,
    }


def transcode(source: Path, target: Path, max_seconds: float) -> None:
    _run(
        [
            FFMPEG_BIN,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-t",
            f"{max_seconds:.3f}",
            "-vf",
            r"scale='if(gt(iw,ih),min(1280\,iw),-2)':'if(gt(iw,ih),-2,min(1280\,ih))':force_divisible_by=2",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(target),
        ]
    )


def extract_audio(source: Path, target: Path) -> None:
    _run([FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", str(target)])


_PTS_TIME = re.compile(r"pts_time:([0-9.]+)")


def detect_cuts(source: Path, threshold: float, width: int, max_cuts: int) -> list[float]:
    output = subprocess.run(
        [
            FFMPEG_BIN,
            "-hide_banner",
            "-nostats",
            "-i",
            str(source),
            "-an",
            "-vf",
            f"scale={int(width)}:-2,select='gt(scene\\,{threshold:.3f})',showinfo",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=STEP_TIMEOUT_SECONDS,
    )
    cuts: list[float] = []
    for line in (output.stderr or "").splitlines():
        if "showinfo" not in line:
            continue
        match = _PTS_TIME.search(line)
        if not match:
            continue
        value = round(float(match.group(1)), 3)
        if value > 0.2 and (not cuts or value - cuts[-1] >= 0.4):
            cuts.append(value)
        if len(cuts) >= max_cuts:
            break
    return cuts


def extract_frame(source: Path, target: Path, seconds: float, max_width: int = 640) -> None:
    _run(
        [
            FFMPEG_BIN,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{max(0.0, seconds):.3f}",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            f"scale='min({int(max_width)},iw)':-2",
            "-q:v",
            "3",
            str(target),
        ],
        timeout=120,
    )


def run_replication_intake(source: Path, work: Path, options: dict) -> tuple[dict, list[tuple[str, Path, str]]]:
    """Return (result, outputs) where outputs are (name, path, media_type)."""
    max_seconds = float(options.get("max_seconds") or 180)
    threshold = float(options.get("threshold") or 0.2)
    width = int(options.get("width") or 320)
    max_cuts = int(options.get("max_cuts") or 500)

    info = probe(source)
    if info["duration"] <= 0:
        raise RuntimeError("无法读取视频时长")
    video = work / "video.mp4"
    transcode(source, video, max_seconds)
    duration = probe(video)["duration"] or min(info["duration"], max_seconds)
    outputs: list[tuple[str, Path, str]] = [("video.mp4", video, "video/mp4")]

    audio_name = ""
    if info["has_audio"]:
        audio = work / "audio.mp3"
        extract_audio(video, audio)
        outputs.append(("audio.mp3", audio, "audio/mpeg"))
        audio_name = "audio.mp3"

    cuts = [cut for cut in detect_cuts(video, threshold, width, max_cuts) if cut < duration - 0.2]
    bounds = [0.0, *cuts, duration]
    shots = []
    for index in range(len(bounds) - 1):
        start, end = bounds[index], bounds[index + 1]
        if end - start < 0.05:
            continue
        name = f"frame-{len(shots) + 1:04d}.jpg"
        frame = work / name
        extract_frame(video, frame, start + min(0.3, (end - start) / 2))
        outputs.append((name, frame, "image/jpeg"))
        shots.append({"index": len(shots) + 1, "start": round(start, 3), "end": round(end, 3), "frame": name})

    result = {
        "duration": round(duration, 3),
        "source_duration": round(info["duration"], 3),
        "truncated": info["duration"] > max_seconds + 0.05,
        "width": info["width"],
        "height": info["height"],
        "fps": info["fps"],
        "cuts": cuts,
        "shots": shots,
        "files": {"video": "video.mp4", "audio": audio_name},
    }
    return result, outputs


def cut_clip(source: Path, target: Path, start: float, end: float) -> None:
    _run(
        [
            FFMPEG_BIN,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{max(0.0, start):.3f}",
            "-i",
            str(source),
            "-t",
            f"{max(0.1, end - start):.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(target),
        ]
    )


def _encode_args() -> list[str]:
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]


def separate_vocals(source: Path, work: Path) -> tuple[Path, Path]:
    """Demucs htdemucs two-stem split; runs in the worker venv (pip install demucs)."""
    import sys

    wav = work / "separate-input.wav"
    _run([FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-ac", "2", "-ar", "44100", str(wav)])
    out_dir = work / "demucs"
    _run([sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", os.getenv("NAS_DEMUCS_MODEL", "htdemucs"), "-o", str(out_dir), str(wav)], timeout=max(STEP_TIMEOUT_SECONDS, 3600))
    stems = next(out_dir.glob("*/separate-input"), None)
    if not stems or not (stems / "vocals.wav").exists() or not (stems / "no_vocals.wav").exists():
        raise RuntimeError("人声分离没有生成人声或背景声音轨")
    vocals, background = work / "vocals.mp3", work / "background.mp3"
    for stem, target in ((stems / "vocals.wav", vocals), (stems / "no_vocals.wav", background)):
        _run([FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y", "-i", str(stem), "-c:a", "libmp3lame", "-b:a", "192k", str(target)])
    return vocals, background


def run_replacement_media(source: Path, work: Path, media: dict, progress=None) -> tuple[dict, list[tuple[str, Path, str]]]:
    """Single-file edits for the replacement studio: reverse / trim a clip, or split vocals from background."""
    op = str(media.get("op") or "")
    if progress:
        progress({"reverse": "正在倒放视频", "trim": "正在裁剪视频", "separate": "正在分离人声和背景声"}.get(op, "正在处理"))
    if op == "reverse":
        target = work / "result.mp4"
        has_audio = probe(source)["has_audio"]
        _run([FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vf", "reverse", *(["-af", "areverse"] if has_audio else ["-an"]), *_encode_args(), str(target)])
        return {"op": op, "duration": probe(target)["duration"], "files": {"video": "result.mp4"}}, [("result.mp4", target, "video/mp4")]
    if op == "trim":
        start = max(0.0, float(media.get("start") or 0))
        end = float(media.get("end") or 0)
        if end <= start + 0.05:
            raise RuntimeError("裁剪区间无效")
        target = work / "result.mp4"
        cut_clip(source, target, start, end)
        return {"op": op, "duration": probe(target)["duration"], "files": {"video": "result.mp4"}}, [("result.mp4", target, "video/mp4")]
    if op == "separate":
        vocals, background = separate_vocals(source, work)
        return {"op": op, "files": {"vocals": "vocals.mp3", "background": "background.mp3"}}, [("vocals.mp3", vocals, "audio/mpeg"), ("background.mp3", background, "audio/mpeg")]
    raise RuntimeError(f"不支持的处理类型：{op}")


def _slice(bundle: Path, entry: dict, target: Path) -> Path:
    offset, size = int(entry["offset"]), int(entry["size"])
    if offset < 0 or size <= 0 or offset + size > bundle.stat().st_size:
        raise RuntimeError("合成素材包损坏")
    with bundle.open("rb") as source, target.open("wb") as handle:
        source.seek(offset)
        remaining = size
        while remaining:
            chunk = source.read(min(remaining, 1 << 20))
            if not chunk:
                raise RuntimeError("合成素材包不完整")
            handle.write(chunk)
            remaining -= len(chunk)
    return target


def run_replacement_compose(bundle: Path, work: Path, plan: dict, progress=None) -> tuple[dict, list[tuple[str, Path, str]]]:
    """Normalize every segment to one size/fps, concat, then lay the audio track and voice lines over it.

    plan: {width, height, fps, segments: [{file: {offset, size}, duration}],
           audio: {file?: {offset, size}, volume}, lines: [{file: {offset, size}, start, volume}]}
    """

    def report(text: str) -> None:
        if progress:
            progress(text)

    width = max(2, int(plan.get("width") or 720) // 2 * 2)
    height = max(2, int(plan.get("height") or 1280) // 2 * 2)
    fps = max(1, min(60, int(plan.get("fps") or 30)))
    segments = plan.get("segments") or []
    if not segments:
        raise RuntimeError("没有可合成的片段")
    parts: list[Path] = []
    total = 0.0
    for index, segment in enumerate(segments, start=1):
        report(f"统一片段格式 {index}/{len(segments)}")
        raw = _slice(bundle, segment["file"], work / f"raw-{index:04d}.bin")
        duration = max(0.1, float(segment.get("duration") or 0) or probe(raw)["duration"])
        part = work / f"part-{index:04d}.mp4"
        _run(
            [
                FFMPEG_BIN,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(raw),
                "-an",
                "-vf",
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},tpad=stop_mode=clone:stop_duration={duration:.3f}",
                "-t",
                f"{duration:.3f}",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                str(part),
            ]
        )
        parts.append(part)
        total += duration

    report("拼接片段")
    listing = work / "concat.txt"
    listing.write_text("".join(f"file '{part.as_posix()}'\n" for part in parts), encoding="utf-8")
    silent = work / "silent.mp4"
    _run([FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(silent)])

    report("混合音轨")
    inputs: list[str] = ["-i", str(silent)]
    filters: list[str] = []
    labels: list[str] = []
    audio = plan.get("audio") or {}
    if audio.get("file"):
        base = _slice(bundle, audio["file"], work / "base-audio.bin")
        inputs += ["-i", str(base)]
        volume = max(0.0, min(2.0, float(audio.get("volume", 1.0))))
        filters.append(f"[1:a]volume={volume:.3f},apad,atrim=0:{total:.3f}[base]")
        labels.append("[base]")
    for index, line in enumerate(plan.get("lines") or []):
        clip = _slice(bundle, line["file"], work / f"line-{index:04d}.bin")
        stream = len(inputs) // 2
        inputs += ["-i", str(clip)]
        delay = max(0, int(float(line.get("start") or 0) * 1000))
        volume = max(0.0, min(2.0, float(line.get("volume", 1.0))))
        filters.append(f"[{stream}:a]aresample=44100,volume={volume:.3f},adelay={delay}|{delay}[l{index}]")
        labels.append(f"[l{index}]")
    final = work / "final.mp4"
    if labels:
        filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:duration=longest:normalize=0,atrim=0:{total:.3f}[mix]")
        _run([FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(filters), "-map", "0:v", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final)])
    else:
        _run([FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y", "-i", str(silent), "-c", "copy", "-movflags", "+faststart", str(final)])
    return {"duration": round(total, 3), "segments": len(parts), "lines": len(plan.get("lines") or []), "width": width, "height": height, "fps": fps, "files": {"video": "final.mp4"}}, [("final.mp4", final, "video/mp4")]
