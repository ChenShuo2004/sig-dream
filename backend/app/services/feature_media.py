"""NAS copies owned by a creation feature, separate from the material library.

A canvas, studio project, workbench log, or voice record points at these files.
Deleting the record moves the NAS file to trash. A file the user also saved into
the material library is marked pinned and is left in place.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.canvas_media import CanvasMediaObject
from app.models.canvas_workspace import CanvasDocument
from app.models.material import NasJob
from app.models.studio_media import StudioMediaObject
from app.models.studio_project import StudioProject
from app.models.voice_record import VoiceRecord
from app.models.workbench_record import WorkbenchRecord

CANVAS_KEY_RE = re.compile(r"^(image|video|audio|file):[A-Za-z0-9_-]{6,80}$")
STUDIO_KEY_RE = re.compile(r"^studio-(image|video|audio):[A-Za-z0-9_-]{8,64}$")
FRESH_SECONDS = 120


def collect_matching_keys(value: object, pattern: re.Pattern[str], out: set[str], depth: int = 0) -> None:
    if depth > 14 or value is None:
        return
    if isinstance(value, str):
        if pattern.fullmatch(value):
            out.add(value)
        return
    if isinstance(value, list):
        for item in value:
            collect_matching_keys(item, pattern, out, depth + 1)
        return
    if isinstance(value, dict):
        for item in value.values():
            collect_matching_keys(item, pattern, out, depth + 1)


def referenced_canvas_media_keys(db: Session, owner: str) -> set[str]:
    keys: set[str] = set()
    documents = db.scalars(select(CanvasDocument.document).where(CanvasDocument.owner == owner, CanvasDocument.deleted_at.is_(None)))
    for document in documents:
        collect_matching_keys(document, CANVAS_KEY_RE, keys)
    records = db.scalars(select(WorkbenchRecord.document).where(WorkbenchRecord.owner == owner, WorkbenchRecord.deleted_at.is_(None)))
    for document in records:
        collect_matching_keys(document, CANVAS_KEY_RE, keys)
    voices = db.scalars(select(VoiceRecord.document).where(VoiceRecord.owner == owner, VoiceRecord.deleted_at.is_(None)))
    for document in voices:
        collect_matching_keys(document, CANVAS_KEY_RE, keys)
    return keys


def referenced_studio_keys(db: Session, owner: str) -> set[str]:
    keys: set[str] = set()
    documents = db.scalars(select(StudioProject.document).where(StudioProject.owner == owner, StudioProject.deleted_at.is_(None)))
    for document in documents:
        collect_matching_keys(document, STUDIO_KEY_RE, keys)
    return keys


def release_unreferenced_canvas_media(db: Session, owner: str, immediate_keys: set[str] | None = None) -> None:
    keep = referenced_canvas_media_keys(db, owner)
    rows = db.scalars(select(CanvasMediaObject).where(CanvasMediaObject.owner == owner)).all()
    for row in rows:
        if row.pinned or row.media_key in keep:
            continue
        if _is_fresh(row.updated_at) and (immediate_keys is None or row.media_key not in immediate_keys):
            continue
        _retire(db, row)


def release_unreferenced_studio_media(db: Session, owner: str, immediate_keys: set[str] | None = None) -> None:
    keep = referenced_studio_keys(db, owner)
    rows = db.scalars(select(StudioMediaObject).where(StudioMediaObject.owner == owner)).all()
    for row in rows:
        if row.media_key in keep:
            continue
        if _is_fresh(row.updated_at) and (immediate_keys is None or row.media_key not in immediate_keys):
            continue
        _retire(db, row)


def mark_media_ready(db: Session, row: CanvasMediaObject | StudioMediaObject, rel: object) -> None:
    if isinstance(rel, str) and rel.strip():
        row.nas_rel_path = rel.strip().replace("\\", "/")
    if row.status == "deleting":
        _unlink(row.source_path)
        if row.nas_rel_path:
            _enqueue_trash(db, row.nas_rel_path)
        db.delete(row)
        return
    row.status = "ready"
    row.updated_at = datetime.utcnow()


def mark_media_failed(db: Session, row: CanvasMediaObject | StudioMediaObject) -> None:
    if row.status == "deleting":
        _unlink(row.source_path)
        db.delete(row)
        return
    row.status = "failed"
    row.updated_at = datetime.utcnow()


def _is_fresh(updated_at: datetime | None) -> bool:
    if updated_at is None:
        return False
    return (datetime.utcnow() - updated_at).total_seconds() < FRESH_SECONDS


def _retire(db: Session, row: CanvasMediaObject | StudioMediaObject) -> None:
    _unlink(row.source_path)
    if row.nas_rel_path and row.status == "ready":
        _enqueue_trash(db, row.nas_rel_path)
        db.delete(row)
        return
    if row.status == "pending":
        row.status = "deleting"
        row.updated_at = datetime.utcnow()
        return
    db.delete(row)


def _unlink(path: str | None) -> None:
    if not path:
        return
    Path(path).unlink(missing_ok=True)


def _enqueue_trash(db: Session, rel_path: str) -> None:
    db.add(
        NasJob(
            id=uuid.uuid4(),
            job_type="move_to_trash",
            payload={"file_path": rel_path, "feature_media": True},
            status="pending",
            max_retries=3,
        )
    )
