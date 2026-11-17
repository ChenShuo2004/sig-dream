import base64
import hashlib
import hmac
import json
import shutil
from mimetypes import guess_type
from pathlib import Path
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config import settings
from app.core.security import (
    bearer_scheme,
    decode_access_token,
    ensure_internal_access,
    extract_bearer_token,
    resolve_access_context,
)
from app.schemas.collection import MaterialCollectRequest, MaterialCollectResponse
from app.schemas.material import (
    MaterialCreate,
    MaterialDetailRead,
    MaterialPermanentDeleteResponse,
    MaterialDownloadPrepareResponse,
    MaterialDownloadPrepareStatusResponse,
    MaterialDownloadTicketReportRequest,
    MaterialDownloadRouteResponse,
    MaterialDownloadTicketResponse,
    MaterialThumbnailUrlResponse,
    MaterialPreviewVideoUrlResponse,
    MaterialDownloadTicketVerifyResponse,
    MaterialLanUploadTicketCreateRequest,
    MaterialLanUploadTicketReportRequest,
    MaterialLanUploadTicketResponse,
    MaterialLanUploadTicketVerifyResponse,
    MaterialIngestFromNasRequest,
    MaterialIngestFromNasResponse,
    MaterialStoragePoolPatchRequest,
    MaterialPatchRequest,
    MaterialListResponse,
    MaterialFacetTagIdsResponse,
    DesktopMetadataSyncResponse,
    DesktopMetadataSyncTag,
    DesktopMetadataSyncMaterial,
    DesktopMetadataSyncFile,
    MaterialUsageListResponse,
    MaterialUsageRead,
    MaterialRead,
    UnorganizedApplySuggestionsRequest,
    UnorganizedBatchActionResponse,
    UnorganizedBatchAnalyzeRequest,
    UnorganizedBatchMarkRequest,
    UnorganizedBatchTagRequest,
    UnorganizedBatchTrashRequest,
    UnorganizedMaterialListResponse,
    UnorganizedMaterialRead,
    MaterialDownloadClientReportRequest,
    MaterialDownloadClientReportResponse,
)
from app.models.material import Material, NasJob
from app.services.library_service import library_id_for_code, resolve_library_code
from app.services.collection_service import collect_material_to_collection
from app.services.content_analysis_service import (
    apply_content_analysis_suggestions,
    enqueue_content_analysis,
)
from app.services.material_service import (
    create_material,
    batch_add_tags_and_remove_unorganized,
    batch_mark_unorganized_materials,
    batch_trash_unorganized_materials,
    get_material,
    get_material_file,
    ingest_material_from_nas,
    list_materials,
    list_distinct_active_tag_ids_for_material_filters,
    list_unorganized_materials,
    list_material_usages,
    permanently_delete_material,
    patch_material_fields,
    patch_material_storage_pool,
    record_material_download_usage,
    restore_material,
    serialize_material,
    soft_delete_material,
)
from app.services.desktop_sync_service import build_desktop_metadata_sync_page, list_active_tags_for_desktop_sync
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import ensure_permission, get_user_permissions
from app.services.upload_service import live_original_material_exists_by_sha256
from app.services.sync_service import create_sync_operation, new_operation_id
from app.services.file_service_registry_service import (
    first_base_url,
    refresh_single_node_public_from_nas_ingress,
    resolve_lan_base_urls,
    resolve_public_base_urls,
    split_base_urls,
)

router = APIRouter(prefix="/materials", tags=["materials"])
def _request_meta(request: Request | None) -> dict[str, str | None]:
    if request is None:
        return {"ip_address": None, "user_agent": None}
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }


_DOWNLOAD_CACHE_ROOT = Path(__file__).resolve().parents[2] / "data" / "download_cache"


def _ensure_nas_client_token(x_nas_client_token: str | None = Header(default=None)) -> None:
    if x_nas_client_token != settings.nas_client_token:
        raise HTTPException(status_code=401, detail="Invalid NAS client token")


def _material_storage_pool_id(material: Material) -> str:
    pid = getattr(material, "storage_pool_id", None)
    if isinstance(pid, str) and pid.strip():
        return pid.strip()
    return (settings.default_storage_pool_id or "default").strip() or "default"


def _lan_roots_for_material(db: Session, material: Material) -> tuple[str, str]:
    return resolve_lan_base_urls(db, _material_storage_pool_id(material))


_PREVIEWABLE_STATUSES = frozenset({"available", "trashed", "trash_pending"})


def _can_preview_material(material: Material) -> bool:
    """缩略图 / H.264 预览片：可用和回收站都可看；原片下载仍只允许 available。"""
    return str(material.status or "") in _PREVIEWABLE_STATUSES


def _lan_direct_bases(access_context: str, down_raw: str | None) -> list[str]:
    bases = split_base_urls(down_raw or "")
    if access_context != "internal":
        bases = [b for b in bases if b.lower().startswith("https://")]
    return bases


def _optional_http_base(url: str) -> str | None:
    u = first_base_url(url) or (url or "").strip().rstrip("/")
    return u if u else None


def _optional_http_bases(url: str) -> list[str]:
    return split_base_urls(url)


def _lan_roots_for_default_pool(db: Session) -> tuple[str, str]:
    return resolve_lan_base_urls(db, settings.default_storage_pool_id)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _sign_ticket_payload(payload: dict) -> str:
    payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    payload_part = _b64url_encode(payload_json)
    signature = hmac.new(
        settings.download_ticket_secret.encode("utf-8"),
        payload_part.encode("ascii"),
        hashlib.sha256,
    ).digest()
    sign_part = _b64url_encode(signature)
    return f"{payload_part}.{sign_part}"


def _verify_ticket_or_401(ticket: str) -> dict:
    try:
        payload_part, sign_part = ticket.split(".", 1)
        expected = hmac.new(
            settings.download_ticket_secret.encode("utf-8"),
            payload_part.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_b64url_encode(expected), sign_part):
            raise ValueError("invalid signature")
        payload = json.loads(_b64url_decode(payload_part))
        expires_at = datetime.fromisoformat(payload["exp"])
        if datetime.now(timezone.utc) >= expires_at:
            raise ValueError("expired")
        return payload
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired download ticket") from exc


def _basename_from_path(path_text: str, default_name: str) -> str:
    val = (path_text or "").replace("\\", "/").strip()
    if not val:
        return default_name
    name = val.split("/")[-1].strip()
    return name or default_name


_VIDEO_PREVIEW_EXTENSIONS = frozenset({"mp4", "mov", "mkv", "avi", "webm", "m4v"})


def _sign_cache_access_token(job_id: str, expires_at_iso: str) -> str:
    payload = {"job_id": job_id, "exp": expires_at_iso, "scope": "download_cache"}
    return _sign_ticket_payload(payload)


def _verify_cache_access_token_or_401(access_token: str, expected_job_id: str) -> None:
    payload = _verify_ticket_or_401(access_token)
    if str(payload.get("scope", "")) != "download_cache":
        raise HTTPException(status_code=401, detail="Invalid download cache token scope")
    if str(payload.get("job_id", "")) != expected_job_id:
        raise HTTPException(status_code=401, detail="Invalid download cache token target")


def _verify_lan_upload_ticket_or_401(ticket: str) -> dict:
    payload = _verify_ticket_or_401(ticket)
    if str(payload.get("scope", "")) != "lan_upload":
        raise HTTPException(status_code=401, detail="Invalid LAN upload ticket scope")
    return payload


def _parse_job_uuid_or_400(job_id: str) -> UUID:
    try:
        return UUID(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid job id") from exc


def _parse_iso_dt(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _cleanup_expired_download_cache(db: Session, limit: int = 200) -> int:
    now = datetime.now(timezone.utc)
    jobs = list(
        db.scalars(
            select(NasJob)
            .where(NasJob.job_type == "prepare_download", NasJob.status == "success")
            .order_by(NasJob.finished_at.asc())
            .limit(limit)
        ).all()
    )
    cleaned = 0
    cleaned_bytes = 0
    for job in jobs:
        if not isinstance(job.result, dict):
            continue
        expires_raw = str(job.result.get("expires_at", ""))
        cache_path = str(job.result.get("cache_path", ""))
        expires_at = _parse_iso_dt(expires_raw)
        if not expires_at or not cache_path:
            continue
        if now < expires_at:
            continue
        file_path = Path(cache_path)
        if file_path.exists():
            try:
                cleaned_bytes += file_path.stat().st_size
                file_path.unlink()
            except Exception:
                pass
        parent = file_path.parent
        if parent.exists():
            try:
                shutil.rmtree(parent)
            except Exception:
                pass
        job.status = "expired"
        job.error_message = "Cached download expired and cleaned"
        cleaned += 1
    if cleaned:
        db.commit()
        print(f"[download-cache] cleaned expired files: count={cleaned}, bytes={cleaned_bytes}")
    return cleaned


def _resolve_cached_download_url(job: NasJob) -> tuple[str | None, datetime | None]:
    if not isinstance(job.result, dict):
        return None, None
    expires_raw = job.result.get("expires_at")
    expires_at = None
    if isinstance(expires_raw, str):
        try:
            expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            expires_at = None
    if job.status != "success":
        return None, expires_at
    if isinstance(expires_raw, str) and expires_raw:
        access_token = _sign_cache_access_token(str(job.id), expires_raw)
        return f"/materials/download-cache/{job.id}?access_token={access_token}", expires_at
    return f"/materials/download-cache/{job.id}", expires_at


@router.get("", response_model=MaterialListResponse)
def material_list(
    keyword: str | None = None,
    uploader: str | None = None,
    tag_ids_all: list[str] = Query(default_factory=list),
    tag_category: str | None = Query(default=None, description="仅返回至少带有一个该分类下「启用」标签的素材；与 tag_ids_all 为 AND"),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    sort_by: str = Query(default="created_at"),
    sort_order: str = Query(default="desc"),
    include_all: bool = Query(default=False),
    quick_view: str | None = Query(default=None),
    tag_match_mode: str = Query(default="and"),
    primary_taxonomy_id: str | None = Query(default=None),
    secondary_taxonomy_id: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> MaterialListResponse:
    requester_username: str | None = None
    owner_only_username: str | None = None
    if credentials is not None:
        token = extract_bearer_token(credentials)
        user = decode_access_token(token)
        requester_username = user.username
        ensure_permission(db, user.username, "asset.view")
        # 回收站列表权限：
        # - asset.restore_all: 可看全部回收站素材
        # - 其他仅可看自己上传的回收站素材
        status_values = {x.strip() for x in str(status or "").split(",") if x.strip()}
        if status_values.intersection({"trashed", "trash_pending"}) and not include_all:
            perms = get_user_permissions(db, user.username)
            if "asset.restore_all" not in perms:
                owner_only_username = user.username
    if include_all:
        token = extract_bearer_token(credentials)
        user = decode_access_token(token)
        ensure_permission(db, user.username, "asset.edit_all")
    only_available = not include_all and status is None
    rows, total = list_materials(
        db,
        keyword=keyword,
        uploader=uploader,
        tag_ids_all=tag_ids_all,
        tag_category=tag_category,
        status_filter=status,
        only_available=only_available,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        quick_view=quick_view,
        requester_username=requester_username,
        owner_only_username=owner_only_username,
        tag_match_mode=tag_match_mode,
        library_id=library_id_for_code(library_code),
        library_code=library_code,
        primary_taxonomy_id=primary_taxonomy_id,
        secondary_taxonomy_id=secondary_taxonomy_id,
    )
    return MaterialListResponse(
        items=[MaterialRead.model_validate(serialize_material(db, item)) for item in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/facet-tag-ids", response_model=MaterialFacetTagIdsResponse)
def materials_facet_tag_ids(
    keyword: str | None = None,
    uploader: str | None = None,
    tag_ids_all: list[str] = Query(default_factory=list),
    tag_category: str | None = Query(default=None),
    status: str | None = Query(default=None),
    quick_view: str | None = Query(default=None),
    tag_match_mode: str = Query(default="and"),
    include_all: bool = Query(default=False),
    primary_taxonomy_id: str | None = Query(default=None),
    secondary_taxonomy_id: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> MaterialFacetTagIdsResponse:
    """与 `GET /materials` 列表同源筛选下，出现在任一匹配素材上的启用标签 id（去重）；用于素材库快捷视图侧栏。"""
    requester_username: str | None = None
    owner_only_username: str | None = None
    if credentials is not None:
        token = extract_bearer_token(credentials)
        user = decode_access_token(token)
        requester_username = user.username
        ensure_permission(db, user.username, "asset.view")
        status_values = {x.strip() for x in str(status or "").split(",") if x.strip()}
        if status_values.intersection({"trashed", "trash_pending"}) and not include_all:
            perms = get_user_permissions(db, user.username)
            if "asset.restore_all" not in perms:
                owner_only_username = user.username
    if include_all:
        token = extract_bearer_token(credentials)
        user = decode_access_token(token)
        ensure_permission(db, user.username, "asset.edit_all")
    only_available = not include_all and status is None
    tag_ids = list_distinct_active_tag_ids_for_material_filters(
        db,
        keyword=keyword,
        uploader=uploader,
        tag_ids_all=tag_ids_all or None,
        tag_category=tag_category,
        status_filter=status,
        only_available=only_available,
        quick_view=quick_view,
        requester_username=requester_username,
        owner_only_username=owner_only_username,
        tag_match_mode=tag_match_mode,
        library_id=library_id_for_code(library_code),
        library_code=library_code,
        primary_taxonomy_id=primary_taxonomy_id,
        secondary_taxonomy_id=secondary_taxonomy_id,
    )
    return MaterialFacetTagIdsResponse(tag_ids=tag_ids)


@router.get("/desktop-metadata-sync", response_model=DesktopMetadataSyncResponse)
def desktop_metadata_sync(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> DesktopMetadataSyncResponse:
    """桌面端分页同步素材元数据与 NAS file_path；第 1 页附带全部启用标签。"""
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.view")
    lid = library_id_for_code(library_code)
    materials, files, total = build_desktop_metadata_sync_page(
        db, page=page, page_size=page_size, library_id=lid, library_code=library_code
    )
    tags: list[DesktopMetadataSyncTag] = []
    if page == 1:
        tags = [DesktopMetadataSyncTag.model_validate(t) for t in list_active_tags_for_desktop_sync(db, library_id=lid)]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return DesktopMetadataSyncResponse(
        tags=tags,
        materials=[DesktopMetadataSyncMaterial.model_validate(m) for m in materials],
        files=[DesktopMetadataSyncFile.model_validate(f) for f in files],
        page=page,
        page_size=page_size,
        total_materials=total,
        synced_at=now,
    )


@router.get("/unorganized", response_model=UnorganizedMaterialListResponse)
def unorganized_material_list(
    file_type: str | None = None,
    uploader_id: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> UnorganizedMaterialListResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.view")
    items, total = list_unorganized_materials(
        db,
        username=user.username,
        file_type=file_type,
        uploader_id=uploader_id,
        created_from=created_from,
        created_to=created_to,
        page=page,
        page_size=page_size,
        library_id=library_id_for_code(library_code),
    )
    return UnorganizedMaterialListResponse(
        items=[UnorganizedMaterialRead.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.patch("/unorganized/batch-tags", response_model=UnorganizedBatchActionResponse)
def batch_tags_unorganized(
    payload: UnorganizedBatchTagRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> UnorganizedBatchActionResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    success_count, failed_count, failed_items = batch_add_tags_and_remove_unorganized(
        db,
        username=user.username,
        asset_ids=payload.asset_ids,
        tag_ids=payload.tag_ids,
        primary_taxonomy_id=payload.primary_taxonomy_id,
        secondary_taxonomy_id=payload.secondary_taxonomy_id,
        keywords=payload.keywords,
        copy_fit=payload.copy_fit,
        description=payload.description,
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="unorganized.batch_add_tags",
        target_type="material",
        target_name="batch",
        after_data={
            "asset_ids": payload.asset_ids,
            "replaced_tag_ids": payload.tag_ids,
            "mode": "replace_all_tags",
            "success_count": success_count,
            "failed_count": failed_count,
            "failed_items": failed_items,
            "description": payload.description,
        },
        **_request_meta(request),
    )
    return UnorganizedBatchActionResponse(success_count=success_count, failed_count=failed_count, failed_items=failed_items)


@router.post("/unorganized/analyze", response_model=UnorganizedBatchActionResponse)
def analyze_unorganized(
    payload: UnorganizedBatchAnalyzeRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
    request: Request = None,
) -> UnorganizedBatchActionResponse:
    """排队内容分析作业（文件机侧视觉模型）；仅写建议，不改标签与描述。"""
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    success_count, failed_count, failed_items = enqueue_content_analysis(
        db,
        username=user.username,
        asset_ids=payload.asset_ids,
        library_id=library_id_for_code(library_code),
        auto_apply=payload.auto_apply,
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="unorganized.analyze_content",
        target_type="material",
        target_name="batch",
        after_data={
            "asset_ids": payload.asset_ids,
            "library": library_code,
            "auto_apply": payload.auto_apply,
            "success_count": success_count,
            "failed_count": failed_count,
            "failed_items": failed_items,
        },
        **_request_meta(request),
    )
    return UnorganizedBatchActionResponse(success_count=success_count, failed_count=failed_count, failed_items=failed_items)


@router.post("/unorganized/apply-suggestions", response_model=UnorganizedBatchActionResponse)
def apply_unorganized_suggestions(
    payload: UnorganizedApplySuggestionsRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
    request: Request = None,
) -> UnorganizedBatchActionResponse:
    """逐素材采纳自身建议：替换为建议标签（等价移除「未整理」）并写入描述等字段。"""
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    success_count, failed_count, failed_items = apply_content_analysis_suggestions(
        db,
        username=user.username,
        asset_ids=payload.asset_ids,
        library_id=library_id_for_code(library_code),
        auto_create=payload.auto_create,
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="unorganized.apply_ai_suggestions",
        target_type="material",
        target_name="batch",
        after_data={
            "asset_ids": payload.asset_ids,
            "library": library_code,
            "mode": "replace_all_tags_per_asset",
            "auto_create": payload.auto_create,
            "success_count": success_count,
            "failed_count": failed_count,
            "failed_items": failed_items,
        },
        **_request_meta(request),
    )
    return UnorganizedBatchActionResponse(success_count=success_count, failed_count=failed_count, failed_items=failed_items)


@router.post("/batch-mark-unorganized", response_model=UnorganizedBatchActionResponse)
def batch_mark_unorganized(
    payload: UnorganizedBatchMarkRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> UnorganizedBatchActionResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    success_count, failed_count, failed_items = batch_mark_unorganized_materials(
        db, username=user.username, asset_ids=payload.asset_ids
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="material.batch_mark_unorganized",
        target_type="material",
        target_name="batch",
        after_data={
            "asset_ids": payload.asset_ids,
            "added_tag": "未整理",
            "success_count": success_count,
            "failed_count": failed_count,
            "failed_items": failed_items,
        },
        **_request_meta(request),
    )
    return UnorganizedBatchActionResponse(success_count=success_count, failed_count=failed_count, failed_items=failed_items)


@router.post("/unorganized/batch-trash", response_model=UnorganizedBatchActionResponse)
def batch_trash_unorganized(
    payload: UnorganizedBatchTrashRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
    request: Request = None,
) -> UnorganizedBatchActionResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_internal_access(access_context)
    success_count, failed_count, failed_items = batch_trash_unorganized_materials(
        db, username=user.username, asset_ids=payload.asset_ids
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="unorganized.batch_trash",
        target_type="material",
        target_name="batch",
        after_data={
            "asset_ids": payload.asset_ids,
            "reason": payload.reason,
            "success_count": success_count,
            "failed_count": failed_count,
            "failed_items": failed_items,
        },
        **_request_meta(request),
    )
    return UnorganizedBatchActionResponse(success_count=success_count, failed_count=failed_count, failed_items=failed_items)


@router.post("/download-client-report", response_model=MaterialDownloadClientReportResponse)
def report_material_download_client(
    body: MaterialDownloadClientReportRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> MaterialDownloadClientReportResponse:
    """记录浏览器侧下载方式与选路结果（与文件机/ECS 传输日志互补）。"""
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.download")
    _ = get_material(db, body.material_id, only_available=False)
    _ = get_material_file(db, body.material_id, body.file_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="material.download_client",
        target_type="素材",
        target_name=body.material_id,
        after_data={
            "file_id": body.file_id,
            "download_mode": body.download_mode,
            "transport_route": body.transport_route,
            "file_size_bytes": body.file_size_bytes,
        },
        success=body.success,
        error_message=(body.error_message or None) if not body.success else None,
        **_request_meta(request),
    )
    return MaterialDownloadClientReportResponse()


@router.get("/{material_id}", response_model=MaterialDetailRead)
def material_detail(
    material_id: str,
    include_all: bool = Query(default=False),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> MaterialDetailRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.view")
    if include_all:
        token = extract_bearer_token(credentials)
        user = decode_access_token(token)
        ensure_permission(db, user.username, "asset.edit_all")
    row = get_material(db, material_id, only_available=not include_all)
    return MaterialDetailRead.model_validate(serialize_material(db, row))


@router.patch("/{material_id}", response_model=MaterialDetailRead)
def patch_material_route(
    material_id: str,
    payload: MaterialPatchRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> MaterialDetailRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    perms = get_user_permissions(db, user.username)
    if "asset.edit_all" not in perms and "asset.edit_own" not in perms:
        raise HTTPException(status_code=403, detail="Missing permission: asset.edit_own/asset.edit_all")
    row = patch_material_fields(
        db,
        username=user.username,
        material_id=material_id,
        title=payload.title,
        description=payload.description,
        tag_ids=payload.tag_ids,
        primary_original_filename=payload.primary_original_filename,
        keywords=payload.keywords,
        copy_fit=payload.copy_fit,
        primary_taxonomy_id=payload.primary_taxonomy_id,
        secondary_taxonomy_id=payload.secondary_taxonomy_id,
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="material.patch",
        target_type="material",
        target_name=material_id,
        after_data={
            "title": payload.title,
            "primary_original_filename": payload.primary_original_filename,
            "description_set": payload.description is not None,
            "tag_ids": payload.tag_ids,
        },
        **_request_meta(request),
    )
    return MaterialDetailRead.model_validate(serialize_material(db, row))


@router.post("/{material_id}/collect", response_model=MaterialCollectResponse)
def material_collect(
    material_id: str,
    payload: MaterialCollectRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> MaterialCollectResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.view")
    ensure_permission(db, user.username, "collection.view")
    perms = get_user_permissions(db, user.username)
    item_id, created = collect_material_to_collection(
        db,
        username=user.username,
        material_id=material_id,
        collection_id=payload.collection_id,
        material_file_id=payload.material_file_id,
        note=payload.note,
        perms=perms,
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="material.collect",
        target_type="material",
        target_name=material_id,
        after_data={"collection_id": payload.collection_id, "item_id": item_id, "created": created},
        ip_address=_request_meta(request)["ip_address"],
        user_agent=_request_meta(request)["user_agent"],
    )
    return MaterialCollectResponse(status="success" if created else "already_exists", item_id=item_id)


@router.post("/{material_id}/files/{file_id}/download-ticket", response_model=MaterialDownloadTicketResponse)
def create_download_ticket(
    material_id: str,
    file_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
):
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.download")
    ensure_internal_access(access_context)
    material = get_material(db, material_id, only_available=False)
    if material.status != "available":
        raise HTTPException(status_code=400, detail="Material is not available for download ticket")
    material_file = get_material_file(db, material_id, file_id)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.download_ticket_ttl_seconds)
    payload = {
        "material_id": material_id,
        "file_id": file_id,
        "exp": expires_at.isoformat(),
    }
    ticket = _sign_ticket_payload(payload)
    _, down_base = _lan_roots_for_material(db, material)
    download_url = f"{down_base}/download?ticket={ticket}" if down_base else None
    return MaterialDownloadTicketResponse(
        material_id=material_id,
        file_id=file_id,
        ticket=ticket,
        expires_at=expires_at.replace(tzinfo=None),
        download_url=download_url,
    )


@router.post("/{material_id}/files/{file_id}/download-route", response_model=MaterialDownloadRouteResponse)
def create_download_route(
    material_id: str,
    file_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> MaterialDownloadRouteResponse:
    """签发一次性下载票据，并返回 LAN/公网 文件机根地址供浏览器探测后直连下载（失败则前端回退 prepare_download）。"""
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.download")
    material = get_material(db, material_id, only_available=False)
    if material.status != "available":
        raise HTTPException(status_code=400, detail="Material is not available for download")
    _ = get_material_file(db, material_id, file_id)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.download_ticket_ttl_seconds)
    payload = {
        "material_id": material_id,
        "file_id": file_id,
        "exp": expires_at.isoformat(),
    }
    ticket = _sign_ticket_payload(payload)
    _, lan_down = _lan_roots_for_material(db, material)
    _, pub_down = resolve_public_base_urls(db, _material_storage_pool_id(material))
    lan_bases = _optional_http_bases(lan_down)
    return MaterialDownloadRouteResponse(
        material_id=material_id,
        file_id=file_id,
        ticket=ticket,
        expires_at=expires_at.replace(tzinfo=None),
        lan_download_base_url=lan_bases[0] if lan_bases else None,
        lan_download_base_urls=lan_bases,
        public_download_base_url=_optional_http_base(pub_down),
        recommended_order=["lan", "wan", "ecs_fallback"],
    )


@router.get("/{material_id}/files/{file_id}/thumbnail-url", response_model=MaterialThumbnailUrlResponse)
def resolve_thumbnail_url(
    material_id: str,
    file_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> MaterialThumbnailUrlResponse:
    _cleanup_expired_download_cache(db)
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.view")
    material = get_material(db, material_id, only_available=False)
    if not _can_preview_material(material):
        raise HTTPException(status_code=400, detail="Material is not available")
    material_file = get_material_file(db, material_id, file_id)
    file_meta = material_file.extra_metadata if isinstance(material_file.extra_metadata, dict) else {}
    thumbnail_path = str((file_meta or {}).get("thumbnail_path") or "").strip()
    preferred_path = thumbnail_path or str(material_file.file_path or "").strip()
    preferred_name = _basename_from_path(preferred_path, material_file.original_filename or "thumbnail.bin")
    if not preferred_path:
        raise HTTPException(status_code=400, detail="File path missing")

    _, down_raw = _lan_roots_for_material(db, material)
    lan_bases = _lan_direct_bases(access_context, down_raw)
    if lan_bases:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.download_ticket_ttl_seconds)
        payload = {
            "scope": "thumbnail_direct",
            "material_id": material_id,
            "file_id": file_id,
            "file_path": preferred_path,
            "original_filename": preferred_name,
            "exp": expires_at.isoformat(),
        }
        ticket = _sign_ticket_payload(payload)
        urls = [f"{b}/download?ticket={ticket}" for b in lan_bases]
        return MaterialThumbnailUrlResponse(
            material_id=material_id,
            file_id=file_id,
            status="ready",
            source="lan",
            expires_at=expires_at.replace(tzinfo=None),
            url=urls[0],
            alternate_urls=urls[1:],
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    recent_success = db.scalar(
        select(NasJob)
        .where(
            NasJob.job_type == "prepare_download",
            NasJob.status == "success",
            NasJob.payload["material_id"].astext == material_id,
            NasJob.payload["material_file_id"].astext == file_id,
            NasJob.payload["file_path"].astext == preferred_path,
        )
        .order_by(NasJob.finished_at.desc())
        .limit(1)
    )
    if recent_success:
        cached_url, expires_at = _resolve_cached_download_url(recent_success)
        if cached_url and expires_at and expires_at > now:
            return MaterialThumbnailUrlResponse(
                material_id=material_id,
                file_id=file_id,
                status="ready",
                source="ecs-cache",
                expires_at=expires_at,
                url=cached_url,
            )

    pending = db.scalar(
        select(NasJob)
        .where(
            NasJob.job_type == "prepare_download",
            NasJob.status.in_(("pending", "running")),
            NasJob.payload["material_id"].astext == material_id,
            NasJob.payload["material_file_id"].astext == file_id,
            NasJob.payload["file_path"].astext == preferred_path,
        )
        .order_by(NasJob.created_at.desc())
        .limit(1)
    )
    if not pending:
        job = NasJob(
            job_type="prepare_download",
            payload={
                "material_id": material_id,
                "material_file_id": file_id,
                "file_path": preferred_path,
                "original_filename": preferred_name,
                "request_username": user.username,
                "record_download_count": False,
            },
            status="pending",
        )
        sync_op = create_sync_operation(
            db,
            operation_id=new_operation_id("thumb_prepare"),
            operation_type="thumbnail.prepare_cache",
            target_type="material_file",
            target_id=file_id,
            status="sync_pending",
            payload={"material_id": material_id, "material_file_id": file_id},
        )
        job.sync_operation_id = sync_op.id
        db.add(job)
        db.commit()
    return MaterialThumbnailUrlResponse(
        material_id=material_id,
        file_id=file_id,
        status="pending",
        source="ecs-cache",
        url=None,
        message="thumbnail_prepare_pending",
    )


@router.get("/{material_id}/files/{file_id}/preview-video-url", response_model=MaterialPreviewVideoUrlResponse)
def resolve_preview_video_url(
    material_id: str,
    file_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> MaterialPreviewVideoUrlResponse:
    """返回浏览器可播的 H.264 预览片地址（派生文件，不计入下载次数）。"""
    _cleanup_expired_download_cache(db)
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.view")
    material = get_material(db, material_id, only_available=False)
    if not _can_preview_material(material):
        raise HTTPException(status_code=400, detail="Material is not available")
    material_file = get_material_file(db, material_id, file_id)
    file_meta = material_file.extra_metadata if isinstance(material_file.extra_metadata, dict) else {}
    pv_status = str((file_meta or {}).get("preview_video_status") or "").strip().lower()
    pv_path = str((file_meta or {}).get("preview_video_path") or "").strip()

    if pv_status == "failed":
        return MaterialPreviewVideoUrlResponse(
            material_id=material_id,
            file_id=file_id,
            status="failed",
            message="预览视频生成失败，请下载原文件查看",
        )
    if not pv_path:
        return MaterialPreviewVideoUrlResponse(
            material_id=material_id,
            file_id=file_id,
            status="pending",
            message="预览视频生成中",
        )

    preferred_name = _basename_from_path(pv_path, "preview.mp4")
    _, down_raw = _lan_roots_for_material(db, material)
    lan_bases = _lan_direct_bases(access_context, down_raw)
    if lan_bases:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.download_ticket_ttl_seconds)
        payload = {
            "scope": "preview_video",
            "material_id": material_id,
            "file_id": file_id,
            "file_path": pv_path,
            "original_filename": preferred_name,
            "exp": expires_at.isoformat(),
        }
        ticket = _sign_ticket_payload(payload)
        urls = [f"{b}/download?ticket={ticket}" for b in lan_bases]
        return MaterialPreviewVideoUrlResponse(
            material_id=material_id,
            file_id=file_id,
            status="ready",
            url=urls[0],
            alternate_urls=urls[1:],
            mime_type="video/mp4",
            source="lan",
            expires_at=expires_at.replace(tzinfo=None),
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    recent_success = db.scalar(
        select(NasJob)
        .where(
            NasJob.job_type == "prepare_download",
            NasJob.status == "success",
            NasJob.payload["material_id"].astext == material_id,
            NasJob.payload["material_file_id"].astext == file_id,
            NasJob.payload["file_path"].astext == pv_path,
        )
        .order_by(NasJob.finished_at.desc())
        .limit(1)
    )
    if recent_success:
        cached_url, expires_at = _resolve_cached_download_url(recent_success)
        if cached_url and expires_at and expires_at > now:
            return MaterialPreviewVideoUrlResponse(
                material_id=material_id,
                file_id=file_id,
                status="ready",
                url=cached_url,
                mime_type="video/mp4",
                source="ecs-cache",
                expires_at=expires_at,
            )

    pending = db.scalar(
        select(NasJob)
        .where(
            NasJob.job_type == "prepare_download",
            NasJob.status.in_(("pending", "running")),
            NasJob.payload["material_id"].astext == material_id,
            NasJob.payload["material_file_id"].astext == file_id,
            NasJob.payload["file_path"].astext == pv_path,
        )
        .order_by(NasJob.created_at.desc())
        .limit(1)
    )
    if not pending:
        job = NasJob(
            job_type="prepare_download",
            payload={
                "material_id": material_id,
                "material_file_id": file_id,
                "file_path": pv_path,
                "original_filename": preferred_name,
                "request_username": user.username,
                "record_download_count": False,
            },
            status="pending",
        )
        sync_op = create_sync_operation(
            db,
            operation_id=new_operation_id("preview_prepare"),
            operation_type="preview_video.prepare_cache",
            target_type="material_file",
            target_id=file_id,
            status="sync_pending",
            payload={"material_id": material_id, "material_file_id": file_id},
        )
        job.sync_operation_id = sync_op.id
        db.add(job)
        db.commit()
    return MaterialPreviewVideoUrlResponse(
        material_id=material_id,
        file_id=file_id,
        status="pending",
        message="预览视频生成中",
        source="ecs-cache",
    )


@router.post("/{material_id}/files/{file_id}/regenerate-derivatives")
def regenerate_material_file_derivatives(
    material_id: str,
    file_id: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """为已有素材重新排队 generate_derivatives（含预览 MP4），需全局素材管理能力。"""
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.edit_all")
    material = get_material(db, material_id, only_available=False)
    if material.status != "available":
        raise HTTPException(status_code=400, detail="Material is not available")
    mf = get_material_file(db, material_id, file_id)
    ext = (mf.extension or "").lower().lstrip(".")
    if ext not in _VIDEO_PREVIEW_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Regeneration applies to video extensions only")
    if mf.storage_type != "nas" or not (mf.file_path or "").strip():
        raise HTTPException(status_code=400, detail="File must be stored on NAS with a valid path")

    exists_job = db.scalar(
        select(NasJob.id).where(
            NasJob.job_type == "generate_derivatives",
            NasJob.status.in_(("pending", "running")),
            NasJob.payload["material_file_id"].astext == str(mf.id),
        )
    )
    if exists_job:
        return {
            "status": "skipped",
            "reason": "job_already_pending_or_running",
            "job_id": str(exists_job),
        }

    op_id = new_operation_id("regen_deriv")
    op = create_sync_operation(
        db,
        operation_id=op_id,
        operation_type="material.regenerate_derivatives",
        target_type="material_file",
        target_id=str(mf.id),
        status="sync_pending",
        payload={"material_id": material_id, "material_file_id": str(mf.id)},
        max_retries=3,
    )
    job = NasJob(
        job_type="generate_derivatives",
        payload={
            "material_id": material_id,
            "material_file_id": str(mf.id),
            "file_path": (mf.file_path or "").strip().replace("\\", "/"),
        },
        status="pending",
        sync_operation_id=op.id,
        max_retries=3,
    )
    db.add(job)
    db.flush()
    jid = str(job.id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="material.regenerate_derivatives",
        target_type="material_file",
        target_name=mf.original_filename or "",
        after_data={"material_id": material_id, "material_file_id": file_id, "nas_job_id": jid},
        **_request_meta(request),
    )
    db.commit()
    return {"status": "queued", "job_id": jid}


@router.get("/download-ticket/verify", response_model=MaterialDownloadTicketVerifyResponse)
def verify_download_ticket(
    request: Request,
    ticket: str = Query(..., min_length=10),
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_nas_client_token),
) -> MaterialDownloadTicketVerifyResponse:
    try:
        payload = _verify_ticket_or_401(ticket)
        scope = str(payload.get("scope", "")).strip()
        if scope == "thumbnail_direct":
            material_id = str(payload.get("material_id", ""))
            file_id = str(payload.get("file_id", ""))
            file_path = str(payload.get("file_path", "")).strip()
            original_filename = str(payload.get("original_filename", "")).strip() or "thumbnail.bin"
            exp = str(payload.get("exp", ""))
            _ = get_material(db, material_id, only_available=False)
            _ = get_material_file(db, material_id, file_id)
            if not file_path:
                raise HTTPException(status_code=400, detail="Thumbnail file path missing in ticket")
            expires_at = datetime.fromisoformat(exp).replace(tzinfo=None)
            return MaterialDownloadTicketVerifyResponse(
                material_id=material_id,
                file_id=file_id,
                original_filename=original_filename,
                storage_type="nas",
                file_path=file_path,
                expires_at=expires_at,
                inline_disposition=True,
            )
        if scope == "preview_video":
            material_id = str(payload.get("material_id", ""))
            file_id = str(payload.get("file_id", ""))
            file_path = str(payload.get("file_path", "")).strip()
            original_filename = str(payload.get("original_filename", "")).strip() or "preview.mp4"
            exp = str(payload.get("exp", ""))
            _ = get_material(db, material_id, only_available=False)
            _ = get_material_file(db, material_id, file_id)
            if not file_path:
                raise HTTPException(status_code=400, detail="Preview video file path missing in ticket")
            expires_at = datetime.fromisoformat(exp).replace(tzinfo=None)
            return MaterialDownloadTicketVerifyResponse(
                material_id=material_id,
                file_id=file_id,
                original_filename=original_filename,
                storage_type="nas",
                file_path=file_path,
                expires_at=expires_at,
                inline_disposition=True,
            )
        material_id = str(payload.get("material_id", ""))
        file_id = str(payload.get("file_id", ""))
        exp = str(payload.get("exp", ""))
        material = get_material(db, material_id, only_available=False)
        if material.status != "available":
            raise HTTPException(status_code=400, detail="Material is not available")
        material_file = get_material_file(db, material_id, file_id)
        expires_at = datetime.fromisoformat(exp).replace(tzinfo=None)
        return MaterialDownloadTicketVerifyResponse(
            material_id=material_id,
            file_id=file_id,
            original_filename=material_file.original_filename,
            storage_type=material_file.storage_type,
            file_path=material_file.file_path,
            expires_at=expires_at,
            inline_disposition=False,
        )
    finally:
        try:
            refresh_single_node_public_from_nas_ingress(db, request)
        except Exception:
            pass


@router.post("/download-ticket/report")
def report_download_ticket_usage(
    payload: MaterialDownloadTicketReportRequest,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_nas_client_token),
) -> dict[str, str]:
    parsed = _verify_ticket_or_401(payload.ticket)
    material_id = str(parsed.get("material_id", "")).strip()
    file_id = str(parsed.get("file_id", "")).strip()
    if not material_id or not file_id:
        raise HTTPException(status_code=400, detail="Invalid ticket payload")
    scope = str(parsed.get("scope", "")).strip()
    # 内网缩略图 / 预览片 LAN 直连与正式下载共用 /download + report，不得计入素材下载次数
    if payload.success and scope not in ("thumbnail_direct", "preview_video"):
        record_material_download_usage(
            db,
            material_id=material_id,
            material_file_id=file_id,
            username=None,
            source="download_ticket",
        )
    return {"status": "ok"}


@router.post("/lan-upload-ticket", response_model=MaterialLanUploadTicketResponse)
def create_lan_upload_ticket(
    payload: MaterialLanUploadTicketCreateRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> MaterialLanUploadTicketResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.upload")
    ticket_library = payload.library or library_code
    if live_original_material_exists_by_sha256(db, payload.sha256, library_id=library_id_for_code(ticket_library)):
        raise HTTPException(
            status_code=409,
            detail="Material with same sha256 already exists",
        )
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.upload_ticket_ttl_seconds)
    ticket_payload: dict = {
        "scope": "lan_upload",
        "uploader": user.username,
        "original_filename": payload.original_filename,
        "title": payload.title,
        "description": payload.description,
        "tag_ids": payload.tag_ids,
        "mime_type": payload.mime_type,
        "sha256": payload.sha256.strip().lower(),
        "library": ticket_library,
        "exp": expires_at.isoformat(),
    }
    if payload.file_size is not None:
        ticket_payload["file_size"] = int(payload.file_size)
    ticket = _sign_ticket_payload(ticket_payload)
    lan_up, _ = _lan_roots_for_default_pool(db)
    pub_up, _ = resolve_public_base_urls(db, settings.default_storage_pool_id)
    primary = (lan_up or "").strip().rstrip("/") or (pub_up or "").strip().rstrip("/")
    upload_url = f"{primary}/upload?ticket={ticket}" if primary else None
    return MaterialLanUploadTicketResponse(
        ticket=ticket,
        expires_at=expires_at.replace(tzinfo=None),
        upload_url=upload_url,
        lan_upload_base_url=_optional_http_base(lan_up),
        public_upload_base_url=_optional_http_base(pub_up),
    )


@router.get("/lan-upload-ticket/verify", response_model=MaterialLanUploadTicketVerifyResponse)
def verify_lan_upload_ticket(
    request: Request,
    ticket: str = Query(..., min_length=10),
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_nas_client_token),
) -> MaterialLanUploadTicketVerifyResponse:
    try:
        payload = _verify_lan_upload_ticket_or_401(ticket)
        exp = str(payload.get("exp", ""))
        expires_at = datetime.fromisoformat(exp).replace(tzinfo=None)
        fs = payload.get("file_size")
        file_size_out: int | None = None
        if isinstance(fs, int) and fs > 0:
            file_size_out = fs
        elif isinstance(fs, (float, str)):
            try:
                iv = int(float(fs))
                file_size_out = iv if iv > 0 else None
            except (TypeError, ValueError):
                file_size_out = None
        raw_sh = str(payload.get("sha256") or "").strip().lower()
        sha256_out: str | None = (
            raw_sh
            if len(raw_sh) == 64 and all(c in "0123456789abcdef" for c in raw_sh)
            else None
        )
        return MaterialLanUploadTicketVerifyResponse(
            original_filename=str(payload.get("original_filename", "")).strip(),
            title=str(payload.get("title", "")).strip(),
            description=(payload.get("description") if isinstance(payload.get("description"), str) else None),
            tag_ids=[str(item) for item in (payload.get("tag_ids") or []) if str(item).strip()],
            uploader=str(payload.get("uploader", "")).strip(),
            mime_type=(str(payload.get("mime_type", "")).strip() or None),
            file_size=file_size_out,
            sha256=sha256_out,
            library=str(payload.get("library") or "auto").strip() or "auto",
            expires_at=expires_at,
        )
    finally:
        try:
            refresh_single_node_public_from_nas_ingress(db, request)
        except Exception:
            pass


@router.post("/lan-upload-ticket/report")
def report_lan_upload_ticket(
    payload: MaterialLanUploadTicketReportRequest,
    _: None = Depends(_ensure_nas_client_token),
) -> dict[str, str]:
    _ = _verify_lan_upload_ticket_or_401(payload.ticket)
    return {"status": "ok"}


@router.post("/{material_id}/files/{file_id}/download-prepare", response_model=MaterialDownloadPrepareResponse)
def create_download_prepare_job(
    material_id: str,
    file_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> MaterialDownloadPrepareResponse:
    _cleanup_expired_download_cache(db)
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.download")
    material = get_material(db, material_id, only_available=False)
    if material.status != "available":
        raise HTTPException(status_code=400, detail="Material is not available for download")
    material_file = get_material_file(db, material_id, file_id)
    job = NasJob(
        job_type="prepare_download",
        payload={
            "material_id": material_id,
            "material_file_id": file_id,
            "file_path": material_file.file_path,
            "original_filename": material_file.original_filename,
            "request_username": user.username,
            "record_download_count": True,
        },
        status="pending",
    )
    sync_op = create_sync_operation(
        db,
        operation_id=new_operation_id("download_prepare"),
        operation_type="download.prepare_cache",
        target_type="material_file",
        target_id=file_id,
        status="sync_pending",
        payload={"material_id": material_id, "material_file_id": file_id},
    )
    job.sync_operation_id = sync_op.id
    db.add(job)
    db.commit()
    db.refresh(job)
    return MaterialDownloadPrepareResponse(job_id=str(job.id), status=job.status)


@router.get("/download-prepare/{job_id}", response_model=MaterialDownloadPrepareStatusResponse)
def get_download_prepare_status(
    job_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> MaterialDownloadPrepareStatusResponse:
    _cleanup_expired_download_cache(db)
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.download")
    job = db.get(NasJob, _parse_job_uuid_or_400(job_id))
    if job is None or job.job_type != "prepare_download":
        raise HTTPException(status_code=404, detail="Download prepare job not found")

    expires_at = None
    download_url = None
    if isinstance(job.result, dict):
        expires_raw = job.result.get("expires_at")
        if isinstance(expires_raw, str):
            try:
                expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                expires_at = None
        if job.status == "success":
            if isinstance(expires_raw, str) and expires_raw:
                access_token = _sign_cache_access_token(job_id, expires_raw)
                download_url = f"/materials/download-cache/{job_id}?access_token={access_token}"
            else:
                download_url = f"/materials/download-cache/{job_id}"
    return MaterialDownloadPrepareStatusResponse(
        job_id=job_id,
        status=job.status,
        error_message=job.error_message,
        expires_at=expires_at,
        download_url=download_url,
        started_at=job.started_at,
    )


@router.post("/download-prepare/{job_id}/upload")
async def upload_prepared_download_file(
    job_id: str,
    request: Request,
    download_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_nas_client_token),
) -> dict[str, str]:
    job = db.get(NasJob, _parse_job_uuid_or_400(job_id))
    if job is None or job.job_type != "prepare_download":
        raise HTTPException(status_code=404, detail="Download prepare job not found")
    if job.status not in {"running", "pending"}:
        raise HTTPException(status_code=400, detail="Job is not uploadable")

    payload = job.payload or {}
    fallback_name = str(payload.get("original_filename") or "download.bin")
    original_filename = (download_file.filename or fallback_name).strip() or fallback_name
    data = await download_file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    target_dir = _DOWNLOAD_CACHE_ROOT / job_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / original_filename
    target_path.write_bytes(data)

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.download_cache_ttl_seconds)
    job.status = "success"
    job.result = {
        "cache_path": str(target_path),
        "original_filename": original_filename,
        "file_size": len(data),
        "expires_at": expires_at.isoformat(),
    }
    job.error_message = None
    job.finished_at = datetime.utcnow()
    db.commit()
    try:
        refresh_single_node_public_from_nas_ingress(db, request)
    except Exception:
        pass
    return {"status": "ok"}


@router.get("/download-cache/{job_id}")
def download_cached_file(
    job_id: str,
    access_token: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
):
    _cleanup_expired_download_cache(db)
    download_username: str | None = None
    if access_token:
        _verify_cache_access_token_or_401(access_token, job_id)
    else:
        token = extract_bearer_token(credentials)
        user = decode_access_token(token)
        download_username = user.username
        ensure_permission(db, user.username, "asset.download")
        ensure_internal_access(access_context)
    job = db.get(NasJob, _parse_job_uuid_or_400(job_id))
    if job is None or job.job_type != "prepare_download":
        raise HTTPException(status_code=404, detail="Download prepare job not found")
    if job.status != "success" or not isinstance(job.result, dict):
        raise HTTPException(status_code=400, detail="Download is not ready")

    cache_path = str(job.result.get("cache_path", ""))
    expires_raw = str(job.result.get("expires_at", ""))
    if not cache_path or not expires_raw:
        raise HTTPException(status_code=500, detail="Invalid cached download result")
    expires_at = _parse_iso_dt(expires_raw)
    if not expires_at:
        raise HTTPException(status_code=500, detail="Invalid cache expiry")
    if datetime.now(timezone.utc) >= expires_at:
        file_path = Path(cache_path)
        if file_path.exists():
            try:
                file_path.unlink()
            except Exception:
                pass
        if file_path.parent.exists():
            try:
                shutil.rmtree(file_path.parent)
            except Exception:
                pass
        job.status = "expired"
        job.error_message = "Cached download expired"
        db.commit()
        raise HTTPException(status_code=410, detail="Cached download has expired")

    file_path = Path(cache_path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Cached file not found")
    filename = str(job.result.get("original_filename") or file_path.name)
    _guessed_mt, _ = guess_type(filename)
    _cache_media_type = _guessed_mt or "application/octet-stream"

    payload = job.payload if isinstance(job.payload, dict) else {}
    payload_material_id = str(payload.get("material_id", "")).strip()
    payload_file_id = str(payload.get("material_file_id", "")).strip()
    if access_token and not download_username:
        payload_username = str(payload.get("request_username", "")).strip()
        download_username = payload_username or None
    if payload_material_id:
        count_download = payload.get("record_download_count")
        if count_download is True:
            record_material_download_usage(
                db,
                material_id=payload_material_id,
                material_file_id=payload_file_id or None,
                username=download_username,
                source="download_cache",
            )

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=_cache_media_type,
        content_disposition_type="attachment",
    )


@router.post("", response_model=MaterialRead)
def create_material_route(
    payload: MaterialCreate,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> MaterialRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.upload")
    row = create_material(db, payload, library_id=library_id_for_code(library_code), library_code=library_code)
    record_operation_log(
        db,
        username=user.username,
        operation_type="创建素材",
        target_type="material",
        target_name=row.title,
        after_data={"material_id": str(row.id)},
    )
    return MaterialRead.model_validate(serialize_material(db, row))


@router.get("/{material_id}/usages", response_model=MaterialUsageListResponse)
def material_usages(
    material_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> MaterialUsageListResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "log.view")
    rows, total = list_material_usages(db, material_id, limit=limit)
    items = [
        MaterialUsageRead(
            id=str(row.id),
            material_id=str(row.material_id),
            material_file_id=str(row.material_file_id) if row.material_file_id else None,
            username=row.username,
            usage_type=row.usage_type,
            source=row.source,
            created_at=row.created_at,
        )
        for row in rows
    ]
    return MaterialUsageListResponse(items=items, total=total)


@router.post("/ingest-from-nas", response_model=MaterialIngestFromNasResponse)
def ingest_from_nas_route(
    payload: MaterialIngestFromNasRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(_ensure_nas_client_token),
) -> MaterialIngestFromNasResponse:
    material, material_file, nas_job = ingest_material_from_nas(db, payload)
    try:
        refresh_single_node_public_from_nas_ingress(db, request)
    except Exception:
        pass
    return MaterialIngestFromNasResponse(
        material_id=str(material.id),
        material_file_id=str(material_file.id),
        nas_job_id=str(nas_job.id),
        status="ingested",
    )


@router.patch("/{material_id}/storage-pool", response_model=MaterialRead)
def patch_material_storage_pool_route(
    material_id: str,
    payload: MaterialStoragePoolPatchRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> MaterialRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.edit_all")
    row = patch_material_storage_pool(db, material_id, storage_pool_id=payload.storage_pool_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="修改存储池",
        target_type="material",
        target_name=material_id,
        after_data={"storage_pool_id": row.storage_pool_id},
    )
    return MaterialRead.model_validate(serialize_material(db, row))


@router.delete("/{material_id}", response_model=MaterialRead)
def delete_material_route(
    material_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> MaterialRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    perms = get_user_permissions(db, user.username)
    if "asset.delete_all" not in perms and "asset.delete_own" not in perms:
        raise HTTPException(status_code=403, detail="Missing permission: asset.delete_own/asset.delete_all")
    row_for_auth = get_material(db, material_id, only_available=False)
    if "asset.delete_all" not in perms and row_for_auth.uploader != user.username:
        raise HTTPException(status_code=403, detail="No delete permission for this material")
    row = soft_delete_material(db, material_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="删除素材",
        target_type="material",
        target_name=material_id,
        after_data={"status": "trashed"},
    )
    return MaterialRead.model_validate(serialize_material(db, row))


@router.post("/{material_id}/restore", response_model=MaterialRead)
def restore_material_route(
    material_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> MaterialRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    perms = get_user_permissions(db, user.username)
    if "asset.restore_all" not in perms and "asset.restore_own" not in perms:
        raise HTTPException(status_code=403, detail="Missing permission: asset.restore_own/asset.restore_all")
    row_for_auth = get_material(db, material_id, only_available=False)
    if "asset.restore_all" not in perms and row_for_auth.uploader != user.username:
        raise HTTPException(status_code=403, detail="No restore permission for this material")
    ensure_internal_access(access_context)
    row = restore_material(db, material_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="恢复素材",
        target_type="material",
        target_name=material_id,
        after_data={"status": "available"},
    )
    return MaterialRead.model_validate(serialize_material(db, row))


@router.delete("/{material_id}/permanent", response_model=MaterialPermanentDeleteResponse)
def permanent_delete_material_route(
    material_id: str,
    confirm: str = Query(..., min_length=1),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> MaterialPermanentDeleteResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.permanent_delete")
    ensure_internal_access(access_context)
    if confirm.strip() != "PERMANENT_DELETE":
        raise HTTPException(status_code=400, detail="Invalid confirm text")
    deleted_id = permanently_delete_material(db, material_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="永久删除素材",
        target_type="material",
        target_name=deleted_id,
        success=True,
    )
    return MaterialPermanentDeleteResponse(material_id=deleted_id, status="deleted")
