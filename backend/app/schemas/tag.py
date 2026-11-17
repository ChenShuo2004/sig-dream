from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TagBase(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    category: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=4000)


class TagCreate(TagBase):
    synonyms: list[str] = Field(default_factory=list)


class TagRead(TagBase):
    id: str
    status: str
    synonyms: list[str]
    sort_order: int
    created_at: datetime


class TagReorderRequest(BaseModel):
    """按「单一分类」内顺序重写该分类下所有标签的 sort_order（须列出该分类下每一条各一次）。"""

    category: str = Field(min_length=1, max_length=64)
    ordered_tag_ids: list[str] = Field(min_length=1)


class TagPatchRequest(BaseModel):
    description: str = Field(default="", max_length=4000)


class TagMergeRequest(BaseModel):
    source_tag_id: str
    target_tag_id: str


class TagApplyRequest(TagBase):
    synonyms: list[str] = Field(default_factory=list)


class TagReviewRequest(BaseModel):
    decision: Literal["approve", "reject"]


class UserTagPreferenceRead(BaseModel):
    favorite_tag_ids: list[str] = Field(default_factory=list)
    recent_tag_ids: list[str] = Field(default_factory=list)


class UserTagPreferenceUpdateRequest(BaseModel):
    favorite_tag_ids: list[str] | None = None
    recent_tag_ids: list[str] | None = None
