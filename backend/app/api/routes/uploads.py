from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import bearer_scheme, decode_access_token, extract_bearer_token
from app.schemas.upload import (
    UploadChunksResponse,
    UploadCompleteResponse,
    UploadDedupResponse,
    UploadIngestRequest,
    UploadIngestResponse,
    UploadInitRequest,
    UploadInitResponse,
)
from app.services.library_service import library_id_for_code, resolve_library_code
from app.services.upload_service import (
    complete_upload,
    find_latest_completed_upload_session_by_sha256,
    find_live_original_material_file_by_sha256,
    ingest_uploaded_material,
    get_uploaded_chunks,
    init_upload,
    live_original_material_exists_by_sha256,
    save_chunk,
)
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import ensure_permission

router = APIRouter(prefix="/uploads", tags=["uploads"])


def _request_meta(request: Request | None) -> dict[str, str | None]:
    if request is None:
        return {"ip_address": None, "user_agent": None}
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }


@router.post("/init", response_model=UploadInitResponse)
def init_upload_route(
    payload: UploadInitRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    request: Request = None,
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> UploadInitResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.upload")
    session, uploaded_chunks = init_upload(
        db, payload, user.username, library_id=library_id_for_code(payload.library or library_code)
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="上传初始化",
        target_type="upload",
        target_name=payload.file_name,
        after_data={"upload_session_id": str(session.id), "total_chunks": session.total_chunks},
        **_request_meta(request),
    )
    return UploadInitResponse(
        upload_session_id=str(session.id),
        total_chunks=session.total_chunks,
        uploaded_chunks=uploaded_chunks,
    )


@router.get("/{upload_session_id}/chunks", response_model=UploadChunksResponse)
def uploaded_chunks_route(upload_session_id: str, db: Session = Depends(get_db)) -> UploadChunksResponse:
    session, uploaded_chunks = get_uploaded_chunks(db, upload_session_id)
    return UploadChunksResponse(
        upload_session_id=str(session.id),
        total_chunks=session.total_chunks,
        uploaded_chunks=uploaded_chunks,
        status=session.status,
    )


@router.post("/{upload_session_id}/chunks/{chunk_index}", response_model=UploadChunksResponse)
async def upload_chunk_route(
    upload_session_id: str,
    chunk_index: int,
    chunk_file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    request: Request = None,
    db: Session = Depends(get_db),
) -> UploadChunksResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.upload")
    session = await save_chunk(db, upload_session_id, chunk_index, chunk_file)
    _, uploaded_chunks = get_uploaded_chunks(db, str(session.id))
    record_operation_log(
        db,
        username=user.username,
        operation_type="上传分片",
        target_type="upload",
        target_name=str(session.id),
        after_data={"chunk_index": chunk_index, "uploaded_chunks": uploaded_chunks},
        **_request_meta(request),
    )
    return UploadChunksResponse(
        upload_session_id=str(session.id),
        total_chunks=session.total_chunks,
        uploaded_chunks=uploaded_chunks,
        status=session.status,
    )


@router.post("/{upload_session_id}/complete", response_model=UploadCompleteResponse)
def complete_upload_route(
    upload_session_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    request: Request = None,
    db: Session = Depends(get_db),
) -> UploadCompleteResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.upload")
    session, merged_sha256 = complete_upload(db, upload_session_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="上传完成",
        target_type="upload",
        target_name=str(session.id),
        after_data={"sha256": merged_sha256, "merged_path": session.merged_path},
        **_request_meta(request),
    )
    return UploadCompleteResponse(
        upload_session_id=str(session.id),
        status=session.status,
        merged_path=session.merged_path or "",
        sha256=merged_sha256,
    )


@router.get("/dedup", response_model=UploadDedupResponse)
def dedup_route(
    sha256: str = Query(...),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> UploadDedupResponse:
    """只读：供上传前判断同 sha 是否已在架；高频调用，不写 operation_logs（与灾难恢复/库修复无关）。"""
    lid = library_id_for_code(library_code)
    exists = live_original_material_exists_by_sha256(db, sha256, library_id=lid)
    session = find_latest_completed_upload_session_by_sha256(db, sha256, library_id=lid) if exists else None
    mf = find_live_original_material_file_by_sha256(db, sha256, library_id=lid) if exists else None
    normalized = sha256.strip().lower()
    return UploadDedupResponse(
        sha256=normalized,
        exists=exists,
        upload_session_id=str(session.id) if session else None,
        material_id=str(mf.material_id) if mf else None,
        material_file_id=str(mf.id) if mf else None,
    )


@router.post("/{upload_session_id}/ingest", response_model=UploadIngestResponse)
def ingest_upload_route(
    upload_session_id: str,
    payload: UploadIngestRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    request: Request = None,
    db: Session = Depends(get_db),
) -> UploadIngestResponse:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.upload")
    session, material, material_file, nas_job = ingest_uploaded_material(db, upload_session_id, payload, user.username)
    record_operation_log(
        db,
        username=user.username,
        operation_type="上传入库",
        target_type="upload",
        target_name=str(session.id),
        after_data={
            "material_id": str(material.id),
            "material_file_id": str(material_file.id),
            "nas_job_id": str(nas_job.id),
        },
        **_request_meta(request),
    )
    return UploadIngestResponse(
        upload_session_id=str(session.id),
        material_id=str(material.id),
        material_file_id=str(material_file.id),
        nas_job_id=str(nas_job.id),
        status=session.status,
    )
