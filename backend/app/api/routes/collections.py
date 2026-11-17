from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import bearer_scheme, decode_access_token, extract_bearer_token
from app.schemas.collection import (
    CollectionCreate,
    CollectionDetail,
    CollectionGroupCreate,
    CollectionGroupPatch,
    CollectionGroupTreeResponse,
    CollectionItemBatchCreate,
    CollectionItemCreate,
    CollectionItemPatch,
    CollectionListResponse,
    CollectionMaterialsResponse,
    CollectionPatch,
    CollectionReorderRequest,
)
from app.services.library_service import library_id_for_code, resolve_library_code
from app.services.collection_service import (
    add_collection_item,
    add_collection_items_batch,
    archive_collection,
    archive_group,
    create_collection,
    create_group,
    delete_collection_item,
    delete_group,
    get_collection_detail,
    list_collection_materials,
    list_collections,
    list_groups_tree,
    patch_collection,
    patch_collection_item,
    _PATCH_GROUP_PARENT_OMIT,
    patch_group,
    reorder_collection_items,
    restore_collection,
    restore_group,
    soft_delete_collection,
)
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import ensure_permission, get_user_permissions

router = APIRouter(prefix="/collections", tags=["collections"])


def _request_meta(request: Request | None) -> dict[str, str | None]:
    if request is None:
        return {"ip_address": None, "user_agent": None}
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }


def _username(credentials: HTTPAuthorizationCredentials | None) -> str:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    return user.username


@router.get("/groups", response_model=CollectionGroupTreeResponse)
def get_groups(
    group_type: str = Query(..., description="personal or project"),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> CollectionGroupTreeResponse:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    items = list_groups_tree(
        db,
        username=username,
        group_type=group_type,
        perms=perms,
        library_id=library_id_for_code(library_code),
    )
    return CollectionGroupTreeResponse(items=items)


@router.post("/groups", status_code=status.HTTP_201_CREATED)
def post_group(
    payload: CollectionGroupCreate,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.create")
    perms = get_user_permissions(db, username)
    row = create_group(
        db,
        username=username,
        name=payload.name,
        group_type=payload.group_type,
        parent_id=payload.parent_id,
        user_group_name=payload.user_group_name,
        perms=perms,
        library_id=library_id_for_code(library_code),
    )
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.group.create",
        target_type="collection",
        target_name=row.name,
        after_data={"id": str(row.id), "group_type": row.group_type},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"id": str(row.id), "name": row.name, "group_type": row.group_type}


@router.patch("/groups/{group_id}")
def patch_group_route(
    group_id: str,
    payload: CollectionGroupPatch,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    patch_in = payload.model_dump(exclude_unset=True)
    row = patch_group(
        db,
        username=username,
        group_id=group_id,
        name=patch_in.get("name"),
        parent_id=patch_in["parent_id"] if "parent_id" in patch_in else _PATCH_GROUP_PARENT_OMIT,
        sort_order=patch_in.get("sort_order"),
        user_group_name=patch_in.get("user_group_name"),
        perms=perms,
    )
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.group.patch",
        target_type="collection",
        target_name=row.name,
        after_data={"id": str(row.id)},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"id": str(row.id), "name": row.name}


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group_route(
    group_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> None:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    delete_group(db, username=username, group_id=group_id, perms=perms)
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.group.delete",
        target_type="collection",
        target_name=group_id,
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )


@router.post("/groups/{group_id}/archive")
def post_group_archive(
    group_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    row = archive_group(db, username=username, group_id=group_id, perms=perms)
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.group.archive",
        target_type="collection",
        target_name=row.name,
        after_data={"id": str(row.id)},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"id": str(row.id), "status": row.status}


@router.post("/groups/{group_id}/restore")
def post_group_restore(
    group_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    row = restore_group(db, username=username, group_id=group_id, perms=perms)
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.group.restore",
        target_type="collection",
        target_name=row.name,
        after_data={"id": str(row.id)},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"id": str(row.id), "status": row.status}


@router.get("", response_model=CollectionListResponse)
def get_collection_list(
    collection_type: str | None = Query(default=None),
    group_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    for_item_edit: bool = Query(default=False, description="项目集合仅返回当前用户对条目可写(edit/manage)的集合"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
) -> CollectionListResponse:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    items, total = list_collections(
        db,
        username=username,
        collection_type=collection_type,
        group_id=group_id,
        status=status,
        keyword=keyword,
        page=page,
        page_size=page_size,
        perms=perms,
        for_item_edit=for_item_edit,
        library_id=library_id_for_code(library_code),
    )
    return CollectionListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("", status_code=status.HTTP_201_CREATED)
def post_collection(
    payload: CollectionCreate,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    library_code: str = Depends(resolve_library_code),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.create")
    perms = get_user_permissions(db, username)
    perm_dicts: list[dict[str, str]] | None = None
    if payload.permissions is not None:
        perm_dicts = [p.model_dump() for p in payload.permissions]
    row = create_collection(
        db,
        username=username,
        name=payload.name,
        description=payload.description,
        collection_type=payload.collection_type,
        group_id=payload.group_id,
        visibility=payload.visibility,
        permissions=perm_dicts,
        perms=perms,
        library_id=library_id_for_code(library_code),
    )
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.create",
        target_type="collection",
        target_name=row.name,
        after_data={"id": str(row.id), "collection_type": row.collection_type},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"id": str(row.id), "name": row.name}


@router.get("/{collection_id}", response_model=CollectionDetail)
def get_collection(
    collection_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CollectionDetail:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    data = get_collection_detail(db, username=username, collection_id=collection_id, perms=perms)
    return CollectionDetail.model_validate(data)


@router.patch("/{collection_id}")
def patch_collection_route(
    collection_id: str,
    payload: CollectionPatch,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    perm_dicts: list[dict[str, str]] | None = None
    if payload.permissions is not None:
        perm_dicts = [p.model_dump() for p in payload.permissions]
    row = patch_collection(
        db,
        username=username,
        collection_id=collection_id,
        name=payload.name,
        description=payload.description,
        group_id=payload.group_id,
        status=payload.status,
        visibility=payload.visibility,
        permissions=perm_dicts,
        perms=perms,
    )
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.patch",
        target_type="collection",
        target_name=row.name,
        after_data={"id": str(row.id), "status": row.status},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"id": str(row.id), "name": row.name, "status": row.status}


@router.post("/{collection_id}/archive")
def post_archive(
    collection_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    row = archive_collection(db, username=username, collection_id=collection_id, perms=perms)
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.archive",
        target_type="collection",
        target_name=row.name,
        after_data={"id": str(row.id)},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"id": str(row.id), "status": row.status}


@router.post("/{collection_id}/restore")
def post_restore(
    collection_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    row = restore_collection(db, username=username, collection_id=collection_id, perms=perms)
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.restore",
        target_type="collection",
        target_name=row.name,
        after_data={"id": str(row.id)},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"id": str(row.id), "status": row.status}


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection_route(
    collection_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> None:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    soft_delete_collection(db, username=username, collection_id=collection_id, perms=perms)
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.delete",
        target_type="collection",
        target_name=collection_id,
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )


@router.get("/{collection_id}/materials", response_model=CollectionMaterialsResponse)
def get_collection_materials(
    collection_id: str,
    keyword: str | None = Query(default=None),
    file_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    sort: str = Query(default="sort_order"),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CollectionMaterialsResponse:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    items, total = list_collection_materials(
        db,
        username=username,
        collection_id=collection_id,
        keyword=keyword,
        file_type=file_type,
        page=page,
        page_size=page_size,
        sort=sort,
        perms=perms,
    )
    return CollectionMaterialsResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("/{collection_id}/items", status_code=status.HTTP_201_CREATED)
def post_item(
    collection_id: str,
    payload: CollectionItemCreate,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    item_id, created = add_collection_item(
        db,
        username=username,
        collection_id=collection_id,
        material_id=payload.material_id,
        material_file_id=payload.material_file_id,
        note=payload.note,
        perms=perms,
    )
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.item.add",
        target_type="collection",
        target_name=collection_id,
        after_data={"item_id": item_id, "material_id": payload.material_id, "created": created},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"status": "success" if created else "already_exists", "item_id": item_id}


@router.post("/{collection_id}/items/batch")
def post_items_batch(
    collection_id: str,
    payload: CollectionItemBatchCreate,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    results = add_collection_items_batch(
        db,
        username=username,
        collection_id=collection_id,
        items=[i.model_dump() for i in payload.items],
        perms=perms,
    )
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.item.batch_add",
        target_type="collection",
        target_name=collection_id,
        after_data={"count": len(results)},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"results": results}


@router.patch("/{collection_id}/items/{item_id}")
def patch_item(
    collection_id: str,
    item_id: str,
    payload: CollectionItemPatch,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    row = patch_collection_item(
        db,
        username=username,
        collection_id=collection_id,
        item_id=item_id,
        note=payload.note,
        sort_order=payload.sort_order,
        perms=perms,
    )
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.item.patch",
        target_type="collection",
        target_name=item_id,
        after_data={"collection_id": collection_id},
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"item_id": str(row.id)}


@router.delete("/{collection_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item_route(
    collection_id: str,
    item_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> None:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    delete_collection_item(db, username=username, collection_id=collection_id, item_id=item_id, perms=perms)
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.item.delete",
        target_type="collection",
        target_name=item_id,
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )


@router.patch("/{collection_id}/items/reorder")
def reorder_items_route(
    collection_id: str,
    payload: CollectionReorderRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> dict:
    username = _username(credentials)
    ensure_permission(db, username, "collection.view")
    perms = get_user_permissions(db, username)
    reorder_collection_items(
        db,
        username=username,
        collection_id=collection_id,
        items=[x.model_dump() for x in payload.items],
        perms=perms,
    )
    meta = _request_meta(request)
    record_operation_log(
        db,
        username=username,
        operation_type="collection.item.reorder",
        target_type="collection",
        target_name=collection_id,
        ip_address=meta["ip_address"],
        user_agent=meta["user_agent"],
    )
    return {"ok": True}
