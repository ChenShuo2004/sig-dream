from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.material import Material, MaterialFile, NasJob
from app.services.sync_service import create_sync_operation, new_operation_id

VIDEO_EXTENSIONS = {"mp4", "mov", "mkv", "avi", "webm", "m4v"}
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp", "bmp"}


def _log(message: str) -> None:
    print(message, flush=True)


def _normalize_ext(row: MaterialFile) -> str:
    return str(row.extension or "").strip().lower().lstrip(".")


def _metadata(row: MaterialFile) -> dict:
    return dict(row.extra_metadata or {}) if isinstance(row.extra_metadata, dict) else {}


def _path_exists(path_text: str) -> bool:
    p = (path_text or "").strip()
    if not p:
        return False


def _is_derivative_thumb(path_text: str) -> bool:
    p = (path_text or "").replace("\\", "/").lower()
    return "/derivatives/" in p and p.endswith("_thumb.jpg")
    try:
        return Path(p).exists()
    except Exception:
        return False


def _should_handle(ext: str, *, images_only: bool, videos_only: bool) -> bool:
    if images_only:
        return ext in IMAGE_EXTENSIONS
    if videos_only:
        return ext in VIDEO_EXTENSIONS
    return ext in IMAGE_EXTENSIONS or ext in VIDEO_EXTENSIONS


def run(limit: int, *, images_only: bool, videos_only: bool) -> dict[str, int]:
    db = SessionLocal()
    stats = {"checked": 0, "image_bound": 0, "video_enqueued": 0, "video_skipped": 0, "stale_fixed": 0, "image_enqueued": 0}
    try:
        mode = "images-only" if images_only else "videos-only" if videos_only else "all(image-first)"
        _log(f"[preview-backfill] loading rows, limit={limit}, mode={mode} ...")
        rows = list(
            db.scalars(
                select(MaterialFile)
                .join(Material, Material.id == MaterialFile.material_id)
                .where(Material.status == "available", MaterialFile.file_role == "original")
                .order_by(MaterialFile.created_at.asc())
                .limit(max(1, limit))
            ).all()
        )
        total_rows = len(rows)
        _log(f"[preview-backfill] loaded rows={total_rows}, start scanning ...")
        image_rows: list[MaterialFile] = []
        video_rows: list[MaterialFile] = []
        for row in rows:
            ext = _normalize_ext(row)
            if not _should_handle(ext, images_only=images_only, videos_only=videos_only):
                continue
            if ext in IMAGE_EXTENSIONS:
                image_rows.append(row)
            elif ext in VIDEO_EXTENSIONS:
                video_rows.append(row)
        ordered_rows = [*image_rows, *video_rows]
        _log(
            "[preview-backfill] ordered targets: "
            f"images={len(image_rows)} videos={len(video_rows)} total={len(ordered_rows)}"
        )
        for row in ordered_rows:
            stats["checked"] += 1
            ext = _normalize_ext(row)
            meta = _metadata(row)
            thumb_path = str(meta.get("thumbnail_path") or "").strip()
            has_thumb = bool(thumb_path)
            thumb_exists = _path_exists(thumb_path)
            if has_thumb and not thumb_exists:
                stats["stale_fixed"] += 1

            if ext in IMAGE_EXTENSIONS:
                if has_thumb and thumb_exists and _is_derivative_thumb(thumb_path):
                    continue
                file_path = (row.file_path or "").strip()
                if not file_path:
                    continue
                if row.storage_type != "nas" and not _path_exists(file_path):
                    continue
                exists_job = db.scalar(
                    select(NasJob.id).where(
                        NasJob.job_type == "generate_derivatives",
                        NasJob.status.in_(("pending", "running")),
                        NasJob.payload["material_file_id"].astext == str(row.id),
                    )
                )
                if exists_job:
                    continue
                op_id = new_operation_id("syncop")
                op = create_sync_operation(
                    db,
                    operation_id=op_id,
                    operation_type="preview.backfill_generate",
                    target_type="material_file",
                    target_id=str(row.id),
                    status="sync_pending",
                    payload={"material_id": str(row.material_id), "material_file_id": str(row.id)},
                    max_retries=3,
                )
                db.add(
                    NasJob(
                        job_type="generate_derivatives",
                        payload={
                            "material_id": str(row.material_id),
                            "material_file_id": str(row.id),
                            "file_path": row.file_path,
                        },
                        status="pending",
                        sync_operation_id=op.id,
                        max_retries=3,
                    )
                )
                stats["image_enqueued"] += 1
                continue

            if ext in VIDEO_EXTENSIONS:
                if has_thumb and thumb_exists:
                    continue
                if row.storage_type != "nas" or not (row.file_path or "").strip():
                    stats["video_skipped"] += 1
                    continue
                exists_job = db.scalar(
                    select(NasJob.id).where(
                        NasJob.job_type == "generate_derivatives",
                        NasJob.status.in_(("pending", "running")),
                        NasJob.payload["material_file_id"].astext == str(row.id),
                    )
                )
                if exists_job:
                    continue
                op_id = new_operation_id("syncop")
                op = create_sync_operation(
                    db,
                    operation_id=op_id,
                    operation_type="preview.backfill_generate",
                    target_type="material_file",
                    target_id=str(row.id),
                    status="sync_pending",
                    payload={"material_id": str(row.material_id), "material_file_id": str(row.id)},
                    max_retries=3,
                )
                db.add(
                    NasJob(
                        job_type="generate_derivatives",
                        payload={
                            "material_id": str(row.material_id),
                            "material_file_id": str(row.id),
                            "file_path": row.file_path,
                        },
                        status="pending",
                        sync_operation_id=op.id,
                        max_retries=3,
                    )
                )
                stats["video_enqueued"] += 1
            if stats["checked"] % 200 == 0:
                _log(
                    "[preview-backfill] progress "
                    f"{stats['checked']}/{total_rows} | "
                    f"image_bound={stats['image_bound']} video_enqueued={stats['video_enqueued']} video_skipped={stats['video_skipped']}"
                )
        _log("[preview-backfill] scan done, committing ...")
        db.commit()
        _log("[preview-backfill] commit done.")
        return stats
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill preview binding/generation for existing materials.")
    parser.add_argument("--limit", type=int, default=50, help="Max rows to scan in one run")
    parser.add_argument("--images-only", action="store_true", help="Only process image files")
    parser.add_argument("--videos-only", action="store_true", help="Only process video files")
    args = parser.parse_args()
    if args.images_only and args.videos_only:
        raise SystemExit("--images-only and --videos-only cannot be used together")
    stats = run(limit=args.limit, images_only=args.images_only, videos_only=args.videos_only)
    print("[preview-backfill]")
    for k, v in stats.items():
        print(f"{k}={v}")


if __name__ == "__main__":
    main()
