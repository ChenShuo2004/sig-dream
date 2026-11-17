"""
为已入库、尚未记录 faststart 的 mp4/m4v/mov 主文件重新排队 generate_derivatives。

在 backend 目录下执行（需已配置数据库与 app 环境）：
  cd backend
  python scripts/enqueue_mp4_faststart_replay.py --limit 100
  python scripts/enqueue_mp4_faststart_replay.py --limit 5 --dry-run

NAS Worker 执行后会：抽缩略图 +（对 mp4/m4v/mov）原地 -movflags +faststart，
并通过 complete 写回 extra_metadata.faststart_remux 与 material_files.file_size/sha256。
"""

from __future__ import annotations

import argparse

from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.material import Material, MaterialFile, NasJob
from app.services.sync_service import create_sync_operation, new_operation_id

FASTSTART_EXT = frozenset({"mp4", "m4v", "mov"})


def _norm_ext(row: MaterialFile) -> str:
    return str(row.extension or "").strip().lower().lstrip(".")


def _already_faststarted(row: MaterialFile) -> bool:
    meta = row.extra_metadata
    if not isinstance(meta, dict):
        return False
    fsr = meta.get("faststart_remux")
    return isinstance(fsr, dict) and fsr.get("applied") is True


def run(*, limit: int, dry_run: bool) -> dict[str, int]:
    db = SessionLocal()
    stats = {"scanned": 0, "enqueued": 0, "skipped_applied": 0, "skipped_ext": 0, "skipped_pending": 0, "skipped_no_path": 0}
    try:
        batch = list(
            db.scalars(
                select(MaterialFile)
                .join(Material, Material.id == MaterialFile.material_id)
                .where(
                    Material.status == "available",
                    MaterialFile.file_role == "original",
                    MaterialFile.storage_type == "nas",
                )
                .order_by(MaterialFile.created_at.desc())
                .limit(max(500, limit * 50))
            ).all()
        )
        for row in batch:
            if stats["enqueued"] >= limit:
                break
            stats["scanned"] += 1
            ext = _norm_ext(row)
            if ext not in FASTSTART_EXT:
                stats["skipped_ext"] += 1
                continue
            if _already_faststarted(row):
                stats["skipped_applied"] += 1
                continue
            fp = (row.file_path or "").strip()
            if not fp:
                stats["skipped_no_path"] += 1
                continue
            exists_job = db.scalar(
                select(NasJob.id).where(
                    NasJob.job_type == "generate_derivatives",
                    NasJob.status.in_(("pending", "running")),
                    NasJob.payload["material_file_id"].astext == str(row.id),
                )
            )
            if exists_job:
                stats["skipped_pending"] += 1
                continue

            op_id = new_operation_id("syncop")
            op = create_sync_operation(
                db,
                operation_id=op_id,
                operation_type="preview.faststart_replay",
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
                        "file_path": fp.replace("\\", "/"),
                    },
                    status="pending",
                    sync_operation_id=op.id,
                    max_retries=3,
                )
            )
            stats["enqueued"] += 1
            print(
                f"[faststart-replay] enqueue material_file={row.id} ext={ext} path={fp[:80]}…",
                flush=True,
            )

        if dry_run:
            db.rollback()
            print("[faststart-replay] dry-run: rolled back", flush=True)
        else:
            db.commit()
            print("[faststart-replay] committed", flush=True)
        return stats
    finally:
        db.close()


def main() -> None:
    p = argparse.ArgumentParser(description="Enqueue generate_derivatives for mp4/m4v/mov without faststart_remux.")
    p.add_argument("--limit", type=int, default=50, help="Max jobs to enqueue")
    p.add_argument("--dry-run", action="store_true", help="Do not commit")
    args = p.parse_args()
    stats = run(limit=max(1, args.limit), dry_run=args.dry_run)
    for k, v in stats.items():
        print(f"{k}={v}", flush=True)


if __name__ == "__main__":
    main()
