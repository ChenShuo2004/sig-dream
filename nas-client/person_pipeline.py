"""Replacement-studio intake: smart_clip -> person_detect -> person_identify.

smart_clip   cut detection plus one keyframe per shot, chosen among a few
             candidates as the frame with the strongest person detections.
person_detect  YOLOX-S (OpenCV Zoo ONNX), person class only, conf 0.5, NMS 0.5,
             at most 32 people per keyframe.
person_identify  OSNet x0.25 MSMT17 (Torchreid weights, ONNX export) embeddings
             clustered across shots: auto 0.78, review 0.68, margin 0.06,
             max shot gap 2.

Models are downloaded on first use from the public repositories into
NAS_STUDIO_MODEL_DIR (default nas-client/models).
"""

from __future__ import annotations

import os
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import studio_media

MODEL_DIR = Path(os.getenv("NAS_STUDIO_MODEL_DIR", str(Path(__file__).resolve().parent / "models")))
DETECTOR_URL = os.getenv("NAS_YOLOX_URL", "https://huggingface.co/opencv/object_detection_yolox/resolve/main/object_detection_yolox_2022nov.onnx")
REID_URL = os.getenv("NAS_OSNET_URL", "https://huggingface.co/kornia/osnet/resolve/main/osnet_x0_25_msmt17.onnx")
DETECTOR_FILE = "yolox_s.onnx"
REID_FILE = "osnet_x0_25_msmt17.onnx"

DETECT_CONFIDENCE = 0.5
DETECT_NMS = 0.5
MAX_PERSONS = 32
MIN_BOX_FRACTION = 0.004
IDENTIFY_AUTO = 0.78
IDENTIFY_REVIEW = 0.68
IDENTIFY_MARGIN = 0.06
IDENTIFY_MAX_SHOT_GAP = 2
CANDIDATE_SPACING_SECONDS = 2.0
MIN_CANDIDATES = 3
MAX_CANDIDATES = 12
KEYFRAME_MAX_SIDE = 1280
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)

_sessions: dict[str, object] = {}


def _model_path(filename: str, url: str) -> Path:
    path = MODEL_DIR / filename
    if path.exists() and path.stat().st_size > 0:
        return path
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as handle:
        while chunk := response.read(1 << 20):
            handle.write(chunk)
    partial.replace(path)
    return path


def _session(filename: str, url: str):
    if filename not in _sessions:
        import onnxruntime as ort

        _sessions[filename] = ort.InferenceSession(str(_model_path(filename, url)), providers=["CPUExecutionProvider"])
    return _sessions[filename]


# ---------- person_detect ----------


class YoloxPersonDetector:
    size = 640
    strides = (8, 16, 32)

    def __init__(self) -> None:
        import numpy as np

        self.np = np
        self.session = _session(DETECTOR_FILE, DETECTOR_URL)
        self.input_name = self.session.get_inputs()[0].name
        grids, expanded = [], []
        for stride in self.strides:
            cells = self.size // stride
            ys, xs = np.meshgrid(np.arange(cells), np.arange(cells), indexing="ij")
            grids.append(np.stack((xs, ys), 2).reshape(-1, 2))
            expanded.append(np.full((cells * cells, 1), stride))
        self.grids = np.concatenate(grids).astype(np.float32)
        self.expanded = np.concatenate(expanded).astype(np.float32)

    def detect(self, image_bgr) -> list[dict]:
        import cv2

        np = self.np
        height, width = image_bgr.shape[:2]
        scale = min(self.size / height, self.size / width)
        resized = cv2.resize(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB), (int(width * scale), int(height * scale)), interpolation=cv2.INTER_LINEAR)
        padded = np.full((self.size, self.size, 3), 114, dtype=np.uint8)
        padded[: resized.shape[0], : resized.shape[1]] = resized
        blob = padded.transpose(2, 0, 1)[np.newaxis].astype(np.float32)
        output = self.session.run(None, {self.input_name: blob})[0][0]
        xy = (output[:, :2] + self.grids) * self.expanded
        wh = np.exp(output[:, 2:4]) * self.expanded
        scores = output[:, 4] * output[:, 5]
        keep = scores >= DETECT_CONFIDENCE
        if not keep.any():
            return []
        xy, wh, scores = xy[keep] / scale, wh[keep] / scale, scores[keep]
        boxes = [[float(cx - w / 2), float(cy - h / 2), float(w), float(h)] for (cx, cy), (w, h) in zip(xy, wh)]
        indexes = cv2.dnn.NMSBoxes(boxes, scores.tolist(), DETECT_CONFIDENCE, DETECT_NMS)
        persons = []
        for index in np.array(indexes).reshape(-1)[:MAX_PERSONS]:
            x, y, w, h = boxes[int(index)]
            x0, y0 = max(0.0, x), max(0.0, y)
            x1, y1 = min(float(width), x + w), min(float(height), y + h)
            if x1 - x0 < 2 or y1 - y0 < 2 or (x1 - x0) * (y1 - y0) < MIN_BOX_FRACTION * width * height:
                continue
            persons.append({"box": [x0 / width, y0 / height, (x1 - x0) / width, (y1 - y0) / height], "score": round(float(scores[int(index)]), 4)})
        persons.sort(key=lambda item: item["box"][2] * item["box"][3] * item["score"], reverse=True)
        return persons


def frame_score(persons: list[dict]) -> float:
    return sum(item["box"][2] * item["box"][3] * item["score"] for item in persons)


# ---------- person_identify ----------


class OsnetEmbedder:
    batch = 16

    def __init__(self) -> None:
        import numpy as np

        self.np = np
        self.session = _session(REID_FILE, REID_URL)
        model_input = self.session.get_inputs()[0]
        self.input_name = model_input.name
        fixed = model_input.shape[0]
        self.fixed_batch = fixed if isinstance(fixed, int) else 0

    def embed(self, crops_bgr: list) -> list:
        import cv2

        np = self.np
        if not crops_bgr:
            return []
        tensors = []
        for crop in crops_bgr:
            rgb = cv2.cvtColor(cv2.resize(crop, (128, 256), interpolation=cv2.INTER_LINEAR), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            tensors.append(((rgb - MEAN) / STD).transpose(2, 0, 1))
        stacked = np.stack(tensors).astype(np.float32)
        size = self.fixed_batch or self.batch
        features = []
        for start in range(0, len(stacked), size):
            chunk = stacked[start : start + size]
            count = len(chunk)
            if self.fixed_batch and count < size:
                chunk = np.concatenate([chunk, np.zeros((size - count, *chunk.shape[1:]), dtype=np.float32)])
            features.append(self.session.run(None, {self.input_name: chunk})[0][:count])
        matrix = np.concatenate(features)
        return list(matrix / np.clip(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-6, None))


@dataclass
class _Identity:
    id: str
    members: list = field(default_factory=list)
    shots: list[int] = field(default_factory=list)
    detections: list[str] = field(default_factory=list)
    review: bool = False
    suggested: str = ""


def identify_people(shots: list[dict], embeddings: dict[str, object]) -> list[dict]:
    """Cluster detections across shots in place; returns identity summaries."""
    import numpy as np

    identities: list[_Identity] = []
    for shot in shots:
        used: set[str] = set()
        for person in shot["persons"]:
            vector = embeddings.get(person["id"])
            if vector is None:
                continue
            ranked = []
            for identity in identities:
                if identity.id in used:
                    continue
                members = np.stack(identity.members[-20:])
                ranked.append((float(np.max(members @ vector)), identity))
            ranked.sort(key=lambda item: item[0], reverse=True)
            best, chosen = ranked[0] if ranked else (0.0, None)
            second = ranked[1][0] if len(ranked) > 1 else 0.0
            review = False
            if chosen and best >= IDENTIFY_AUTO and best - second >= IDENTIFY_MARGIN:
                target = chosen
            elif chosen and best >= IDENTIFY_REVIEW and shot["index"] - chosen.shots[-1] <= IDENTIFY_MAX_SHOT_GAP:
                target, review = chosen, True
            else:
                target = _Identity(id=f"p{len(identities) + 1}")
                if chosen and best >= IDENTIFY_REVIEW:
                    target.review, target.suggested = True, chosen.id
                identities.append(target)
            target.members.append(vector)
            if not target.shots or target.shots[-1] != shot["index"]:
                target.shots.append(shot["index"])
            target.detections.append(person["id"])
            target.review = target.review or review
            used.add(target.id)
            person.update(identity=target.id, similarity=round(best, 4) if target.members[:-1] else 1.0, review=review)

    by_id = {person["id"]: person for shot in shots for person in shot["persons"]}
    ordered = sorted(identities, key=lambda item: (-len(item.detections), item.shots[0]))
    rename = {identity.id: f"p{index + 1}" for index, identity in enumerate(ordered)}
    for person in by_id.values():
        if person.get("identity"):
            person["identity"] = rename[person["identity"]]
    summaries = []
    for identity in ordered:
        cover = max((by_id[ref] for ref in identity.detections), key=lambda item: item["box"][2] * item["box"][3] * item["score"])
        summaries.append(
            {
                "id": rename[identity.id],
                "count": len(identity.detections),
                "shots": identity.shots,
                "cover": cover["crop"],
                "review": identity.review,
                "suggested": rename.get(identity.suggested, ""),
            }
        )
    return summaries


# ---------- smart_clip + pipeline ----------


def _read_frame(capture, seconds: float):
    import cv2

    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, seconds) * 1000.0)
    ok, frame = capture.read()
    return frame if ok else None


def _limit(frame):
    import cv2

    height, width = frame.shape[:2]
    scale = min(1.0, KEYFRAME_MAX_SIDE / max(height, width))
    return frame if scale >= 1.0 else cv2.resize(frame, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)


def _crop(frame, box: list[float], pad: float = 0.06):
    height, width = frame.shape[:2]
    x, y, w, h = box
    x0 = int(max(0, (x - w * pad) * width))
    y0 = int(max(0, (y - h * pad) * height))
    x1 = int(min(width, (x + w * (1 + pad)) * width))
    y1 = int(min(height, (y + h * (1 + pad)) * height))
    return frame[y0:y1, x0:x1]


def extract_voice_audio(source: Path, target: Path) -> None:
    studio_media._run([studio_media.FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", str(target)])


def run_replacement_intake(source: Path, work: Path, options: dict, progress=None) -> tuple[dict, list[tuple[str, Path, str]]]:
    import cv2

    def report(text: str) -> None:
        if progress:
            progress(text)

    max_seconds = float(options.get("max_seconds") or 300)
    threshold = float(options.get("threshold") or 0.2)
    width = int(options.get("width") or 320)
    max_cuts = int(options.get("max_cuts") or 500)

    info = studio_media.probe(source)
    if info["duration"] <= 0:
        raise RuntimeError("无法读取视频时长")
    report("转码原片")
    video = work / "video.mp4"
    studio_media.transcode(source, video, max_seconds)
    probed = studio_media.probe(video)
    duration = probed["duration"] or min(info["duration"], max_seconds)
    outputs: list[tuple[str, Path, str]] = [("video.mp4", video, "video/mp4")]
    audio_name = ""
    if info["has_audio"]:
        audio = work / "audio.mp3"
        extract_voice_audio(video, audio)
        outputs.append(("audio.mp3", audio, "audio/mpeg"))
        audio_name = "audio.mp3"

    if isinstance(options.get("bounds"), list):
        cuts = sorted({round(float(cut), 3) for cut in options["bounds"] if 0.2 < float(cut) < duration - 0.2})
    elif options.get("skip_cuts"):
        cuts = []
    else:
        report("智能切镜")
        cuts = [cut for cut in studio_media.detect_cuts(video, threshold, width, max_cuts) if cut < duration - 0.2]
    bounds = [0.0, *cuts, duration]

    detector = YoloxPersonDetector()
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise RuntimeError("OpenCV 无法读取转码后的视频")
    shots: list[dict] = []
    crops: dict[str, object] = {}
    try:
        for index in range(len(bounds) - 1):
            start, end = bounds[index], bounds[index + 1]
            if end - start < 0.05:
                continue
            number = len(shots) + 1
            report(f"检测人物：第 {number}/{len(bounds) - 1} 个镜头")
            best = None
            count = max(MIN_CANDIDATES, min(MAX_CANDIDATES, int((end - start) / CANDIDATE_SPACING_SECONDS) + 1))
            for slot in range(count):
                at = min(end - 0.04, max(start + 0.04, start + (end - start) * (slot + 0.5) / count))
                frame = _read_frame(capture, at)
                if frame is None:
                    continue
                frame = _limit(frame)
                persons = detector.detect(frame)
                score = frame_score(persons)
                if best is None or score > best[0] + 1e-6:
                    best = (score, at, frame, persons)
            if best is None:
                continue
            _, at, frame, persons = best
            keyframe = f"keyframe-{number:04d}.jpg"
            cv2.imwrite(str(work / keyframe), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            outputs.append((keyframe, work / keyframe, "image/jpeg"))
            for order, person in enumerate(persons, start=1):
                person_id = f"s{number}-{order}"
                crop_name = f"person-{number:04d}-{order:02d}.jpg"
                crop = _crop(frame, person["box"])
                cv2.imwrite(str(work / crop_name), crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
                outputs.append((crop_name, work / crop_name, "image/jpeg"))
                crops[person_id] = _crop(frame, person["box"], pad=0.0)
                person.update(id=person_id, crop=crop_name)
            shots.append({"index": number, "start": round(start, 3), "end": round(end, 3), "keyframe": keyframe, "keyframeTime": round(at, 3), "persons": persons})
    finally:
        capture.release()

    for shot in shots:
        report(f"切出镜头片段 {shot['index']}/{len(shots)}")
        clip_name = f"clip-{shot['index']:04d}.mp4"
        studio_media.cut_clip(video, work / clip_name, shot["start"], shot["end"])
        outputs.append((clip_name, work / clip_name, "video/mp4"))
        shot["clip"] = clip_name

    report("跨镜头识别同一人物")
    ids = list(crops)
    embedder = OsnetEmbedder()
    embeddings = dict(zip(ids, embedder.embed([crops[ref] for ref in ids])))
    identities = identify_people(shots, embeddings)

    result = {
        "duration": round(duration, 3),
        "source_duration": round(info["duration"], 3),
        "truncated": info["duration"] > max_seconds + 0.05,
        "width": probed["width"] or info["width"],
        "height": probed["height"] or info["height"],
        "fps": info["fps"],
        "shots": shots,
        "cuts": cuts,
        "identities": identities,
        "files": {"video": "video.mp4", "audio": audio_name},
        "models": {"detector": "YOLOX-S (OpenCV Zoo 2022nov)", "reid": "OSNet x0.25 MSMT17"},
        "thresholds": {"confidence": DETECT_CONFIDENCE, "nms": DETECT_NMS, "maxPersons": MAX_PERSONS, "auto": IDENTIFY_AUTO, "review": IDENTIFY_REVIEW, "margin": IDENTIFY_MARGIN, "maxShotGap": IDENTIFY_MAX_SHOT_GAP},
    }
    return result, outputs
