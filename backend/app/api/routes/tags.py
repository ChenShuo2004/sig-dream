from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    bearer_scheme,
    decode_access_token,
    ensure_internal_access,
    extract_bearer_token,
    resolve_access_context,
)
from app.models.tag import Tag
from app.schemas.tag import (
    TagApplyRequest,
    TagCreate,
    TagMergeRequest,
    TagPatchRequest,
    TagRead,
    TagReorderRequest,
    TagReviewRequest,
    UserTagPreferenceRead,
    UserTagPreferenceUpdateRequest,
)
from app.services.library_service import library_id_for_code, resolve_library_code
from app.services.tag_service import (
    activate_tag,
    apply_tag,
    create_tag,
    delete_tag_to_trash,
    deactivate_tag,
    get_tag_categories,
    list_tags,
    list_active_tags_grouped,
    merge_tag,
    permanently_delete_tag,
    reorder_tags_in_category,
    review_tag_application,
    update_tag_description,
)
from app.services.tag_preference_service import get_or_create_user_tag_preferences, save_user_tag_preferences
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import ensure_permission

router = APIRouter(prefix="/tags", tags=["tags"])


def _tag_read(row: Tag) -> TagRead:
    return TagRead.model_validate(
        {
            "id": str(row.id),
            "name": row.name,
            "category": row.category,
            "description": row.description or "",
            "status": row.status,
            "synonyms": row.synonyms,
            "sort_order": int(getattr(row, "sort_order", 0) or 0),
            "created_at": row.created_at,
        }
    )


@router.get("/categories", response_model=list[str])
def tag_categories(library_code: str = Depends(resolve_library_code)) -> list[str]:
    return get_tag_categories(library_code)


@router.get("/active")
def active_tags(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> dict[str, list[dict[str, str]]]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.view")
    return list_active_tags_grouped(db, library_id=library_id_for_code(library_code), library_code=library_code)


@router.get("", response_model=list[TagRead])
def tags(
    category: str | None = None,
    status: str | None = None,
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> list[TagRead]:
    rows = list_tags(db, library_id=library_id_for_code(library_code), category=category, status_filter=status)
    return [_tag_read(item) for item in rows]


@router.post("/reorder")
def reorder_tags_route(
    payload: TagReorderRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.create")
    ensure_internal_access(access_context)
    reorder_tags_in_category(
        db,
        payload.category,
        payload.ordered_tag_ids,
        library_id=library_id_for_code(library_code),
        library_code=library_code,
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="调整标签顺序",
        target_type="tag",
        target_name=payload.category,
        after_data={"category": payload.category, "count": len(payload.ordered_tag_ids)},
    )
    return {"status": "ok"}


@router.get("/preferences", response_model=UserTagPreferenceRead)
def get_user_tag_preferences(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> UserTagPreferenceRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    pref = get_or_create_user_tag_preferences(db, user.username, library_id=library_id_for_code(library_code))
    return UserTagPreferenceRead(
        favorite_tag_ids=[str(x) for x in (pref.favorite_tag_ids or []) if str(x).strip()],
        recent_tag_ids=[str(x) for x in (pref.recent_tag_ids or []) if str(x).strip()],
    )


@router.put("/preferences", response_model=UserTagPreferenceRead)
def put_user_tag_preferences(
    payload: UserTagPreferenceUpdateRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> UserTagPreferenceRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    pref = save_user_tag_preferences(
        db,
        username=user.username,
        library_id=library_id_for_code(library_code),
        favorite_tag_ids=payload.favorite_tag_ids,
        recent_tag_ids=payload.recent_tag_ids,
    )
    return UserTagPreferenceRead(
        favorite_tag_ids=[str(x) for x in (pref.favorite_tag_ids or []) if str(x).strip()],
        recent_tag_ids=[str(x) for x in (pref.recent_tag_ids or []) if str(x).strip()],
    )


@router.post("/apply", response_model=TagRead)
def apply_tag_route(
    payload: TagApplyRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> TagRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.request")
    row = apply_tag(db, payload, library_id=library_id_for_code(library_code), library_code=library_code)
    record_operation_log(
        db,
        username=user.username,
        operation_type="申请标签",
        target_type="tag",
        target_name=row.name,
        after_data={"status": row.status, "category": row.category},
    )
    return _tag_read(row)


@router.patch("/{tag_id}/review", response_model=TagRead)
def review_tag_route(
    tag_id: str,
    payload: TagReviewRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> TagRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.review")
    row = review_tag_application(db, tag_id, payload.decision)
    record_operation_log(
        db,
        username=user.username,
        operation_type="审核标签申请",
        target_type="tag",
        target_name=row.name,
        after_data={"status": row.status, "decision": payload.decision},
    )
    return _tag_read(row)


@router.post("", response_model=TagRead)
def create_tag_route(
    payload: TagCreate,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> TagRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.create")
    row = create_tag(db, payload, library_id=library_id_for_code(library_code), library_code=library_code)
    record_operation_log(
        db,
        username=user.username,
        operation_type="创建标签",
        target_type="tag",
        target_name=row.name,
        after_data={"category": row.category},
    )
    return _tag_read(row)


@router.patch("/{tag_id}/description", response_model=TagRead)
def patch_tag_description_route(
    tag_id: str,
    payload: TagPatchRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> TagRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.create")
    ensure_internal_access(access_context)
    row = update_tag_description(db, tag_id, payload.description)
    record_operation_log(
        db,
        username=user.username,
        operation_type="更新标签说明",
        target_type="tag",
        target_name=row.name,
        after_data={"description": row.description},
    )
    return _tag_read(row)


@router.patch("/{tag_id}/deactivate", response_model=TagRead)
def deactivate_tag_route(
    tag_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> TagRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.disable")
    ensure_internal_access(access_context)
    row = deactivate_tag(db, tag_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="停用标签",
        target_type="tag",
        target_name=row.name,
        after_data={"status": row.status},
    )
    return _tag_read(row)


@router.post("/merge", response_model=TagRead)
def merge_tag_route(
    payload: TagMergeRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> TagRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.merge")
    ensure_internal_access(access_context)
    row = merge_tag(db, payload.source_tag_id, payload.target_tag_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="合并标签",
        target_type="tag",
        target_name=row.name,
        after_data={"source_tag_id": payload.source_tag_id, "target_tag_id": payload.target_tag_id},
    )
    return _tag_read(row)


@router.patch("/{tag_id}/activate", response_model=TagRead)
def activate_tag_route(
    tag_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> TagRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.disable")
    ensure_internal_access(access_context)
    row = activate_tag(db, tag_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="启用标签",
        target_type="tag",
        target_name=row.name,
        after_data={"status": row.status},
    )
    return _tag_read(row)


@router.patch("/{tag_id}/trash", response_model=TagRead)
def delete_tag_to_trash_route(
    tag_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> TagRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.delete")
    ensure_internal_access(access_context)
    row = delete_tag_to_trash(db, tag_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="删除标签",
        target_type="tag",
        target_name=row.name,
        after_data={"status": row.status},
    )
    return _tag_read(row)


@router.delete("/{tag_id}/permanent")
def permanently_delete_tag_route(
    tag_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_context: str = Depends(resolve_access_context),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.delete")
    ensure_internal_access(access_context)
    deleted_id = permanently_delete_tag(db, tag_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="彻底删除标签",
        target_type="tag",
        target_name=deleted_id,
        success=True,
    )
    return {"tag_id": deleted_id, "status": "deleted"}
