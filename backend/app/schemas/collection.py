from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CollectionGroupTreeResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    items: list[dict[str, Any]]


class CollectionGroupCreate(BaseModel):
    name: str
    group_type: str
    parent_id: str | None = None
    user_group_name: str | None = None


class CollectionGroupPatch(BaseModel):
    name: str | None = None
    parent_id: str | None = None
    sort_order: int | None = None
    user_group_name: str | None = None


class ProjectPermissionInput(BaseModel):
    user_group_name: str
    permission_level: str


class CollectionCreate(BaseModel):
    name: str
    description: str | None = None
    collection_type: str
    group_id: str | None = None
    visibility: str | None = None
    permissions: list[ProjectPermissionInput] | None = None


class CollectionPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    group_id: str | None = None
    status: str | None = None
    visibility: str | None = None
    permissions: list[ProjectPermissionInput] | None = None


class CollectionListItem(BaseModel):
    id: str
    name: str
    collection_type: str
    group_id: str | None
    status: str
    item_count: int
    created_by_name: str
    created_at: datetime


class CollectionListResponse(BaseModel):
    items: list[CollectionListItem]
    total: int
    page: int
    page_size: int


class CollectionDetail(BaseModel):
    id: str
    name: str
    description: str | None
    collection_type: str
    group_id: str | None
    status: str
    visibility: str
    permission_level: str | None
    item_count: int
    created_by_name: str
    created_at: datetime
    permissions: list[dict[str, str]] = Field(default_factory=list)


class CollectionItemRead(BaseModel):
    item_id: str
    material_id: str
    material_file_id: str | None
    primary_file_id: str | None = None
    title: str
    description: str | None = None
    thumbnail_url: str | None
    file_type: str
    tags: list[str]
    note: str | None
    sort_order: int
    added_by_name: str
    added_at: datetime
    original_filename: str | None = None
    file_size: int | None = None
    primary_media_width: int | None = None
    primary_media_height: int | None = None
    download_count: int = 0
    material_status: str = "available"


class CollectionMaterialsResponse(BaseModel):
    items: list[CollectionItemRead]
    total: int
    page: int
    page_size: int


class CollectionItemCreate(BaseModel):
    material_id: str
    material_file_id: str | None = None
    note: str | None = None


class CollectionItemBatchCreate(BaseModel):
    items: list[CollectionItemCreate]


class CollectionItemPatch(BaseModel):
    note: str | None = None
    sort_order: int | None = None


class CollectionReorderEntry(BaseModel):
    item_id: str
    sort_order: int


class CollectionReorderRequest(BaseModel):
    items: list[CollectionReorderEntry]


class MaterialCollectRequest(BaseModel):
    collection_id: str
    material_file_id: str | None = None
    note: str | None = None


class MaterialCollectResponse(BaseModel):
    status: str
    item_id: str
