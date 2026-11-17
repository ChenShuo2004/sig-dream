import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.material import Material, MaterialFile, NasJob
from app.models.sync_operation import SyncOperation

_RETRY_BACKOFF_SECONDS = (60, 300, 900, 3600, 21600)


def new_operation_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def create_sync_operation(
    db: Session,
    *,
    operation_id: str,
    operation_type: str,
    target_type: str,
    target_id: str | None,
    status: str = "sync_pending",
    payload: dict | None = None,
    max_retries: int = 8,
) -> SyncOperation:
    row = SyncOperation(
        operation_id=operation_id,
        operation_type=operation_type,
        target_type=target_type,
        target_id=target_id,
        status=status,
        payload=payload or {},
        max_retries=max_retries,
    )
    db.add(row)
    db.flush()
    return row


def mark_sync_operation(
    db: Session,
    operation_id: uuid.UUID | None,
    *,
    status: str,
    last_error: str | None = None,
    resolution_note: str | None = None,
    retry_count: int | None = None,
    next_retry_at: datetime | None = None,
) -> None:
    if not operation_id:
        return
    row = db.get(SyncOperation, operation_id)
    if row is None:
        return
    row.status = status
    row.last_error = last_error
    if resolution_note is not None:
        row.resolution_note = resolution_note
    if retry_count is not None:
        row.retry_count = retry_count
    row.next_retry_at = next_retry_at


def compute_next_retry(retry_count: int) -> datetime:
    idx = min(max(retry_count - 1, 0), len(_RETRY_BACKOFF_SECONDS) - 1)
    return datetime.utcnow() + timedelta(seconds=_RETRY_BACKOFF_SECONDS[idx])


def schedule_nas_job_retry(db: Session, job: NasJob, error_message: str) -> bool:
    next_retry_count = int(job.retry_count or 0) + 1
    if next_retry_count > int(job.max_retries or 8):
        job.status = "failed"
        job.error_message = error_message
        job.is_deadletter = True
        job.finished_at = datetime.utcnow()
        mark_sync_operation(
            db,
            job.sync_operation_id,
            status="sync_deadletter",
            last_error=error_message,
            retry_count=next_retry_count,
        )
        return False
    next_retry_at = compute_next_retry(next_retry_count)
    job.status = "pending"
    job.retry_count = next_retry_count
    job.next_retry_at = next_retry_at
    job.error_message = error_message
    job.started_at = None
    job.finished_at = None
    mark_sync_operation(
        db,
        job.sync_operation_id,
        status="sync_pending",
        last_error=error_message,
        retry_count=next_retry_count,
        next_retry_at=next_retry_at,
    )
    return True


def run_reconciliation(db: Session, limit: int = 200) -> dict[str, int]:
    created = 0
    checked = 0

    rows = list(
        db.scalars(
            select(MaterialFile)
            .join(Material, Material.id == MaterialFile.material_id)
            .where(MaterialFile.storage_type == "nas", Material.status == "available")
            .limit(limit)
        ).all()
    )
    for file_row in rows:
        checked += 1
        path = (file_row.file_path or "").strip()
        if not path:
            continue
        existing = db.scalar(
            select(SyncOperation).where(
                SyncOperation.operation_type == "reconcile.material_file",
                SyncOperation.target_type == "material_file",
                SyncOperation.target_id == str(file_row.id),
                SyncOperation.status.in_(["sync_pending", "sync_running"]),
            )
        )
        if existing is None:
            create_sync_operation(
                db,
                operation_id=new_operation_id("reconcile"),
                operation_type="reconcile.material_file",
                target_type="material_file",
                target_id=str(file_row.id),
                status="sync_pending",
                payload={"material_id": str(file_row.material_id), "file_path": file_row.file_path},
            )
            created += 1
    return {"checked": checked, "created": created}
