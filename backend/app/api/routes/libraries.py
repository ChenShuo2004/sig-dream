from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import bearer_scheme, decode_access_token, extract_bearer_token
from app.schemas.library import (
    AssetLibraryRead,
    LibraryTaxonomyCreate,
    LibraryTaxonomyNodeRead,
    LibraryTaxonomyPatch,
)
from app.services.library_service import (
    create_taxonomy_node,
    delete_taxonomy_node,
    get_library_by_code,
    list_libraries,
    list_taxonomy_tree,
    patch_taxonomy_node,
    serialize_library,
)
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import ensure_permission

router = APIRouter(prefix="/libraries", tags=["libraries"])


@router.get("", response_model=list[AssetLibraryRead])
def libraries_list(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> list[AssetLibraryRead]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "asset.view")
    return [AssetLibraryRead.model_validate(serialize_library(row)) for row in list_libraries(db)]


@router.get("/{library_code}/taxonomy", response_model=list[LibraryTaxonomyNodeRead])
def libraries_taxonomy(
    library_code: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> list[LibraryTaxonomyNodeRead]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.view")
    library = get_library_by_code(db, library_code)
    return [LibraryTaxonomyNodeRead.model_validate(item) for item in list_taxonomy_tree(db, library.id)]


@router.post("/{library_code}/taxonomy", response_model=LibraryTaxonomyNodeRead)
def libraries_taxonomy_create(
    library_code: str,
    payload: LibraryTaxonomyCreate,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> LibraryTaxonomyNodeRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.create")
    library = get_library_by_code(db, library_code)
    row = create_taxonomy_node(
        db,
        library_id=library.id,
        name=payload.name,
        parent_id=payload.parent_id,
        description=payload.description,
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="创建库内分类",
        target_type="taxonomy",
        target_name=row.name,
        after_data={"id": str(row.id), "library": library.code, "parent_id": str(row.parent_id) if row.parent_id else None},
    )
    tree = list_taxonomy_tree(db, library.id)
    for root in tree:
        if root["id"] == str(row.id):
            return LibraryTaxonomyNodeRead.model_validate(root)
        for child in root.get("children") or []:
            if child["id"] == str(row.id):
                return LibraryTaxonomyNodeRead.model_validate(child)
    return LibraryTaxonomyNodeRead.model_validate(
        {
            "id": str(row.id),
            "library_id": str(row.library_id),
            "parent_id": str(row.parent_id) if row.parent_id else None,
            "name": row.name,
            "sort_order": row.sort_order,
            "description": row.description or "",
            "children": [],
        }
    )


@router.patch("/{library_code}/taxonomy/{node_id}", response_model=LibraryTaxonomyNodeRead)
def libraries_taxonomy_patch(
    library_code: str,
    node_id: str,
    payload: LibraryTaxonomyPatch,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> LibraryTaxonomyNodeRead:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.create")
    library = get_library_by_code(db, library_code)
    row = patch_taxonomy_node(
        db,
        library_id=library.id,
        node_id=node_id,
        name=payload.name,
        description=payload.description,
        sort_order=payload.sort_order,
    )
    record_operation_log(
        db,
        username=user.username,
        operation_type="更新库内分类",
        target_type="taxonomy",
        target_name=row.name,
        after_data={"id": str(row.id), "library": library.code},
    )
    return LibraryTaxonomyNodeRead.model_validate(
        {
            "id": str(row.id),
            "library_id": str(row.library_id),
            "parent_id": str(row.parent_id) if row.parent_id else None,
            "name": row.name,
            "sort_order": row.sort_order,
            "description": row.description or "",
            "children": [],
        }
    )


@router.delete("/{library_code}/taxonomy/{node_id}")
def libraries_taxonomy_delete(
    library_code: str,
    node_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    token = extract_bearer_token(credentials)
    user = decode_access_token(token)
    ensure_permission(db, user.username, "tag.delete")
    library = get_library_by_code(db, library_code)
    delete_taxonomy_node(db, library_id=library.id, node_id=node_id)
    record_operation_log(
        db,
        username=user.username,
        operation_type="删除库内分类",
        target_type="taxonomy",
        target_name=node_id,
        after_data={"library": library.code},
    )
    return {"status": "ok"}
