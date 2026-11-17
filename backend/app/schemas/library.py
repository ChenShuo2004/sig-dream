from __future__ import annotations

from pydantic import BaseModel, Field


class AssetLibraryRead(BaseModel):
    id: str
    code: str
    name: str
    schema_profile: str


class LibraryTaxonomyNodeRead(BaseModel):
    id: str
    library_id: str
    parent_id: str | None = None
    name: str
    sort_order: int = 0
    description: str = ""
    children: list["LibraryTaxonomyNodeRead"] = Field(default_factory=list)


class LibraryTaxonomyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    parent_id: str | None = None
    description: str = Field(default="", max_length=4000)


class LibraryTaxonomyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=4000)
    sort_order: int | None = None


LibraryTaxonomyNodeRead.model_rebuild()

