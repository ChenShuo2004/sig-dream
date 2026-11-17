#!/usr/bin/env python3
"""为缺少浏览器预览 MP4 或预览失败的视频素材排队 generate_derivatives（与 Worker 扩展逻辑一致）。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import select  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.material import Material, MaterialFile, NasJob  # noqa: E402
from app.services.sync_service import create_sync_operation, new_operation_id  # noqa: E402

VIDEO_EXTENSIONS = frozenset({"mp4", "mov", "mkv", "avi", "webm", "m4v"})


def _meta(row: MaterialFile) -> dict:
    return dict(row.extra_metadata or {}) if isinstance(row.extra_metadata, dict) else {}


def run(*, limit: int, dry_run: bool) -> dict[str, int]:
    db = SessionLocal()
    stats = {"scanned": 0, "enqueued": 0, "skipped_has_preview": 0, "skipped_job_pending": 0, "skipped_not_nas": 0}
    try:
        rows = list(
            db.scalars(
                select(MaterialFile)
                .join(Material, Material.id == MaterialFile.material_id)
                .where(Material.status == "available", MaterialFile.file_role == "original")
                .order_by(MaterialFile.created_at.asc())
                .limit(max(1, limit))
            ).all()
        )
        for row in rows:
            stats["scanned"] += 1
            ext = str(row.extension or "").lower().lstrip(".")
            if ext not in VIDEO_EXTENSIONS:
                continue
            if row.storage_type != "nas" or not (row.file_path or "").strip():
                stats["skipped_not_nas"] += 1
                continue
            meta = _meta(row)
            pv_path = str(meta.get("preview_video_path") or "").strip()
            pv_status = str(meta.get("preview_video_status") or "").strip().lower()
            needs_preview = (not pv_path) or (pv_status == "failed")
            if not needs_preview:
                stats["skipped_has_preview"] += 1
                continue
            exists_job = db.scalar(
                select(NasJob.id).where(
                    NasJob.job_type == "generate_derivatives",
                    NasJob.status.in_(("pending", "running")),
                    NasJob.payload["material_file_id"].astext == str(row.id),
                )
            )
            if exists_job:
                stats["skipped_job_pending"] += 1
                continue
            if dry_run:
                stats["enqueued"] += 1
                continue
            op_id = new_operation_id("pv_enqueue")
            op = create_sync_operation(
                db,
                operation_id=op_id,
                operation_type="preview_video.enqueue_backfill",
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
                        "file_path": (row.file_path or "").strip().replace("\\", "/"),
                    },
                    status="pending",
                    sync_operation_id=op.id,
                    max_retries=3,
                )
            )
            stats["enqueued"] += 1
        db.commit()
    finally:
        db.close()
    return stats


def main() -> None:
    p = argparse.ArgumentParser(description="Enqueue generate_derivatives for videos missing preview_video or with preview_video_status=failed.")
    p.add_argument("--limit", type=int, default=500, help="最多扫描的 material_files 行数（含非视频，会跳过）")
    p.add_argument("--dry-run", action="store_true", help="只统计不入队")
    args = p.parse_args()
    stats = run(limit=args.limit, dry_run=args.dry_run)
    print(stats, flush=True)


if __name__ == "__main__":
    main()
