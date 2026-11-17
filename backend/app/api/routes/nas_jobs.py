from datetime import datetime, timedelta, timezone
import glob
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
from uuid import UUID
from urllib.parse import quote_plus

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.engine.url import make_url
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    ROLE_MATERIAL_ADMIN,
    ROLE_SUPER_ADMIN,
    bearer_scheme,
    decode_access_token,
    ensure_roles,
    extract_bearer_token,
)
from app.core.database import get_db
from app.models.material import Material, MaterialFile, NasJob
from app.models.sync_operation import SyncOperation
from app.models.upload import UploadSession
from app.schemas.nas_job import (
    FileServiceHeartbeatRequest,
    FileServiceHeartbeatResponse,
    FileServiceNodeListResponse,
    FileServiceNodeRead,
    NasJobDeadletterActionRequest,
    NasJobPollResponse,
    NasJobProgressRequest,
    NasJobResultRequest,
    NasJobStatusResponse,
    NasQueueBoardResponse,
    NasQueueCount,
    NasQueueFileNode,
    NasQueueJob,
    SyncOperationRead,
    SyncOperationListResponse,
)
from app.services.file_service_public_infer_service import merge_public_bases_from_ingress
from app.services.file_service_registry_service import (
    count_healthy_nodes,
    list_nodes_for_admin,
    refresh_single_node_public_from_nas_ingress,
    resolve_lan_base_urls,
    revive_or_bootstrap_file_service_registry_on_poll,
    upsert_file_service_node,
)
from app.services.content_analysis_service import (
    mark_content_analysis_failed,
    store_content_analysis_result,
    update_content_analysis_progress,
)
from app.services.material_service import enqueue_generate_derivatives_if_applicable
from app.services.sync_service import mark_sync_operation, run_reconciliation, schedule_nas_job_retry
from app.services.settings_service import (
    ensure_permission,
    get_maintenance_status,
    set_maintenance_announcement,
    set_maintenance_mode,
)

router = APIRouter(prefix="/nas-jobs", tags=["nas-jobs"])
# 与 nas-client/worker.py 实际可执行类型一致（不含已废弃/未实现的 job_type）
_KNOWN_NAS_JOB_TYPES = frozenset(
    {
        "store_original",
        "prepare_download",
        "move_to_trash",
        "restore_from_trash",
        "generate_derivatives",
        "analyze_content",
        "lan_tts",
        "lan_asr",
        "lan_voice_convert",
        "lan_seedvc",
        "lan_svs_remake",
        "lan_comfy",
        "lan_voice_design",
        "lan_yue2",
        "ai007_forward",
        "replication_intake",
        "replacement_intake",
        "replacement_compose",
        "replacement_media",
    }
)
_NAMED_OUTPUT_JOB_TYPES = frozenset({"replication_intake", "replacement_intake", "replacement_compose", "replacement_media"})
# AI 歌曲 / 画布交互任务优先于大批量 store_original 入库，避免用户一直「排队等待」。
_INTERACTIVE_LAN_JOB_TYPES = frozenset(
    {
        "lan_yue2",
        "lan_tts",
        "lan_asr",
        "lan_voice_convert",
        "lan_seedvc",
        "lan_svs_remake",
        "lan_voice_design",
        "lan_comfy",
        "ai007_forward",
        "replication_intake",
        "replacement_intake",
        "replacement_compose",
        "replacement_media",
    }
)
_NAMED_OUTPUT_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(mp4|mp3|wav|jpg|png|json)$")
_last_reconcile_at: datetime | None = None
_last_client_poll_at: datetime | None = None
_reconcile_lock = threading.Lock()


def _ensure_client_token(x_nas_client_token: str | None = Header(default=None)) -> None:
    if x_nas_client_token != settings.nas_client_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid NAS client token")


def _get_job_or_404(db: Session, job_id: str) -> NasJob:
    try:
        uuid_value = UUID(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid job id") from exc
    job = db.get(NasJob, uuid_value)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="NAS job not found")
    return job


def _reap_stale_lan_yue2_jobs(db: Session) -> int:
    """Recover lan_yue2 rows claimed but never attached to a real YuE2 job.

    Typical cause: poll claimed the row, then the worker lost the response / died before
    POST /api/jobs on 8190. First soft miss → requeue pending; repeated miss → fail.
    """
    now = datetime.utcnow()
    # No yue2_job_id after claim → worker never reached GPU create.
    soft = now - timedelta(seconds=90)
    # Has yue2_job_id but never finished → hard ceiling (worker wait is 60m).
    hard = now - timedelta(minutes=70)
    changed = 0
    rows = (
        db.query(NasJob)
        .filter(NasJob.job_type == "lan_yue2", NasJob.status == "running")
        .order_by(NasJob.started_at.asc())
        .limit(50)
        .all()
    )
    for job in rows:
        started = job.started_at or job.created_at
        if started is None:
            continue
        result = job.result if isinstance(job.result, dict) else {}
        payload = job.payload if isinstance(job.payload, dict) else {}
        yue2_id = str(result.get("yue2_job_id") or "").strip()
        reclaim_count = int(payload.get("orphan_reclaim_count") or 0)
        if not yue2_id and started <= soft:
            if reclaim_count < 2:
                job.status = "pending"
                job.started_at = None
                job.finished_at = None
                job.error_message = None
                job.payload = {
                    **payload,
                    "orphan_reclaim_count": reclaim_count + 1,
                    "orphan_requeued_at": now.isoformat() + "Z",
                }
                # Keep stage hint empty so UI shows queued until a live worker ACKs.
                job.result = {}
                mark_sync_operation(db, job.sync_operation_id, status="pending", last_error=None)
                changed += 1
            else:
                job.status = "failed"
                job.finished_at = now
                job.error_message = (
                    "文件机多次领取后仍未在 YuE2 创建任务"
                    "（worker 可能未运行），已关闭。请确认本机 NAS worker 后重新提交。"
                )
                job.result = {**result, "non_retryable": True, "orphan_reaped": True}
                mark_sync_operation(db, job.sync_operation_id, status="failed", last_error=job.error_message)
                changed += 1
        elif yue2_id and started <= hard:
            job.status = "failed"
            job.finished_at = now
            job.error_message = (
                f"YuE2 任务 {yue2_id} 超过 70 分钟仍未回传完成，已自动关闭，请检查 88 上 YuE2 后重试。"
            )
            job.result = {**result, "non_retryable": True, "orphan_reaped": True}
            mark_sync_operation(db, job.sync_operation_id, status="failed", last_error=job.error_message)
            changed += 1
    return changed


def _reap_stale_bulk_running_jobs(db: Session) -> int:
    """Requeue bulk jobs stuck in running after worker death (days-old store_original etc.)."""
    now = datetime.utcnow()
    cutoff = now - timedelta(hours=6)
    bulk_types = (
        "store_original",
        "move_to_trash",
        "restore_from_trash",
        "prepare_download",
        "generate_derivatives",
        "analyze_content",
        "lan_comfy",
    )
    changed = 0
    rows = (
        db.query(NasJob)
        .filter(NasJob.job_type.in_(bulk_types), NasJob.status == "running")
        .filter(NasJob.started_at.isnot(None))
        .filter(NasJob.started_at <= cutoff)
        .order_by(NasJob.started_at.asc())
        .limit(80)
        .all()
    )
    for job in rows:
        payload = job.payload if isinstance(job.payload, dict) else {}
        reclaim = int(payload.get("stale_running_reclaim_count") or 0)
        if reclaim >= 3:
            job.status = "failed"
            job.finished_at = now
            job.error_message = "任务运行超过 6 小时未完成（疑似 worker 中断），已关闭，请重试。"
            job.result = {**(job.result if isinstance(job.result, dict) else {}), "non_retryable": True, "stale_reaped": True}
            mark_sync_operation(db, job.sync_operation_id, status="failed", last_error=job.error_message)
        else:
            job.status = "pending"
            job.started_at = None
            job.finished_at = None
            job.error_message = None
            job.payload = {**payload, "stale_running_reclaim_count": reclaim + 1}
            mark_sync_operation(db, job.sync_operation_id, status="pending", last_error=None)
        changed += 1
    return changed


@router.get("/poll", response_model=NasJobPollResponse | None)
def poll_nas_job(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
    job_types: str | None = Query(
        default=None,
        description="可选：逗号分隔的 job_type，仅领取这些类型（如 generate_derivatives）。与 exclude_job_types 二选一。",
    ),
    exclude_job_types: str | None = Query(
        default=None,
        description="可选：逗号分隔，不领取这些类型（如 generate_derivatives）。全量 worker 与缩略图专服并存时使用。",
    ),
) -> NasJobPollResponse | None:
    global _last_reconcile_at, _last_client_poll_at
    _last_client_poll_at = datetime.utcnow()
    pool = (settings.default_storage_pool_id or "default").strip() or "default"
    resolved_lan_up, resolved_lan_down = resolve_lan_base_urls(db, pool)
    refresh_single_node_public_from_nas_ingress(db, request)
    try:
        now = datetime.utcnow()
        reaped = _reap_stale_lan_yue2_jobs(db) + _reap_stale_bulk_running_jobs(db)
        if reaped:
            db.commit()
        should_reconcile = False
        with _reconcile_lock:
            if (_last_reconcile_at is None) or (now - _last_reconcile_at >= timedelta(minutes=30)):
                _last_reconcile_at = now
                should_reconcile = True
        if should_reconcile:
            _ = run_reconciliation(db, limit=200)
            db.commit()
        types_filter: list[str] | None = None
        exclude_filter: list[str] | None = None
        if job_types and job_types.strip():
            raw = [t.strip() for t in job_types.split(",") if t.strip()]
            unknown = [t for t in raw if t not in _KNOWN_NAS_JOB_TYPES]
            if unknown:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unknown job_types (allowed: {sorted(_KNOWN_NAS_JOB_TYPES)}): {unknown}",
                )
            types_filter = raw
        if exclude_job_types and exclude_job_types.strip():
            raw_ex = [t.strip() for t in exclude_job_types.split(",") if t.strip()]
            unknown_ex = [t for t in raw_ex if t not in _KNOWN_NAS_JOB_TYPES]
            if unknown_ex:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unknown exclude_job_types (allowed: {sorted(_KNOWN_NAS_JOB_TYPES)}): {unknown_ex}",
                )
            exclude_filter = raw_ex
        if types_filter and exclude_filter:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use either job_types or exclude_job_types, not both.",
            )
        stmt = select(NasJob).where(NasJob.status == "pending").where(
            (NasJob.next_retry_at.is_(None)) | (NasJob.next_retry_at <= datetime.utcnow())
        )
        if types_filter:
            stmt = stmt.where(NasJob.job_type.in_(types_filter))
        if exclude_filter:
            stmt = stmt.where(NasJob.job_type.not_in(exclude_filter))
        # Interactive LAN/AI jobs jump ahead of bulk NAS ingest backlog.
        priority = case((NasJob.job_type.in_(tuple(_INTERACTIVE_LAN_JOB_TYPES)), 0), else_=1)
        stmt = (
            stmt.order_by(priority.asc(), NasJob.created_at.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        job = db.scalar(stmt)
        if job is None:
            db.rollback()
            return None
        # Atomic claim: whoever polls first claims the job.
        job.status = "running"
        job.started_at = datetime.utcnow()
        mark_sync_operation(db, job.sync_operation_id, status="sync_running", last_error=None)
        if str(job.job_type or "") == "analyze_content":
            raw_file_id = (job.payload or {}).get("material_file_id")
            if isinstance(raw_file_id, str):
                try:
                    claimed_file = db.get(MaterialFile, UUID(raw_file_id))
                    if claimed_file is not None:
                        update_content_analysis_progress(db, claimed_file, step="claimed")
                except ValueError:
                    pass
        db.commit()
        db.refresh(job)
        return NasJobPollResponse(
            id=str(job.id),
            job_type=job.job_type,
            payload=job.payload,
            status=job.status,
            created_at=job.created_at,
        )
    except HTTPException:
        db.rollback()
        raise
    finally:
        try:
            revive_or_bootstrap_file_service_registry_on_poll(
                db,
                request,
                pool=pool,
                fallback_lan_up=resolved_lan_up,
                fallback_lan_down=resolved_lan_down,
            )
        except Exception:
            db.rollback()


@router.post("/{job_id}/progress")
def report_job_progress(
    job_id: str,
    payload: NasJobProgressRequest,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
) -> dict[str, str]:
    """文件机回写 analyze_content / lan_yue2 步骤；高频，不记操作日志。"""
    job = _get_job_or_404(db, job_id)
    job_type = str(job.job_type or "")
    if job_type in _NAMED_OUTPUT_JOB_TYPES:
        if str(job.status or "") not in {"pending", "running"}:
            return {"status": "ignored"}
        job.payload = {**(job.payload or {}), "progress": {"step": str(payload.step or "")[:40], "percent": payload.percent, "label": str(payload.label or "")[:200]}}
        db.commit()
        return {"status": "ok"}
    if job_type == "lan_yue2":
        if str(job.status or "") not in {"pending", "running"}:
            return {"status": "ignored"}
        current = job.result if isinstance(job.result, dict) else {}
        patch = payload.result_patch if isinstance(payload.result_patch, dict) else {}
        merged = {**current}
        for key, value in patch.items():
            if key in {"yue2_job_id", "stage", "progress", "summary", "kind", "endpoint"} and value is not None:
                merged[key] = value
        step = str(payload.step or "").strip()
        if step:
            merged["stage"] = step[:64]
        if payload.percent is not None:
            try:
                merged["progress"] = max(0.0, min(1.0, float(payload.percent) / 100.0))
            except (TypeError, ValueError):
                pass
        if payload.label:
            merged["progress_label"] = str(payload.label)[:200]
        job.result = merged
        db.commit()
        return {"status": "ok"}
    if job_type != "analyze_content":
        raise HTTPException(status_code=400, detail="Only analyze_content / lan_yue2 / named-output jobs report progress")
    if str(job.status or "") not in {"pending", "running"}:
        return {"status": "ignored"}
    raw_file_id = (job.payload or {}).get("material_file_id")
    if not isinstance(raw_file_id, str):
        return {"status": "ignored"}
    try:
        material_file = db.get(MaterialFile, UUID(raw_file_id))
    except ValueError:
        return {"status": "ignored"}
    if material_file is None:
        return {"status": "ignored"}
    update_content_analysis_progress(
        db,
        material_file,
        step=str(payload.step or "").strip() or "queued",
        percent=payload.percent,
        label=payload.label,
    )
    db.commit()
    return {"status": "ok"}


@router.get("/client-status")
def get_nas_client_status(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.view")
    now = datetime.utcnow()
    online_window_seconds = 45
    is_online = bool(_last_client_poll_at and (now - _last_client_poll_at).total_seconds() <= online_window_seconds)
    pool = (settings.default_storage_pool_id or "default").strip() or "default"
    up, down = resolve_lan_base_urls(db, pool)
    # 环境变量或「文件机注册表」任一能解析出成对 LAN 根地址即视为已配置
    lan_urls_configured = bool(up and down)
    healthy_nodes = count_healthy_nodes(db, pool)
    # 与 healthy_nodes 一致；前端亦在 healthy>0 时视为注册表在线，避免字段缺失导致误显示「仅环境变量」
    registry_active = healthy_nodes > 0
    # worker 轮询为进程内记忆，多 worker 时不可靠；文件机心跳在 DB，任一健康即视为直传侧就绪
    lan_direct_enabled = bool(lan_urls_configured or is_online or healthy_nodes > 0)
    transfer_ready = bool(is_online or healthy_nodes > 0)
    last_poll = None
    if _last_client_poll_at is not None:
        last_poll = _last_client_poll_at.replace(microsecond=0).isoformat() + "Z"
    return {
        "nas_client_online": is_online,
        "nas_client_last_poll_at": last_poll,
        "lan_direct_enabled": lan_direct_enabled,
        "transfer_ready": transfer_ready,
        "online_window_seconds": online_window_seconds,
        "default_storage_pool_id": pool,
        "file_service_healthy_nodes": healthy_nodes,
        "file_service_registry_active": registry_active,
        "file_service_stale_seconds": int(settings.file_service_node_stale_seconds),
        "message": "ok" if transfer_ready else "请联系管理员：NAS客户端或局域网直传未就绪",
    }


def _iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(microsecond=0).isoformat() + "Z"


def _iso_shanghai(value: datetime | None) -> str | None:
    """created_at 由数据库 now() 写入，会话时区是上海，列本身不带时区。"""
    if value is None:
        return None
    return value.replace(microsecond=0).isoformat() + "+08:00"


def _clip_error(message: str | None) -> str | None:
    text = " ".join((message or "").split())
    if not text:
        return None
    return text[:180]


def _queue_job(job: NasJob) -> NasQueueJob:
    return NasQueueJob(
        id=str(job.id),
        job_type=job.job_type,
        status=job.status,
        created_at=_iso_shanghai(job.created_at),
        started_at=_iso_utc(job.started_at),
        finished_at=_iso_utc(job.finished_at),
        retry_count=int(job.retry_count or 0),
        error_message=_clip_error(job.error_message),
    )


@router.get("/queue-board", response_model=NasQueueBoardResponse)
def get_nas_queue_board(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> NasQueueBoardResponse:
    """文件机心跳、任务进程轮询，以及正在执行和排队的任务。不含任务正文和文件路径。"""
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN, ROLE_MATERIAL_ADMIN})
    now = datetime.utcnow()
    shanghai = timezone(timedelta(hours=8))
    now_sh = now.replace(tzinfo=timezone.utc).astimezone(shanghai)
    start_sh = now_sh.replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = start_sh.astimezone(timezone.utc).replace(tzinfo=None)
    stale_seconds = int(settings.file_service_node_stale_seconds)
    online_window_seconds = 45
    poll_age = None
    if _last_client_poll_at is not None:
        poll_age = max(0, int((now - _last_client_poll_at).total_seconds()))
    worker_polling = poll_age is not None and poll_age <= online_window_seconds

    file_nodes: list[NasQueueFileNode] = []
    for row in list_nodes_for_admin(db, limit=50):
        age = None
        if row.last_seen_at is not None:
            age = max(0, int((now - row.last_seen_at).total_seconds()))
        file_nodes.append(
            NasQueueFileNode(
                node_id=row.node_id,
                pool_id=row.pool_id,
                status=row.status,
                healthy=row.status == "online" and age is not None and age <= stale_seconds,
                last_seen_at=_iso_utc(row.last_seen_at),
                age_seconds=age,
            )
        )
    file_ok = any(node.healthy for node in file_nodes)
    if file_ok and worker_polling:
        overall = "ok"
    elif file_ok:
        overall = "worker_down"
    elif worker_polling:
        overall = "file_down"
    else:
        overall = "down"

    open_rows = db.execute(
        select(NasJob.job_type, NasJob.status, func.count())
        .where(NasJob.status.in_(["pending", "running"]))
        .group_by(NasJob.job_type, NasJob.status)
    ).all()
    today_rows = db.execute(
        select(NasJob.job_type, NasJob.status, func.count())
        .where(NasJob.status.in_(["success", "failed"]))
        .where(NasJob.finished_at.is_not(None))
        .where(NasJob.finished_at >= start_utc)
        .group_by(NasJob.job_type, NasJob.status)
    ).all()
    buckets: dict[str, NasQueueCount] = {}

    def bucket(job_type: str) -> NasQueueCount:
        found = buckets.get(job_type)
        if found is None:
            found = NasQueueCount(job_type=job_type)
            buckets[job_type] = found
        return found

    for job_type, job_status, count in open_rows:
        item = bucket(str(job_type))
        if job_status == "pending":
            item.pending = int(count)
        elif job_status == "running":
            item.running = int(count)
    for job_type, job_status, count in today_rows:
        item = bucket(str(job_type))
        if job_status == "success":
            item.success_today = int(count)
        elif job_status == "failed":
            item.failed_today = int(count)
    queues = sorted(buckets.values(), key=lambda item: (-item.running, -item.pending, item.job_type))
    active = list(
        db.scalars(
            select(NasJob)
            .where(NasJob.status.in_(["pending", "running"]))
            .order_by(NasJob.status.desc(), NasJob.created_at.asc())
            .limit(150)
        ).all()
    )
    recent = list(
        db.scalars(
            select(NasJob)
            .where(NasJob.status.in_(["success", "failed"]))
            .where(NasJob.finished_at.is_not(None))
            .where(NasJob.finished_at >= start_utc)
            .order_by(NasJob.finished_at.desc())
            .limit(40)
        ).all()
    )
    return NasQueueBoardResponse(
        server_time=_iso_utc(now) or "",
        overall=overall,
        worker_polling=worker_polling,
        worker_last_poll_at=_iso_utc(_last_client_poll_at),
        worker_age_seconds=poll_age,
        worker_online_window_seconds=online_window_seconds,
        file_stale_seconds=stale_seconds,
        file_nodes=file_nodes,
        pending_total=sum(item.pending for item in queues),
        running_total=sum(item.running for item in queues),
        queues=queues,
        active_jobs=[_queue_job(job) for job in active],
        recent_jobs=[_queue_job(job) for job in recent],
    )


@router.post("/file-service/heartbeat", response_model=FileServiceHeartbeatResponse)
def file_service_heartbeat(
    payload: FileServiceHeartbeatRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
) -> FileServiceHeartbeatResponse:
    """文件机定时上报 LAN 上传/下载 HTTP 根地址（与 worker 共用 X-NAS-Client-Token）。未配 public_* 时可用入站公网 IP 推断单文件机公网直连根。"""
    try:
        pool_raw = payload.pool_id
        pool_arg = pool_raw.strip() if isinstance(pool_raw, str) and pool_raw.strip() else None
        pub_u, pub_d = merge_public_bases_from_ingress(
            lan_upload_base_url=payload.lan_upload_base_url,
            lan_download_base_url=payload.lan_download_base_url,
            public_upload_base_url=payload.public_upload_base_url,
            public_download_base_url=payload.public_download_base_url,
            request=request,
            infer_enabled=settings.file_service_infer_public_from_ingress,
        )
        row = upsert_file_service_node(
            db,
            pool_id=pool_arg or "",
            node_id=payload.node_id,
            lan_upload_base_url=payload.lan_upload_base_url,
            lan_download_base_url=payload.lan_download_base_url,
            status=str(payload.status or "online"),
            public_upload_base_url=pub_u or None,
            public_download_base_url=pub_d or None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return FileServiceHeartbeatResponse(pool_id=row.pool_id, node_id=row.node_id, status=row.status)


@router.get("/file-service-nodes", response_model=FileServiceNodeListResponse)
def list_file_service_nodes(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
) -> FileServiceNodeListResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN, ROLE_MATERIAL_ADMIN})
    rows = list_nodes_for_admin(db, limit=limit)
    items = [
        FileServiceNodeRead(
            id=str(r.id),
            pool_id=r.pool_id,
            node_id=r.node_id,
            lan_upload_base_url=r.lan_upload_base_url,
            lan_download_base_url=r.lan_download_base_url,
            public_upload_base_url=r.public_upload_base_url or "",
            public_download_base_url=r.public_download_base_url or "",
            status=r.status,
            last_seen_at=r.last_seen_at,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
    return FileServiceNodeListResponse(items=items)


@router.post("/{job_id}/start", response_model=NasJobPollResponse)
def start_job(
    job_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
) -> NasJobPollResponse:
    job = _get_job_or_404(db, job_id)
    if job.status not in {"pending", "running"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job is not startable")
    job.status = "running"
    job.started_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return NasJobPollResponse(
        id=str(job.id),
        job_type=job.job_type,
        payload=job.payload,
        status=job.status,
        created_at=job.created_at,
    )


@router.post("/{job_id}/complete")
def complete_job(
    job_id: str,
    payload: NasJobResultRequest,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
) -> dict[str, str]:
    job = _get_job_or_404(db, job_id)
    job.status = "success"
    job.result = payload.result or {}
    job.error_message = None
    job.finished_at = datetime.utcnow()
    job.is_deadletter = False
    payload_map = job.payload or {}
    canvas_asset_id = payload_map.get("canvas_asset_id")
    if isinstance(canvas_asset_id, str) and canvas_asset_id:
        from app.models.canvas_workspace import CanvasAsset

        canvas_asset = db.get(CanvasAsset, canvas_asset_id)
        if canvas_asset is not None:
            canvas_asset.status = "ready"
            rel = payload_map.get("target_rel_path")
            if isinstance(rel, str) and rel.strip():
                canvas_asset.nas_rel_path = rel.strip().replace("\\", "/")
            canvas_asset.updated_at = datetime.utcnow()
    studio_media_key = payload_map.get("studio_media_key")
    if isinstance(studio_media_key, str) and studio_media_key:
        from app.models.studio_media import StudioMediaObject

        studio_media = db.get(StudioMediaObject, studio_media_key)
        if studio_media is not None:
            from app.services.feature_media import mark_media_ready

            mark_media_ready(db, studio_media, payload_map.get("target_rel_path"))
    canvas_media_key = payload_map.get("canvas_media_key")
    if isinstance(canvas_media_key, str) and canvas_media_key:
        from app.models.canvas_media import CanvasMediaObject
        from app.services.feature_media import mark_media_ready

        canvas_media = db.get(CanvasMediaObject, canvas_media_key)
        if canvas_media is not None:
            mark_media_ready(db, canvas_media, payload_map.get("target_rel_path"))
    result_map = payload.result or {}
    job_type = str(job.job_type or "")
    material_id = payload_map.get("material_id") or result_map.get("material_id")
    material_file_id = payload_map.get("material_file_id") or result_map.get("material_file_id")
    upload_session_id = payload_map.get("upload_session_id")
    target_file = result_map.get("target_file")
    if isinstance(material_id, str):
        try:
            material_uuid = UUID(material_id)
            material = db.get(Material, material_uuid)
            if material is not None:
                if job_type in {"store_original", "restore_from_trash"}:
                    material.status = "available"
        except ValueError:
            pass
    if isinstance(material_file_id, str):
        try:
            material_file_uuid = UUID(material_file_id)
            material_file = db.get(MaterialFile, material_file_uuid)
            if material_file is not None:
                material_file.storage_type = "nas"
                # store_original：优先写入相对路径（与 NAS MOUNT 拼接），避免绝对盘符在 worker 与 ECS 间不一致导致 ffmpeg 找不到源文件、无法落 derivatives
                if job_type == "store_original":
                    rel = payload_map.get("target_rel_path")
                    if isinstance(rel, str) and rel.strip():
                        material_file.file_path = rel.strip().replace("\\", "/")
                    elif isinstance(target_file, str) and target_file.strip():
                        material_file.file_path = target_file.strip()
                elif isinstance(target_file, str) and target_file.strip():
                    material_file.file_path = target_file.strip()
                if job_type == "store_original":
                    enqueue_generate_derivatives_if_applicable(db, material_file)
                if job_type == "move_to_trash":
                    metadata = dict(material_file.extra_metadata or {})
                    restore_to_path = payload_map.get("restore_to_path")
                    if isinstance(restore_to_path, str) and restore_to_path.strip():
                        metadata["restore_to_path"] = restore_to_path.strip()
                    material_file.extra_metadata = metadata
                elif job_type == "restore_from_trash":
                    metadata = dict(material_file.extra_metadata or {})
                    metadata.pop("restore_to_path", None)
                    material_file.extra_metadata = metadata
                elif job_type == "analyze_content":
                    store_content_analysis_result(db, material_file, result_map)
                elif job_type == "generate_derivatives":
                    metadata = dict(material_file.extra_metadata or {})
                    thumbnail_path = result_map.get("thumbnail_path")
                    duration_seconds = result_map.get("duration_seconds")
                    if isinstance(thumbnail_path, str) and thumbnail_path.strip():
                        metadata["thumbnail_path"] = thumbnail_path.strip()
                    metadata.pop("preview_path", None)
                    if isinstance(duration_seconds, (float, int)):
                        metadata["duration_seconds"] = float(duration_seconds)
                    mw = result_map.get("media_width")
                    mh = result_map.get("media_height")
                    if isinstance(mw, (int, float)) and isinstance(mh, (int, float)):
                        iw, ih = int(mw), int(mh)
                        if iw > 0 and ih > 0:
                            metadata["media_width"] = iw
                            metadata["media_height"] = ih
                    pv_keys = (
                        "preview_video_path",
                        "preview_video_status",
                        "preview_video_duration",
                        "preview_video_codec",
                        "preview_video_audio",
                        "preview_video_error",
                    )
                    for k in pv_keys:
                        if k not in result_map:
                            continue
                        val = result_map.get(k)
                        if val is None:
                            continue
                        if k == "preview_video_duration" and isinstance(val, (float, int)):
                            metadata[k] = float(val)
                        elif isinstance(val, str):
                            metadata[k] = val.strip() if val.strip() else val
                        else:
                            metadata[k] = val
                    if str(result_map.get("preview_video_status") or "").strip().lower() == "success":
                        metadata.pop("preview_video_error", None)
                    fsr = result_map.get("faststart_remux")
                    if isinstance(fsr, dict):
                        metadata["faststart_remux"] = fsr
                    patch = result_map.get("storage_patch")
                    if isinstance(patch, dict):
                        fsz = patch.get("file_size")
                        if isinstance(fsz, int) and fsz >= 0:
                            material_file.file_size = fsz
                        hx = patch.get("sha256")
                        if isinstance(hx, str) and len(hx.strip()) == 64:
                            material_file.sha256 = hx.strip().lower()
                    material_file.extra_metadata = metadata
        except ValueError:
            pass
    if isinstance(upload_session_id, str):
        try:
            session_uuid = UUID(upload_session_id)
            session = db.get(UploadSession, session_uuid)
            if session is not None:
                if job_type == "store_original":
                    session.status = "ingested"
        except ValueError:
            pass
    mark_sync_operation(db, job.sync_operation_id, status="synced", last_error=None)
    # Cleanup temporary ECS source file after NAS write succeeds.
    source_path = (job.payload or {}).get("source_path")
    if job_type == "store_original" and isinstance(source_path, str) and source_path:
        source_file = Path(source_path)
        if source_file.exists():
            try:
                source_file.unlink()
            except Exception:
                pass
        # Best-effort cleanup for upload session temp directory.
        upload_root = source_file.parent.parent if source_file.parent.name == "merged" else None
        if upload_root and upload_root.exists():
            try:
                shutil.rmtree(upload_root)
            except Exception:
                pass
    db.commit()
    return {"status": "ok"}


@router.post("/{job_id}/fail")
def fail_job(
    job_id: str,
    payload: NasJobResultRequest,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
) -> dict[str, str]:
    job = _get_job_or_404(db, job_id)
    error_message = payload.error_message or "NAS job failed"
    job.result = payload.result or {}
    payload_map = job.payload or {}
    job_type = str(job.job_type or "")
    material_id = payload_map.get("material_id")
    material_file_id = payload_map.get("material_file_id")
    upload_session_id = payload_map.get("upload_session_id")
    if isinstance(material_id, str):
        try:
            material_uuid = UUID(material_id)
            material = db.get(Material, material_uuid)
            if material is not None:
                if job_type == "store_original":
                    material.status = "nas_failed"
                elif job_type == "restore_from_trash":
                    material.status = "trashed"
        except ValueError:
            pass
    if job_type == "analyze_content" and isinstance(material_file_id, str):
        try:
            analyzed_file = db.get(MaterialFile, UUID(material_file_id))
            if analyzed_file is not None:
                mark_content_analysis_failed(db, analyzed_file, error_message)
        except ValueError:
            pass
    if isinstance(upload_session_id, str):
        try:
            session_uuid = UUID(upload_session_id)
            session = db.get(UploadSession, session_uuid)
            if session is not None:
                if job_type == "store_original":
                    session.status = "nas_failed"
        except ValueError:
            pass
    non_retryable = bool((payload.result or {}).get("non_retryable")) if isinstance(payload.result, dict) else False
    if job_type == "analyze_content":
        non_retryable = True
    retryable_job_types = {"store_original", "move_to_trash", "prepare_download", "restore_from_trash", "generate_derivatives", "generate_preview", "analyze_content"}
    if (job_type in retryable_job_types) and not non_retryable:
        will_retry = schedule_nas_job_retry(db, job, error_message)
        if will_retry:
            db.commit()
            return {"status": "retrying"}
    job.status = "failed"
    job.error_message = error_message
    job.finished_at = datetime.utcnow()
    if job_type == "store_original":
        studio_media_key = payload_map.get("studio_media_key")
        if isinstance(studio_media_key, str) and studio_media_key:
            from app.models.studio_media import StudioMediaObject

            studio_media = db.get(StudioMediaObject, studio_media_key)
            if studio_media is not None:
                from app.services.feature_media import mark_media_failed

                mark_media_failed(db, studio_media)
        canvas_media_key = payload_map.get("canvas_media_key")
        if isinstance(canvas_media_key, str) and canvas_media_key:
            from app.models.canvas_media import CanvasMediaObject
            from app.services.feature_media import mark_media_failed

            canvas_media = db.get(CanvasMediaObject, canvas_media_key)
            if canvas_media is not None:
                mark_media_failed(db, canvas_media)
    mark_sync_operation(db, job.sync_operation_id, status="sync_failed", last_error=error_message)
    db.commit()
    return {"status": "failed"}


@router.get("/{job_id}/source")
def download_job_source(
    job_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
):
    job = _get_job_or_404(db, job_id)
    source_path = (job.payload or {}).get("source_path")
    if not isinstance(source_path, str):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job has no source_path")
    file_path = Path(source_path)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source file not found")
    return FileResponse(path=file_path, filename=file_path.name, media_type="application/octet-stream")


def _canvas_lan_root() -> Path:
    from app.api.routes.canvas_lan import canvas_lan_root

    return canvas_lan_root()


def _canvas_lan_file(job_id: str, name: str) -> Path:
    # Stored names look like image.png / reference.wav / last_frame.jpg.
    stem, dot, ext = name.partition(".")
    if dot and (not ext.isalnum() or "." in ext):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid input name")
    if not stem.replace("_", "").isalnum():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid input name")
    try:
        job_uuid = UUID(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid job id") from exc
    directory = (_canvas_lan_root() / str(job_uuid)).resolve()
    root = _canvas_lan_root().resolve()
    if directory.parent != root:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid job path")
    return directory / name


@router.get("/{job_id}/input/{name}")
def download_job_input(
    job_id: str,
    name: str,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
):
    job = _get_job_or_404(db, job_id)
    inputs = (job.payload or {}).get("inputs") or {}
    filename = inputs.get(name) if isinstance(inputs, dict) else None
    if not isinstance(filename, str) or not filename:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Input not found")
    file_path = _canvas_lan_file(job_id, Path(filename).name)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Input file not found")
    return FileResponse(path=file_path, filename=file_path.name, media_type="application/octet-stream")


@router.post("/{job_id}/output")
def upload_job_output(
    job_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
) -> dict[str, str]:
    job = _get_job_or_404(db, job_id)
    if str(job.job_type or "") not in {
        "lan_tts",
        "lan_voice_convert",
        "lan_seedvc",
        "lan_svs_remake",
        "lan_comfy",
        "ai007_forward",
        "lan_voice_design",
        "lan_yue2",
    }:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job does not accept output")
    suffix = Path(file.filename or "output.bin").suffix.lower()
    if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".mp4", ".webm", ".mov", ".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        if job.job_type == "lan_yue2":
            suffix = ".flac"
        elif job.job_type in {"lan_tts", "lan_voice_convert", "lan_seedvc", "lan_svs_remake", "lan_voice_design"}:
            suffix = ".wav"
        else:
            suffix = ".mp4"
    directory = _canvas_lan_root() / str(job.id)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"output{suffix}"
    with target.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)
    return {"status": "ok", "filename": target.name}


def named_output_path(job_id: str, name: str) -> Path:
    if not _NAMED_OUTPUT_PATTERN.match(name or ""):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid output name")
    return _canvas_lan_file(job_id, "outputs") / name


@router.post("/{job_id}/outputs/{name}")
def upload_named_job_output(
    job_id: str,
    name: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_client_token),
) -> dict[str, str]:
    job = _get_job_or_404(db, job_id)
    if str(job.job_type or "") not in _NAMED_OUTPUT_JOB_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job does not accept named outputs")
    target = named_output_path(job_id, name)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)
    return {"status": "ok", "filename": name}


@router.get("/{job_id}", response_model=NasJobStatusResponse)
def get_job_status(
    job_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> NasJobStatusResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    job = _get_job_or_404(db, job_id)
    return NasJobStatusResponse(
        id=str(job.id),
        job_type=job.job_type,
        status=job.status,
        result=job.result,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.get("/sync/deadletters", response_model=SyncOperationListResponse)
def list_sync_deadletters(
    status_filter: str = "sync_deadletter",
    limit: int = 100,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> SyncOperationListResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    rows = list(
        db.scalars(
            select(SyncOperation)
            .where(SyncOperation.status == status_filter)
            .order_by(SyncOperation.updated_at.desc())
            .limit(max(1, min(limit, 500)))
        ).all()
    )
    return SyncOperationListResponse(
        items=[
            SyncOperationRead(
                id=str(row.id),
                operation_id=row.operation_id,
                operation_type=row.operation_type,
                target_type=row.target_type,
                target_id=row.target_id,
                status=row.status,
                retry_count=row.retry_count,
                max_retries=row.max_retries,
                next_retry_at=row.next_retry_at,
                last_error=row.last_error,
                resolution_note=row.resolution_note,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ],
        total=len(rows),
    )


@router.post("/sync/{sync_operation_id}/action")
def sync_deadletter_action(
    sync_operation_id: str,
    payload: NasJobDeadletterActionRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    op = db.get(SyncOperation, UUID(sync_operation_id))
    if op is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync operation not found")
    if payload.action == "requeue":
        op.status = "sync_pending"
        op.next_retry_at = datetime.utcnow()
        op.last_error = None
        jobs = list(db.scalars(select(NasJob).where(NasJob.sync_operation_id == op.id)).all())
        for job in jobs:
            job.status = "pending"
            job.is_deadletter = False
            job.next_retry_at = datetime.utcnow()
            job.error_message = None
    elif payload.action == "resolved":
        op.status = "synced"
    else:
        op.status = "sync_failed"
    op.resolution_note = payload.note
    db.commit()
    return {"status": "ok"}


@router.post("/sync/reconcile")
def trigger_reconciliation(
    limit: int = 200,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    start = time.perf_counter()
    result = run_reconciliation(db, limit=max(10, min(limit, 1000)))
    db.commit()
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    return {
        **result,
        "elapsed_ms": elapsed_ms,
        "scope": "扫描 ECS 中 storage_type=nas 且 status=available 的素材文件，生成待修复同步任务",
    }


@router.get("/sync/maintenance-status")
def get_sync_maintenance_status(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    return get_maintenance_status(db)


@router.post("/sync/reconcile-with-maintenance")
def reconcile_with_maintenance(
    limit: int = 200,
    announcement: str = "系统维护中：正在执行手动对账，暂时禁止上传/删除/标签修改。",
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    started = time.perf_counter()
    maintenance_status_before = get_maintenance_status(db)
    set_maintenance_mode(
        db,
        enabled=True,
        announcement=announcement,
        operator_username=user.username,
    )
    try:
        result = run_reconciliation(db, limit=max(10, min(limit, 1000)))
        db.commit()
    finally:
        set_maintenance_mode(
            db,
            enabled=False,
            announcement=None,
            operator_username=user.username,
        )
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {
        **result,
        "elapsed_ms": elapsed_ms,
        "scope": "扫描 ECS 中 storage_type=nas 且 status=available 的素材文件，生成待修复同步任务",
        "maintenance_enabled_before": bool(maintenance_status_before.get("enabled")),
        "maintenance_announcement": announcement,
        "maintenance_auto_recovered": True,
    }


@router.post("/sync/maintenance-announcement/publish")
def publish_maintenance_announcement(
    announcement: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    return set_maintenance_announcement(
        db,
        announcement=announcement,
        published=True,
        operator_username=user.username,
    )


@router.post("/sync/maintenance-announcement/withdraw")
def withdraw_maintenance_announcement(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    current = get_maintenance_status(db)
    return set_maintenance_announcement(
        db,
        announcement=str(current.get("announcement") or ""),
        published=False,
        operator_username=user.username,
    )


def _build_pg_conn_env_and_url() -> tuple[dict[str, str], str, str]:
    db_url = make_url(settings.database_url)
    if not str(db_url.drivername).startswith("postgresql"):
        raise HTTPException(status_code=400, detail="Only PostgreSQL export/import is supported")
    host = str(db_url.host or "127.0.0.1")
    port = str(db_url.port or 5432)
    user = str(db_url.username or "postgres")
    password = str(db_url.password or "")
    dbname = str(db_url.database or "")
    if not dbname:
        raise HTTPException(status_code=400, detail="Invalid database name")
    env = os.environ.copy()
    env["PGHOST"] = host
    env["PGPORT"] = port
    env["PGUSER"] = user
    if password:
        env["PGPASSWORD"] = password
    safe_url = f"postgresql://{quote_plus(user)}:***@{host}:{port}/{dbname}"
    tool_url = f"postgresql://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{quote_plus(dbname)}"
    return env, safe_url, tool_url


def _discover_postgres_container_names() -> list[str]:
    configured = settings.postgres_tools_container_name.strip()
    if configured:
        return [configured]
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except FileNotFoundError:
        return []
    if result.returncode != 0:
        return []
    names = [line.strip() for line in result.stdout.decode("utf-8", errors="ignore").splitlines() if line.strip()]
    preferred = [n for n in names if ("postgres" in n.lower() or "pgsql" in n.lower() or n.lower().endswith("db"))]
    return preferred or names


def _find_pg_tool(tool_name: str) -> str | None:
    direct = shutil.which(tool_name)
    if direct:
        return direct
    candidates = sorted(glob.glob(f"/usr/lib/postgresql/*/bin/{tool_name}"), reverse=True)
    for path in candidates:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def _pg_dump_to_file_with_fallback(output_file: Path, env: dict[str, str], tool_url: str) -> None:
    direct_err = ""
    pg_dump_bin = _find_pg_tool("pg_dump")
    if pg_dump_bin:
        with output_file.open("wb") as fp:
            result = subprocess.run(
                [pg_dump_bin, "--clean", "--if-exists", "--no-owner", "--no-privileges", tool_url],
                env=env,
                stdout=fp,
                stderr=subprocess.PIPE,
                check=False,
            )
        if result.returncode == 0:
            return
        direct_err = result.stderr.decode("utf-8", errors="ignore").strip()
    else:
        direct_err = "pg_dump not found on ECS server"

    candidates = _discover_postgres_container_names()
    for name in candidates:
        with output_file.open("wb") as fp:
            result = subprocess.run(
                ["docker", "exec", "-i", name, "pg_dump", "--clean", "--if-exists", "--no-owner", "--no-privileges", tool_url],
                stdout=fp,
                stderr=subprocess.PIPE,
                check=False,
            )
        if result.returncode == 0:
            return
        direct_err = result.stderr.decode("utf-8", errors="ignore").strip() or direct_err

    raise HTTPException(
        status_code=500,
        detail=f"pg_dump unavailable. direct_or_docker_failed: {direct_err or 'unknown error'}. "
        "请在 Ubuntu 执行：sudo apt-get update && sudo apt-get install -y postgresql-client，"
        "或配置 POSTGRES_TOOLS_CONTAINER_NAME。",
    )


def _psql_restore_with_fallback(sql_file: Path, env: dict[str, str], tool_url: str) -> None:
    direct_err = ""
    psql_bin = _find_pg_tool("psql")
    if psql_bin:
        result = subprocess.run(
            [psql_bin, tool_url, "-v", "ON_ERROR_STOP=1", "-f", str(sql_file)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode == 0:
            return
        direct_err = result.stderr.decode("utf-8", errors="ignore").strip()
    else:
        direct_err = "psql not found on ECS server"

    sql_bytes = sql_file.read_bytes()
    candidates = _discover_postgres_container_names()
    for name in candidates:
        result = subprocess.run(
            ["docker", "exec", "-i", name, "psql", tool_url, "-v", "ON_ERROR_STOP=1", "-f", "-"],
            input=sql_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode == 0:
            return
        direct_err = result.stderr.decode("utf-8", errors="ignore").strip() or direct_err

    raise HTTPException(
        status_code=500,
        detail=f"psql restore unavailable. direct_or_docker_failed: {direct_err or 'unknown error'}. "
        "请在 Ubuntu 执行：sudo apt-get update && sudo apt-get install -y postgresql-client，"
        "或配置 POSTGRES_TOOLS_CONTAINER_NAME。",
    )


@router.get("/sync/db/export")
def export_ecs_database(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> FileResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    env, _, tool_url = _build_pg_conn_env_and_url()
    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    tmp_file = Path(tempfile.gettempdir()) / f"ecs-db-backup-{ts}.sql"
    _pg_dump_to_file_with_fallback(tmp_file, env, tool_url)
    return FileResponse(
        path=tmp_file,
        filename=tmp_file.name,
        media_type="application/sql",
        background=None,
    )


@router.post("/sync/db/import")
async def import_ecs_database(
    backup_file: UploadFile = File(...),
    auto_backup_before_import: bool = True,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> JSONResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_roles(user, {ROLE_SUPER_ADMIN})
    env, safe_url, tool_url = _build_pg_conn_env_and_url()
    suffix = Path(backup_file.filename or "backup.sql").suffix or ".sql"
    tmp_file = Path(tempfile.gettempdir()) / f"ecs-db-restore-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}{suffix}"
    content = await backup_file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded backup file is empty")
    tmp_file.write_bytes(content)
    pre_backup_file: Path | None = None
    try:
        if auto_backup_before_import:
            pre_backup_file = Path(tempfile.gettempdir()) / f"ecs-db-pre-import-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.sql"
            _pg_dump_to_file_with_fallback(pre_backup_file, env, tool_url)
        _psql_restore_with_fallback(tmp_file, env, tool_url)
    finally:
        try:
            tmp_file.unlink(missing_ok=True)
        except Exception:
            pass
    return JSONResponse(
        {
            "status": "ok",
            "message": "数据库导入完成",
            "database": safe_url,
            "filename": backup_file.filename or tmp_file.name,
            "auto_backup_before_import": auto_backup_before_import,
            "pre_import_backup_file": str(pre_backup_file) if pre_backup_file else None,
        }
    )
